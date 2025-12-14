#!/usr/bin/env bun
/**
 * mem0.ai integration for persistent memory across gemini sessions.
 * Stores research findings, summaries, and key insights in vector store.
 *
 * Enhanced with full OffloadMetadata schema, local index fallback,
 * and entity-scoped memory model.
 *
 * Entity Scoping Model (mem0 constraint: ONE entity space per memory):
 *   - Project memories: user_id=project_hash only (queryable per-project)
 *   - Session memories: user_id=project_hash + run_id=session_name (queryable per-session)
 *   - Agent memories: user_id="gemini-offloader" (cross-project knowledge)
 *
 * IMPORTANT: Do NOT combine agent_id + user_id in the same memory.
 * mem0 queries ONE entity space at a time. Combining entities creates
 * unretrievable memories.
 *
 * Prerequisites:
 *   bun add mem0ai
 *
 * Usage:
 *   bun run scripts/memory.ts status
 *   bun run scripts/memory.ts add --user "research" --text "Key finding..."
 *   bun run scripts/memory.ts search --user "research" --query "WASM performance"
 *   bun run scripts/memory.ts get --user "research"
 *   bun run scripts/memory.ts delete --id "memory_id"
 *   bun run scripts/memory.ts index-offload --summary "..." --metadata '{...}'
 *   echo '{"response":"..."}' | bun run scripts/memory.ts store-response --user "research" --topic "wasm"
 *
 *   # Entity-scoped search (new model):
 *   bun run scripts/memory.ts search-scoped --scope agent --query "patterns"           # Cross-project agent knowledge
 *   bun run scripts/memory.ts search-scoped --scope project --project "abc123" --query "conventions"  # Project-specific
 *   bun run scripts/memory.ts search-scoped --scope session --project "abc123" --session "research-1" --query "current"  # Session-specific
 *   bun run scripts/memory.ts get-scoped --scope agent                                 # All agent memories
 *   bun run scripts/memory.ts get-scoped --scope project --project "abc123"            # All project memories
 *   bun run scripts/memory.ts migrate-legacy                                           # Analyze legacy user_id="offloads" memories
 *
 *   # Filter local index with various criteria:
 *   bun run scripts/memory.ts filter-local --since 7d                    # Last 7 days
 *   bun run scripts/memory.ts filter-local --session "research-wasm"     # By session name
 *   bun run scripts/memory.ts filter-local --source "sessions/*"         # By source path pattern
 *   bun run scripts/memory.ts filter-local --topic "performance"         # By topic
 *   bun run scripts/memory.ts filter-local --query "memory" --since 1m   # Combined filters
 *   bun run scripts/memory.ts filter-local --global                      # Search all projects
 *
 * Output JSON:
 *   {
 *     "action": "add",
 *     "success": true,
 *     "memory_id": "abc123",
 *     "error": null
 *   }
 */

import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import {
  appendToLocalIndex,
  loadLocalIndex,
  getProjectHash,
  getMem0Mode,
  getMem0LocalConfig,
  isProjectDirectory,
  getOrCreateProject,
  type OffloadMetadata
} from "./state";

// Dual-mode mem0 support: hosted API or local OSS
let MemoryOSS: any = null;
let MemoryClient: any = null;
let memoryInstance: any = null;
let currentMode: "hosted" | "local" | null = null;

async function loadMem0OSS(): Promise<boolean> {
  try {
    const mem0 = await import("mem0ai/oss");
    MemoryOSS = mem0.Memory || mem0.default?.Memory || mem0.default;
    return MemoryOSS != null;
  } catch (e) {
    return false;
  }
}

async function loadMem0Hosted(): Promise<boolean> {
  try {
    const mem0 = await import("mem0ai");
    MemoryClient = mem0.default || mem0.MemoryClient || mem0;
    return MemoryClient != null;
  } catch (e) {
    return false;
  }
}

