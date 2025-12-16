# Agent Evals

Local-first testing framework for validating Claude Code subagent behavior using Bun's native test runner.

## Quickstart: Testing a File Search Agent

This walkthrough demonstrates how to verify that Claude uses the correct tools when asked to find files in a codebase.

### Step 1: Understand the Architecture

When you run a test, the framework:

1. **Spawns Claude** as a subprocess with `TEST_MODE=true` and a unique `TEST_RUN_ID`
2. **Hooks intercept** every tool call via PreToolUse/PostToolUse
3. **JSONL logs** capture tool names, inputs, and outputs to `test-output/{TEST_RUN_ID}/tool-calls.jsonl`
4. **Your test** reads the JSONL and asserts on the tool sequence

```
┌─────────────────────────────────────────────────────────────┐
│  bun test                                                   │
│    └── runAgent({ prompt: "Find all .ts files" })           │
│          └── spawns: claude -p "..." --output-format json   │
│                │                                            │
│                ▼                                            │
│          ┌─────────────┐                                    │
│          │ Claude Code │                                    │
│          └─────────────┘                                    │
│                │                                            │
│                ▼                                            │
│          PreToolUse hook ──► writes to tool-calls.jsonl     │
│                │                                            │
│                ▼                                            │
│          Tool executes (Glob, Grep, Read, etc.)             │
│                │                                            │
│                ▼                                            │
│          PostToolUse hook ──► appends result to JSONL       │
│                │                                            │
│                ▼                                            │
│          getToolCalls(testId) ──► parses JSONL              │
│                │                                            │
│                ▼                                            │
│          expect(toolSequence).toContain("Glob")             │
└─────────────────────────────────────────────────────────────┘
```

### Step 2: Write Your First Test

Create `tests/skills/file-search.test.ts`:

```typescript
import { describe, test, expect } from "bun:test";
import {
  runAgent,
  getToolCalls,
  getToolSequence,
  generateTestId,
} from "../lib/harness.ts";

describe("File Search Agent", () => {
  test("uses Glob tool to find TypeScript files", async () => {
    // 1. Generate unique test ID for isolation
    const testId = generateTestId("glob-typescript-files");

    // 2. Run the agent with a file search prompt
    const result = await runAgent({
      prompt: "List all TypeScript files in the src directory",
      testId,
      maxTurns: 5,
      timeout: 30000,
    });

    // 3. Verify agent completed successfully
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);

    // 4. Get captured tool calls
    const toolCalls = await getToolCalls(testId);
    const toolSequence = getToolSequence(toolCalls);

    // 5. Assert on expected behavior
    expect(toolSequence).toContain("Glob");

    // 6. Verify Glob was called with correct pattern
    const globCall = toolCalls.find(
      (c) => c.tool_name === "Glob" && c.phase === "pre"
    );
    expect(globCall).toBeDefined();
    expect(globCall!.tool_input).toMatchObject({
      pattern: expect.stringContaining("*.ts"),
    });
  });

  test("uses Grep for content search, not Bash grep", async () => {
    const testId = generateTestId("grep-content-search");

    const result = await runAgent({
      prompt: "Find all files containing 'TODO' comments",
      testId,
      maxTurns: 5,
    });

    expect(result.exitCode).toBe(0);

    const toolSequence = getToolSequence(await getToolCalls(testId));

    // Should use Grep tool, NOT Bash with grep command
    expect(toolSequence).toContain("Grep");
    expect(toolSequence).not.toContain("Bash");
  });
});
```

### Step 3: Run the Test

```bash
cd plugins/agent-evals/tests
bun test skills/file-search.test.ts
```

Expected output:
```
bun test v1.x.x

skills/file-search.test.ts:
✓ File Search Agent > uses Glob tool to find TypeScript files [2841ms]
✓ File Search Agent > uses Grep for content search, not Bash grep [1923ms]

 2 pass
 0 fail
```

### Step 4: Inspect Captured Tool Calls

After running tests, examine the JSONL output:

```bash
cat test-output/glob-typescript-files-*/tool-calls.jsonl | jq .
```

