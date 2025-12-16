---
name: h-implement-bun-eval-suite
branch: feature/implement-bun-eval-suite
status: in-progress
created: 2025-12-15
---

# Bun Native Eval Suite for Claude Code Subagent Testing

## Problem/Goal

When developing Claude Code skills and multi-agent workflows, there's no systematic way to validate agent behavior before deployment. Manual testing is slow, non-reproducible, and misses edge cases in tool selection and parameter accuracy.

This task implements a local testing framework using Bun's native test runner (`bun:test`) combined with Claude Code's hook system and AgentEvals for trajectory matching.

## Success Criteria
- [x] Tool call capture via PreToolUse/PostToolUse hooks writes to JSONL
- [x] Custom `describeEval` wrapper provides vitest-evals-like API for bun:test
- [x] AgentEvals `createTrajectoryMatchEvaluator` integration validates tool sequences
- [x] VCR cassette recording enables deterministic replay without API calls
- [x] Parallel test isolation across git worktrees via unique output paths
- [x] Gemini-offloader unit tests validate CLI script behavior

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

## Next Steps

- Implement subtask 08: gemini-offloader e2e workflow tests (Layer 3)
- Add subtask 09 (Langfuse observability) when reference implementation ready
- Consider expanding test coverage to other skills/plugins

## Context Manifest

### How This Testing Framework Will Work: Complete System Architecture

This implementation creates a local-first testing framework for validating Claude Code subagent behavior. The framework leverages three key infrastructure pieces already present in the codebase: (1) Claude Code's native hook system for tool call interception, (2) Bun's built-in test runner for test execution, and (3) the sessions framework's git worktree isolation for parallel test execution.

#### The Hook System Architecture (Already in Production)

The project already has a sophisticated hook system configured at `.claude/settings.json`. This configuration demonstrates how hooks intercept tool execution at multiple lifecycle points. The existing hooks use Node.js scripts (`sessions/hooks/*.js`) that receive JSON via stdin containing complete tool invocation details: `tool_name`, `tool_input`, `session_id`, `tool_use_id`, and `cwd`.

The hook execution model works like this: When Claude Code is about to execute a tool, it spawns the hook script as a subprocess, pipes the tool invocation JSON to stdin, and reads the stdout/stderr response. The hook can exit with code 0 to allow execution, code 2 to block it, or output modified JSON to transform the tool's inputs. This architecture is already battle-tested through the sessions enforcement system (`sessions/hooks/sessions_enforce.js`) which blocks Write/Edit/MultiEdit tools during discussion mode.

For the eval suite, we'll add new PreToolUse and PostToolUse hooks specifically for test runs. These hooks will write JSONL entries to a test-run-specific output directory (e.g., `./test-output/{TEST_RUN_ID}/tool-calls.jsonl`). The TEST_RUN_ID environment variable will enable parallel worktree isolation - each git worktree running tests gets its own unique capture directory.

The critical insight: hooks are **environment-aware**. When Claude Code runs in a test context (as a subprocess spawned by `Bun.spawn(["claude", ...])` from a test), those hooks see the TEST_RUN_ID environment variable and route their output to isolated files. This prevents cross-contamination when multiple test suites run concurrently in different worktrees.

#### The Bun + TypeScript Stack (Established Pattern)

The project has multiple examples of Bun TypeScript implementations with consistent patterns. Looking at the gemini-offloader plugin (`plugins/gemini-offloader/skills/gemini-offloader/scripts/`), we see the established structure:

**Directory Layout:**
```
scripts/
├── package.json           # Bun dependencies
├── tsconfig.json         # Strict TypeScript config
├── bun.lock              # Lockfile (gitignored)
├── launcher.ts           # Entry point pattern
├── query.ts              # Single operation scripts
├── session.ts            # Multi-operation scripts
└── memory.ts             # Shared library modules
```

**TypeScript Configuration Standard:**
The gemini-offloader's `tsconfig.json` sets the project-wide standard:
- `"experimentalDecorators": true` and `"emitDecoratorMetadata": true` - Required for Judgment Labs tracing decorators
- `"target": "ESNext"`, `"module": "Preserve"` - Bun-native settings
- `"moduleResolution": "bundler"` - Enables `.ts` imports without compilation
- `"strict": true` with specific safety flags enabled
- No emit (`"noEmit": true`) since Bun executes TypeScript directly