async function getLocalMemoryConfig() {
  const localConfig = await getMem0LocalConfig();
  const historyDbPath = join(homedir(), ".gemini_offloader", "memory.db");

  return {
    llm: {
      provider: localConfig.llm_provider,
      config: {
        model: localConfig.llm_model,
        apiKey: process.env.GROQ_API_KEY,
      }
    },
    embedder: {
      provider: localConfig.embedder_provider,
      config: {
        model: localConfig.embedder_model,
      }
    },
    vectorStore: {
      provider: "memory",
      config: {
        collectionName: "offloads",
        dimension: 768,
      }
    },
    historyDbPath,
  };
}

/**
 * Get mem0 memory instance with proper mode handling.
 * Exported for use by other scripts (e.g., sync.ts).
 *
 * Returns cached instance if mode hasn't changed.
 * Dispatches to hosted or local mode based on config.
 */
export async function getMemory(): Promise<{ memory: any; error: string | null; mode: "hosted" | "local" }> {
  const mode = await getMem0Mode();

  // Return cached instance if mode matches
  if (memoryInstance && currentMode === mode) {
    return { memory: memoryInstance, error: null, mode };
  }

  if (mode === "hosted") {
    // Hosted mem0 API
    const available = await loadMem0Hosted();
    if (!available) {
      return { memory: null, error: "mem0ai not installed. Run: bun add mem0ai", mode };
    }

    const apiKey = process.env.MEM0_API_KEY;
    if (!apiKey) {
      return { memory: null, error: "MEM0_API_KEY not set. Required for hosted mem0.", mode };
    }

    try {
      memoryInstance = new MemoryClient({ apiKey });
      currentMode = mode;
      return { memory: memoryInstance, error: null, mode };
    } catch (e) {
      return { memory: null, error: `Failed to initialize hosted mem0: ${e}`, mode };
    }
  } else {
    // Local mem0 OSS
    const available = await loadMem0OSS();
    if (!available) {
      return { memory: null, error: "mem0ai/oss not installed. Run: bun add mem0ai", mode };
    }

    if (!process.env.GROQ_API_KEY) {
      return { memory: null, error: "GROQ_API_KEY not set. Required for local mem0 LLM.", mode };
    }

    try {
      const config = await getLocalMemoryConfig();
      memoryInstance = new MemoryOSS(config);
      currentMode = mode;
      return { memory: memoryInstance, error: null, mode };
    } catch (e) {
      return { memory: null, error: `Failed to initialize local mem0: ${e}`, mode };
    }
  }
}

async function cmdStatus() {
  const mode = await getMem0Mode();
  const { memory, error, mode: activeMode } = await getMemory();

  const result: Record<string, unknown> = {
    action: "status",
    mem0_mode: mode,
    success: !error
  };

  if (mode === "hosted") {
    result.mem0_api_key_set = !!process.env.MEM0_API_KEY;
    result.config = { provider: "mem0.ai hosted API" };
  } else {
    const localConfig = await getMem0LocalConfig();
    result.groq_api_key_set = !!process.env.GROQ_API_KEY;
    result.config = {
      llm: `${localConfig.llm_provider}/${localConfig.llm_model}`,
      embedder: `${localConfig.embedder_provider}/${localConfig.embedder_model}`,
      vectorStore: "memory (in-memory)",
    };
  }

  if (error) {
    result.error = error;
  } else {
    result.memory_initialized = true;
  }

  return result;
}

async function cmdAdd(args: { user: string; text: string; topic?: string; metadata?: string }) {
  const { memory, error, mode } = await getMemory();
  if (error) {
    return { action: "add", success: false, error };
  }

  try {
    let metadata: Record<string, unknown> = {};
    if (args.metadata) {
      metadata = JSON.parse(args.metadata);
    }

    metadata.timestamp = new Date().toISOString();
    metadata.source = "gemini-offloader";

    if (args.topic) {
      metadata.topic = args.topic;
    }

    let result;
    if (mode === "hosted") {
      // Hosted API: expects Array<Message>, uses user_id (snake_case)
      const messages = [{ role: "user" as const, content: args.text }];
      result = await memory.add(messages, { user_id: args.user, metadata });
    } else {
      // OSS API: accepts string, uses userId (camelCase)
      result = await memory.add(args.text, { userId: args.user, metadata });
    }

    return {
      action: "add",
      success: true,
      result,
      user: args.user
    };
  } catch (e) {
    return { action: "add", success: false, error: String(e) };
  }
}

