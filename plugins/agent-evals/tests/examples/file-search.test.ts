/**
 * Example test demonstrating the bun-evals API.
 *
 * Run with: bun test examples/file-search.test.ts
 */

import { describe, test, expect } from "bun:test";
import {
  describeEval,
  describeEvalIndividual,
  defaultTask,
  toolSequenceScorer,
  toolOrderScorer,
  toolExclusionScorer,
  completionScorer,
  combineScorers,
} from "../lib/bun-evals.ts";
import {
  createTrajectoryMatchScorer,
  claudeToolScorer,
} from "../lib/evaluators.ts";
import { createVCRTask } from "../lib/vcr.ts";
import { generateTestId, getToolCalls, getToolSequence } from "../lib/harness.ts";

/**
 * Example 1: Basic eval with built-in scorers
 */
describeEval("File Search - Basic", {
  data: () => [
    {
      name: "find-ts-files",
      input: "List all TypeScript files in the plugins directory",
      expected: { tools: ["Glob"] },
    },
    {
      name: "search-todo",
      input: "Find all TODO comments in the codebase",
      expected: { tools: ["Grep"] },
    },
  ],
  task: defaultTask,
  scorers: [toolSequenceScorer, completionScorer],
  threshold: 0.8,
  timeout: 30000,
});

/**
 * Example 2: Individual tests per case
 */
describeEvalIndividual("File Search - Individual", {
  data: () => [
    {
      name: "uses Glob for file patterns",
      input: "Find all .json files",
      expected: { tools: ["Glob"] },
    },
    {
      name: "uses Read for file content",
      input: "Show the contents of package.json",
      expected: { tools: ["Read"] },
    },
  ],
  task: defaultTask,
  scorers: [toolSequenceScorer],
});

/**
 * Example 3: AgentEvals trajectory matching
 */
describeEval("File Search - Trajectory Match", {
  data: () => [
    {
      name: "subset-match",
      input: "Find TypeScript files and show one of them",
      expected: {
        tools: [
          { name: "Glob", args: { pattern: "*.ts" } },
          { name: "Read" },
        ],
      },
    },
  ],
  task: defaultTask,
  scorers: [
    createTrajectoryMatchScorer({
      trajectoryMatchMode: "subset",
      toolArgsMatchMode: "subset",
    }),
  ],
});

/**
 * Example 4: VCR cassette recording/playback
 */
describeEval("File Search - VCR", {
  data: () => [
    {
      name: "vcr-glob-test",
      input: "List markdown files",
      expected: { tools: ["Glob"] },
    },
  ],
  task: createVCRTask(defaultTask, {
    mode: "passthrough", // Change to "record" or "playback"
  }),
  scorers: [toolSequenceScorer],
});

/**
 * Example 5: Combined scorers with weights
 */
describeEval("File Search - Combined Scoring", {
  data: () => [
    {
      name: "weighted-eval",
      input: "Find and read the README file",
      expected: {
        tools: ["Glob", "Read"],
        toolOrder: ["Glob", "Read"],
        excludeTools: ["Bash"],
      },
    },
  ],
  task: defaultTask,
  scorers: [
    combineScorers([
      { scorer: completionScorer, weight: 2 },
      { scorer: toolSequenceScorer, weight: 1 },
      { scorer: toolOrderScorer, weight: 1 },
      { scorer: toolExclusionScorer, weight: 1 },
    ]),
  ],
});

/**
 * Example 6: Manual test with harness utilities
 */
describe("File Search - Manual", () => {
  test("agent uses Grep for content search", async () => {
    const testId = generateTestId("manual-grep-test");

    // This test is skipped by default to avoid API calls
    // Remove the skip to run it
    test.skip("skipped - remove to run", () => {});

    // Example of what the test would look like:
    // const result = await runAgent({
    //   prompt: "Search for 'export function' in TypeScript files",
    //   testId,
    //   maxTurns: 5,
    // });
    //
    // const toolCalls = await getToolCalls(testId);
    // const sequence = getToolSequence(toolCalls);
    //
    // expect(sequence).toContain("Grep");
    // expect(sequence).not.toContain("Bash");
  });
});
