#!/usr/bin/env bun
/**
 * mem0.ai integration for persistent memory across gemini sessions.
 * Stores research findings, summaries, and key insights in vector store.
 *
 * Enhanced with full OffloadMetadata schema and local index fallback.
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

async function getMemory(): Promise<{ memory: any; error: string | null; mode: "hosted" | "local" }> {
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

/**
 * Index an offload result with full OffloadMetadata schema.
 * Falls back to local index if mem0 is unavailable.
 * This is the primary function used by query.ts and session.ts.
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
        // Hosted API: expects Array<Message>, uses user_id (snake_case)
        const messages = [{ role: "user" as const, content: summary }];
        await memory.add(messages, {
          user_id: "offloads",
          metadata: metadata as Record<string, unknown>
        });
      } else {
        // OSS API: accepts string, uses userId (camelCase)
        await memory.add(summary, {
          userId: "offloads",
          metadata: metadata as Record<string, unknown>
        });
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
    const results = await filterLocalIndex(options);

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
      error: "Usage: memory.ts <status|add|search|get|delete|store-response|search-local|filter-local> [options]"
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