async function cmdSearch(args: { user: string; query: string; limit?: number }) {
  const { memory, error, mode } = await getMemory();
  if (error) {
    return { action: "search", success: false, error };
  }

  try {
    let results;
    if (mode === "hosted") {
      // Hosted API: uses user_id (snake_case)
      results = await memory.search(args.query, {
        user_id: args.user,
        limit: args.limit || 5
      });
    } else {
      // OSS API: uses userId (camelCase)
      results = await memory.search(args.query, {
        userId: args.user,
        limit: args.limit || 5
      });
    }

    return {
      action: "search",
      success: true,
      query: args.query,
      user: args.user,
      results
    };
  } catch (e) {
    return { action: "search", success: false, error: String(e) };
  }
}

async function cmdGet(args: { user: string }) {
  const { memory, error, mode } = await getMemory();
  if (error) {
    return { action: "get", success: false, error };
  }

  try {
    let results;
    if (mode === "hosted") {
      // Hosted API: uses user_id (snake_case)
      results = await memory.getAll({ user_id: args.user });
    } else {
      // OSS API: uses userId (camelCase)
      results = await memory.getAll({ userId: args.user });
    }

    // Normalize response format (hosted returns array, OSS returns { results: [] })
    const memories = Array.isArray(results) ? results : results?.results || [];

    return {
      action: "get",
      success: true,
      user: args.user,
      count: memories.length,
      memories
    };
  } catch (e) {
    return { action: "get", success: false, error: String(e) };
  }
}

async function cmdDelete(args: { id: string }) {
  const { memory, error } = await getMemory();
  if (error) {
    return { action: "delete", success: false, error };
  }

  try {
    await memory.delete(args.id);

    return {
      action: "delete",
      success: true,
      deleted_id: args.id
    };
  } catch (e) {
    return { action: "delete", success: false, error: String(e) };
  }
}

// Entity constants for mem0 scoping
const AGENT_ID = "gemini-offloader";

/**
 * Index an offload result with full OffloadMetadata schema.
 * Falls back to local index if mem0 is unavailable.
 * This is the primary function used by query.ts and session.ts.
 *
 * Entity scoping (mem0 constraint: ONE entity space per memory):
 * - Project memories: user_id=project_hash only
 * - Session memories: user_id=project_hash + run_id=session_name
 *
 * Note: mem0 queries ONE entity space at a time. Combining agent_id + user_id
 * creates memories that are unretrievable. Each memory must belong to exactly
 * one entity type for reliable querying.
 */
export async function indexOffload(
  summary: string,
  metadata: OffloadMetadata
): Promise<{ success: boolean; mem0_indexed: boolean; local_indexed: boolean; error: string | null }> {
  let mem0Indexed = false;
  let localIndexed = false;
  let error: string | null = null;

  // Try mem0 first
  const { memory, error: mem0Error, mode } = await getMemory();
  if (memory && !mem0Error) {
    try {
      if (mode === "hosted") {
        // Hosted API: expects Array<Message>, uses snake_case
        const messages = [{ role: "user" as const, content: summary }];

        // Single entity space model (mem0 requirement):
        // - user_id only for project scope (queryable via user_id)
        // - user_id + run_id for session scope (queryable via user_id + run_id)
        // Do NOT combine agent_id + user_id - creates unretrievable memories
        const entityScope: Record<string, unknown> = {
          user_id: metadata.project_hash,
          metadata: metadata as Record<string, unknown>
        };

        // Add run_id for session-scoped memories
        if (metadata.session_name) {
          entityScope.run_id = metadata.session_name;
        }

        await memory.add(messages, entityScope);
      } else {
        // OSS API: uses camelCase
        const entityScope: Record<string, unknown> = {
          userId: metadata.project_hash,
          metadata: metadata as Record<string, unknown>
        };

        if (metadata.session_name) {
          entityScope.runId = metadata.session_name;
        }

        await memory.add(summary, entityScope);
      }
      mem0Indexed = true;
    } catch (e) {
      error = `mem0 indexing failed: ${e}`;
    }
  }

  // Always update local index as backup
  try {
    await appendToLocalIndex(summary, metadata);
    localIndexed = true;
  } catch (e) {
    if (!error) {
      error = `Local indexing failed: ${e}`;
    } else {
      error += `; Local indexing also failed: ${e}`;
    }
  }

  return {
    success: mem0Indexed || localIndexed,
    mem0_indexed: mem0Indexed,
    local_indexed: localIndexed,
    error: (mem0Indexed || localIndexed) ? null : error
  };
}

