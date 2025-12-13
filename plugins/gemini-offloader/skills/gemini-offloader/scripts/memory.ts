#!/usr/bin/env bun
/**
 * mem0.ai integration for persistent memory across gemini sessions.
 * Stores research findings, summaries, and key insights in vector store.
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
 *   echo '{"response":"..."}' | bun run scripts/memory.ts store-response --user "research" --topic "wasm"
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

// Dynamic import for mem0 (may not be installed)
let Memory: any = null;

async function loadMem0(): Promise<boolean> {
  try {
    const mem0 = await import("mem0ai");
    Memory = mem0.Memory || mem0.default?.Memory;
    return Memory !== null;
  } catch {
    return false;
  }
}

function getConfigPath(): string {
  return join(homedir(), ".config", "gemini-offloader", "mem0_config.json");
}

async function loadConfig(): Promise<Record<string, unknown>> {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      return await Bun.file(configPath).json();
    } catch {
      // Ignore
    }
  }
  return { version: "v1.1" };
}

async function getMemory(): Promise<{ memory: any; error: string | null }> {
  const available = await loadMem0();
  if (!available) {
    return {
      memory: null,
      error: "mem0 not installed. Run: bun add mem0ai"
    };
  }

  try {
    const config = await loadConfig();
    const m = new Memory(config);
    return { memory: m, error: null };
  } catch (e) {
    // Try simple initialization
    try {
      const m = new Memory();
      return { memory: m, error: null };
    } catch (e2) {
      return {
        memory: null,
        error: `Failed to initialize mem0: ${e2}`
      };
    }
  }
}

async function cmdStatus() {
  const available = await loadMem0();

  const result: Record<string, unknown> = {
    action: "status",
    mem0_installed: available,
    success: available
  };

  if (!available) {
    result.error = "mem0 not installed. Run: bun add mem0ai";
    result.install_command = "bun add mem0ai";
  } else {
    const { memory, error } = await getMemory();
    if (error) {
      result.success = false;
      result.error = error;
    } else {
      result.config_path = getConfigPath();
      result.memory_initialized = true;
    }
  }

  return result;
}

async function cmdAdd(args: { user: string; text: string; topic?: string; metadata?: string }) {
  const { memory, error } = await getMemory();
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

    const result = await memory.add(args.text, { user_id: args.user, metadata });

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
  const { memory, error } = await getMemory();
  if (error) {
    return { action: "search", success: false, error };
  }

  try {
    const results = await memory.search(args.query, {
      user_id: args.user,
      limit: args.limit || 5
    });

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
  const { memory, error } = await getMemory();
  if (error) {
    return { action: "get", success: false, error };
  }

  try {
    const results = await memory.getAll({ user_id: args.user });

    return {
      action: "get",
      success: true,
      user: args.user,
      count: results?.length || 0,
      memories: results
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

async function cmdStoreResponse(args: { user: string; topic: string; file?: string }) {
  const { memory, error } = await getMemory();
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

    const result = await memory.add(responseText, {
      user_id: args.user,
      metadata
    });

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
      error: "Usage: memory.ts <status|add|search|get|delete|store-response> [options]"
    }, null, 2));
    process.exit(1);
  }

  // Parse options
  const parseOptions = (args: string[]) => {
    const opts: Record<string, string | number> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--user" || args[i] === "-u") opts.user = args[++i];
      else if (args[i] === "--text" || args[i] === "-t") opts.text = args[++i];
      else if (args[i] === "--topic") opts.topic = args[++i];
      else if (args[i] === "--metadata" || args[i] === "-m") opts.metadata = args[++i];
      else if (args[i] === "--query" || args[i] === "-q") opts.query = args[++i];
      else if (args[i] === "--limit" || args[i] === "-l") opts.limit = parseInt(args[++i]);
      else if (args[i] === "--id") opts.id = args[++i];
      else if (args[i] === "--file" || args[i] === "-f") opts.file = args[++i];
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
    default:
      result = { success: false, error: `Unknown command: ${command}` };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
