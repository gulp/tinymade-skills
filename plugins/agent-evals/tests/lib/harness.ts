/**
 * Test harness for running Claude Code as a subprocess and capturing tool calls.
 *
 * Provides utilities to spawn Claude, wait for completion, and parse JSONL output.
 */

import { join } from "node:path";
import { readFile } from "node:fs/promises";
import type { ToolCallEntry } from "../../scripts/common.ts";

export interface RunAgentOptions {
  /** The prompt to send to Claude */
  prompt: string;
  /** Unique test ID for namespacing output files */
  testId: string;
  /** Maximum number of agent turns (default: 10) */
  maxTurns?: number;
  /** Working directory for the agent (default: process.cwd()) */
  cwd?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

export interface RunAgentResult {
  /** Exit code from the Claude process */
  exitCode: number;
  /** Stdout from the process */
  stdout: string;
  /** Stderr from the process */
  stderr: string;
  /** Whether the process timed out */
  timedOut: boolean;
}

/**
 * Run Claude Code as a subprocess with TEST_MODE enabled.
 *
 * Tool calls are captured by the PreToolUse/PostToolUse hooks to JSONL files.
 * Use `getToolCalls()` after this completes to retrieve captured calls.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const {
    prompt,
    testId,
    maxTurns = 10,
    cwd = process.cwd(),
    env = {},
    timeout = 60000,
  } = options;

  const proc = Bun.spawn(
    [
      "claude",
      "-p",
      prompt,
      "--output-format",
      "json",
      "--max-turns",
      maxTurns.toString(),
      "--dangerously-skip-permissions",
    ],
    {
      cwd,
      env: {
        ...process.env,
        ...env,
        TEST_MODE: "true",
        TEST_RUN_ID: testId,
      },
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout);

  const exitCode = await proc.exited;
  clearTimeout(timeoutId);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return {
    exitCode,
    stdout,
    stderr,
    timedOut,
  };
}

/**
 * Get the path to the tool calls JSONL file for a given test ID.
 */
export function getToolCallsPath(testId: string, projectRoot?: string): string {
  const root = projectRoot || process.cwd();
  return join(root, "test-output", testId, "tool-calls.jsonl");
}

/**
 * Read and parse tool call entries from the JSONL output file.
 *
 * Returns entries sorted by timestamp (earliest first).
 */
export async function getToolCalls(
  testId: string,
  projectRoot?: string
): Promise<ToolCallEntry[]> {
  const logPath = getToolCallsPath(testId, projectRoot);

  let content: string;
  try {
    content = await readFile(logPath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return []; // No tool calls captured
    }
    throw err;
  }

  const entries = content
    .trim()
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ToolCallEntry);

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return entries;
}

/**
 * Filter tool calls to only include PreToolUse entries (before execution).
 */
export function getPreToolCalls(entries: ToolCallEntry[]): ToolCallEntry[] {
  return entries.filter((e) => e.phase === "pre");
}

/**
 * Filter tool calls to only include PostToolUse entries (after execution).
 */
export function getPostToolCalls(entries: ToolCallEntry[]): ToolCallEntry[] {
  return entries.filter((e) => e.phase === "post");
}

/**
 * Extract just the tool names from a list of entries (for trajectory matching).
 */
export function getToolSequence(entries: ToolCallEntry[]): string[] {
  return getPreToolCalls(entries).map((e) => e.tool_name);
}

/**
 * Generate a unique test ID based on test name and timestamp.
 */
export function generateTestId(testName: string): string {
  const sanitized = testName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const timestamp = Date.now();
  return `${sanitized}-${timestamp}`;
}
