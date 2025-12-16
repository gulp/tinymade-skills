---
name: 07-gemini-offloader-skill-invocation
parent: h-implement-bun-eval-suite
status: pending
---

# Layer 2: Gemini-Offloader Skill Invocation Tests

## Problem/Goal

Test that Claude Code correctly invokes the gemini-offloader skill when asked to do research. This uses the agent-evals harness to capture tool calls and verify Claude's decision-making.

**What we're testing:** Does Claude use the right tool (Skill) with the right arguments (gemini-offloader) when the user requests research?

## Success Criteria

- [ ] Test file exists at `plugins/agent-evals/tests/skills/gemini-offloader.test.ts`
- [ ] Tests verify Claude invokes `Skill` tool for research requests
- [ ] Tests verify correct skill name is passed (`gemini-offloader`)
- [ ] Tests verify Claude then executes appropriate script (`query.ts`, `session.ts`, etc.)
- [ ] Tests pass with `bun test` in the agent-evals directory

## Implementation

### Test Location

```
plugins/agent-evals/tests/
├── lib/
│   └── harness.ts          # runAgent(), getToolCalls()
└── skills/
    └── gemini-offloader.test.ts
```

### gemini-offloader.test.ts

```typescript
import { describe, test, expect, beforeAll } from "bun:test";
import {
  runAgent,
  getToolCalls,
  getToolSequence,
  generateTestId,
  getPreToolCalls,
} from "../lib/harness.ts";

describe("Gemini Offloader Skill Invocation", () => {
  // Skip all tests if Claude CLI not available
  beforeAll(async () => {
    const proc = Bun.spawn(["which", "claude"], { stdout: "pipe" });
    const output = await new Response(proc.stdout).text();
    if (!output.trim()) {
      console.log("Skipping: claude CLI not found");
      process.exit(0);
    }
  });

  test("Claude invokes Skill tool when asked to research", async () => {
    const testId = generateTestId("skill-invocation-research");

    const result = await runAgent({
      prompt: "Use the gemini-offloader skill to research WebSocket performance in Bun",
      testId,
      maxTurns: 10,
      timeout: 60000,
    });

    // Agent should complete (may fail if no API key, but should try)
    expect(result.timedOut).toBe(false);

    const toolCalls = await getToolCalls(testId);
    const preToolCalls = getPreToolCalls(toolCalls);

    // Should have invoked Skill tool
    const skillCalls = preToolCalls.filter((c) => c.tool_name === "Skill");
    expect(skillCalls.length).toBeGreaterThanOrEqual(1);

    // First Skill call should be for gemini-offloader
    const firstSkillCall = skillCalls[0];
    const input = firstSkillCall.tool_input as { skill?: string };
    expect(input.skill).toContain("gemini-offloader");
  });

  test("Claude runs query.ts after skill activation", async () => {
    const testId = generateTestId("query-execution");

    const result = await runAgent({
      prompt: `The gemini-offloader skill is activated.
               Run a query to research "Bun vs Deno performance comparison"`,
      testId,
      maxTurns: 15,
      timeout: 90000,
    });

    expect(result.timedOut).toBe(false);

    const toolCalls = await getToolCalls(testId);
    const preToolCalls = getPreToolCalls(toolCalls);

    // Find Bash calls that execute query.ts
    const bashCalls = preToolCalls.filter((c) => c.tool_name === "Bash");

    const queryExecution = bashCalls.some((c) => {
      const cmd = (c.tool_input as { command?: string }).command || "";
      return cmd.includes("query.ts") && cmd.includes("--prompt");
    });

    expect(queryExecution).toBe(true);
  });

  test("Claude uses correct script for session management", async () => {
    const testId = generateTestId("session-management");

    const result = await runAgent({
      prompt: `The gemini-offloader skill is activated.
               Create a new research session named "typescript-history"`,
      testId,
      maxTurns: 15,
      timeout: 90000,
    });

    expect(result.timedOut).toBe(false);

    const toolCalls = await getToolCalls(testId);
    const bashCalls = getPreToolCalls(toolCalls).filter(
      (c) => c.tool_name === "Bash"
    );

    // Should call session.ts for session management
    const sessionExecution = bashCalls.some((c) => {
      const cmd = (c.tool_input as { command?: string }).command || "";
      return cmd.includes("session.ts");
    });

    expect(sessionExecution).toBe(true);
  });

  test("Claude checks status before research", async () => {
    const testId = generateTestId("status-check");

    const result = await runAgent({
      prompt: `Use gemini-offloader. First check if it's properly configured,
               then research "TypeScript 5.0 features"`,
      testId,
      maxTurns: 20,
      timeout: 120000,
    });

    expect(result.timedOut).toBe(false);

    const toolCalls = await getToolCalls(testId);
    const bashCalls = getPreToolCalls(toolCalls).filter(
      (c) => c.tool_name === "Bash"
    );

    // Should call launcher.ts or status.ts first
    const statusCheck = bashCalls.some((c) => {
      const cmd = (c.tool_input as { command?: string }).command || "";
      return cmd.includes("launcher.ts") || cmd.includes("status.ts");
    });

    expect(statusCheck).toBe(true);
  });
});
```

### Trajectory Matching (Advanced)

For more sophisticated validation, use trajectory matching:

```typescript
import { createToolSequenceMatcher } from "../lib/evaluators.ts";

test("follows expected research trajectory", async () => {
  const testId = generateTestId("trajectory-match");

  await runAgent({
    prompt: "Use gemini-offloader to research GraphQL vs REST",
    testId,
    maxTurns: 15,
  });

  const toolCalls = await getToolCalls(testId);
  const trajectory = getPreToolCalls(toolCalls).map((c) => ({
    tool: c.tool_name,
    args: c.tool_input as Record<string, unknown>,
  }));

  const expectedTrajectory = [
    { tool: "Skill", args: { skill: "gemini-offloader" } },
    { tool: "Bash", args: { command: expect.stringContaining("query.ts") } },
  ];

  const matcher = createToolSequenceMatcher(expectedTrajectory);
  const result = await matcher({ actualTrajectory: trajectory, expectedTrajectory });

  expect(result.score).toBeGreaterThanOrEqual(0.8);
});
```

### Running Tests

```bash
cd plugins/agent-evals/tests
bun test skills/gemini-offloader.test.ts
```

## Environment Requirements

- `claude` CLI available in PATH
- `TEST_MODE=true` set by harness (automatic)
- `TEST_RUN_ID` generated per test (automatic)
- agent-evals plugin hooks loaded

## Notes

- These tests spawn real Claude processes - they're slow and use API credits
- Consider using `--max-turns 5` for faster iteration during development
- Gate expensive tests behind `CI=true` or similar flag
- Tests may fail if gemini-offloader skill not activated or configured
