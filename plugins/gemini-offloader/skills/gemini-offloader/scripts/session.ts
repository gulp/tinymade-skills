#!/usr/bin/env bun
/**
 * Manage warm gemini sessions for context preservation.
 * Supports listing, resuming, continuing, and deleting sessions.
 *
 * All session turns are automatically persisted to ~/.gemini_offloader/ and
 * indexed in mem0 for semantic search.
 *
 * Usage:
 *   bun run scripts/session.ts list
 *   bun run scripts/session.ts create --name "research-wasm" --prompt "Research WebAssembly"
 *   bun run scripts/session.ts create --name "large-ctx" --prompt "Analyze" --timeout 300
 *   bun run scripts/session.ts continue --name "research-wasm" --prompt "Compare runtimes"
 *   bun run scripts/session.ts continue --prompt "Go deeper"  # continues latest
 *   bun run scripts/session.ts continue --timeout 180 --prompt "Long analysis"
 *   bun run scripts/session.ts resume --index 2 --prompt "Continue from here"
 *   bun run scripts/session.ts delete --index 3
 *
 * Options:
 *   --timeout, -t   Request timeout in seconds (default: 90)
 *                   Useful for complex research queries or large context operations
 *
 * Output JSON:
 *   {
 *     "action": "continue",
 *     "session": {"index": 0, "name": "research-wasm"},
 *     "response": "Gemini's response text",
 *     "success": true,
 *     "error": null
 *   }
 */

import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import {
  appendSessionTurn,
  generateSimpleSummary,
  estimateTokens,
  getProjectHash,
  hashContent,
  getGeminiProjectHash,
  findSessionFile,
  parseGeminiSession,
  listGeminiSessionFiles,
  getMostRecentSession,
  listAllProjectHashes,
  extractSessionPreview,
  verifySessionExists as verifySessionExistsOnDisk,
  type OffloadMetadata,
  type SessionMapping,
  type GeminiSessionFile,
  type SessionPreview
} from "./state.ts";
import { indexOffload } from "./memory.ts";

/**
 * Session state with enhanced session tracking.
 * Supports both legacy (index-only) and new (SessionMapping) formats.
 */
interface SessionState {
  named_sessions: Record<string, number | SessionMapping>;
  last_used: {
    session: { type: string; name?: string; index?: number; sessionId?: string };
    timestamp: string;
    prompt_preview: string;
  } | null;
}

/**
 * Check if a session mapping is the legacy format (just an index number)
 */
function isLegacyMapping(mapping: number | SessionMapping): mapping is number {
  return typeof mapping === "number";
}

/**
 * Extract session index from a mapping (handles both legacy and new formats)
 */
function getSessionIndex(mapping: number | SessionMapping): number | null {
  if (isLegacyMapping(mapping)) {
    return mapping;
  }
  // New format doesn't store index - we resolve dynamically
  return null;
}

interface SessionInfo {
  index: number;
  description: string;
  sessionId?: string;  // Extracted from [uuid] in description
  name?: string;
}

function getStatePath(): string {
  // Try project-level first
  const projectState = ".gemini-offloader-sessions.json";
  if (existsSync(projectState)) return projectState;

  // Fall back to user-level
  const userDir = join(homedir(), ".config", "gemini-offloader");
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
  }
  return join(userDir, "sessions.json");
}

async function loadState(): Promise<SessionState> {
  const statePath = getStatePath();
  if (existsSync(statePath)) {
    try {
      return await Bun.file(statePath).json();
    } catch {
      // Ignore
    }
  }
  return { named_sessions: {}, last_used: null };
}

async function saveState(state: SessionState): Promise<void> {
  const statePath = getStatePath();
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  await Bun.write(statePath, JSON.stringify(state, null, 2));
}

async function findGemini(): Promise<string | null> {
  try {
    const result = await $`which gemini`.text();
    return result.trim() || null;
  } catch {
    return null;
  }
}

