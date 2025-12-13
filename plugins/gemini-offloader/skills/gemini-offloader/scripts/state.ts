#!/usr/bin/env bun
/**
 * State manager for gemini-offloader persistence layer.
 * Handles directory structure, caching, and metadata management.
 *
 * Filesystem is source of truth, mem0 is semantic index layer.
 */

import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { $ } from "bun";

// ============================================================================
// Types
// ============================================================================

export interface FileInfo {
  path: string;
  mtime: number;
  size: number;
}

export interface CacheMetadata {
  version: "1.0.0";
  created_at: string;
  prompt: string;
  prompt_hash: string;
  source_files: FileInfo[];
  model: string;
  response_tokens: number;
  offload_metadata: OffloadMetadata;
}

export interface OffloadMetadata {
  project_hash: string;
  project_path: string;
  source_path: string;
  source_hash: string;
  source_type: "folder" | "file" | "stdin";
  session_name: string | null;
  turn_number: number | null;
  timestamp: string;
  type: "offload" | "research" | "synthesis";
  topics: string[];
  model: string;
  prompt_hash: string;
  response_file: string;
  token_count: number;
}

export interface SessionMetadata {
  version: "1.0.0";
  session_name: string;
  created_at: string;
  last_turn_at: string;
  turn_count: number;
  gemini_session_index: number;
  turns: Array<{
    turn_number: number;
    timestamp: string;
    prompt: string;
    response_file: string;
    tokens: number;
  }>;
}

export interface Mem0LocalConfig {
  llm_provider: string;
  llm_model: string;
  embedder_provider: string;
  embedder_model: string;
}

export interface GlobalConfig {
  version: "1.0.0";
  default_model: string;
  cache_enabled: boolean;
  cache_ttl_days: number;
  mem0_enabled: boolean;
  mem0_mode: "hosted" | "local";
  mem0_local_config: Mem0LocalConfig;
  summary_max_tokens: number;
  projects: Record<string, {
    last_access: string;
    source_count: number;
    session_count: number;
    mem0_mode?: "hosted" | "local";  // per-project override
  }>;
}

export interface LocalIndex {
  version: "1.0.0";
  last_updated: string;
  entries: Array<{
    id: string;
    summary: string;
    metadata: OffloadMetadata;
  }>;
}

export interface CacheLookupResult {
  hit: boolean;
  stale: boolean;
  cache_dir: string | null;
  metadata: CacheMetadata | null;
  summary: string | null;
  full_response_path: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const BASE_DIR = join(homedir(), ".gemini_offloader");
const CONFIG_FILE = join(BASE_DIR, "config.json");
const INDEX_FILE = join(BASE_DIR, "index.json");
const PROJECTS_DIR = join(BASE_DIR, "projects");

const DEFAULT_CONFIG: GlobalConfig = {
  version: "1.0.0",
  default_model: "gemini-2.5-pro",
  cache_enabled: true,
  cache_ttl_days: 30,
  mem0_enabled: true,
  mem0_mode: "hosted",
  mem0_local_config: {
    llm_provider: "groq",
    llm_model: "llama-3.1-8b-instant",
    embedder_provider: "ollama",
    embedder_model: "nomic-embed-text"
  },
  summary_max_tokens: 500,
  projects: {}
};

// ============================================================================
// Directory Management
// ============================================================================

export function ensureBaseDir(): void {
  if (!existsSync(BASE_DIR)) {
    mkdirSync(BASE_DIR, { recursive: true });
  }
  if (!existsSync(PROJECTS_DIR)) {
    mkdirSync(PROJECTS_DIR, { recursive: true });
  }
}

export function ensureProjectDir(projectHash: string): string {
  ensureBaseDir();
  const projectDir = join(PROJECTS_DIR, projectHash);
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, "cache"), { recursive: true });
    mkdirSync(join(projectDir, "sessions"), { recursive: true });
  }
  return projectDir;
}

export function ensureCacheDir(projectHash: string, sourceHash: string): string {
  const projectDir = ensureProjectDir(projectHash);
  const cacheDir = join(projectDir, "cache", sourceHash);
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

export function ensureSessionDir(projectHash: string, sessionName: string): string {
  const projectDir = ensureProjectDir(projectHash);
  const sessionDir = join(projectDir, "sessions", sessionName);
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true });
  }
  return sessionDir;
}