/**
 * Search scopes for entity-based memory retrieval.
 * Follows mem0 best practices for layered memory access.
 */
export type SearchScope = "agent" | "project" | "session";

export interface ScopedSearchOptions {
  query: string;
  scope: SearchScope;
  projectHash?: string;
  sessionName?: string;
  limit?: number;
}

/**
 * Search memories with entity scoping.
 *
 * Scopes:
 * - "agent": Cross-project agent knowledge (agent_id only)
 * - "project": Project-specific context (agent_id + user_id)
 * - "session": Current session context (agent_id + user_id + run_id)
 */
export async function searchScoped(options: ScopedSearchOptions): Promise<{
  success: boolean;
  scope: SearchScope;
  results: unknown[];
  error: string | null;
}> {
  const { memory, error: mem0Error, mode } = await getMemory();

  if (mem0Error || !memory) {
    // Fall back to local index search
    const localResults = await searchLocalIndex(options.query, options.limit || 5);
    return {
      success: true,
      scope: options.scope,
      results: localResults,
      error: mem0Error ? `mem0 unavailable, used local index: ${mem0Error}` : null
    };
  }

  try {
    if (mode === "hosted") {
      // Build search options based on scope
      // mem0 constraint: query ONE entity space at a time
      const searchOpts: Record<string, unknown> = {
        limit: options.limit || 10
      };

      switch (options.scope) {
        case "agent":
          // Agent scope uses AGENT_ID as user_id (workaround for cross-project)
          // Since mem0 doesn't support agent_id-only queries reliably,
          // we use a dedicated user_id for agent-level memories
          searchOpts.user_id = AGENT_ID;
          break;

        case "project":
          // Project scope: user_id only
          if (!options.projectHash) {
            return { success: false, scope: options.scope, results: [], error: "projectHash required for project scope" };
          }
          searchOpts.user_id = options.projectHash;
          break;

        case "session":
          // Session scope: user_id + run_id
          if (!options.projectHash || !options.sessionName) {
            return { success: false, scope: options.scope, results: [], error: "projectHash and sessionName required for session scope" };
          }
          searchOpts.user_id = options.projectHash;
          searchOpts.run_id = options.sessionName;
          break;
      }

      const results = await memory.search(options.query, searchOpts);

      return {
        success: true,
        scope: options.scope,
        results: results?.results || results || [],
        error: null
      };
    } else {
      // OSS mode - single entity space per query
      const searchOpts: Record<string, unknown> = {
        limit: options.limit || 10
      };

      if (options.scope === "agent") {
        searchOpts.userId = AGENT_ID;
      } else if (options.projectHash) {
        searchOpts.userId = options.projectHash;
      }

      if (options.scope === "session" && options.sessionName) {
        searchOpts.runId = options.sessionName;
      }

      const results = await memory.search(options.query, searchOpts);

      return {
        success: true,
        scope: options.scope,
        results: results?.results || results || [],
        error: null
      };
    }
  } catch (e) {
    return { success: false, scope: options.scope, results: [], error: String(e) };
  }
}

/**
 * Get all memories for a given scope.
 */