async function listSessions(geminiPath: string): Promise<SessionInfo[]> {
  try {
    // Use Bun.spawn with inherit stdin and read stderr (gemini writes list to stderr)
    const proc = Bun.spawn([geminiPath, "--list-sessions"], {
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe"
    });

    // gemini-cli writes session list to stderr, not stdout
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (stderr.includes("No previous sessions")) {
      return [];
    }

    const sessions: SessionInfo[] = [];
    for (const line of stderr.split("\n")) {
      const match = line.match(/(\d+)[:\.\s]+(.+)/);
      if (match) {
        const description = match[2].trim();
        // Extract sessionId from [uuid] at end of description
        const uuidMatch = description.match(/\[([a-f0-9-]{36})\]$/);
        sessions.push({
          index: parseInt(match[1]),
          description,
          sessionId: uuidMatch ? uuidMatch[1] : undefined
        });
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Verify a session index exists and return info about it
 */
async function verifySession(geminiPath: string, index: number): Promise<{
  exists: boolean;
  session?: SessionInfo;
  availableSessions: SessionInfo[];
}> {
  const sessions = await listSessions(geminiPath);
  const session = sessions.find(s => s.index === index);
  return {
    exists: !!session,
    session,
    availableSessions: sessions
  };
}

/**
 * Resolve a sessionId to its current index.
 *
 * This is the key function for persistent session tracking:
 * 1. Get list of sessions from gemini --list-sessions (includes sessionId in output)
 * 2. Find the session with matching sessionId
 * 3. Return its current index
 *
 * Returns null if session not found (purged by gemini-cli)
 */
async function sessionIdToIndex(
  sessionId: string,
  geminiProjectHash: string,
  geminiPath: string
): Promise<{ index: number; sessionFile: string } | null> {
  // Get sessions from gemini (includes sessionId in output)
  const sessions = await listSessions(geminiPath);

  // Find session with matching sessionId
  const session = sessions.find(s => s.sessionId === sessionId);

  if (session) {
    // Find the session file path for this sessionId
    const sessionFile = await findSessionFile(sessionId, geminiProjectHash);
    return {
      index: session.index,
      sessionFile: sessionFile || `unknown-${sessionId}`
    };
  }

  return null;
}

/**
 * Resolve a session mapping to a usable index.
 * Handles both legacy (index-only) and new (sessionId-based) formats.
 */
async function resolveSessionMapping(
  mapping: number | SessionMapping,
  geminiPath: string
): Promise<{
  index: number;
  sessionId: string | null;
  sessionFile: string | null;
  isLegacy: boolean;
  resolved: boolean;
}> {
  if (isLegacyMapping(mapping)) {
    // Legacy format: just verify the index exists
    const verification = await verifySession(geminiPath, mapping);
    return {
      index: mapping,
      sessionId: null,
      sessionFile: null,
      isLegacy: true,
      resolved: verification.exists
    };
  }

  // New format: resolve sessionId to current index
  const geminiProjectHash = mapping.geminiProjectHash;
  const resolution = await sessionIdToIndex(mapping.sessionId, geminiProjectHash, geminiPath);

  if (resolution) {
    return {
      index: resolution.index,
      sessionId: mapping.sessionId,
      sessionFile: resolution.sessionFile,
      isLegacy: false,
      resolved: true
    };
  }

  // Session file no longer exists
  return {
    index: -1,
    sessionId: mapping.sessionId,
    sessionFile: mapping.sessionFile,
    isLegacy: false,
    resolved: false
  };
}

interface GeminiResult {
  response: string | null;
  error: string | null;
  exitCode?: number;
  diagnostic?: {
    type: "success" | "timeout" | "rate_limit" | "auth" | "stale_session" | "unknown";
    message: string;
    suggestion: string;
  };
}

async function runWithSession(
  geminiPath: string,
  prompt: string,
  resume?: string | number,
  timeoutMs: number = 90000
): Promise<GeminiResult> {
  const cmdArgs: string[] = [geminiPath];

  if (resume !== undefined) {
    cmdArgs.push("--resume", String(resume));
  }

  cmdArgs.push("-o", "json");
  cmdArgs.push(prompt);

  const startTime = Date.now();

  try {
    const proc = Bun.spawn(cmdArgs, {
      stdout: "pipe",
      stderr: "pipe"
    });

    // Race between process completion and timeout
    const timeoutPromise = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), timeoutMs)
    );

    const processPromise = (async () => {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited
      ]);
      return { stdout, stderr, exitCode };
    })();

    const result = await Promise.race([processPromise, timeoutPromise]);

    if (result === "timeout") {
      proc.kill();
      return {
        response: null,
        error: `Request timed out after ${timeoutMs / 1000}s`,
        diagnostic: {
          type: "timeout",
          message: `Gemini did not respond within ${timeoutMs / 1000} seconds`,
          suggestion: "Try a shorter prompt, or wait 30-60s if rate limited"
        }
      };
    }

    const { stdout, stderr, exitCode } = result;
    const elapsed = Date.now() - startTime;

    // Interpret exit codes
    if (exitCode === 124) {
      return {
        response: null,
        error: "Timeout: Context too large or slow response",
        exitCode,
        diagnostic: {
          type: "timeout",
          message: `Exit 124 after ${elapsed}ms: Backend timeout`,
          suggestion: "Reduce context size or use shorter prompts"
        }
      };
    }

    if (exitCode === 144) {
      return {
        response: null,
        error: "Rate limited: Too many requests",
        exitCode,
        diagnostic: {
          type: "rate_limit",
          message: `Exit 144 after ${elapsed}ms: Quota/rate throttling`,
          suggestion: "Wait 30-60 seconds before retrying"
        }
      };
    }

    // Check for auth errors in stderr
    if (stderr.includes("authentication") || stderr.includes("401") || stderr.includes("login")) {
      return {
        response: null,
        error: stderr.trim(),
        exitCode,
        diagnostic: {
          type: "auth",
          message: "Authentication required or expired",
          suggestion: "Run 'gemini' interactively to re-authenticate"
        }
      };
    }

    if (stdout.trim()) {
      try {
        const data = JSON.parse(stdout);
        if (data.error) {
          return {
            response: null,
            error: data.error.message || String(data.error),
            exitCode,
            diagnostic: {
              type: "unknown",
              message: `API error: ${data.error.message || data.error}`,
              suggestion: "Check the error message for details"
            }
          };
        }
        return {
          response: data.response || data.text || stdout.trim(),
          error: null,
          exitCode,
          diagnostic: {
            type: "success",
            message: `Completed in ${elapsed}ms`,
            suggestion: ""
          }
        };
      } catch {
        return {
          response: stdout.trim(),
          error: null,
          exitCode,
          diagnostic: {
            type: "success",
            message: `Completed in ${elapsed}ms (non-JSON response)`,
            suggestion: ""
          }
        };
      }
    }

    return {
      response: null,
      error: stderr.trim() || "No response",
      exitCode,
      diagnostic: {
        type: "unknown",
        message: `Exit ${exitCode} after ${elapsed}ms: ${stderr.slice(0, 200) || "No output"}`,
        suggestion: "Check stderr for details"
      }
    };
  } catch (e) {
    return {
      response: null,
      error: String(e),
      diagnostic: {
        type: "unknown",
        message: `Exception: ${e}`,
        suggestion: "Check if gemini-cli is installed correctly"
      }
    };
  }
}