export function getBasePaths() {
  return {
    BASE_DIR,
    CONFIG_FILE,
    INDEX_FILE,
    PROJECTS_DIR
  };
}

// ============================================================================
// Hashing
// ============================================================================

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Check if current directory is a valid project directory (has .git)
 */
export function isProjectDirectory(): boolean {
  const cwd = process.cwd();
  return existsSync(join(cwd, ".git"));
}

export async function getProjectHash(): Promise<string> {
  const cwd = process.cwd();
  try {
    const remote = await $`git remote get-url origin 2>/dev/null`.text();
    return hashContent(`${remote.trim()}:${cwd}`);
  } catch {
    return hashContent(cwd);
  }
}

/**
 * Get project hash and auto-initialize project directory if valid git repo
 */
export async function getOrCreateProject(): Promise<{ hash: string; initialized: boolean } | null> {
  if (!isProjectDirectory()) {
    return null;
  }
  const hash = await getProjectHash();
  const projectDir = join(PROJECTS_DIR, hash);
  const existed = existsSync(projectDir);
  ensureProjectDir(hash);
  await updateProjectAccess(hash);
  return { hash, initialized: !existed };
}

export async function getProjectPath(): Promise<string> {
  return process.cwd();
}

export async function generateSourceHash(args: {
  prompt: string;
  includeDirs?: string;
  model?: string;
}): Promise<{ hash: string; files: FileInfo[]; sourceType: "folder" | "file" | "stdin" }> {
  const hashInput = [args.prompt, args.model || "default"];
  const files: FileInfo[] = [];
  let sourceType: "folder" | "file" | "stdin" = "stdin";

  if (args.includeDirs) {
    const dirs = args.includeDirs.split(",").map(d => d.trim());

    for (const dir of dirs) {
      const resolvedPath = resolve(dir);
      if (!existsSync(resolvedPath)) continue;

      const stat = statSync(resolvedPath);
      if (stat.isDirectory()) {
        sourceType = "folder";
        const dirFiles = collectFilesSync(resolvedPath);
        for (const file of dirFiles) {
          const fileStat = statSync(file);
          files.push({
            path: file,
            mtime: fileStat.mtimeMs,
            size: fileStat.size
          });
          hashInput.push(file);
          hashInput.push(String(fileStat.size));
        }
      } else {
        sourceType = "file";
        files.push({
          path: resolvedPath,
          mtime: stat.mtimeMs,
          size: stat.size
        });
        hashInput.push(resolvedPath);
        hashInput.push(String(stat.size));
      }
    }
  }

  const hash = hashContent(hashInput.join("|"));
  return { hash, files, sourceType };
}

function collectFilesSync(dir: string, maxDepth: number = 5, currentDepth: number = 0): string[] {
  if (currentDepth >= maxDepth) return [];

  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectFilesSync(fullPath, maxDepth, currentDepth + 1));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    // Permission denied or other error
  }
  return files;
}

// ============================================================================
// Config Management
// ============================================================================

