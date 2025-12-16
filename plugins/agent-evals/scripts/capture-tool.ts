#!/usr/bin/env bun
/**
 * PreToolUse hook for capturing tool calls during test runs.
 *
 * Reads tool invocation from stdin, writes JSONL entry if TEST_MODE=true,
 * always exits 0 to allow tool execution.
 */

import {
  type PreToolUseHookInput,
  isTestMode,
  createToolCallEntry,
  appendToolCallEntry,
} from "./common.ts";

async function main(): Promise<void> {
  // Read hook input from stdin
  const input: PreToolUseHookInput = await Bun.stdin.json();

  // Only capture if in test mode
  if (isTestMode()) {
    const entry = createToolCallEntry("pre", {
      tool_name: input.tool_name,
      tool_input: input.tool_input as Record<string, unknown>,
      tool_use_id: input.tool_use_id,
      session_id: input.session_id,
      cwd: input.cwd,
    });

    await appendToolCallEntry(entry);
  }

  // Always exit 0 to allow tool execution
  process.exit(0);
}

main().catch((err) => {
  console.error("capture-tool.ts error:", err);
  process.exit(0); // Still allow execution even on hook error
});