/**
 * Persist a session turn to ~/.gemini_offloader and index in mem0
 */
async function persistSessionTurn(args: {
  sessionName: string;
  prompt: string;
  response: string;
  geminiIndex: number;
  isNewSession: boolean;
}): Promise<{ persisted: boolean; indexed: boolean; turnNumber: number }> {
  try {
    const projectHash = await getProjectHash();
    const tokenCount = estimateTokens(args.response);
    const summary = generateSimpleSummary(args.response);

    // Persist to filesystem
    const metadata = await appendSessionTurn({
      projectHash,
      sessionName: args.sessionName,
      prompt: args.prompt,
      fullResponse: args.response,
      summary,
      geminiSessionIndex: args.geminiIndex,
      tokenCount
    });

    // Index in mem0 with rich metadata
    const offloadMetadata: OffloadMetadata = {
      project_hash: projectHash,
      project_path: process.cwd(),
      source_path: `session:${args.sessionName}`,
      source_hash: hashContent(`${args.sessionName}:${metadata.turn_count}`),
      source_type: "stdin" as const,
      session_name: args.sessionName,
      turn_number: metadata.turn_count,
      timestamp: new Date().toISOString(),
      type: "research" as const,
      topics: [],
      model: "gemini-2.5-pro",
      prompt_hash: hashContent(args.prompt),
      response_file: `sessions/${args.sessionName}/full_response-*.md`,
      token_count: tokenCount
    };

    const indexResult = await indexOffload(summary, offloadMetadata);

    return {
      persisted: true,
      indexed: indexResult.success,
      turnNumber: metadata.turn_count
    };
  } catch (e) {
    console.error("Session persistence error:", e);
    return { persisted: false, indexed: false, turnNumber: 0 };
  }
}