export async function getAllScoped(options: {
  scope: SearchScope;
  projectHash?: string;
  sessionName?: string;
}): Promise<{
  success: boolean;
  scope: SearchScope;
  count: number;
  memories: unknown[];
  error: string | null;
}> {
  const { memory, error: mem0Error, mode } = await getMemory();

  if (mem0Error || !memory) {
    return { success: false, scope: options.scope, count: 0, memories: [], error: mem0Error || "mem0 not available" };
  }

  try {
    let getOpts: Record<string, unknown>;

    if (mode === "hosted") {
      // mem0 constraint: query ONE entity space at a time
      getOpts = {};

      switch (options.scope) {
        case "agent":
          // Agent scope uses AGENT_ID as user_id (workaround)
          getOpts.user_id = AGENT_ID;
          break;
        case "project":
          getOpts.user_id = options.projectHash;
          break;
        case "session":
          getOpts.user_id = options.projectHash;
          if (options.sessionName) {
            getOpts.run_id = options.sessionName;
          }
          break;
      }
    } else {
      // OSS mode - single entity space per query
      getOpts = {};

      switch (options.scope) {
        case "agent":
          getOpts.userId = AGENT_ID;
          break;
        case "project":
          getOpts.userId = options.projectHash;
          break;
        case "session":
          getOpts.userId = options.projectHash;
          if (options.sessionName) {
            getOpts.runId = options.sessionName;
          }
          break;
      }
    }

    const results = await memory.getAll(getOpts);
    const memories = Array.isArray(results) ? results : results?.results || [];

    return {
      success: true,
      scope: options.scope,
      count: memories.length,
      memories,
      error: null
    };
  } catch (e) {
    return { success: false, scope: options.scope, count: 0, memories: [], error: String(e) };
  }
}

async function cmdIndexOffload(args: { summary: string; metadata: string }) {
  try {
    const metadata: OffloadMetadata = JSON.parse(args.metadata);
    const result = await indexOffload(args.summary, metadata);

    return {
      action: "index-offload",
      ...result
    };
  } catch (e) {
    return {
      action: "index-offload",
      success: false,
      mem0_indexed: false,
      local_indexed: false,
      error: `Failed to parse metadata: ${e}`
    };
  }
}

/**
 * Search local index when mem0 is unavailable.
 */
async function searchLocalIndex(query: string, limit: number = 5): Promise<Array<{
  id: string;
  summary: string;
  metadata: OffloadMetadata;
  score: number;
}>> {
  const index = await loadLocalIndex();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);

  // Simple keyword matching with scoring
  const scored = index.entries.map(entry => {
    const summaryLower = entry.summary.toLowerCase();
    let score = 0;

    for (const term of queryTerms) {
      if (summaryLower.includes(term)) {
        score += 1;
      }
    }

    // Boost recent entries
    const age = Date.now() - new Date(entry.metadata.timestamp).getTime();
    const daysSinceCreated = age / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < 7) score += 0.5;
    if (daysSinceCreated < 1) score += 0.5;

    return { ...entry, score };
  });

  return scored
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Parse relative time strings like "7d", "2w", "1m" into dates
 */
function parseRelativeTime(sinceStr: string): Date | null {
  const now = new Date();

  // Try ISO date first
  const isoDate = new Date(sinceStr);
  if (!isNaN(isoDate.getTime())) {
    return isoDate;
  }

  // Parse relative time: 7d, 2w, 1m, 1y
  const match = sinceStr.match(/^(\d+)([dwmy])$/i);
  if (!match) return null;

  const amount = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case "d":
      now.setDate(now.getDate() - amount);
      break;
    case "w":
      now.setDate(now.getDate() - amount * 7);
      break;
    case "m":
      now.setMonth(now.getMonth() - amount);
      break;
    case "y":
      now.setFullYear(now.getFullYear() - amount);
      break;
    default:
      return null;
  }

  return now;
}

interface FilterOptions {
  query?: string;
  since?: string;
  source?: string;
  session?: string;
  topic?: string;
  global?: boolean;
  limit?: number;
}

/**
 * Filter local index with multiple criteria
 */
