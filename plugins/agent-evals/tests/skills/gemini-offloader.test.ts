/**
 * Layer 2: Gemini-Offloader Skill Invocation Tests
 *
 * Tests that Claude Code correctly invokes the gemini-offloader skill when asked
 * to do research. Uses the agent-evals harness to capture tool calls and verify
 * Claude's decision-making.
 *
 * Run with: bun test skills/gemini-offloader.test.ts
 *
 * NOTE: These tests spawn real Claude processes and use API credits.
 * Set SKIP_AGENT_TESTS=true to skip these tests.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import {
  runAgent,
  getToolCalls,
  getToolSequence,
  getPreToolCalls,
  generateTestId,
} from "../lib/harness.ts";

import {
  describeEval,
  describeEvalIndividual,
  defaultTask,
  toolSequenceScorer,
  completionScorer,
  combineScorers,
} from "../lib/bun-evals.ts";
import {
  createTrajectoryMatchScorer,
  claudeToolScorer,
} from "../lib/evaluators.ts";

// Check if tests should be skipped
const SKIP_AGENT_TESTS = process.env.SKIP_AGENT_TESTS === "true";

let claudeAvailable = false;

/**
 * Check if Claude CLI is available before running tests.
 */
async function checkClaudeAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["which", "claude"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim().length > 0;
  } catch {
    return false;
  }
}

describe("Gemini Offloader Skill Invocation", () => {
  beforeAll(async () => {
    if (SKIP_AGENT_TESTS) {
      console.log("Skipping agent tests: SKIP_AGENT_TESTS=true");
      return;
    }
    claudeAvailable = await checkClaudeAvailable();
    if (!claudeAvailable) {
      console.log("Skipping: claude CLI not found");
    }
  });

  test("Claude invokes Skill tool when asked to research", async () => {
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

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
    expect(input.skill).toMatch(/gemini-offloader$/);
  });

  test("Claude runs query.ts after skill activation", async () => {
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

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
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

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
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

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

/**
 * Trajectory matching tests using AgentEvals evaluators.
 *
 * These tests validate tool sequences using fuzzy matching.
 */
describe("Gemini Offloader Trajectory Matching", () => {
  beforeAll(async () => {
    if (SKIP_AGENT_TESTS) {
      console.log("Skipping trajectory tests: SKIP_AGENT_TESTS=true");
      return;
    }
    if (!claudeAvailable) {
      claudeAvailable = await checkClaudeAvailable();
      if (!claudeAvailable) {
        console.log("Skipping: claude CLI not found");
      }
    }
  });

  test("follows expected skill activation trajectory", async () => {
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

    const testId = generateTestId("trajectory-skill-activation");

    await runAgent({
      prompt: "Use gemini-offloader to research GraphQL vs REST",
      testId,
      maxTurns: 15,
      timeout: 90000,
    });

    const toolCalls = await getToolCalls(testId);
    const preToolCalls = getPreToolCalls(toolCalls);
    const toolSequence = preToolCalls.map((c) => c.tool_name);

    // Verify Skill tool is called
    const skillIndex = toolSequence.indexOf("Skill");
    expect(skillIndex).toBeGreaterThanOrEqual(0);

    // Verify the Skill call is for gemini-offloader
    const skillCalls = preToolCalls.filter((c) => c.tool_name === "Skill");
    expect(skillCalls.length).toBeGreaterThanOrEqual(1);

    const skillInput = skillCalls[0].tool_input as { skill?: string };
    expect(skillInput.skill).toContain("gemini-offloader");

    // Verify Bash is called after Skill (for script execution)
    const bashIndex = toolSequence.indexOf("Bash");
    // Bash may not be called if skill activation fails, but if called must be after Skill
    expect(bashIndex === -1 || bashIndex > skillIndex).toBe(true);
  });

  test("follows expected research query trajectory", async () => {
    if (SKIP_AGENT_TESTS || !claudeAvailable) {
      console.log("Skipped: agent tests disabled or claude unavailable");
      return;
    }

    const testId = generateTestId("trajectory-query");

    await runAgent({
      prompt: `The gemini-offloader skill is activated.
               Research "Bun HTTP server performance benchmarks"`,
      testId,
      maxTurns: 15,
      timeout: 90000,
    });

    const toolCalls = await getToolCalls(testId);
    const preToolCalls = getPreToolCalls(toolCalls);
    const toolSequence = preToolCalls.map((c) => c.tool_name);

    // Should include Bash execution
    expect(toolSequence).toContain("Bash");

    // Verify at least one Bash call includes query.ts
    const bashCalls = preToolCalls.filter((c) => c.tool_name === "Bash");
    const hasQueryCall = bashCalls.some((c) => {
      const cmd = (c.tool_input as { command?: string }).command || "";
      return cmd.includes("query.ts");
    });

    expect(hasQueryCall).toBe(true);
  });
});

/**
 * describeEval-based tests (advanced API).
 *
 * These use the vitest-evals-like API for declarative test definitions.
 * Uncomment and adjust when ready for production evals.
 */

// describeEval("Gemini Offloader - Skill Activation", {
//   data: () => [
//     {
//       name: "invokes-skill-for-research",
//       input: "Use gemini-offloader to research async programming patterns",
//       expected: {
//         tools: [{ name: "Skill", args: { skill: "gemini-offloader" } }],
//       },
//     },
//     {
//       name: "invokes-skill-explicitly",
//       input: "Invoke the gemini-offloader skill now",
//       expected: {
//         tools: ["Skill"],
//       },
//     },
//   ],
//   task: defaultTask,
//   scorers: [
//     createTrajectoryMatchScorer({
//       trajectoryMatchMode: "subset",
//       toolArgsMatchMode: "subset",
//     }),
//     completionScorer,
//   ],
//   threshold: 0.8,
//   timeout: 90000,
// });

// describeEvalIndividual("Gemini Offloader - Script Selection", {
//   data: () => [
//     {
//       name: "uses query.ts for research",
//       input: "The gemini-offloader skill is activated. Research TypeScript enums.",
//       expected: { tools: ["Bash"] },
//     },
//     {
//       name: "uses session.ts for sessions",
//       input: "The gemini-offloader skill is activated. List all research sessions.",
//       expected: { tools: ["Bash"] },
//     },
//     {
//       name: "uses launcher.ts for status",
//       input: "The gemini-offloader skill is activated. Check the configuration status.",
//       expected: { tools: ["Bash"] },
//     },
//   ],
//   task: defaultTask,
//   scorers: [toolSequenceScorer],
//   threshold: 0.8,
//   timeout: 60000,
// });