// Command handlers
async function cmdList() {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  const sessions = await listSessions(geminiPath);
  const state = await loadState();
  const geminiProjectHash = getGeminiProjectHash();

  // Build enhanced named sessions info
  const namedSessionsEnhanced: Record<string, {
    sessionId?: string;
    index?: number;
    isLegacy: boolean;
    exists: boolean;
  }> = {};

  for (const [name, mapping] of Object.entries(state.named_sessions)) {
    if (isLegacyMapping(mapping)) {
      // Legacy format - try to find by index
      const exists = sessions.some(s => s.index === mapping);
      namedSessionsEnhanced[name] = {
        index: mapping,
        isLegacy: true,
        exists
      };
      // Attach name to session if it exists
      const session = sessions.find(s => s.index === mapping);
      if (session) {
        session.name = name;
      }
    } else {
      // New format - resolve sessionId to index
      const resolution = await sessionIdToIndex(mapping.sessionId, geminiProjectHash, geminiPath);
      namedSessionsEnhanced[name] = {
        sessionId: mapping.sessionId,
        index: resolution?.index,
        isLegacy: false,
        exists: resolution !== null
      };
      // Attach name to session if found
      if (resolution) {
        const session = sessions.find(s => s.index === resolution.index);
        if (session) {
          session.name = name;
        }
      }
    }
  }

  return {
    action: "list",
    sessions,
    named_sessions: state.named_sessions,
    named_sessions_resolved: namedSessionsEnhanced,
    last_used: state.last_used,
    success: true
  };
}

async function cmdContinue(args: { name?: string; index?: number; prompt: string; timeout?: number }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  const state = await loadState();
  let resume: string | number = "latest";
  let sessionInfo: { type: string; name?: string; index?: number; sessionId?: string } = { type: "latest" };
  let persistenceName: string | null = null;
  let resolvedSessionId: string | null = null;

  if (args.name) {
    // Named session lookup with sessionId resolution
    if (!(args.name in state.named_sessions)) {
      return {
        success: false,
        error: `Named session '${args.name}' not found. Use 'create' first.`
      };
    }

    const mapping = state.named_sessions[args.name];
    persistenceName = args.name;

    // Resolve the mapping to a usable index
    const resolution = await resolveSessionMapping(mapping, geminiPath);

    if (!resolution.resolved) {
      // Session no longer exists - clean up stale mapping
      delete state.named_sessions[args.name];
      await saveState(state);

      const sessions = await listSessions(geminiPath);
      const availableList = sessions.length > 0
        ? sessions.map(s => `  ${s.index}: ${s.description.slice(0, 60)}`).join("\n")
        : "  (no sessions available)";

      return {
        action: "continue",
        session: { type: "named", name: args.name, sessionId: resolution.sessionId },
        success: false,
        error: resolution.isLegacy
          ? `Session index no longer exists (purged by gemini-cli)`
          : `Session ${resolution.sessionId?.slice(0, 8)}... no longer exists (purged by gemini-cli)`,
        diagnostic: {
          type: "stale_session" as const,
          message: resolution.isLegacy
            ? `Legacy session mapping for '${args.name}' was purged. Mapping cleaned up.`
            : `Session ${resolution.sessionId} ('${args.name}') was purged. Session file: ${resolution.sessionFile}`,
          suggestion: `Create a new session with 'create --name "${args.name}" --prompt "..."'`
        },
        available_sessions: sessions.map(s => ({
          index: s.index,
          description: s.description.slice(0, 80)
        }))
      };
    }

    resume = resolution.index;
    resolvedSessionId = resolution.sessionId;
    sessionInfo = {
      type: "named",
      name: args.name,
      index: resolution.index,
      sessionId: resolution.sessionId || undefined
    };

  } else if (args.index !== undefined) {
    // Direct index access (legacy behavior)
    resume = args.index;
    sessionInfo = { type: "indexed", index: resume };

    // Look up name by checking all mappings
    for (const [name, mapping] of Object.entries(state.named_sessions)) {
      if (isLegacyMapping(mapping)) {
        if (mapping === args.index) {
          persistenceName = name;
          break;
        }
      }
      // For new mappings, we can't reliably match by index since indices are volatile
    }
    if (!persistenceName) {
      persistenceName = `session-${args.index}`;
    }

    // Verify the index exists
    const verification = await verifySession(geminiPath, resume);
    if (!verification.exists) {
      return {
        action: "continue",
        session: sessionInfo,
        success: false,
        error: `Session index ${resume} no longer exists`,
        diagnostic: {
          type: "stale_session" as const,
          message: `Session index ${resume} was purged by gemini-cli.`,
          suggestion: `Use 'list' to see available sessions, or 'create' for a new one.`
        },
        available_sessions: verification.availableSessions.map(s => ({
          index: s.index,
          description: s.description.slice(0, 80)
        }))
      };
    }

  } else {
    // "latest" mode
    if (state.last_used?.session.name) {
      persistenceName = state.last_used.session.name;
    } else {
      persistenceName = "latest";
    }
  }

  const timeoutMs = args.timeout ? args.timeout * 1000 : 90000;
  const { response, error, exitCode, diagnostic } = await runWithSession(geminiPath, args.prompt, resume, timeoutMs);

  if (error) {
    return {
      action: "continue",
      session: sessionInfo,
      success: false,
      error,
      exitCode,
      diagnostic
    };
  }

  // Update mapping if we have a sessionId (increase turn count)
  if (args.name && !isLegacyMapping(state.named_sessions[args.name])) {
    const mapping = state.named_sessions[args.name] as SessionMapping;
    mapping.lastTurn += 1;
    mapping.lastPromptPreview = args.prompt.slice(0, 100);
  }

  // Update last used
  state.last_used = {
    session: sessionInfo,
    timestamp: new Date().toISOString(),
    prompt_preview: args.prompt.slice(0, 100)
  };
  await saveState(state);

  // Persist session turn and index in mem0
  const persistence = await persistSessionTurn({
    sessionName: persistenceName,
    prompt: args.prompt,
    response: response!,
    geminiIndex: typeof resume === "number" ? resume : 0,
    isNewSession: false
  });

  return {
    action: "continue",
    session: sessionInfo,
    response,
    persisted: persistence.persisted,
    indexed: persistence.indexed,
    turn: persistence.turnNumber,
    sessionId: resolvedSessionId,
    exitCode,
    diagnostic,
    success: true
  };
}

