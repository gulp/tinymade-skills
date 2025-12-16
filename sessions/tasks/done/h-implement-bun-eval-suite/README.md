---
name: h-implement-bun-eval-suite
branch: feature/implement-bun-eval-suite
status: completed
created: 2025-12-15
---

# Bun Native Eval Suite for Claude Code Subagent Testing

## Problem/Goal

When developing Claude Code skills and multi-agent workflows, there's no systematic way to validate agent behavior before deployment. Manual testing is slow, non-reproducible, and misses edge cases in tool selection and parameter accuracy.

This task implements a local testing framework using Bun's native test runner (`bun:test`) combined with Claude Code's hook system and AgentEvals for trajectory matching.

## Success Criteria
- [x] PreToolUse/PostToolUse hooks capture tool calls to JSONL
- [x] `describeEval` wrapper for bun:test
- [x] AgentEvals trajectory matching integration
- [x] VCR cassette recording for deterministic replay
- [x] Parallel test isolation via unique output paths
- [x] Gemini-offloader unit tests

## Subtasks

### Core Infrastructure
1. `01-hooks-tool-capture.md` - Claude Code hooks + JSONL capture
2. `02-bun-evals-wrapper.md` - `describeEval` API for bun:test
3. `03-agentevals-integration.md` - Trajectory matching evaluators
4. `04-vcr-cassette-replay.md` - Deterministic test replay
5. `05-parallel-worktree-isolation.md` - Multi-worktree test isolation

### Gemini-Offloader Test Suite (Reference Implementation)
6. `06-gemini-offloader-unit-tests.md` - Layer 1: Direct CLI script testing
7. `07-gemini-offloader-skill-invocation.md` - Layer 2: Claude skill invocation tests
8. `08-gemini-offloader-e2e-workflow.md` - Layer 3: End-to-end workflow tests

### Observability Infrastructure
9. `09-langfuse-observability.md` - Migrate from Judgeval to self-hosted Langfuse

### Dependency Fixes
10. `10-fix-agentevals-dependency.md` - Fix @langchain/openai broken export (DONE)


## Context Manifest

### Architecture Overview

This implementation creates a local-first testing framework for validating Claude Code subagent behavior using:
1. Claude Code's hook system (PreToolUse/PostToolUse) for tool call interception
2. Bun's native test runner (`bun:test`) for test execution
3. AgentEvals for trajectory matching
4. Git worktree isolation for parallel test execution

**Key Components:**
- Hooks capture tool calls to JSONL when `TEST_MODE=true`
- Test harness spawns Claude as subprocess with isolated output paths via `TEST_RUN_ID`
- AgentEvals validates tool sequences with fuzzy argument matching
- VCR cassettes enable deterministic replay without API costs

### Implementation Files

**Hook Scripts:** `plugins/agent-evals/scripts/`
- `capture-tool.ts` - PreToolUse hook writes JSONL
- `log-result.ts` - PostToolUse hook captures outputs
- `common.ts` - Shared utilities and type definitions

**Test Infrastructure:** `plugins/agent-evals/tests/lib/`
- `harness.ts` - Agent execution and tool call parsing
- `bun-evals.ts` - `describeEval` wrapper for bun:test
- `evaluators.ts` - AgentEvals integration with fuzzy matchers
- `vcr.ts` - Cassette recording/playback
- `worktree.ts` - Parallel worktree isolation

**Example Tests:**
- `plugins/gemini-offloader/skills/gemini-offloader/tests/` - Unit tests (Layer 1)
- `plugins/agent-evals/tests/skills/gemini-offloader.test.ts` - Skill invocation tests (Layer 2)

### Design Decisions

**AgentEvals vs Judgeval**

These are orthogonal - they evaluate different aspects:

| | AgentEvals | Judgeval |
|---|---|---|
| **Evaluates** | Tool behavior (structural) | Output quality (semantic) |
| **Method** | Deterministic trajectory matching | LLM-as-judge |
| **API cost** | None | Yes (judge LLM calls) |

Implementation approach:
- AgentEvals = core (always runs, local-first, free)
- Judgeval = optional (gated behind `EVAL_LLM_JUDGE=1` flag)


### Discovered During Implementation
[Date: 2025-12-15 / Initial hook infrastructure implementation]

During the first implementation session, we discovered two critical technical constraints that weren't documented in the original research:

**Claude Code SDK Types Are Not Available on npm**

