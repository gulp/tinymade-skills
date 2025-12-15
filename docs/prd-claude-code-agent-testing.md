# PRD: Local Testing Framework for Claude Code Subagents

## Context

You are helping build a testing framework for Claude Code subagents/skills that run locally via CLI. The system uses parallel agent dispatch across git worktrees, with a Bun stack (not Node.js).

## Problem Statement

When developing Claude Code skills and multi-agent workflows, there's no systematic way to validate agent behavior before deployment. Manual testing is slow, non-reproducible, and misses edge cases in tool selection and parameter accuracy.

## User Needs

### 1. Tool Call Accuracy
Validate that agents call the correct tools with correct parameters for a given task.

**Example scenario**: When asked to "find all TypeScript files with TODO comments", the agent should:
- Call `Glob` with pattern `**/*.ts` (or equivalent)
- Call `Grep` with pattern containing `TODO`
- NOT call `Write` or other mutation tools

**Acceptance criteria**:
- Assert exact tool names in a sequence
- Assert tool arguments match expected values (exact or subset)
- Support fuzzy matching for arguments where appropriate (e.g., regex patterns)

### 2. Tool Discovery
Validate that agents find and select appropriate tools from the available set, even when multiple tools could technically work.

**Example scenario**: Given access to `Read`, `Grep`, `Glob`, `Bash`, the agent should prefer `Grep` for text search rather than piping through `Bash`.

**Acceptance criteria**:
- Assert tool appears in trajectory (regardless of position)
- Assert tool does NOT appear (negative testing)
- Validate tool selection rationale aligns with efficiency/safety heuristics

### 3. Observation & Tracing
Monitor and debug agent behavior during multi-step task execution.

**Example scenario**: A 5-turn agent conversation should produce a traceable log of every tool call, its inputs, outputs, and timing.

**Acceptance criteria**:
- Capture complete tool call trajectories per test run
- Support post-hoc analysis of failed tests
- Enable comparison between expected and actual trajectories

## Technical Constraints

| Constraint | Requirement |
|------------|-------------|
| Runtime | Bun (not Node.js) |
| Test runner | bun:test |
| Agent invocation | Claude Code CLI with `--output-format json` |
| Isolation | Tests run in parallel across git worktrees |
| Cost | Minimize API calls; prefer deterministic assertions over LLM-as-judge |
| Local-first | No external eval services; self-hosted tracing only |

## Why AgentEvals

After evaluating vitest-evals, @langwatch/scenario, Zevals, EvalFlow, OpenEvals, and AgentEvals:

**AgentEvals (LangChain) is the optimal choice** because:

1. **Trajectory-native**: Built specifically for agent tool call sequences, not just output quality
2. **Flexible matching modes**: 
   - `strict` — exact sequence match
   - `unordered` — same tools, any order
   - `subset` — agent used at least these tools
   - `superset` — agent used at most these tools
3. **Argument validation**: `toolArgsMatchMode` with per-tool override functions for custom matching logic
4. **Bun-compatible**: Pure TypeScript library, no Vitest internals or Node-specific APIs
5. **No external dependencies**: Evaluators run locally without LangSmith or other services

**What AgentEvals provides that others don't**:

```typescript
import { createTrajectoryMatchEvaluator } from "agentevals";

// This single evaluator handles all three user needs
const evaluator = createTrajectoryMatchEvaluator({
  trajectoryMatchMode: "subset",  // Tool discovery: agent found the right tools
  toolArgsMatchMode: "exact",     // Tool accuracy: arguments are correct
  toolArgsMatchOverrides: {
    Grep: (actual, expected) =>   // Fuzzy matching where needed
      actual.pattern.toLowerCase().includes(expected.pattern.toLowerCase())
  }
});

// Returns { score: 0 | 1 } plus detailed mismatch info for observation
```

## Implementation Architecture