async function cmdCreate(args: { name: string; prompt: string; timeout?: number }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  // Run initial query (creates new session)
  const timeoutMs = args.timeout ? args.timeout * 1000 : 90000;
  const { response, error, exitCode, diagnostic } = await runWithSession(geminiPath, args.prompt, undefined, timeoutMs);

  if (error) {
    return {
      action: "create",
      success: false,
      error,
      exitCode,
      diagnostic
    };
  }

  // Get gemini's project hash for this directory
  const geminiProjectHash = getGeminiProjectHash();

  // Get the new session (most recent one contains our new session)
  const mostRecent = await getMostRecentSession(geminiProjectHash);

  if (!mostRecent) {
    // Fallback to legacy behavior if we can't find the session file
    const sessions = await listSessions(geminiPath);
    const newIndex = sessions.length > 0 ? sessions[0].index : 0;

    const state = await loadState();
    state.named_sessions[args.name] = newIndex;  // Legacy format
    state.last_used = {
      session: { type: "named", name: args.name, index: newIndex },
      timestamp: new Date().toISOString(),
      prompt_preview: args.prompt.slice(0, 100)
    };
    await saveState(state);

    const persistence = await persistSessionTurn({
      sessionName: args.name,
      prompt: args.prompt,
      response: response!,
      geminiIndex: newIndex,
      isNewSession: true
    });

    return {
      action: "create",
      session: { name: args.name, index: newIndex },
      response,
      persisted: persistence.persisted,
      indexed: persistence.indexed,
      turn: persistence.turnNumber,
      exitCode,
      diagnostic,
      success: true,
      warning: "Could not capture sessionId - using legacy index mapping"
    };
  }

  // Create enhanced session mapping with persistent sessionId
  const sessionMapping: SessionMapping = {
    sessionId: mostRecent.parsed.sessionId,
    sessionFile: mostRecent.path,
    geminiProjectHash,
    createdAt: new Date().toISOString(),
    lastTurn: 1,
    lastPromptPreview: args.prompt.slice(0, 100)
  };

  // Save enhanced mapping
  const state = await loadState();
  state.named_sessions[args.name] = sessionMapping;
  state.last_used = {
    session: { type: "named", name: args.name, sessionId: mostRecent.parsed.sessionId },
    timestamp: new Date().toISOString(),
    prompt_preview: args.prompt.slice(0, 100)
  };
  await saveState(state);

  // Resolve current index for persistence
  const sessions = await listSessions(geminiPath);
  const currentIndex = sessions.length > 0 ? sessions[0].index : 0;

  // Persist session turn and index in mem0
  const persistence = await persistSessionTurn({
    sessionName: args.name,
    prompt: args.prompt,
    response: response!,
    geminiIndex: currentIndex,
    isNewSession: true
  });

  return {
    action: "create",
    session: {
      name: args.name,
      sessionId: mostRecent.parsed.sessionId,
      sessionFile: mostRecent.path
    },
    response,
    persisted: persistence.persisted,
    indexed: persistence.indexed,
    turn: persistence.turnNumber,
    exitCode,
    diagnostic,
    success: true
  };
}

