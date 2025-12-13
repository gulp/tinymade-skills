#!/usr/bin/env bun
/**
 * Sync filesystem state with mem0 index.
 *
 * Usage:
 *   bun run scripts/sync.ts rebuild    # Re-index all files into mem0
 *   bun run scripts/sync.ts prune      # Remove orphaned mem0 entries
 *   bun run scripts/sync.ts check      # Report drift between filesystem and mem0
 *   bun run scripts/sync.ts stats      # Show sync statistics
 *
 * Output JSON:
 *   {
 *     "success": true,
 *     "action": "rebuild",
 *     "indexed": 15,
 *     "pruned": 3,
 *     "errors": []
 *   }
 */

import { parseArgs } from "util";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import {
  getBasePaths,
  loadConfig,
  loadLocalIndex,
  appendToLocalIndex,
  type CacheMetadata,
  type SessionMetadata,
  type OffloadMetadata
} from "./state";

interface SyncResult {
  success: boolean;
  action: "rebuild" | "prune" | "check" | "stats";
  mem0_available: boolean;
  indexed: number;
  pruned: number;
  skipped: number;
  drift: {
    filesystem_only: string[];
    index_only: string[];
    in_sync: number;
  };
  errors: string[];
}

async function checkMem0Available(): Promise<boolean> {
  try {
    const mem0 = await import("mem0ai");
    return true;
  } catch {
    return false;
  }
}

async function getMem0Memory() {
  try {
    const mem0Module = await import("mem0ai");
    const Memory = mem0Module.default || mem0Module.Memory;
    return new Memory();
  } catch {
    return null;
  }
}

async function getAllCacheEntries(): Promise<Array<{
  projectHash: string;
  sourceHash: string;
  metadata: CacheMetadata;
  summaryPath: string;
}>> {
  const { PROJECTS_DIR } = getBasePaths();
  const entries: Array<{
    projectHash: string;
    sourceHash: string;
    metadata: CacheMetadata;
    summaryPath: string;
  }> = [];

  if (!existsSync(PROJECTS_DIR)) return entries;

  const projects = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  for (const project of projects) {
    if (!project.isDirectory()) continue;

    const cacheDir = join(PROJECTS_DIR, project.name, "cache");
    if (!existsSync(cacheDir)) continue;

    const caches = readdirSync(cacheDir, { withFileTypes: true });
    for (const cache of caches) {
      if (!cache.isDirectory()) continue;

      const metadataPath = join(cacheDir, cache.name, "metadata.json");
      const summaryPath = join(cacheDir, cache.name, "summary.md");

      if (!existsSync(metadataPath) || !existsSync(summaryPath)) continue;

      try {
        const metadata: CacheMetadata = await Bun.file(metadataPath).json();
        entries.push({
          projectHash: project.name,
          sourceHash: cache.name,
          metadata,
          summaryPath
        });
      } catch {
        // Skip invalid entries
      }
    }
  }

  return entries;
}

async function getAllSessionEntries(): Promise<Array<{
  projectHash: string;
  sessionName: string;
  metadata: SessionMetadata;
  summaryPath: string;
}>> {
  const { PROJECTS_DIR } = getBasePaths();
  const entries: Array<{
    projectHash: string;
    sessionName: string;
    metadata: SessionMetadata;
    summaryPath: string;
  }> = [];

  if (!existsSync(PROJECTS_DIR)) return entries;

  const projects = readdirSync(PROJECTS_DIR, { withFileTypes: true });
  for (const project of projects) {
    if (!project.isDirectory()) continue;

    const sessionsDir = join(PROJECTS_DIR, project.name, "sessions");
    if (!existsSync(sessionsDir)) continue;

    const sessions = readdirSync(sessionsDir, { withFileTypes: true });
    for (const session of sessions) {
      if (!session.isDirectory()) continue;

      const sessionPath = join(sessionsDir, session.name, "session.json");
      const summaryPath = join(sessionsDir, session.name, "summary.md");

      if (!existsSync(sessionPath) || !existsSync(summaryPath)) continue;

      try {
        const metadata: SessionMetadata = await Bun.file(sessionPath).json();
        entries.push({
          projectHash: project.name,
          sessionName: session.name,
          metadata,
          summaryPath
        });
      } catch {
        // Skip invalid entries
      }
    }
  }

  return entries;
}

