/**
 * Shared utilities for agent-evals hooks
 */

import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Hook input types (based on Claude Code hook protocol)
 * These match the JSON structure piped to stdin
 */
export interface PreToolUseHookInput {
  tool_name: string;
  tool_input: unknown;
  tool_use_id: string;
  session_id: string;
  cwd: string;
}

export interface PostToolUseHookInput extends PreToolUseHookInput {
  tool_response: unknown;
}

/**
 * Check if we're in test mode (hooks should capture tool calls)
 */
export function isTestMode(): boolean {
  return process.env.TEST_MODE === "true";
}

/**
 * Get the test run ID for namespacing output files
 * Defaults to "default" if not set
 */
export function getTestRunId(): string {
  return process.env.TEST_RUN_ID || "default";
}

/**
 * Get the project root directory
 * Uses CLAUDE_PROJECT_DIR if available, otherwise cwd from hook input
 */
export function getProjectRoot(cwd?: string): string {
  return process.env.CLAUDE_PROJECT_DIR || cwd || process.cwd();
}

/**
 * Get the output path for tool call JSONL files
 * Format: {projectRoot}/test-output/{testRunId}/tool-calls.jsonl
 */
export function getToolCallsOutputPath(cwd?: string): string {
  const projectRoot = getProjectRoot(cwd);
  const testRunId = getTestRunId();
  return join(projectRoot, "test-output", testRunId, "tool-calls.jsonl");
}

/**
 * Ensure the output directory exists
 */
export async function ensureOutputDir(outputPath: string): Promise<void> {
  const dir = dirname(outputPath);
  await mkdir(dir, { recursive: true });
}

/**
 * Tool call entry structure for JSONL output
 */
export interface ToolCallEntry {
  timestamp: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  session_id: string;
  cwd: string;
  phase: "pre" | "post";
  // PostToolUse adds these:
  tool_output?: string;
  tool_response?: unknown;
  error?: string;
}

/**
 * Create a JSONL entry for a tool call
 */
export function createToolCallEntry(
  phase: "pre" | "post",
  input: {
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_use_id: string;
    session_id: string;
    cwd: string;
    tool_response?: unknown;
  }
): ToolCallEntry {
  return {
    timestamp: new Date().toISOString(),
    phase,
    tool_name: input.tool_name,
    tool_input: input.tool_input,
    tool_use_id: input.tool_use_id,
    session_id: input.session_id,
    cwd: input.cwd,
    ...(input.tool_response !== undefined && { tool_response: input.tool_response }),
  };
}

/**
 * Append a JSONL entry to the output file
 */
export async function appendToolCallEntry(entry: ToolCallEntry): Promise<void> {
  const outputPath = getToolCallsOutputPath(entry.cwd);
  await ensureOutputDir(outputPath);

  const line = JSON.stringify(entry) + "\n";
  await appendFile(outputPath, line, "utf-8");
}