async function cmdDelete(args: { index: number }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  const geminiProjectHash = getGeminiProjectHash();

  try {
    await $`${geminiPath} --delete-session ${args.index}`;

    // Remove from named sessions if exists (handle both legacy and new formats)
    const state = await loadState();
    const removedNames: string[] = [];
    const removedSessionIds: string[] = [];

    for (const [name, mapping] of Object.entries(state.named_sessions)) {
      if (isLegacyMapping(mapping)) {
        // Legacy: check if index matches
        if (mapping === args.index) {
          removedNames.push(name);
          delete state.named_sessions[name];
        }
      } else {
        // New format: resolve sessionId to current index and check if it matches
        const resolution = await sessionIdToIndex(mapping.sessionId, geminiProjectHash, geminiPath);
        if (resolution && resolution.index === args.index) {
          removedNames.push(name);
          removedSessionIds.push(mapping.sessionId);
          delete state.named_sessions[name];
        }
      }
    }
    await saveState(state);

    return {
      action: "delete",
      index: args.index,
      removed_names: removedNames,
      removed_session_ids: removedSessionIds,
      success: true
    };
  } catch (e) {
    return {
      action: "delete",
      success: false,
      error: String(e)
    };
  }
}

/**
 * Migrate legacy session mappings (index-only) to new format (sessionId-based)
 */
async function cmdMigrate() {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  const state = await loadState();
  const geminiProjectHash = getGeminiProjectHash();
  const sessionFiles = await listGeminiSessionFiles(geminiProjectHash);
  const sessions = await listSessions(geminiPath);

  const migrated: string[] = [];
  const failed: Array<{ name: string; reason: string }> = [];
  const alreadyNew: string[] = [];

  for (const [name, mapping] of Object.entries(state.named_sessions)) {
    if (!isLegacyMapping(mapping)) {
      alreadyNew.push(name);
      continue;
    }

    const legacyIndex = mapping;

    // Find the session file that corresponds to this index
    // Indices correspond to position in the sorted session list
    if (legacyIndex >= sessionFiles.length) {
      failed.push({ name, reason: `Index ${legacyIndex} out of range (${sessionFiles.length} sessions)` });
      continue;
    }

    const sessionFile = sessionFiles[legacyIndex];
    if (!sessionFile) {
      failed.push({ name, reason: `Could not find session file for index ${legacyIndex}` });
      continue;
    }

    // Create new mapping
    const newMapping: SessionMapping = {
      sessionId: sessionFile.parsed.sessionId,
      sessionFile: sessionFile.path,
      geminiProjectHash,
      createdAt: sessionFile.parsed.startTime,
      lastTurn: Math.ceil(sessionFile.parsed.messageCount / 2),  // Estimate turns
      lastPromptPreview: sessionFile.parsed.lastMessagePreview
    };

    state.named_sessions[name] = newMapping;
    migrated.push(name);
  }

  if (migrated.length > 0) {
    await saveState(state);
  }

  return {
    action: "migrate",
    migrated,
    already_new: alreadyNew,
    failed,
    success: true
  };
}


/**
 * Discovered session info for display.
 */
interface DiscoveredSession {
  index: number;
  sessionId: string;
  projectHash: string;
  sessionFile: string;
  startTime: string;
  lastUpdated: string;
  messageCount: number;
  preview: SessionPreview | null;
  isCurrentProject: boolean;
}

/**
 * Discover unmapped gemini-cli sessions.
 * Scans gemini's session storage and compares against tracked sessions.
 */