async function filterLocalIndex(options: FilterOptions): Promise<Array<{
  id: string;
  summary: string;
  metadata: OffloadMetadata;
  matchReasons: string[];
}>> {
  const index = await loadLocalIndex();
  const currentProjectHash = options.global ? null : await getProjectHash();

  const results: Array<{
    id: string;
    summary: string;
    metadata: OffloadMetadata;
    matchReasons: string[];
  }> = [];

  // Parse since date if provided
  const sinceDate = options.since ? parseRelativeTime(options.since) : null;

  // Parse query terms if provided
  const queryTerms = options.query
    ? options.query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    : [];

  for (const entry of index.entries) {
    const matchReasons: string[] = [];

    // Filter by project (unless global)
    if (currentProjectHash && entry.metadata.project_hash !== currentProjectHash) {
      continue;
    }

    // Filter by since date
    if (sinceDate) {
      const entryDate = new Date(entry.metadata.timestamp);
      if (entryDate < sinceDate) continue;
      matchReasons.push(`after ${options.since}`);
    }

    // Filter by source pattern
    if (options.source) {
      const pattern = options.source.toLowerCase();
      const sourcePath = entry.metadata.source_path.toLowerCase();
      // Simple glob-like matching: * matches anything
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
      if (!regex.test(sourcePath) && !sourcePath.includes(pattern)) {
        continue;
      }
      matchReasons.push(`source: ${options.source}`);
    }

    // Filter by session name
    if (options.session) {
      if (!entry.metadata.session_name) continue;
      if (!entry.metadata.session_name.toLowerCase().includes(options.session.toLowerCase())) {
        continue;
      }
      matchReasons.push(`session: ${entry.metadata.session_name}`);
    }

    // Filter by topic
    if (options.topic) {
      const topicLower = options.topic.toLowerCase();
      const hasMatchingTopic = entry.metadata.topics.some(t =>
        t.toLowerCase().includes(topicLower)
      );
      if (!hasMatchingTopic) continue;
      matchReasons.push(`topic: ${options.topic}`);
    }

    // Filter by query terms (keyword search)
    if (queryTerms.length > 0) {
      const summaryLower = entry.summary.toLowerCase();
      const matchingTerms = queryTerms.filter(term => summaryLower.includes(term));
      if (matchingTerms.length === 0) continue;
      matchReasons.push(`keywords: ${matchingTerms.join(", ")}`);
    }

    // Entry passed all filters
    results.push({
      id: entry.id,
      summary: entry.summary,
      metadata: entry.metadata,
      matchReasons: matchReasons.length > 0 ? matchReasons : ["all filters"]
    });
  }

  // Sort by timestamp (newest first)
  results.sort((a, b) =>
    new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
  );

  // Apply limit
  const limit = options.limit || 10;
  return results.slice(0, limit);
}

async function cmdFilterLocal(options: FilterOptions) {
  try {
    // Auto-initialize project if in a git directory
    if (!options.global && isProjectDirectory()) {
      await getOrCreateProject();
    }

    const results = await filterLocalIndex(options);

    // Check if we should suggest --global
    let hint: string | undefined;
    if (results.length === 0 && !options.global) {
      const index = await loadLocalIndex();
      if (index.entries.length > 0) {
        hint = `No results for current project. Use --global to search all ${index.entries.length} indexed entries.`;
      }
    }

    return {
      action: "filter-local",
      success: true,
      filters: {
        query: options.query || null,
        since: options.since || null,
        source: options.source || null,
        session: options.session || null,
        topic: options.topic || null,
        global: options.global || false
      },
      count: results.length,
      hint,
      results: results.map(r => ({
        id: r.id,
        summary: r.summary.slice(0, 500) + (r.summary.length > 500 ? "..." : ""),
        timestamp: r.metadata.timestamp,
        source_path: r.metadata.source_path,
        session_name: r.metadata.session_name,
        type: r.metadata.type,
        match_reasons: r.matchReasons
      }))
    };
  } catch (e) {
    return { action: "filter-local", success: false, error: String(e) };
  }
}

