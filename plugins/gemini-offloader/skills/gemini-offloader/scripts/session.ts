#!/usr/bin/env bun
/**
 * Manage warm gemini sessions for context preservation.
 * Supports listing, resuming, continuing, and deleting sessions.
 *
 * Usage:
 *   bun run scripts/session.ts list
 *   bun run scripts/session.ts create --name "research-wasm" --prompt "Research WebAssembly"
 *   bun run scripts/session.ts continue --name "research-wasm" --prompt "Compare runtimes"
 *   bun run scripts/session.ts continue --prompt "Go deeper"  # continues latest
 *   bun run scripts/session.ts resume --index 2 --prompt "Continue from here"
 *   bun run scripts/session.ts delete --index 3
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

interface SessionState {
  named_sessions: Record<string, number>;
  last_used: {
    session: { type: string; name?: string; index?: number };
    timestamp: string;
    prompt_preview: string;
  } | null;
}

interface SessionInfo {
  index: number;
  description: string;
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
    const result = await $`${geminiPath} --list-sessions`.text();

    if (result.includes("No previous sessions")) {
      return [];
    }

    const sessions: SessionInfo[] = [];
    for (const line of result.split("\n")) {
      const match = line.match(/(\d+)[:\.\s]+(.+)/);
      if (match) {
        sessions.push({
          index: parseInt(match[1]),
          description: match[2].trim()
        });
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

async function runWithSession(
  geminiPath: string,
  prompt: string,
  resume?: string | number
): Promise<{ response: string | null; error: string | null }> {
  const cmdArgs: string[] = [geminiPath];

  if (resume !== undefined) {
    cmdArgs.push("--resume", String(resume));
  }

  cmdArgs.push("-o", "json");
  cmdArgs.push(prompt);

  try {
    const proc = Bun.spawn(cmdArgs, {
      stdout: "pipe",
      stderr: "pipe"
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (stdout.trim()) {
      try {
        const data = JSON.parse(stdout);
        if (data.error) {
          return { response: null, error: data.error.message || String(data.error) };
        }
        return { response: data.response || data.text || stdout.trim(), error: null };
      } catch {
        return { response: stdout.trim(), error: null };
      }
    }

    return { response: null, error: stderr.trim() || "No response" };
  } catch (e) {
    return { response: null, error: String(e) };
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

  // Enhance with named session info
  for (const session of sessions) {
    for (const [name, idx] of Object.entries(state.named_sessions)) {
      if (idx === session.index) {
        session.name = name;
        break;
      }
    }
  }

  return {
    action: "list",
    sessions,
    named_sessions: state.named_sessions,
    last_used: state.last_used,
    success: true
  };
}

async function cmdContinue(args: { name?: string; index?: number; prompt: string }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  const state = await loadState();
  let resume: string | number = "latest";
  let sessionInfo: { type: string; name?: string; index?: number } = { type: "latest" };

  if (args.name) {
    if (!(args.name in state.named_sessions)) {
      return {
        success: false,
        error: `Named session '${args.name}' not found. Use 'create' first.`
      };
    }
    resume = state.named_sessions[args.name];
    sessionInfo = { type: "named", name: args.name, index: resume };
  } else if (args.index !== undefined) {
    resume = args.index;
    sessionInfo = { type: "indexed", index: resume };
  }

  const { response, error } = await runWithSession(geminiPath, args.prompt, resume);

  if (error) {
    return {
      action: "continue",
      session: sessionInfo,
      success: false,
      error
    };
  }

  // Update last used
  state.last_used = {
    session: sessionInfo,
    timestamp: new Date().toISOString(),
    prompt_preview: args.prompt.slice(0, 100)
  };
  await saveState(state);

  return {
    action: "continue",
    session: sessionInfo,
    response,
    success: true
  };
}

async function cmdCreate(args: { name: string; prompt: string }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  // Run initial query (creates new session)
  const { response, error } = await runWithSession(geminiPath, args.prompt);

  if (error) {
    return {
      action: "create",
      success: false,
      error
    };
  }

  // Get the new session index (most recent is 0)
  const sessions = await listSessions(geminiPath);
  const newIndex = sessions.length > 0 ? sessions[0].index : 0;

  // Save named mapping
  const state = await loadState();
  state.named_sessions[args.name] = newIndex;
  state.last_used = {
    session: { type: "named", name: args.name, index: newIndex },
    timestamp: new Date().toISOString(),
    prompt_preview: args.prompt.slice(0, 100)
  };
  await saveState(state);

  return {
    action: "create",
    session: { name: args.name, index: newIndex },
    response,
    success: true
  };
}

async function cmdDelete(args: { index: number }) {
  const geminiPath = await findGemini();
  if (!geminiPath) {
    return { success: false, error: "gemini-cli not found" };
  }

  try {
    await $`${geminiPath} --delete-session ${args.index}`;

    // Remove from named sessions if exists
    const state = await loadState();
    const removedNames: string[] = [];
    for (const [name, idx] of Object.entries(state.named_sessions)) {
      if (idx === args.index) {
        removedNames.push(name);
        delete state.named_sessions[name];
      }
    }
    await saveState(state);

    return {
      action: "delete",
      index: args.index,
      removed_names: removedNames,
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

async function main() {
  const args = Bun.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(JSON.stringify({
      success: false,
      error: "Usage: session.ts <list|create|continue|resume|delete> [options]"
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
        result = await cmdCreate({ name: opts.name as string, prompt: opts.prompt as string });
      }
      break;
    case "continue":
      if (!opts.prompt) {
        result = { success: false, error: "continue requires --prompt" };
      } else {
        result = await cmdContinue({
          name: opts.name as string | undefined,
          index: opts.index as number | undefined,
          prompt: opts.prompt as string
        });
      }
      break;
    case "resume":
      if (opts.index === undefined || !opts.prompt) {
        result = { success: false, error: "resume requires --index and --prompt" };
      } else {
        result = await cmdContinue({ index: opts.index as number, prompt: opts.prompt as string });
      }
      break;
    case "delete":
      if (opts.index === undefined) {
        result = { success: false, error: "delete requires --index" };
      } else {
        result = await cmdDelete({ index: opts.index as number });
      }
      break;
    default:
      result = { success: false, error: `Unknown command: ${command}` };
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