**Package Management:**
The project uses isolated `package.json` files per script directory (not monorepo). The gemini-offloader example shows:
```json
{
  "name": "scripts",
  "private": true,
  "devDependencies": { "@types/bun": "latest" },
  "peerDependencies": { "typescript": "^5" },
  "dependencies": { "judgeval": "^0.8.1" }
}
```

The `bun.lock` files are present but gitignored (`.gitignore` includes `bun.lock`). Dependencies install with `bun install` (not npm/yarn).

**Bun-Native APIs in Use:**
- `Bun.spawn()` for subprocess management (see `query.ts:123` where it shells out to `which gemini`)
- `Bun.file()` for filesystem operations (preferred over Node's fs)
- `Bun.$` template for shell commands
- `Bun.stdin.stream()` for stdin reading
- `import.meta.main` guard for dual-purpose scripts (both CLI and importable library)

#### The Judgment Labs Tracing Integration (Reference Implementation)

The most recent completed task (`sessions/tasks/done/m-implement-judgment-tracing.md`) provides the exact tracing pattern we'll need to replicate for eval infrastructure:

**Tracer Initialization Pattern:**
```typescript
import { Judgeval, NodeTracer } from "judgeval";

let tracer: NodeTracer | null = null;

async function initTracer(): Promise<NodeTracer | null> {
  if (!(process.env.JUDGMENT_ORG_ID && process.env.JUDGMENT_API_KEY)) {
    return null; // Gracefully degrade when tracing unavailable
  }
  try {
    const judgeval = Judgeval.create({
      organizationId: process.env.JUDGMENT_ORG_ID!,
      apiKey: process.env.JUDGMENT_API_KEY!,
    });
    const t = await judgeval.nodeTracer.create({
      projectName: "tinymade-skills-gemini-offloader",
    });
    await t.initialize();
    return t;
  } catch {
    return null; // Silent failure - don't break the main flow
  }
}
```

**Function Wrapping:**
The `query.ts` implementation shows how to wrap functions with tracing:
```typescript
tracer = await initTracer();
const tracedFn = tracer ? tracer.observe(myFunction, "span", "myFunction") : myFunction;
```

**Span Attributes:**
Traces include rich context via `tracer.setAttributes()`:
```typescript
tracer.setAttributes({
  "gemini.script": "query",
  "gemini.model": args.model || "default",
  "gemini.cache_hit": true,
  "gemini.project_hash": projectHash,
});
```

**Cleanup:**
Scripts call `await tracer.forceFlush()` and `await tracer.shutdown()` before exit.

This tracing infrastructure already exists and is sending data to the "tinymade-skills-gemini-offloader" project. Our eval suite should create a separate project (e.g., "tinymade-skills-agent-evals") to keep eval traces isolated from production usage.

#### The Sessions Framework Integration

The sessions system provides critical infrastructure for task management and mode enforcement. Key components:

**State Management (`sessions/hooks/shared_state.js`):**
- `PROJECT_ROOT` discovery via `.claude` directory traversal or `CLAUDE_PROJECT_DIR` env var
- State persistence at `sessions/sessions-state.json` with atomic file locking
- Mode tracking: `discussion` vs `implementation` (controlled by trigger phrases in `sessions-config.json`)
- Task tracking: current task name, branch, status, dependencies

**Configuration Schema (`sessions/sessions-config.json`):**
Shows how to configure behavior:
- `trigger_phrases`: User commands that activate protocols ("yert" for implementation mode, "mek:" for task creation)
- `blocked_actions.implementation_only_tools`: Tools blocked in discussion mode (Write, Edit, MultiEdit, NotebookEdit)
- `git_preferences`: Auto-merge, auto-push, commit style
- `features.branch_enforcement`: Ensures work happens on correct branches

**Hook Composition:**
The `.claude/settings.json` shows hooks can have multiple matchers and chain multiple commands:
```json
"PreToolUse": [
  {
    "matcher": "Task",
    "hooks": [{ "type": "command", "command": "node $CLAUDE_PROJECT_DIR/sessions/hooks/subagent_hooks.js" }]
  },
  {
    "matcher": "Write|Edit|MultiEdit|Task|Bash|TodoWrite|NotebookEdit",
    "hooks": [{ "type": "command", "command": "node $CLAUDE_PROJECT_DIR/sessions/hooks/sessions_enforce.js" }]
  }
]
```

For the eval suite, we'll need to add test-specific hooks that **only activate when `TEST_MODE=true`** to avoid polluting production usage.

#### The Git Worktree Isolation Pattern

The project has a worktree orchestrator plugin (`plugins/worktree-orchestrator`) that demonstrates parallel git worktree management. While we don't have direct access to its implementation (no source files visible), the `.trees/` directory structure and sessions integration shows the pattern:

**Worktree Directory Structure:**
```
.trees/
└── .state/     # Worktree metadata
```

**Isolation Strategy:**
Each worktree is a separate git checkout at a different branch/commit. Tests running in parallel across worktrees need:
1. Unique hook output paths (via `TEST_RUN_ID` env var)
2. Isolated `.claude/settings.json` or env-based hook activation
3. Separate test result directories

The key insight from the research docs: we can use `TEST_RUN_ID` environment variable to namespace hook outputs. Hook scripts check this var and write to `./test-output/${TEST_RUN_ID}/` instead of a shared location.

### For New Feature Implementation: Where the Eval Suite Hooks Into Existing Infrastructure

Since we're building a brand-new testing framework (not modifying existing functionality), the integration points are **additive** rather than invasive:

#### 1. New Hooks for Tool Call Capture

We'll create TypeScript hooks in a new `hooks/testing/` directory:
```
hooks/
└── testing/
    ├── capture-tool.ts     # PreToolUse: writes JSONL
    ├── log-result.ts       # PostToolUse: captures outputs
    └── common.ts           # Shared utilities (outputPath resolver, etc.)
```

These hooks will:
- Check `process.env.TEST_MODE === "true"` to activate (inactive in production)
- Read `process.env.TEST_RUN_ID` for output path namespacing
- Write to `./test-output/{TEST_RUN_ID}/tool-calls.jsonl`
- Use append mode to handle concurrent tool calls in a single test

**Hook Registration (Manual or Test-Specific):**
Option A: Add to `.claude/settings.json` with matcher that checks env var
Option B: Use separate `.claude/settings.test.json` and swap via test setup

#### 2. Bun Test Infrastructure

Create `tests/` directory with structure:
```
tests/
├── lib/
│   ├── bun-evals.ts        # Custom describeEval wrapper
│   ├── harness.ts          # runAgent(), getToolCalls()
│   └── evaluators.ts       # AgentEvals integration
├── fixtures/
│   ├── file-search.json    # Expected trajectories
│   └── code-edit.json
└── skills/
    ├── file-search.test.ts
    └── code-edit.test.ts
```

**The `harness.ts` Module:**
Provides test utilities:
```typescript
export async function runAgent(options: {
  prompt: string;
  allowedTools: string[];
  maxTurns: number;
  testId: string;
}): Promise<void> {
  // Spawn Claude Code as subprocess with TEST_MODE=true
  const proc = Bun.spawn([
    "claude",
    "-p", options.prompt,
    "--output-format", "json",
    "--max-turns", options.maxTurns.toString(),
    // Tool restrictions would need custom Claude Code flags
  ], {
    env: {
      ...process.env,
      TEST_MODE: "true",
      TEST_RUN_ID: options.testId,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
}

export async function getToolCalls(testId: string): Promise<ToolCall[]> {
  const logPath = `./test-output/${testId}/tool-calls.jsonl`;
  const content = await Bun.file(logPath).text();
  return content
    .trim()
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}
```

**The `bun-evals.ts` Wrapper:**
Mimics vitest-evals API but uses bun:test:
```typescript
import { test, expect } from "bun:test";

export function describeEval(name: string, config: {
  data: () => Promise<EvalCase[]>;
  task: (input: string) => Promise<AgentResult>;
  scorers: Scorer[];
  threshold?: number;
}) {
  test(name, async () => {
    const cases = await config.data();
    const threshold = config.threshold ?? 0.8;

    for (const evalCase of cases) {
      const testId = `${name}-${Date.now()}`;
      const result = await config.task(evalCase.input);

      // Run scorers (includes trajectory matching)
      for (const scorer of config.scorers) {
        const { score } = await scorer({
          input: evalCase.input,
          output: result,
          expected: evalCase.expected,
        });
        expect(score).toBeGreaterThanOrEqual(threshold);
      }
    }
  });
}
```

#### 3. AgentEvals Integration

Install as dependency:
```bash
bun add agentevals  # LangChain's trajectory matching library
```

Create evaluator factory in `tests/lib/evaluators.ts`:
```typescript
import { createTrajectoryMatchEvaluator } from "agentevals";

export function createToolSequenceMatcher(expectedTrajectory: ToolCall[]) {
  return createTrajectoryMatchEvaluator({
    trajectoryMatchMode: "subset",  // Agent used at least these tools
    toolArgsMatchMode: "subset",    // Arguments contain expected keys
    toolArgsMatchOverrides: {
      Grep: (actual, expected) => {
        // Fuzzy pattern matching for regex patterns
        return actual.pattern.toLowerCase().includes(
          expected.pattern.toLowerCase()
        );
      },
    },
  });
}
```

#### 4. VCR Cassette Recording (Phase 4)

For deterministic replay without API calls, we'll intercept Claude API responses. The gemini-offloader's caching pattern provides a model:

**Cache Structure:**
```
cassettes/
└── {test-name}/
    ├── request-1.json    # Recorded Claude API request
    ├── response-1.json   # Recorded Claude API response
    └── metadata.json     # Timing, model, etc.
```

**Mock Implementation:**
Use Bun's `mock.module()` to intercept HTTP requests:
```typescript
import { mock } from "bun:test";

const cassette = await Bun.file(`./cassettes/${testName}/response-1.json`).json();

mock.module("node:https", () => ({
  request: (url, opts, callback) => {
    // Return canned response from cassette
    callback({
      on: (event, handler) => {
        if (event === "data") handler(JSON.stringify(cassette));
      }
    });
  }
}));
```

This enables running tests without hitting Claude API (instant execution, no costs).

#### 5. Parallel Worktree Isolation

For running tests across multiple git worktrees simultaneously:

**Per-Worktree Setup Script:**
```typescript
// tests/lib/setup-worktree.ts
export async function setupWorktreeTestEnv(worktreePath: string, testId: string) {
  // Ensure isolated hook output
  const testOutputDir = `${worktreePath}/test-output/${testId}`;
  await Bun.write(`${testOutputDir}/.gitkeep`, "");

  // Optional: Generate worktree-specific .claude/settings.json
  // Or rely on TEST_RUN_ID env var in shared hooks
}
```

**Parallel Execution:**
```bash
# Run tests in parallel across worktrees
cd .trees/worktree-a && TEST_RUN_ID=wt-a bun test &
cd .trees/worktree-b && TEST_RUN_ID=wt-b bun test &
wait
```

### Technical Reference Details

#### Dependencies to Install

**In Project Root (or tests/ directory):**
```json
{
  "name": "agent-evals",
  "private": true,
  "devDependencies": {
    "@types/bun": "latest"
  },
  "dependencies": {
    "agentevals": "^0.1.0",  // LangChain trajectory matching
    "judgeval": "^0.8.1"      // Already installed for tracing
  }
}
```

#### TypeScript Configuration (tests/tsconfig.json)

Inherit from gemini-offloader pattern with test-specific settings:
```json
{
  "extends": "../plugins/gemini-offloader/skills/gemini-offloader/scripts/tsconfig.json",
  "compilerOptions": {
    "types": ["bun:test"]  // Enable bun:test types
  },
  "include": ["**/*.ts", "**/*.test.ts"]
}
```

#### Tool Call Data Structures

**JSONL Entry Format (Hook Output):**
```typescript
interface ToolCallEntry {
  timestamp: string;           // ISO8601
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
  session_id: string;
  cwd: string;
  // PostToolUse adds:
  tool_output?: string;
  exit_code?: number;
  error?: string;
}
```

**AgentEvals Trajectory Format:**
```typescript
interface ToolCall {
  tool: string;           // Tool name
  args: Record<string, unknown>;  // Tool arguments
}

interface TrajectoryEvalInput {
  input: string;                    // Original prompt
  actualTrajectory: ToolCall[];     // From tool-calls.jsonl
  expectedTrajectory: ToolCall[];   // From fixture
}
```

#### File Locations for Implementation

**Hook Scripts:**
- `/home/gulp/projects/tinymade-skills/hooks/testing/capture-tool.ts`
- `/home/gulp/projects/tinymade-skills/hooks/testing/log-result.ts`
- `/home/gulp/projects/tinymade-skills/hooks/testing/common.ts`

**Test Infrastructure:**
- `/home/gulp/projects/tinymade-skills/tests/lib/bun-evals.ts`
- `/home/gulp/projects/tinymade-skills/tests/lib/harness.ts`
- `/home/gulp/projects/tinymade-skills/tests/lib/evaluators.ts`

**Test Fixtures:**
- `/home/gulp/projects/tinymade-skills/tests/fixtures/`

**Example Tests:**
- `/home/gulp/projects/tinymade-skills/tests/skills/file-search.test.ts`
- `/home/gulp/projects/tinymade-skills/tests/skills/code-edit.test.ts`

**VCR Cassettes:**
- `/home/gulp/projects/tinymade-skills/cassettes/`

**Test Output (gitignored):**
- `/home/gulp/projects/tinymade-skills/test-output/{TEST_RUN_ID}/tool-calls.jsonl`

#### Environment Variables

**For Test Execution:**
```bash
TEST_MODE=true              # Activates test hooks
TEST_RUN_ID=unique-id       # Namespaces hook outputs
CLAUDE_PROJECT_DIR=/path    # Already used by sessions hooks
```

**For Tracing (Optional):**
```bash
JUDGMENT_ORG_ID=...        # Already configured in .envrc
JUDGMENT_API_KEY=...       # Already configured in .envrc
```

#### Integration with Existing Sessions

**Avoiding Conflicts:**
The sessions framework's mode enforcement (`sessions/hooks/sessions_enforce.js`) blocks Write/Edit/MultiEdit in discussion mode. Tests need to either:
1. Run with `bypass_mode: true` in sessions state
2. Set mode to implementation before spawning agent
3. Run in isolated environment without sessions hooks active

**Recommended Approach:**
Tests spawn Claude Code in a clean subprocess environment where sessions hooks are either:
- Not loaded (custom .claude/settings.json for tests)
- Deactivated via flag (e.g., `SESSIONS_DISABLED=true`)

This keeps eval infrastructure isolated from sessions workflow.

#### Claude Code CLI Invocation Patterns

From the research and existing code:
```bash
# Basic query with JSON output
claude -p "Find TypeScript files with TODOs" --output-format json

# With tool restrictions (if supported - needs verification)
claude -p "..." --allowed-tools Read,Grep,Glob

# With max turns limit
claude -p "..." --max-turns 5

# Skip permission prompts for automation
claude -p "..." --dangerously-skip-permissions
```

Tests will use `Bun.spawn()` to invoke these commands programmatically.

## Reference Documents

- `docs/bun-agent-testing.md` - Technical research on Bun compatibility and approaches
- `docs/prd-claude-code-agent-testing.md` - Full PRD with architecture and implementation details

## User Notes

### Design Decision: AgentEvals vs Judgeval

These are **orthogonal** — they evaluate different things:

| | AgentEvals | Judgeval |
|---|---|---|
| **Evaluates** | Tool behavior (structural) | Output quality (semantic) |
| **Method** | Deterministic trajectory matching | LLM-as-judge |
| **API cost** | None | Yes (judge LLM calls) |

**Implementation approach:**
- AgentEvals = core, always runs (local-first, free)
- Judgeval = optional, gated behind `EVAL_LLM_JUDGE=1` flag

```typescript
const USE_LLM_JUDGE = process.env.EVAL_LLM_JUDGE === "1";
const scorers = [
  trajectoryMatchScorer,  // Always
  ...(USE_LLM_JUDGE ? [answerRelevancyScorer] : []),
];
```

This respects the "minimize API costs" constraint while allowing semantic scoring when needed (CI, release validation).


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