async function cmdStoreResponse(args: { user: string; topic: string; file?: string }) {
  const { memory, error, mode } = await getMemory();
  if (error) {
    return { action: "store-response", success: false, error };
  }

  try {
    let data: Record<string, unknown>;

    if (args.file) {
      data = await Bun.file(args.file).json();
    } else if (!Bun.stdin.isTTY) {
      const reader = Bun.stdin.stream().getReader();
      const chunks: Buffer[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      data = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
    } else {
      return {
        action: "store-response",
        success: false,
        error: "No input provided. Pipe JSON or use --file"
      };
    }

    const responseText = (data.response || data.text || JSON.stringify(data)) as string;

    const metadata = {
      timestamp: new Date().toISOString(),
      source: "gemini-offloader",
      topic: args.topic,
      model: data.model,
      tokens: data.tokens
    };

    let result;
    if (mode === "hosted") {
      // Hosted API: expects Array<Message>, uses user_id (snake_case)
      const messages = [{ role: "user" as const, content: responseText }];
      result = await memory.add(messages, { user_id: args.user, metadata });
    } else {
      // OSS API: accepts string, uses userId (camelCase)
      result = await memory.add(responseText, { userId: args.user, metadata });
    }

    return {
      action: "store-response",
      success: true,
      result,
      user: args.user,
      topic: args.topic,
      text_length: responseText.length
    };
  } catch (e) {
    return { action: "store-response", success: false, error: String(e) };
  }
}

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(JSON.stringify({
      success: false,
      error: "Usage: memory.ts <status|add|search|get|delete|store-response|search-local|filter-local|search-scoped|get-scoped|migrate-legacy> [options]"
    }, null, 2));
    process.exit(1);
  }

  // Parse options
  const parseOptions = (args: string[]) => {
    const opts: Record<string, string | number | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--user" || args[i] === "-u") opts.user = args[++i];
      else if (args[i] === "--text" || args[i] === "-t") opts.text = args[++i];
      else if (args[i] === "--topic") opts.topic = args[++i];
      else if (args[i] === "--metadata" || args[i] === "-m") opts.metadata = args[++i];
      else if (args[i] === "--query" || args[i] === "-q") opts.query = args[++i];
      else if (args[i] === "--limit" || args[i] === "-l") opts.limit = parseInt(args[++i]);
      else if (args[i] === "--id") opts.id = args[++i];
      else if (args[i] === "--file" || args[i] === "-f") opts.file = args[++i];
      else if (args[i] === "--summary" || args[i] === "-s") opts.summary = args[++i];
      // Filter options
      else if (args[i] === "--since") opts.since = args[++i];
      else if (args[i] === "--source") opts.source = args[++i];
      else if (args[i] === "--session") opts.session = args[++i];
      else if (args[i] === "--global" || args[i] === "-g") opts.global = true;
      // Scoped search options
      else if (args[i] === "--scope") opts.scope = args[++i];
      else if (args[i] === "--project" || args[i] === "-p") opts.project = args[++i];
    }
    return opts;
  };

  const opts = parseOptions(args.slice(1));
  let result: Record<string, unknown>;

  switch (command) {
    case "status":
      result = await cmdStatus();
      break;
    case "add":
      if (!opts.user || !opts.text) {
        result = { success: false, error: "add requires --user and --text" };
      } else {
        result = await cmdAdd({
          user: opts.user as string,
          text: opts.text as string,
          topic: opts.topic as string | undefined,
          metadata: opts.metadata as string | undefined
        });
      }
      break;
    case "search":
      if (!opts.user || !opts.query) {
        result = { success: false, error: "search requires --user and --query" };
      } else {
        result = await cmdSearch({
          user: opts.user as string,
          query: opts.query as string,
          limit: opts.limit as number | undefined
        });
      }
      break;
    case "get":
      if (!opts.user) {
        result = { success: false, error: "get requires --user" };
      } else {
        result = await cmdGet({ user: opts.user as string });
      }
      break;
    case "delete":
      if (!opts.id) {
        result = { success: false, error: "delete requires --id" };
      } else {
        result = await cmdDelete({ id: opts.id as string });
      }
      break;
    case "store-response":
      if (!opts.user || !opts.topic) {
        result = { success: false, error: "store-response requires --user and --topic" };
      } else {
        result = await cmdStoreResponse({
          user: opts.user as string,
          topic: opts.topic as string,
          file: opts.file as string | undefined
        });
      }
      break;
    case "index-offload":
      if (!opts.summary || !opts.metadata) {
        result = { success: false, error: "index-offload requires --summary and --metadata" };
      } else {
        result = await cmdIndexOffload({
          summary: opts.summary as string,
          metadata: opts.metadata as string
        });
      }
      break;
    case "search-local":
      if (!opts.query) {
        result = { success: false, error: "search-local requires --query" };
      } else {
        const localResults = await searchLocalIndex(
          opts.query as string,
          (opts.limit as number) || 5
        );
        result = {
          action: "search-local",
          success: true,
          query: opts.query,
          count: localResults.length,
          results: localResults
        };
      }
      break;
    case "filter-local":
      // Supports: --query, --since, --source, --session, --topic, --global, --limit
      result = await cmdFilterLocal({
        query: opts.query as string | undefined,
        since: opts.since as string | undefined,
        source: opts.source as string | undefined,
        session: opts.session as string | undefined,
        topic: opts.topic as string | undefined,
        global: opts.global as boolean | undefined,
        limit: opts.limit as number | undefined
      });
      break;

    case "search-scoped": {
      // Entity-scoped search: --scope (agent|project|session) --query --project --session --limit
      const scope = (opts.scope as string) || "agent";
      if (!["agent", "project", "session"].includes(scope)) {
        result = { success: false, error: "scope must be one of: agent, project, session" };
      } else if (!opts.query) {
        result = { success: false, error: "search-scoped requires --query" };
      } else {
        result = await searchScoped({
          query: opts.query as string,
          scope: scope as SearchScope,
          projectHash: opts.project as string | undefined,
          sessionName: opts.session as string | undefined,
          limit: opts.limit as number | undefined
        });
        result.action = "search-scoped";
      }
      break;
    }

    case "get-scoped": {
      // Entity-scoped get all: --scope (agent|project|session) --project --session
      const scope = (opts.scope as string) || "agent";
      if (!["agent", "project", "session"].includes(scope)) {
        result = { success: false, error: "scope must be one of: agent, project, session" };
      } else {
        result = await getAllScoped({
          scope: scope as SearchScope,
          projectHash: opts.project as string | undefined,
          sessionName: opts.session as string | undefined
        });
        result.action = "get-scoped";
      }
      break;
    }

    case "migrate-legacy": {
      // Migrate old user_id="offloads" memories to new entity model
      // This is a read-only analysis - actual migration would require delete + re-add
      const { memory, error: mem0Error, mode } = await getMemory();
      if (mem0Error || !memory) {
        result = { action: "migrate-legacy", success: false, error: mem0Error || "mem0 not available" };
      } else {
        try {
          // Get all legacy memories
          let legacyMemories;
          if (mode === "hosted") {
            legacyMemories = await memory.getAll({ user_id: "offloads" });
          } else {
            legacyMemories = await memory.getAll({ userId: "offloads" });
          }

          const memories = Array.isArray(legacyMemories) ? legacyMemories : legacyMemories?.results || [];

          // Analyze what would be migrated
          const analysis = {
            total_legacy_memories: memories.length,
            by_project: {} as Record<string, number>,
            by_session: {} as Record<string, number>,
            missing_project_hash: 0
          };

          for (const mem of memories) {
            const projectHash = mem.metadata?.project_hash;
            const sessionName = mem.metadata?.session_name;

            if (projectHash) {
              analysis.by_project[projectHash] = (analysis.by_project[projectHash] || 0) + 1;
            } else {
              analysis.missing_project_hash++;
            }

            if (sessionName) {
              analysis.by_session[sessionName] = (analysis.by_session[sessionName] || 0) + 1;
            }
          }

          result = {
            action: "migrate-legacy",
            success: true,
            message: "Analysis complete. Legacy memories found under user_id='offloads'. New memories will use agent_id + user_id (project_hash) + run_id (session_name).",
            analysis,
            note: "To actually migrate, you would need to re-index each memory with the new entity model. The metadata already contains project_hash and session_name."
          };
        } catch (e) {
          result = { action: "migrate-legacy", success: false, error: String(e) };
        }
      }
      break;
    }

    default:
      result = { success: false, error: `Unknown command: ${command}` };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

// Only run main() when this file is the entry point
if (import.meta.main) {
  main();
}