```
project/
├── .claude/
│   └── settings.json          # Hook configuration for tool capture
├── hooks/
│   ├── capture-tool.ts        # PreToolUse hook → writes to JSONL
│   └── log-result.ts          # PostToolUse hook → captures outputs
├── tests/
│   ├── lib/
│   │   └── bun-evals.ts       # Custom describeEval wrapper for bun:test
│   ├── fixtures/
│   │   └── file-search.json   # Expected trajectories per test case
│   └── skills/
│       ├── file-search.test.ts
│       └── code-edit.test.ts
├── cassettes/                  # VCR recordings for deterministic replay
└── test-output/                # Per-run tool call logs
```

## Key Implementation Details

### 1. Claude Code Hook Integration

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "bun ./hooks/capture-tool.ts" }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "bun ./hooks/log-result.ts" }]
    }]
  }
}
```

### 2. Test Harness Pattern

```typescript
// tests/skills/file-search.test.ts
import { test, expect, beforeEach } from "bun:test";
import { createTrajectoryMatchEvaluator } from "agentevals";
import { runAgent, getToolCalls } from "../lib/harness";

const trajectoryEval = createTrajectoryMatchEvaluator({
  trajectoryMatchMode: "subset",
  toolArgsMatchMode: "subset"
});

beforeEach(async () => {
  await Bun.write("./test-output/tool-calls.jsonl", "");
});

test("file search uses Grep over Bash", async () => {
  await runAgent({
    prompt: "Find all TypeScript files containing TODO comments",
    allowedTools: ["Read", "Grep", "Glob", "Bash"],
    maxTurns: 5
  });
  
  const actualTrajectory = await getToolCalls();
  const expectedTrajectory = [
    { tool: "Glob", args: { pattern: "**/*.ts" } },
    { tool: "Grep", args: { pattern: "TODO" } }
  ];
  
  const result = await trajectoryEval({
    input: "Find TypeScript files with TODOs",
    actualTrajectory,
    expectedTrajectory
  });
  
  expect(result.score).toBe(1);
  
  // Negative assertion: should NOT shell out
  expect(actualTrajectory.some(t => t.tool === "Bash")).toBe(false);
});
```

### 3. Parallel Worktree Isolation

Each git worktree gets unique hook output paths via environment variable:

```typescript
// hooks/capture-tool.ts
const testId = Bun.env.TEST_RUN_ID ?? "default";
const outputPath = `./test-output/${testId}/tool-calls.jsonl`;
```

```bash
# Run tests in parallel across worktrees
TEST_RUN_ID=wt-feature-a bun test --cwd ../worktree-a &
TEST_RUN_ID=wt-feature-b bun test --cwd ../worktree-b &
wait
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Test execution time | < 30s for full suite (with cassette replay) |
| Tool call assertion coverage | 100% of critical paths |
| False positive rate | < 5% (tests fail only on real regressions) |
| Debugging time | Trajectory diffs identify root cause in < 2 min |

## Out of Scope (v1)

- LLM-as-judge for semantic output quality (use AgentEvals trajectory matching only)
- Hosted eval dashboards (local JSONL analysis only)
- Cross-agent communication testing (single-agent skills only)
- Performance benchmarking (correctness first)

## Open Questions

1. Should cassette recording happen at the Claude API level or tool execution level?
2. What's the right granularity for trajectory snapshots—per-turn or per-tool-call?
3. How to handle non-deterministic tool argument generation (e.g., timestamps, UUIDs)?

---

## Instructions for Claude Code

Implement this testing framework incrementally:

1. **Phase 1**: Set up hooks and basic tool call capture to JSONL
2. **Phase 2**: Create `bun-evals.ts` wrapper with `describeEval` API
3. **Phase 3**: Integrate AgentEvals' `createTrajectoryMatchEvaluator`
4. **Phase 4**: Add VCR cassette recording/replay for deterministic tests
5. **Phase 5**: Implement parallel worktree isolation

Start with Phase 1. Ask clarifying questions before implementing if any requirements are ambiguous.