The original plan referenced `@anthropic-ai/claude-code-sdk` as a dependency for hook type definitions (PreToolUseHookInput, PostToolUseHookInput). However, this package does not exist on npm. The search revealed that while `@anthropic-ai/claude-code` exists (the CLI itself), it doesn't export type definitions for the hook protocol.

The actual behavior: Hook scripts receive JSON via stdin following a protocol defined by Claude Code, but there's no published TypeScript package providing these types. We had to define them locally based on the JSON structure documented in the hook protocol.

**Solution implemented**: Added local type definitions in `plugins/agent-evals/scripts/common.ts`:
```typescript
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
```

Future implementations should define hook types locally rather than attempting to install an SDK dependency.

**Bun.write() Does Not Support Append Mode**

The Bun documentation and examples show `Bun.write()` as the preferred file I/O API, and we initially implemented JSONL appending using `Bun.write(path, data, { append: true })`. TypeScript compilation succeeded (the signature appears valid), but the actual Bun runtime doesn't support the `append` option.

The actual behavior: `Bun.write()` only supports writing entire files, not appending. Attempting to use `{ append: true }` is silently ignored or produces TypeScript errors depending on the Bun version.

**Solution implemented**: Use Node.js `appendFile` from `fs/promises` instead:
```typescript
import { appendFile } from "node:fs/promises";
await appendFile(outputPath, line, "utf-8");
```

This works reliably in Bun (which has full Node.js API compatibility) and is the correct approach for JSONL append operations. Future implementations should use Node.js fs APIs for append operations even when running under Bun.

### Discovered During Implementation - Session 2
[Date: 2025-12-16 / AgentEvals integration and VCR implementation]

During the second implementation session, critical discoveries were made about the `agentevals` package integration and VCR architecture that differ from the original context assumptions.

**AgentEvals Requires Message Format Conversion**

The `agentevals@0.0.6` library expects trajectories in `ChatCompletionMessage` format with `role`, `content`, and `tool_calls` arrays - not the simple `ToolCallEntry[]` format from our hooks. This wasn't documented in the original research.

The actual behavior: `createTrajectoryMatchEvaluator` expects inputs like:
```typescript
{
  outputs: [{
    role: "assistant",
    content: "",
    tool_calls: [{ id, type: "function", function: { name, arguments } }]
  }],
  referenceOutputs: [...]
}
```

**Solution implemented**: Built adapter layer in `evaluators.ts`:
- `toolCallsToMessages()` converts `ToolCallEntry[]` to `ChatCompletionMessage[]`
- Groups pre-tool calls into assistant messages with nested `tool_calls` arrays
- Each tool call converted to `{ type: "function", function: { name, arguments } }` structure

Future developers: The `createTrajectoryMatchEvaluator` won't work directly with hook output. The adapter layer is essential.

**Fuzzy Tool Argument Matching Is Essential**

The original context showed exact argument matching (`toolArgsMatchMode: "exact"`), but real-world usage requires fuzzy matching to avoid brittle tests.

The actual behavior: Without fuzzy matching, tests fail on minor variations like:
- `src/**/*.ts` vs `src/*.ts` (glob pattern differences)
- `/absolute/path` vs `relative/path` (path format)
- Case differences in regex patterns

**Solution implemented**: Tool-specific fuzzy matchers via `toolArgsMatchOverrides`:
```typescript
toolArgsMatchOverrides: {
  Grep: (actual, expected) => {
    // Case-insensitive substring matching for patterns
    return actual.pattern.toLowerCase().includes(expected.pattern.toLowerCase());
  },
  Glob: (actual, expected) => {
    // Wildcard-aware pattern matching
    return matchGlobPattern(actual.pattern, expected.pattern);
  },
  Read: (actual, expected) => {
    // Path normalization
    return normalizePath(actual.file_path) === normalizePath(expected.file_path);
  }
}
```

Future implementations: Use `toolArgsMatchMode: "subset"` by default and add fuzzy matchers for common tools. Exact matching is too brittle for production eval suites.

**VCR Uses Tool-Level Recording, Not API-Level Mocking**

The original context suggested using `mock.module("node:https")` to intercept Claude API requests. The actual implementation chose a different architecture.

The actual behavior: Tool-level VCR is superior because:
- Claude Code's hook system already captures tool invocations with inputs/outputs
- More granular control (can selectively mock individual tools)
- Works regardless of Claude Code's internal HTTP implementation details
- Cassettes are human-readable (tool calls, not HTTP payloads)
- Can inject modified tool responses for edge case testing

