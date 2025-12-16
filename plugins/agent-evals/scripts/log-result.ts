#!/usr/bin/env bun
/**
 * PostToolUse hook for capturing tool results during test runs.
 *
 * Reads tool result from stdin, writes JSONL entry if TEST_MODE=true,
 * always exits 0.
 */

import {
  type PostToolUseHookInput,
  isTestMode,
  createToolCallEntry,
  appendToolCallEntry,
} from "./common.ts";

async function main(): Promise<void> {
  // Read hook input from stdin
  const input: PostToolUseHookInput = await Bun.stdin.json();

  // Only capture if in test mode
  if (isTestMode()) {
    const entry = createToolCallEntry("post", {
      tool_name: input.tool_name,
      tool_input: input.tool_input as Record<string, unknown>,
      tool_use_id: input.tool_use_id,
      session_id: input.session_id,
      cwd: input.cwd,
      tool_response: input.tool_response,
    });

    await appendToolCallEntry(entry);
  }

  // Always exit 0
  process.exit(0);
}

main().catch((err) => {
  console.error("log-result.ts error:", err);
  process.exit(0); // Still continue even on hook error
});