export async function loadConfig(): Promise<GlobalConfig> {
  ensureBaseDir();
  if (!existsSync(CONFIG_FILE)) {
    await saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    return await Bun.file(CONFIG_FILE).json();
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: GlobalConfig): Promise<void> {
  ensureBaseDir();
  await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export async function getMem0Mode(projectHash?: string): Promise<"hosted" | "local"> {
  const config = await loadConfig();
  if (projectHash && config.projects[projectHash]?.mem0_mode) {
    return config.projects[projectHash].mem0_mode!;
  }
  return config.mem0_mode || "hosted";
}

export async function getMem0LocalConfig(): Promise<GlobalConfig["mem0_local_config"]> {
  const config = await loadConfig();
  return config.mem0_local_config || DEFAULT_CONFIG.mem0_local_config;
}

export async function updateProjectAccess(projectHash: string): Promise<void> {
  const config = await loadConfig();
  if (!config.projects[projectHash]) {
    config.projects[projectHash] = {
      last_access: new Date().toISOString(),
      source_count: 0,
      session_count: 0
    };
  } else {
    config.projects[projectHash].last_access = new Date().toISOString();
  }
  await saveConfig(config);
}

// ============================================================================
// Cache Operations
// ============================================================================

export async function lookupCache(
  projectHash: string,
  sourceHash: string
): Promise<CacheLookupResult> {
  const cacheDir = join(PROJECTS_DIR, projectHash, "cache", sourceHash);

  if (!existsSync(cacheDir)) {
    return {
      hit: false,
      stale: false,
      cache_dir: null,
      metadata: null,
      summary: null,
      full_response_path: null
    };
  }

  const metadataPath = join(cacheDir, "metadata.json");
  const summaryPath = join(cacheDir, "summary.md");
  const fullResponsePath = join(cacheDir, "full_response.md");

  if (!existsSync(metadataPath) || !existsSync(summaryPath)) {
    return {
      hit: false,
      stale: false,
      cache_dir: cacheDir,
      metadata: null,
      summary: null,
      full_response_path: null
    };
  }

  try {
    const metadata: CacheMetadata = await Bun.file(metadataPath).json();
    const isStale = await isCacheStale(metadata);

    if (isStale) {
      return {
        hit: true,
        stale: true,
        cache_dir: cacheDir,
        metadata,
        summary: null,
        full_response_path: fullResponsePath
      };
    }

    const summary = await Bun.file(summaryPath).text();
    return {
      hit: true,
      stale: false,
      cache_dir: cacheDir,
      metadata,
      summary,
      full_response_path: fullResponsePath
    };
  } catch {
    return {
      hit: false,
      stale: false,
      cache_dir: cacheDir,
      metadata: null,
      summary: null,
      full_response_path: null
    };
  }
}

export async function isCacheStale(metadata: CacheMetadata): Promise<boolean> {
  for (const fileInfo of metadata.source_files) {
    if (!existsSync(fileInfo.path)) {
      return true;
    }
    const stat = statSync(fileInfo.path);
    if (stat.mtimeMs !== fileInfo.mtime) {
      return true;
    }
  }
  return false;
}

export async function writeCache(args: {
  projectHash: string;
  sourceHash: string;
  prompt: string;
  model: string;
  fullResponse: string;
  summary: string;
  sourceFiles: FileInfo[];
  sourceType: "folder" | "file" | "stdin";
  sourcePath: string;
  tokenCount: number;
}): Promise<{ cacheDir: string; metadata: CacheMetadata }> {
  const cacheDir = ensureCacheDir(args.projectHash, args.sourceHash);
  const timestamp = new Date().toISOString();
  const promptHash = hashContent(args.prompt);

  const offloadMetadata: OffloadMetadata = {
    project_hash: args.projectHash,
    project_path: await getProjectPath(),
    source_path: args.sourcePath,
    source_hash: args.sourceHash,
    source_type: args.sourceType,
    session_name: null,
    turn_number: null,
    timestamp,
    type: "offload",
    topics: [],
    model: args.model,
    prompt_hash: promptHash,
    response_file: join(cacheDir, "full_response.md"),
    token_count: args.tokenCount
  };

  const metadata: CacheMetadata = {
    version: "1.0.0",
    created_at: timestamp,
    prompt: args.prompt,
    prompt_hash: promptHash,
    source_files: args.sourceFiles,
    model: args.model,
    response_tokens: args.tokenCount,
    offload_metadata: offloadMetadata
  };

  await Promise.all([
    Bun.write(join(cacheDir, "metadata.json"), JSON.stringify(metadata, null, 2)),
    Bun.write(join(cacheDir, "full_response.md"), args.fullResponse),
    Bun.write(join(cacheDir, "summary.md"), args.summary)
  ]);

  return { cacheDir, metadata };
}

// ============================================================================
// Session Operations
// ============================================================================

export async function loadSessionMetadata(
  projectHash: string,
  sessionName: string
): Promise<SessionMetadata | null> {
  const sessionDir = join(PROJECTS_DIR, projectHash, "sessions", sessionName);
  const sessionFile = join(sessionDir, "session.json");

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    return await Bun.file(sessionFile).json();
  } catch {
    return null;
  }
}

export async function saveSessionMetadata(
  projectHash: string,
  sessionName: string,
  metadata: SessionMetadata
): Promise<void> {
  const sessionDir = ensureSessionDir(projectHash, sessionName);
  await Bun.write(
    join(sessionDir, "session.json"),
    JSON.stringify(metadata, null, 2)
  );
}

export async function appendSessionTurn(args: {
  projectHash: string;
  sessionName: string;
  prompt: string;
  fullResponse: string;
  summary: string;
  geminiSessionIndex: number;
  tokenCount: number;
}): Promise<SessionMetadata> {
  const sessionDir = ensureSessionDir(args.projectHash, args.sessionName);
  const timestamp = new Date().toISOString();
  const safeTimestamp = timestamp.replace(/[:.]/g, "-");

  let metadata = await loadSessionMetadata(args.projectHash, args.sessionName);

  if (!metadata) {
    metadata = {
      version: "1.0.0",
      session_name: args.sessionName,
      created_at: timestamp,
      last_turn_at: timestamp,
      turn_count: 0,
      gemini_session_index: args.geminiSessionIndex,
      turns: []
    };
  }

  const turnNumber = metadata.turn_count + 1;
  const responseFile = `full_response-${safeTimestamp}.md`;

  metadata.turns.push({
    turn_number: turnNumber,
    timestamp,
    prompt: args.prompt,
    response_file: responseFile,
    tokens: args.tokenCount
  });
  metadata.turn_count = turnNumber;
  metadata.last_turn_at = timestamp;
  metadata.gemini_session_index = args.geminiSessionIndex;

  await Promise.all([
    Bun.write(join(sessionDir, responseFile), args.fullResponse),
    Bun.write(join(sessionDir, "summary.md"), args.summary),
    saveSessionMetadata(args.projectHash, args.sessionName, metadata)
  ]);

  return metadata;
}

// ============================================================================
// Local Index (mem0 fallback)
// ============================================================================

export async function loadLocalIndex(): Promise<LocalIndex> {
  ensureBaseDir();
  if (!existsSync(INDEX_FILE)) {
    const defaultIndex: LocalIndex = {
      version: "1.0.0",
      last_updated: new Date().toISOString(),
      entries: []
    };
    await Bun.write(INDEX_FILE, JSON.stringify(defaultIndex, null, 2));
    return defaultIndex;
  }
  try {
    return await Bun.file(INDEX_FILE).json();
  } catch {
    return {
      version: "1.0.0",
      last_updated: new Date().toISOString(),
      entries: []
    };
  }
}

export async function appendToLocalIndex(
  summary: string,
  metadata: OffloadMetadata
): Promise<void> {
  const index = await loadLocalIndex();
  const id = hashContent(`${metadata.project_hash}:${metadata.source_hash}:${metadata.timestamp}`);

  // Remove existing entry with same ID if present
  index.entries = index.entries.filter(e => e.id !== id);

  index.entries.push({ id, summary, metadata });
  index.last_updated = new Date().toISOString();

  await Bun.write(INDEX_FILE, JSON.stringify(index, null, 2));
}

// ============================================================================
// Summary Generation
// ============================================================================

export function generateSimpleSummary(fullResponse: string, maxChars: number = 2000): string {
  if (fullResponse.length <= maxChars) {
    return fullResponse;
  }

  const truncated = fullResponse.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastNewline = truncated.lastIndexOf("\n\n");

  const breakPoint = Math.max(lastPeriod, lastNewline);
  if (breakPoint > maxChars * 0.5) {
    return truncated.slice(0, breakPoint + 1) + "\n\n[...truncated]";
  }

  return truncated + "\n\n[...truncated]";
}

// ============================================================================
// Utility Exports
// ============================================================================

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getSourcePath(includeDirs?: string): string {
  if (!includeDirs) return "stdin";
  const dirs = includeDirs.split(",").map(d => d.trim());
  return dirs.length === 1 ? dirs[0] : dirs.join(", ");
}