async function cmdDiscover(opts: { allProjects?: boolean } = {}) {
  const currentProjectHash = getGeminiProjectHash();
  const state = await loadState();

  // Collect all tracked sessionIds
  const trackedSessionIds = new Set<string>();
  for (const mapping of Object.values(state.named_sessions)) {
    if (!isLegacyMapping(mapping)) {
      trackedSessionIds.add(mapping.sessionId);
    }
  }

  // Get project hashes to scan
  const projectHashes = opts.allProjects
    ? listAllProjectHashes()
    : [currentProjectHash];

  const unmappedSessions: DiscoveredSession[] = [];
  let totalGeminiSessions = 0;
  let displayIndex = 0;

  for (const projectHash of projectHashes) {
    const sessions = await listGeminiSessionFiles(projectHash);
    totalGeminiSessions += sessions.length;

    for (const { path, parsed } of sessions) {
      if (!trackedSessionIds.has(parsed.sessionId)) {
        const preview = await extractSessionPreview(path);
        unmappedSessions.push({
          index: displayIndex++,
          sessionId: parsed.sessionId,
          projectHash: parsed.projectHash,
          sessionFile: path,
          startTime: parsed.startTime,
          lastUpdated: parsed.lastUpdated,
          messageCount: parsed.messageCount,
          preview,
          isCurrentProject: parsed.projectHash === currentProjectHash
        });
      }
    }
  }

  return {
    action: "discover",
    unmapped_sessions: unmappedSessions,
    total_gemini_sessions: totalGeminiSessions,
    total_tracked_sessions: trackedSessionIds.size,
    current_project_hash: currentProjectHash,
    scanned_projects: projectHashes.length,
    success: true
  };
}

/**
 * Adopt an existing gemini-cli session into tracked sessions.
 * Creates a SessionMapping and indexes all historical turns in mem0.
 */
