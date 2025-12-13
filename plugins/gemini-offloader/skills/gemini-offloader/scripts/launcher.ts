#!/usr/bin/env bun
/**
 * launcher.ts - Interactive skill initialization
 *
 * Outputs structured options and current state for AskUserQuestion flow.
 * Run this when the skill is activated to determine user intent.
 */

import { existsSync } from "fs";
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// State paths
const BASE_DIR = join(homedir(), ".gemini_offloader");
const CONFIG_FILE = join(BASE_DIR, "config.json");
const PROJECTS_DIR = join(BASE_DIR, "projects");
const INDEX_FILE = join(BASE_DIR, "index.json");

interface Operation {
  id: string;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
  context?: Record<string, unknown>;
}

interface LauncherResult {
  success: boolean;

  // System state
  ready: boolean;
  installed: boolean;
  authenticated: boolean;
  state_initialized: boolean;

  // Current project context
  project: {
    path: string;
    hash: string;
    cache_entries: number;
    active_sessions: string[];
  } | null;

  // Global stats
  global: {
    total_projects: number;
    total_cache_entries: number;
    total_sessions: number;
    index_entries: number;
  };

  // Available operations for AskUserQuestion
  operations: Operation[];

  // Suggested action based on context
  suggestion: {
    operation: string;
    reason: string;
  } | null;

  error: string | null;
}

