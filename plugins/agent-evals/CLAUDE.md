# Agent Evals Plugin

This plugin provides a local-first testing framework for validating Claude Code subagent behavior using Bun's native test runner.

## Architecture

The framework captures tool calls via Claude Code's hook system and validates agent behavior using trajectory matching. Tests run locally without external eval services.

### Core Components

1. **Hook System** (`scripts/`)
   - Intercepts tool calls via PreToolUse/PostToolUse hooks
   - Writes JSONL logs when `TEST_MODE=true`
   - Output path: `test-output/{TEST_RUN_ID}/tool-calls.jsonl`

2. **Test Infrastructure** (`tests/lib/`)
   - `harness.ts`: Spawn Claude as subprocess, parse JSONL output
   - `bun-evals.ts`: Custom `describeEval` wrapper for bun:test
   - `evaluators.ts`: AgentEvals trajectory matching integration
   - `vcr.ts`: Record/replay tool call sequences
   - `worktree.ts`: Parallel worktree isolation

3. **Test Layers**
   - Layer 1: Unit tests for CLI scripts
   - Layer 2: Skill invocation tests (Claude → Skill tool)
   - Layer 3: End-to-end workflow tests

## Key Implementation Details

### Hook Types Are Defined Locally

The `@anthropic-ai/claude-code-sdk` package doesn't exist on npm. Hook types (`PreToolUseHookInput`, `PostToolUseHookInput`) are defined in `scripts/common.ts` based on the JSON structure piped to stdin.

Reference: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/scripts/common.ts` lines 8-22

### Use appendFile, Not Bun.write for JSONL

Bun doesn't support append mode in `Bun.write()`. Use `appendFile` from `node:fs/promises` instead:

```typescript
import { appendFile } from "node:fs/promises";
await appendFile(outputPath, line, "utf-8");
```

Reference: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/scripts/common.ts` lines 111-117

### AgentEvals Requires Message Format Conversion

The `agentevals` library expects `ChatCompletionMessage` format with `role`, `content`, and `tool_calls` arrays. Our hooks output `ToolCallEntry[]` format. The adapter layer in `evaluators.ts` handles this conversion:

- `toolCallsToMessages()`: Converts captured tool calls to message format
- `expectedToMessages()`: Converts test expectations to message format

Reference: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/evaluators.ts` lines 17-77

### Fuzzy Argument Matching

Use `toolArgsMatchMode: "subset"` and custom matchers for production tests. Exact matching is too brittle:

```typescript
import { createTrajectoryMatchScorer, grepPatternMatcher, globPatternMatcher } from "./evaluators.ts";

const scorer = createTrajectoryMatchScorer({
  trajectoryMatchMode: "subset",
  toolArgsMatchMode: "subset",
  toolArgsMatchOverrides: {
    Grep: grepPatternMatcher,    // Case-insensitive substring matching
    Glob: globPatternMatcher,    // Wildcard-aware pattern matching
  },
});
```

Reference: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/evaluators.ts` lines 279-287

### VCR Uses Tool-Level Recording

VCR cassettes record tool call sequences (not HTTP payloads). This works regardless of Claude Code's internal HTTP implementation and provides human-readable cassettes.

Recording mode:
```typescript
import { createVCRTask, defaultTask } from "./lib/vcr.ts";

const vcrTask = createVCRTask(defaultTask, { mode: "record" });
```

Playback mode (no API calls):
```typescript
const vcrTask = createVCRTask(defaultTask, { mode: "playback", failOnMissing: true });
```

Reference: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/lib/vcr.ts` lines 207-258

## Testing External CLI Dependencies

When testing scripts that spawn external CLI tools, handle potential hangs:

### Pattern 1: Responsiveness Check

```typescript
async function isToolResponsive(toolName: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["timeout", "2", toolName, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

// In test setup
const geminiResponsive = await isToolResponsive("gemini");

// In tests
if (!geminiResponsive) {
  console.log("Skipping: gemini not responsive");
  return;
}
```

### Pattern 2: Minimal PATH Environment

Force fast "command not found" errors instead of hangs:

```typescript
const BUN_DIR = dirname(Bun.which("bun") || "/usr/bin/bun");

const proc = Bun.spawn(["bun", "./script.ts"], {
  env: {
    ...process.env,
    PATH: BUN_DIR, // Only bun available
  },
});
```

### Pattern 3: Avoid stdin Inheritance

Never use `stdin: "inherit"` in spawned processes during tests:

```typescript
// BAD - can hang in test context
Bun.spawn(["external-tool"], { stdin: "inherit" });

// GOOD - explicit stdin handling
Bun.spawn(["external-tool"], { stdin: "pipe" });
```

Reference: Gemini-offloader unit tests at `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/tests/`

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TEST_MODE` | Enables tool call capture in hooks | `"false"` |
| `TEST_RUN_ID` | Unique identifier for test output isolation | `"default"` |
| `CLAUDE_PROJECT_DIR` | Project root for output path resolution | `process.cwd()` |
| `VCR_MODE` | VCR mode: `"record"`, `"playback"`, or `"passthrough"` | `"passthrough"` |
| `VCR_CASSETTES_DIR` | Directory for cassette storage | `"cassettes"` |

## Common Patterns

### Writing a Simple Test

```typescript
import { test, expect } from "bun:test";
import { runAgent, getToolCalls, getToolSequence, generateTestId } from "../lib/harness.ts";

test("agent uses Grep for content search", async () => {
  const testId = generateTestId("grep-test");
  
  const result = await runAgent({
    prompt: "Find all files containing TODO comments",
    testId,
    maxTurns: 5,
  });
  
  expect(result.exitCode).toBe(0);
  
  const toolSequence = getToolSequence(await getToolCalls(testId));
  expect(toolSequence).toContain("Grep");
});
```

### Using describeEval

```typescript
import { describeEval, defaultTask, toolSequenceScorer } from "../lib/bun-evals.ts";

describeEval("File Search Agent", {
  data: () => [
    { 
      name: "find ts files", 
      input: "List all TypeScript files", 
      expected: { tools: ["Glob"] } 
    },
  ],
  task: defaultTask,
  scorers: [toolSequenceScorer],
  threshold: 0.8,
});
```

### Using AgentEvals Trajectory Matching

```typescript
import { describeEval, defaultTask } from "../lib/bun-evals.ts";
import { claudeToolScorer } from "../lib/evaluators.ts";

describeEval("Tool Selection", {
  data: () => [
    { 
      name: "search workflow", 
      input: "Find TODO in TypeScript files", 
      expected: { 
        tools: [
          { name: "Glob", args: { pattern: "*.ts" } },
          { name: "Grep", args: { pattern: "TODO" } },
        ]
      } 
    },
  ],
  task: defaultTask,
  scorers: [claudeToolScorer], // Uses fuzzy matching
});
```

## Known Gotchas

1. **Hook activation**: Hooks only capture when `TEST_MODE=true` is set in the environment
2. **Test ID uniqueness**: Always use `generateTestId()` to avoid output path collisions
3. **JSONL parsing**: Tool calls are sorted by timestamp, not insertion order
4. **Message conversion**: AgentEvals expects different format than raw hook output
5. **External tools**: CLI tools can hang indefinitely - always use responsiveness checks or timeouts

## Related Documentation

- Main README: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/README.md`
- PRD: `/home/gulp/projects/tinymade-skills/docs/prd-claude-code-agent-testing.md`
- Research: `/home/gulp/projects/tinymade-skills/docs/bun-agent-testing.md`
- Task file: `/home/gulp/projects/tinymade-skills/sessions/tasks/done/h-implement-bun-eval-suite/README.md`