async function cmdAdopt(args: {
  index?: number;
  sessionId?: string;
  name: string;
  projectHash?: string;
}) {
  if (args.index === undefined && !args.sessionId) {
    return { success: false, error: "adopt requires --index or --session-id" };
  }

  if (!args.name) {
    return { success: false, error: "adopt requires --name" };
  }

  const state = await loadState();

  // Check if name already exists
  if (state.named_sessions[args.name]) {
    return {
      success: false,
      error: `Session name "${args.name}" already exists. Use a different name.`
    };
  }

  // Determine project hash to search in
  const geminiProjectHash = args.projectHash || getGeminiProjectHash();

  // Find the session
  let sessionFile: string | null = null;
  let sessionId: string | null = null;

  if (args.sessionId) {
    // Find by sessionId
    sessionFile = await findSessionFile(args.sessionId, geminiProjectHash);
    sessionId = args.sessionId;
  } else if (args.index !== undefined) {
    // Find by discovery index - need to re-run discovery to get the mapping
    const discovery = await cmdDiscover({ allProjects: !!args.projectHash });
    const session = discovery.unmapped_sessions.find(s => s.index === args.index);
    if (!session) {
      return {
        success: false,
        error: `No unmapped session found at index ${args.index}. Run 'discover' to see available sessions.`
      };
    }
    sessionFile = session.sessionFile;
    sessionId = session.sessionId;
  }

  if (!sessionFile || !sessionId) {
    return {
      success: false,
      error: "Could not find session. It may have been purged by gemini-cli."
    };
  }

  // Check if sessionId is already tracked under a different name
  for (const [existingName, mapping] of Object.entries(state.named_sessions)) {
    if (!isLegacyMapping(mapping) && mapping.sessionId === sessionId) {
      return {
        success: false,
        error: `This session is already tracked as "${existingName}".`
      };
    }
  }

  // Parse session file
  const parsed = await parseGeminiSession(sessionFile);
  if (!parsed) {
    return {
      success: false,
      error: "Could not parse session file. It may be corrupted."
    };
  }

  // Read full session data for indexing
  let sessionData: { messages?: Array<{ type: string; content: string }> };
  try {
    sessionData = await Bun.file(sessionFile).json();
  } catch {
    return {
      success: false,
      error: "Could not read session file contents."
    };
  }

  const messages = sessionData.messages || [];

  // Create SessionMapping
  const mapping: SessionMapping = {
    sessionId: parsed.sessionId,
    sessionFile,
    geminiProjectHash: parsed.projectHash,
    createdAt: parsed.startTime,
    lastTurn: Math.ceil(parsed.messageCount / 2),
    lastPromptPreview: parsed.lastMessagePreview
  };

  // Save mapping first
  state.named_sessions[args.name] = mapping;
  await saveState(state);

  // Index historical turns in mem0
  let indexedCount = 0;
  const indexErrors: string[] = [];

  // Pair messages into turns (user + gemini pairs)
  for (let i = 0; i < messages.length; i += 2) {
    const userMsg = messages[i];
    const geminiMsg = messages[i + 1];

    if (userMsg?.type !== "user") continue;
    if (!geminiMsg || geminiMsg.type !== "gemini") continue;

    try {
      const result = await persistSessionTurn({
        sessionName: args.name,
        prompt: userMsg.content || "",
        response: geminiMsg.content || "",
        geminiIndex: 0, // Index not relevant for historical turns
        isNewSession: indexedCount === 0
      });

      if (result.persisted) {
        indexedCount++;
      }
    } catch (e) {
      indexErrors.push(`Turn ${indexedCount + 1}: ${e}`);
    }
  }

  return {
    action: "adopt",
    session_name: args.name,
    sessionId: parsed.sessionId,
    session_file: sessionFile,
    total_messages: messages.length,
    turns_indexed: indexedCount,
    index_errors: indexErrors.length > 0 ? indexErrors : undefined,
    success: true
  };
}

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(JSON.stringify({
      success: false,
      error: "Usage: session.ts <list|create|continue|resume|delete|migrate|discover|adopt> [options]"
    }, null, 2));
    process.exit(1);
  }

  // Parse remaining args
  const parseOptions = (args: string[]) => {
    const opts: Record<string, string | number | boolean> = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--name" || args[i] === "-n") {
        opts.name = args[++i];
      } else if (args[i] === "--prompt" || args[i] === "-p") {
        opts.prompt = args[++i];
      } else if (args[i] === "--index" || args[i] === "-i") {
        opts.index = parseInt(args[++i]);
      } else if (args[i] === "--timeout" || args[i] === "-t") {
        opts.timeout = parseInt(args[++i]);
      } else if (args[i] === "--all-projects" || args[i] === "-a") {
        opts.allProjects = true;
      } else if (args[i] === "--session-id" || args[i] === "-s") {
        opts.sessionId = args[++i];
      } else if (args[i] === "--project-hash") {
        opts.projectHash = args[++i];
      }
    }
    return opts;
  };

  const opts = parseOptions(args.slice(1));
  let result: Record<string, unknown>;

  switch (command) {
    case "list":
      result = await cmdList();
      break;
    case "create":
      if (!opts.name || !opts.prompt) {
        result = { success: false, error: "create requires --name and --prompt" };
      } else {
        result = await cmdCreate({
          name: opts.name as string,
          prompt: opts.prompt as string,
          timeout: opts.timeout as number | undefined
        });
      }
      break;
    case "continue":
      if (!opts.prompt) {
        result = { success: false, error: "continue requires --prompt" };
      } else {
        result = await cmdContinue({
          name: opts.name as string | undefined,
          index: opts.index as number | undefined,
          prompt: opts.prompt as string,
          timeout: opts.timeout as number | undefined
        });
      }
      break;
    case "resume":
      if (opts.index === undefined || !opts.prompt) {
        result = { success: false, error: "resume requires --index and --prompt" };
      } else {
        result = await cmdContinue({
          index: opts.index as number,
          prompt: opts.prompt as string,
          timeout: opts.timeout as number | undefined
        });
      }
      break;
    case "delete":
      if (opts.index === undefined) {
        result = { success: false, error: "delete requires --index" };
      } else {
        result = await cmdDelete({ index: opts.index as number });
      }
      break;
    case "migrate":
      result = await cmdMigrate();
      break;
    case "discover":
      result = await cmdDiscover({
        allProjects: opts.allProjects as boolean | undefined
      });
      break;
    case "adopt":
      if (!opts.name) {
        result = { success: false, error: "adopt requires --name" };
      } else if (opts.index === undefined && !opts.sessionId) {
        result = { success: false, error: "adopt requires --index or --session-id" };
      } else {
        result = await cmdAdopt({
          index: opts.index as number | undefined,
          sessionId: opts.sessionId as string | undefined,
          name: opts.name as string,
          projectHash: opts.projectHash as string | undefined
        });
      }
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
