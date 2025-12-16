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

## Architecture

The framework consists of three main layers:

### 1. Hook Layer (`scripts/`)
- `capture-tool.ts`: PreToolUse hook that writes tool invocations to JSONL when `TEST_MODE=true`
- `log-result.ts`: PostToolUse hook that captures tool outputs and responses
- `common.ts`: Shared TypeScript types and utilities

Key implementation detail: Hook types (`PreToolUseHookInput`, `PostToolUseHookInput`) are defined locally because `@anthropic-ai/claude-code-sdk` doesn't exist on npm. Uses `appendFile` from `node:fs/promises` instead of `Bun.write()` since Bun doesn't support append mode.

### 2. Test Infrastructure (`tests/lib/`)
- `harness.ts`: Agent subprocess spawning, JSONL parsing, test ID generation
- `bun-evals.ts`: Custom `describeEval` wrapper for bun:test with built-in scorers
- `evaluators.ts`: AgentEvals integration with message format conversion and fuzzy matchers
- `vcr.ts`: Cassette recording/playback for deterministic test replay
- `worktree.ts`: Parallel worktree isolation utilities

Key implementation detail: AgentEvals requires message format conversion (`ToolCallEntry[]` to `ChatCompletionMessage[]`). The adapter layer in `evaluators.ts` handles this transformation.

### 3. Test Suites
- **Layer 1 - Unit tests**: Direct CLI script testing (see gemini-offloader tests)
- **Layer 2 - Skill invocation tests**: Verify Claude invokes skills correctly (`tests/skills/*.test.ts`)
- **Layer 3 - End-to-end workflow tests**: Multi-agent coordination validation (planned)

## Features

- **Tool call capture**: PreToolUse/PostToolUse hooks write complete JSONL logs to `test-output/{TEST_RUN_ID}/tool-calls.jsonl`
- **Trajectory matching**: AgentEvals integration with fuzzy argument matching (subset, superset, unordered, strict modes)
- **VCR cassette replay**: Record tool call sequences and agent results for fast deterministic tests
- **Parallel worktree isolation**: Run tests across multiple git worktrees with unique `TEST_RUN_ID` namespacing
- **Bun-native API**: `describeEval`, built-in scorers (`toolSequenceScorer`, `toolOrderScorer`, `toolExclusionScorer`, `completionScorer`)
- **Composable scorers**: Combine multiple evaluation criteria with `combineScorers`
- **AgentEvals evaluators**: Pre-configured scorers (`claudeToolScorer`, `strictTrajectoryScorer`, `unorderedTrajectoryScorer`)

## Implementation Files

Reference these paths for implementation details:

### Hook Scripts
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/scripts/capture-tool.ts` (lines 1-40)
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/scripts/log-result.ts`
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/scripts/common.ts` (lines 8-80 for type definitions)

### Test Infrastructure
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/harness.ts` (lines 37-95 for `runAgent()`, lines 110-136 for parsing)
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/bun-evals.ts` (lines 136-186 for `describeEval()`)
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/evaluators.ts` (lines 133-205 for AgentEvals integration)
- `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/vcr.ts` (lines 207-258 for VCR task wrapper)

### Example Tests
- Unit tests: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/tests/*.test.ts`
- Skill invocation tests: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/skills/gemini-offloader.test.ts`

## Limitations

1. **Hooks must be loaded**: The plugin's hooks need to be active. If testing in a clean environment, ensure the plugin is installed.

2. **Subprocess isolation**: Each `runAgent()` spawns a new Claude process. Tests are isolated but slower than unit tests.

3. **VCR architecture**: Uses tool-level recording (not API-level HTTP mocking). Cassettes contain tool calls and responses, not raw HTTP payloads. This design works regardless of Claude Code's internal HTTP implementation.

4. **External CLI dependencies**: Tests that spawn external CLI tools (like `gemini`) require responsiveness checks to avoid indefinite hangs. Use minimal PATH environments or timeout wrappers. See gemini-offloader tests for patterns.

5. **Bun.spawn stdin inheritance**: Avoid `stdin: "inherit"` in spawned processes during tests unless testing TTY behavior. It can cause hangs when no TTY is available.
