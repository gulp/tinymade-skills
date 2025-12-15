---
name: h-implement-bun-eval-suite
branch: feature/implement-bun-eval-suite
status: pending
created: 2025-12-15
---

# Bun Native Eval Suite for Claude Code Subagent Testing

## Problem/Goal

When developing Claude Code skills and multi-agent workflows, there's no systematic way to validate agent behavior before deployment. Manual testing is slow, non-reproducible, and misses edge cases in tool selection and parameter accuracy.

This task implements a local testing framework using Bun's native test runner (`bun:test`) combined with Claude Code's hook system and AgentEvals for trajectory matching.

## Success Criteria
- [ ] Tool call capture via PreToolUse/PostToolUse hooks writes to JSONL
- [ ] Custom `describeEval` wrapper provides vitest-evals-like API for bun:test
- [ ] AgentEvals `createTrajectoryMatchEvaluator` integration validates tool sequences
- [ ] VCR cassette recording enables deterministic replay without API calls
- [ ] Parallel test isolation across git worktrees via unique output paths

## Subtasks

1. `01-hooks-tool-capture.md` - Claude Code hooks + JSONL capture
2. `02-bun-evals-wrapper.md` - `describeEval` API for bun:test
3. `03-agentevals-integration.md` - Trajectory matching evaluators
4. `04-vcr-cassette-replay.md` - Deterministic test replay
5. `05-parallel-worktree-isolation.md` - Multi-worktree test isolation

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

## Work Log
<!-- Updated as work progresses -->
- [2025-12-15] Task created from PRD