async function findGemini(): Promise<string | null> {
  const paths = [
    join(homedir(), ".nvm/versions/node", process.version, "bin/gemini"),
    "/usr/local/bin/gemini",
    "/usr/bin/gemini",
    join(homedir(), ".local/bin/gemini"),
  ];

  // Check PATH
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(":")) {
    paths.push(join(dir, "gemini"));
  }

  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // Try which
  try {
    const proc = Bun.spawn(["which", "gemini"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(proc.stdout).text();
    if (output.trim()) return output.trim();
  } catch {}

  return null;
}

async function checkAuthentication(): Promise<{ authenticated: boolean; method: string | null }> {
  // Check for API key first
  if (process.env.GEMINI_API_KEY) {
    return { authenticated: true, method: "api_key" };
  }

  // Check for OAuth tokens
  const configDir = join(homedir(), ".config", "gemini-cli");
  const tokenFile = join(configDir, "oauth_tokens.json");

  if (existsSync(tokenFile)) {
    try {
      const content = await readFile(tokenFile, "utf-8");
      const tokens = JSON.parse(content);
      if (tokens.access_token) {
        return { authenticated: true, method: "oauth" };
      }
    } catch {}
  }

  return { authenticated: false, method: null };
}

async function getProjectHash(): Promise<string> {
  const cwd = process.cwd();

  // Try to get git remote
  try {
    const proc = Bun.spawn(["git", "remote", "get-url", "origin"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd,
    });
    const output = await new Response(proc.stdout).text();
    if (output.trim()) {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(`${output.trim()}:${cwd}`);
      return hasher.digest("hex").slice(0, 16);
    }
  } catch {}

  // Fallback to cwd only
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(cwd);
  return hasher.digest("hex").slice(0, 16);
}

async function getGlobalStats(): Promise<{
  total_projects: number;
  total_cache_entries: number;
  total_sessions: number;
  index_entries: number;
}> {
  const stats = {
    total_projects: 0,
    total_cache_entries: 0,
    total_sessions: 0,
    index_entries: 0,
  };

  if (!existsSync(PROJECTS_DIR)) return stats;

  try {
    const projects = await readdir(PROJECTS_DIR);
    stats.total_projects = projects.length;

    for (const proj of projects) {
      const projDir = join(PROJECTS_DIR, proj);
      const cacheDir = join(projDir, "cache");
      const sessionsDir = join(projDir, "sessions");

      if (existsSync(cacheDir)) {
        const cacheEntries = await readdir(cacheDir);
        stats.total_cache_entries += cacheEntries.length;
      }

      if (existsSync(sessionsDir)) {
        const sessions = await readdir(sessionsDir);
        stats.total_sessions += sessions.length;
      }
    }

    // Count index entries
    if (existsSync(INDEX_FILE)) {
      const indexContent = await readFile(INDEX_FILE, "utf-8");
      const index = JSON.parse(indexContent);
      stats.index_entries = index.entries?.length || 0;
    }
  } catch {}

  return stats;
}

async function getProjectContext(projectHash: string): Promise<{
  path: string;
  hash: string;
  cache_entries: number;
  active_sessions: string[];
} | null> {
  const projDir = join(PROJECTS_DIR, projectHash);

  if (!existsSync(projDir)) return null;

  const context = {
    path: process.cwd(),
    hash: projectHash,
    cache_entries: 0,
    active_sessions: [] as string[],
  };

  try {
    const cacheDir = join(projDir, "cache");
    if (existsSync(cacheDir)) {
      const entries = await readdir(cacheDir);
      context.cache_entries = entries.length;
    }

    const sessionsDir = join(projDir, "sessions");
    if (existsSync(sessionsDir)) {
      const sessions = await readdir(sessionsDir);
      context.active_sessions = sessions;
    }
  } catch {}

  return context;
}

function buildOperations(
  installed: boolean,
  authenticated: boolean,
  stateInitialized: boolean,
  project: { cache_entries: number; active_sessions: string[] } | null,
  global: { total_cache_entries: number; index_entries: number }
): Operation[] {
  const ops: Operation[] = [];

  // Research a topic
  ops.push({
    id: "research",
    label: "Research a new topic",
    description: "Send a query to Gemini with optional local file context. Results are cached automatically.",
    available: installed && authenticated,
    reason: !installed ? "gemini-cli not installed" : !authenticated ? "Authentication required" : undefined,
  });

  // Manage sessions
  const hasSessions = (project?.active_sessions.length || 0) > 0;
  ops.push({
    id: "sessions",
    label: "Manage research sessions",
    description: hasSessions
      ? `Create, continue, or delete multi-turn sessions. ${project?.active_sessions.length} active session(s).`
      : "Create multi-turn research sessions for deep dives.",
    available: installed && authenticated,
    reason: !installed ? "gemini-cli not installed" : !authenticated ? "Authentication required" : undefined,
    context: hasSessions ? { sessions: project?.active_sessions } : undefined,
  });

  // Search past research
  const hasCache = global.total_cache_entries > 0 || global.index_entries > 0;
  ops.push({
    id: "search",
    label: "Search past research",
    description: hasCache
      ? `Search ${global.index_entries} indexed entries across ${global.total_cache_entries} cached queries.`
      : "Search previously cached research (no entries yet).",
    available: hasCache,
    reason: !hasCache ? "No cached research to search" : undefined,
  });

  // Store/manage memories
  ops.push({
    id: "memory",
    label: "Store or manage memories",
    description: "Add findings to memory, retrieve past memories, or store Gemini responses.",
    available: true,
  });

  // Check status
  ops.push({
    id: "status",
    label: "Check system status",
    description: "Verify gemini-cli installation, authentication, and state directory.",
    available: true,
  });

  // Cache/sync operations
  ops.push({
    id: "sync",
    label: "Manage cache and sync",
    description: stateInitialized
      ? "View stats, check drift, rebuild index, or prune orphans."
      : "Initialize state directory and sync operations.",
    available: true,
    context: stateInitialized ? { initialized: true } : { initialized: false },
  });

  return ops;
}

function determineSuggestion(
  installed: boolean,
  authenticated: boolean,
  stateInitialized: boolean,
  project: { cache_entries: number; active_sessions: string[] } | null
): { operation: string; reason: string } | null {
  // Not ready - suggest status check
  if (!installed || !authenticated) {
    return {
      operation: "status",
      reason: !installed
        ? "gemini-cli needs to be installed first"
        : "Authentication required before using Gemini",
    };
  }

  // Has active sessions - suggest continuing
  if (project && project.active_sessions.length > 0) {
    return {
      operation: "sessions",
      reason: `You have ${project.active_sessions.length} active session(s) you can continue`,
    };
  }

  // State not initialized - suggest sync
  if (!stateInitialized) {
    return {
      operation: "sync",
      reason: "State directory not initialized - run init first",
    };
  }

  // Default - suggest research
  return {
    operation: "research",
    reason: "Ready to research a new topic",
  };
}

async function main() {
  const result: LauncherResult = {
    success: false,
    ready: false,
    installed: false,
    authenticated: false,
    state_initialized: false,
    project: null,
    global: {
      total_projects: 0,
      total_cache_entries: 0,
      total_sessions: 0,
      index_entries: 0,
    },
    operations: [],
    suggestion: null,
    error: null,
  };

  try {
    // Check installation
    const geminiPath = await findGemini();
    result.installed = !!geminiPath;

    // Check authentication
    const auth = await checkAuthentication();
    result.authenticated = auth.authenticated;

    // Check state initialization
    result.state_initialized = existsSync(BASE_DIR) && existsSync(CONFIG_FILE);

    // Get global stats
    result.global = await getGlobalStats();

    // Get project context
    const projectHash = await getProjectHash();
    result.project = await getProjectContext(projectHash);

    // Build operations
    result.operations = buildOperations(
      result.installed,
      result.authenticated,
      result.state_initialized,
      result.project,
      result.global
    );

    // Determine suggestion
    result.suggestion = determineSuggestion(
      result.installed,
      result.authenticated,
      result.state_initialized,
      result.project
    );

    // Overall readiness
    result.ready = result.installed && result.authenticated;
    result.success = true;

  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

// Only run when executed directly
if (import.meta.main) {
  main();
}

export { LauncherResult, Operation };