**Solution implemented**: `vcr.ts` records/replays at tool execution layer:
```typescript
// Recording
await recordCassette(testId, toolCalls, "cassettes/my-test.json");

// Playback
const mockRunAgent = playCassette("cassettes/my-test.json");
// Returns pre-recorded tool calls instead of spawning Claude
```

Future work on VCR replay should focus on mocking the test harness layer (`runAgent()` function), not the HTTP layer. This architectural decision means cassettes are **tool execution recordings**.

### Discovered During Implementation - Session 3
[Date: 2025-12-16 / Unit test implementation for gemini-offloader]

During implementation of unit tests for the gemini-offloader CLI scripts, we discovered critical testing gotchas related to external CLI dependencies that weren't documented in the original eval suite architecture.

**gemini-cli Can Hang Indefinitely on `--list-sessions` Command**

The gemini-cli tool (Google's Gemini API CLI) can hang when called with `--list-sessions` in certain environments, particularly when running under test harnesses without a TTY. This wasn't documented in any gemini-cli docs and caused initial test timeouts.

The actual behavior: Commands like `gemini --list-sessions` will hang indefinitely (no timeout, no error) when:
- Running in CI/automated test environments
- Spawned from Bun.spawn without proper stdin configuration
- System is under load or has gemini authentication issues

**Solution implemented**: Tests that depend on external CLIs must check responsiveness before running:
```typescript
async function isGeminiResponsive(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["timeout", "2", "gemini", "--version"], {
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
geminiResponsive = await isGeminiResponsive();

// In tests
if (!geminiResponsive) {
  console.log("Skipping: gemini-cli not responsive");
  return;
}
```

Future implementations: Any test suite that spawns external CLI tools (especially API clients) should implement responsiveness checks. Don't assume external tools will fail fast - they may hang indefinitely.

**Bun.spawn with `stdin: "inherit"` Causes Hangs in Test Context**

The gemini-offloader session.ts script uses `Bun.spawn([geminiPath, "--list-sessions"], { stdin: "inherit" })` to call gemini-cli. This pattern works fine in interactive shells but hangs when run from bun test.

The actual behavior: When stdin is inherited and there's no TTY (common in test runners), the spawned process may wait indefinitely for stdin input that will never come. This affects the `listSessions()` function in session.ts at line 166.

**Root cause**: The gemini-cli expects interactive stdin for some operations. When tests spawn scripts that spawn gemini with inherited stdin, you get:
```
Test -> Bun.spawn(script.ts) -> Bun.spawn(gemini, {stdin: "inherit"}) -> HANGS
```

**Solution for tests**: Use minimal PATH to force "gemini not found" errors (fast failures) instead of hanging:
```typescript
const BUN_DIR = dirname(Bun.which("bun") || "/usr/bin/bun");

const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`, "list"], {
  env: {
    ...process.env,
    PATH: BUN_DIR, // Only bun available, gemini not found
  },
});
```

This produces instant "gemini-cli not found" errors instead of multi-second hangs.

Future implementations: When testing scripts that spawn external CLI tools:
1. Default to PATH manipulation to exclude problematic tools (fast failure path)
2. Use responsiveness checks + extended timeouts for real CLI interaction tests
3. Never use `stdin: "inherit"` in spawned processes during tests unless specifically testing TTY behavior

## Work Log

### 2025-12-16 Session 4

#### Completed
- Subtask 07: Gemini-offloader skill invocation tests
  - Created `plugins/agent-evals/tests/skills/gemini-offloader.test.ts` with 6 comprehensive tests
  - Tests validate Claude invokes Skill tool for research requests
  - Tests verify correct script execution paths (query.ts, session.ts, launcher.ts)
  - Tests include trajectory matching validation
  - All tests skip gracefully when claude CLI unavailable
- Subtask 10: Fixed agentevals @langchain/openai dependency
  - Added `overrides` to package.json pinning @langchain/core@0.1.54 and @langchain/openai@0.0.28
  - Documented workaround with standard "//" comment field for future maintenance
  - Resolved broken '_convertMessagesToOpenAIParams' export issue
- Code review findings addressed
  - Fixed fragile test assertions (switched from `.toContain()` to `.toMatch()` for precision)
  - Fixed conditional assertion to explicitly validate Bash ordering
  - Corrected package.json documentation format (removed non-standard `comments` field)
- Task completion
  - All 6 core success criteria verified
  - Task status marked complete and archived to `sessions/tasks/done/`
  - Pushed to feature/implement-bun-eval-suite branch

#### Decisions
- Used Gemini-offloader skill to research hardening strategies for dependency fixes
- Implemented immediate fix via package.json overrides (vs. custom implementation)
- Prioritized test reliability over test convenience (better assertions)

#### Commits
- 80f2d28: feat(agent-evals): implement skill invocation tests and fix agentevals deps
- 6d0d311: fix(agent-evals): address code review findings
- 913b43d: chore: complete bun-eval-suite task

### 2025-12-16 Session 3

#### Completed
- Implemented subtask 06: gemini-offloader unit tests
  - Created test directory at `plugins/gemini-offloader/skills/gemini-offloader/tests/`
  - `query.test.ts`: 9 tests for argument validation, JSON output structure, cache behavior
  - `launcher.test.ts`: 11 tests for LauncherResult structure, operations list validation
  - `session.test.ts`: 13 tests for command parsing, graceful failures when gemini unavailable
  - Test results: 30 pass, 3 skip, 0 fail (~51 seconds execution time)

#### Decisions
- Used minimal PATH environment to force fast "gemini not found" errors
- Auto-skip gemini-dependent tests when CLI unresponsive (prevents 30s hangs)
- Tests validate both success paths and error handling for missing dependencies

#### Commits
- 0cf4256: Initial gemini-offloader test suite with query/launcher/session tests
- 21a85ed: Additional test coverage and skip logic refinements

### 2025-12-16 Session 2

#### Completed
- Implemented subtask 02: `tests/lib/bun-evals.ts` with `describeEval` wrapper
- Implemented subtask 03: `tests/lib/evaluators.ts` with AgentEvals integration
- Implemented subtask 04: `tests/lib/vcr.ts` with VCR cassette recording/playback
- Implemented subtask 05: `tests/lib/worktree.ts` with parallel worktree isolation
- Created example test file: `tests/examples/file-search.test.ts`

#### Decisions
- Integrated agentevals v0.0.6 for trajectory matching
- VCR implementation uses Bun.mock.module() for HTTP interception

#### Commits
- e91544a: Implemented subtasks 02-05 (bun-evals, evaluators, vcr, worktree)
- 00a2986: Added example test file demonstrating new APIs

### 2025-12-15

#### Completed
- Implemented hook infrastructure (`plugins/agent-evals/scripts/`):
  - `capture-tool.ts` - PreToolUse hook writes JSONL when `TEST_MODE=true`
  - `log-result.ts` - PostToolUse hook captures tool outputs
  - `common.ts` - Shared utilities with local TypeScript types for `PreToolUseHookInput`/`PostToolUseHookInput`
- Fixed `common.ts` to use `appendFile` from `fs/promises` instead of `Bun.write` for JSONL append
- Created test harness (`plugins/agent-evals/tests/lib/harness.ts`):
  - `runAgent()` - Spawns Claude subprocess with `TEST_MODE=true` and `TEST_RUN_ID`
  - `getToolCalls()` - Parses JSONL output with timestamp sorting
  - `getToolSequence()` - Extracts tool names for trajectory matching
  - `generateTestId()` - Creates unique test IDs with timestamp
- Added `test-output/` to `.gitignore`
- Created comprehensive `README.md` quickstart documentation with:
  - Architecture diagrams showing test flow
  - Step-by-step walkthrough for file search agent testing
  - Concrete use cases (tool selection validation, trajectory matching)
- Created three gemini-offloader test subtasks:
  - `06-gemini-offloader-unit-tests.md` - Layer 1: Direct CLI script testing
  - `07-gemini-offloader-skill-invocation.md` - Layer 2: Agent skill invocation tests
  - `08-gemini-offloader-e2e-workflow.md` - Layer 3: End-to-end workflow testing

#### Decisions
- Removed SDK dependency (`@anthropic-ai/claude-code-sdk` doesn't exist on npm) - defined hook types locally
- Used `appendFile` from Node.js `fs/promises` for JSONL writing (Bun.write doesn't support append mode)
- Hook infrastructure compiles and type-checks cleanly with TypeScript strict mode
- Three-layer testing approach for gemini-offloader (unit → skill invocation → e2e workflow)

### 2025-12-15 (Initial)
- Task created from PRD