async function rebuild(): Promise<SyncResult> {
  const errors: string[] = [];
  let indexed = 0;
  let skipped = 0;

  const mem0Available = await checkMem0Available();
  const memory = mem0Available ? await getMem0Memory() : null;

  // Get all cache entries
  const cacheEntries = await getAllCacheEntries();
  const sessionEntries = await getAllSessionEntries();

  // Index cache entries
  for (const entry of cacheEntries) {
    try {
      const summary = await Bun.file(entry.summaryPath).text();
      const offloadMetadata = entry.metadata.offload_metadata;

      if (memory) {
        await memory.add(summary, {
          user_id: "offloads",
          metadata: offloadMetadata
        });
      }

      // Always update local index as backup
      await appendToLocalIndex(summary, offloadMetadata);
      indexed++;
    } catch (e) {
      errors.push(`Cache ${entry.sourceHash}: ${e}`);
      skipped++;
    }
  }

  // Index session entries (latest summary only)
  for (const entry of sessionEntries) {
    try {
      const summary = await Bun.file(entry.summaryPath).text();

      const sessionMetadata: OffloadMetadata = {
        project_hash: entry.projectHash,
        project_path: "",
        source_path: entry.sessionName,
        source_hash: entry.sessionName,
        source_type: "folder",
        session_name: entry.sessionName,
        turn_number: entry.metadata.turn_count,
        timestamp: entry.metadata.last_turn_at,
        type: "research",
        topics: [],
        model: "",
        prompt_hash: "",
        response_file: entry.summaryPath,
        token_count: 0
      };

      if (memory) {
        await memory.add(summary, {
          user_id: "offloads",
          metadata: sessionMetadata
        });
      }

      await appendToLocalIndex(summary, sessionMetadata);
      indexed++;
    } catch (e) {
      errors.push(`Session ${entry.sessionName}: ${e}`);
      skipped++;
    }
  }

  return {
    success: errors.length === 0,
    action: "rebuild",
    mem0_available: mem0Available,
    indexed,
    pruned: 0,
    skipped,
    drift: { filesystem_only: [], index_only: [], in_sync: indexed },
    errors
  };
}

async function prune(): Promise<SyncResult> {
  const errors: string[] = [];
  let pruned = 0;

  const mem0Available = await checkMem0Available();

  // Get all filesystem entry IDs
  const cacheEntries = await getAllCacheEntries();
  const sessionEntries = await getAllSessionEntries();

  const filesystemIds = new Set<string>();
  for (const entry of cacheEntries) {
    const id = `${entry.projectHash}:${entry.sourceHash}`;
    filesystemIds.add(id);
  }
  for (const entry of sessionEntries) {
    const id = `${entry.projectHash}:${entry.sessionName}`;
    filesystemIds.add(id);
  }

  // Prune local index
  const localIndex = await loadLocalIndex();
  const originalCount = localIndex.entries.length;
  localIndex.entries = localIndex.entries.filter(entry => {
    const id = `${entry.metadata.project_hash}:${entry.metadata.source_hash}`;
    return filesystemIds.has(id);
  });
  pruned = originalCount - localIndex.entries.length;

  if (pruned > 0) {
    localIndex.last_updated = new Date().toISOString();
    await Bun.write(getBasePaths().INDEX_FILE, JSON.stringify(localIndex, null, 2));
  }

  // Note: mem0 pruning would require listing all memories and comparing
  // This is expensive and would need pagination - skip for now

  return {
    success: true,
    action: "prune",
    mem0_available: mem0Available,
    indexed: 0,
    pruned,
    skipped: 0,
    drift: { filesystem_only: [], index_only: [], in_sync: localIndex.entries.length },
    errors
  };
}

async function check(): Promise<SyncResult> {
  const cacheEntries = await getAllCacheEntries();
  const sessionEntries = await getAllSessionEntries();
  const localIndex = await loadLocalIndex();

  const filesystemIds = new Set<string>();
  for (const entry of cacheEntries) {
    filesystemIds.add(`${entry.projectHash}:${entry.sourceHash}`);
  }
  for (const entry of sessionEntries) {
    filesystemIds.add(`${entry.projectHash}:${entry.sessionName}`);
  }

  const indexIds = new Set<string>();
  for (const entry of localIndex.entries) {
    indexIds.add(`${entry.metadata.project_hash}:${entry.metadata.source_hash}`);
  }

  const filesystemOnly: string[] = [];
  const indexOnly: string[] = [];
  let inSync = 0;

  for (const id of filesystemIds) {
    if (indexIds.has(id)) {
      inSync++;
    } else {
      filesystemOnly.push(id);
    }
  }

  for (const id of indexIds) {
    if (!filesystemIds.has(id)) {
      indexOnly.push(id);
    }
  }

  const mem0Available = await checkMem0Available();

  return {
    success: true,
    action: "check",
    mem0_available: mem0Available,
    indexed: 0,
    pruned: 0,
    skipped: 0,
    drift: {
      filesystem_only: filesystemOnly,
      index_only: indexOnly,
      in_sync: inSync
    },
    errors: []
  };
}

async function stats(): Promise<SyncResult> {
  const cacheEntries = await getAllCacheEntries();
  const sessionEntries = await getAllSessionEntries();
  const localIndex = await loadLocalIndex();
  const mem0Available = await checkMem0Available();

  return {
    success: true,
    action: "stats",
    mem0_available: mem0Available,
    indexed: localIndex.entries.length,
    pruned: 0,
    skipped: 0,
    drift: {
      filesystem_only: [],
      index_only: [],
      in_sync: cacheEntries.length + sessionEntries.length
    },
    errors: []
  };
}

async function main() {
  const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {},
    allowPositionals: true
  });

  const action = positionals[0] || "stats";
  let result: SyncResult;

  switch (action) {
    case "rebuild":
      result = await rebuild();
      break;
    case "prune":
      result = await prune();
      break;
    case "check":
      result = await check();
      break;
    case "stats":
    default:
      result = await stats();
      break;
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