Example output:
```json
{
  "timestamp": "2025-12-15T10:23:45.123Z",
  "phase": "pre",
  "tool_name": "Glob",
  "tool_input": {
    "pattern": "src/**/*.ts"
  },
  "tool_use_id": "toolu_01ABC...",
  "session_id": "session_xyz",
  "cwd": "/home/user/project"
}
{
  "timestamp": "2025-12-15T10:23:45.456Z",
  "phase": "post",
  "tool_name": "Glob",
  "tool_input": {
    "pattern": "src/**/*.ts"
  },
  "tool_use_id": "toolu_01ABC...",
  "session_id": "session_xyz",
  "cwd": "/home/user/project",
  "tool_response": "/home/user/project/src/index.ts\n/home/user/project/src/utils.ts"
}
```

## Use Case: Validating Tool Selection

### Problem

You've built a skill that should use specific tools. You want to ensure Claude:
- Uses `Read` instead of `Bash cat`
- Uses `Glob` instead of `Bash find`
- Uses `Grep` instead of `Bash grep/rg`

### Solution

```typescript
test("prefers native tools over Bash equivalents", async () => {
  const testId = generateTestId("native-tools-preference");

  await runAgent({
    prompt: "Read the contents of package.json and find all .json files",
    testId,
    maxTurns: 10,
  });

  const toolCalls = await getToolCalls(testId);
  const preToolCalls = toolCalls.filter((c) => c.phase === "pre");

  // Check for native tool usage
  const toolNames = preToolCalls.map((c) => c.tool_name);

  expect(toolNames).toContain("Read");
  expect(toolNames).toContain("Glob");

  // Ensure no Bash calls for file operations
  const bashCalls = preToolCalls.filter((c) => c.tool_name === "Bash");
  for (const bash of bashCalls) {
    const command = (bash.tool_input as { command?: string }).command || "";
    expect(command).not.toMatch(/\b(cat|find|grep|rg)\b/);
  }
});
```

## Use Case: Trajectory Matching

### Problem

You want to verify Claude follows a specific sequence of tools for a multi-step task.

### Solution

```typescript
test("follows expected trajectory for code modification", async () => {
  const testId = generateTestId("code-modification-trajectory");

  await runAgent({
    prompt: "Add a 'version' field to package.json with value '1.0.0'",
    testId,
    maxTurns: 10,
  });

  const toolSequence = getToolSequence(await getToolCalls(testId));

  // Expected: Read file first, then Edit
  const readIndex = toolSequence.indexOf("Read");
  const editIndex = toolSequence.indexOf("Edit");

  expect(readIndex).toBeGreaterThanOrEqual(0); // Read was called
  expect(editIndex).toBeGreaterThanOrEqual(0); // Edit was called
  expect(readIndex).toBeLessThan(editIndex);   // Read before Edit
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_MODE` | Enables tool call capture in hooks | `"false"` |
| `TEST_RUN_ID` | Unique identifier for test output isolation | `"default"` |
| `CLAUDE_PROJECT_DIR` | Project root for output path resolution | `process.cwd()` |

## File Structure

```
plugins/agent-evals/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── hooks/
│   └── hooks.json           # PreToolUse/PostToolUse registration
├── scripts/
│   ├── capture-tool.ts      # PreToolUse hook implementation
│   ├── log-result.ts        # PostToolUse hook implementation
│   └── common.ts            # Shared types and utilities
├── tests/
│   ├── lib/
│   │   └── harness.ts       # runAgent(), getToolCalls(), etc.
│   └── skills/
│       └── *.test.ts        # Your test files
└── README.md                # This file
```

## Limitations

1. **Hooks must be loaded**: The plugin's hooks need to be active. If testing in a clean environment, ensure the plugin is installed.

2. **Subprocess isolation**: Each `runAgent()` spawns a new Claude process. Tests are isolated but slower than unit tests.

3. **No VCR yet**: Tests hit the real Claude API. VCR cassette recording for deterministic replay is planned for a future subtask.

## Next Steps

- **AgentEvals integration**: Add `createTrajectoryMatchEvaluator` for fuzzy trajectory matching
- **VCR cassettes**: Record/replay API responses for fast, deterministic tests
- **Parallel worktree isolation**: Run tests across multiple git worktrees simultaneously
