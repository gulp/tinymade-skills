/**
 * Bun-native eval wrapper providing vitest-evals-like API.
 *
 * Provides `describeEval` for defining evaluation test suites with
 * data-driven test cases, custom scorers, and threshold assertions.
 */

import { describe, test, expect } from "bun:test";
import type { ToolCallEntry } from "../../scripts/common.ts";
import {
  runAgent,
  getToolCalls,
  generateTestId,
  type RunAgentOptions,
  type RunAgentResult,
} from "./harness.ts";

/**
 * A single evaluation case with input prompt and expected behavior.
 */
export interface EvalCase {
  /** Unique name for this test case */
  name: string;
  /** The prompt to send to the agent */
  input: string;
  /** Expected output or behavior (structure depends on scorer) */
  expected: unknown;
  /** Optional metadata for the test case */
  metadata?: Record<string, unknown>;
}

/**
 * Result from running an agent on an eval case.
 */
export interface AgentResult {
  /** The original input prompt */
  input: string;
  /** Unique test ID used for this run */
  testId: string;
  /** Raw result from runAgent */
  runResult: RunAgentResult;
  /** Captured tool calls from the run */
  toolCalls: ToolCallEntry[];
  /** Extracted tool sequence (pre-tool names only) */
  toolSequence: string[];
}

/**
 * Result from a scorer evaluation.
 */
export interface ScorerResult {
  /** Score between 0 and 1 */
  score: number;
  /** Human-readable explanation of the score */
  reason?: string;
  /** Additional scorer-specific details */
  details?: Record<string, unknown>;
}

/**
 * A scorer function that evaluates agent output against expected behavior.
 */
export type Scorer = (context: {
  input: string;
  output: AgentResult;
  expected: unknown;
}) => Promise<ScorerResult> | ScorerResult;

/**
 * Configuration for describeEval.
 */
export interface DescribeEvalConfig {
  /** Function returning eval cases (can be async for loading from files) */
  data: () => Promise<EvalCase[]> | EvalCase[];
  /** Function that runs the agent and returns result */
  task: (input: string, testId: string) => Promise<AgentResult>;
  /** Array of scorer functions to evaluate results */
  scorers: Scorer[];
  /** Minimum score threshold (0-1), defaults to 0.8 */
  threshold?: number;
  /** Timeout per test case in ms, defaults to 60000 */
  timeout?: number;
  /** Additional options passed to runAgent */
  agentOptions?: Partial<RunAgentOptions>;
}

/**
 * Default task runner that spawns Claude and captures tool calls.
 */
export async function defaultTask(
  input: string,
  testId: string,
  options?: Partial<RunAgentOptions>
): Promise<AgentResult> {
  const runResult = await runAgent({
    prompt: input,
    testId,
    maxTurns: options?.maxTurns ?? 10,
    timeout: options?.timeout ?? 60000,
    cwd: options?.cwd,
    env: options?.env,
  });

  const toolCalls = await getToolCalls(testId);
  const toolSequence = toolCalls
    .filter((c) => c.phase === "pre")
    .map((c) => c.tool_name);

  return {
    input,
    testId,
    runResult,
    toolCalls,
    toolSequence,
  };
}

/**
 * Define an evaluation test suite with data-driven test cases.
 *
 * Similar to vitest-evals API but using bun:test under the hood.
 *
 * @example
 * ```typescript
 * describeEval("File Search Agent", {
 *   data: () => [
 *     { name: "find ts files", input: "Find all .ts files", expected: { tools: ["Glob"] } },
 *     { name: "search content", input: "Find TODO comments", expected: { tools: ["Grep"] } },
 *   ],
 *   task: defaultTask,
 *   scorers: [toolSequenceScorer],
 *   threshold: 0.8,
 * });
 * ```
 */
export function describeEval(name: string, config: DescribeEvalConfig): void {
  const { data, task, scorers, threshold = 0.8, timeout = 60000 } = config;

  describe(name, () => {
    test(
      "evaluates all cases",
      async () => {
        const cases = await data();
        const results: Array<{
          case: EvalCase;
          scores: ScorerResult[];
          passed: boolean;
        }> = [];

        for (const evalCase of cases) {
          const testId = generateTestId(`${name}-${evalCase.name}`);

          // Run the task
          const output = await task(evalCase.input, testId);

          // Run all scorers
          const scores: ScorerResult[] = [];
          for (const scorer of scorers) {
            const result = await scorer({
              input: evalCase.input,
              output,
              expected: evalCase.expected,
            });
            scores.push(result);
          }

          // Check if all scores meet threshold
          const passed = scores.every((s) => s.score >= threshold);
          results.push({ case: evalCase, scores, passed });

          // Assert immediately for fast feedback
          for (const score of scores) {
            expect(score.score).toBeGreaterThanOrEqual(threshold);
          }
        }

        // Log summary
        const passCount = results.filter((r) => r.passed).length;
        console.log(
          `\n${name}: ${passCount}/${results.length} cases passed (threshold: ${threshold})`
        );
      },
      { timeout }
    );
  });
}

/**
 * Define individual eval tests (one test per case).
 *
 * Useful when you want separate test results per case in the test output.
 */
export function describeEvalIndividual(
  name: string,
  config: DescribeEvalConfig
): void {
  const { data, task, scorers, threshold = 0.8, timeout = 60000 } = config;

  describe(name, async () => {
    const cases = await data();

    for (const evalCase of cases) {
      test(
        evalCase.name,
        async () => {
          const testId = generateTestId(`${name}-${evalCase.name}`);
          const output = await task(evalCase.input, testId);

          for (const scorer of scorers) {
            const result = await scorer({
              input: evalCase.input,
              output,
              expected: evalCase.expected,
            });
            expect(result.score).toBeGreaterThanOrEqual(threshold);
          }
        },
        { timeout }
      );
    }
  });
}

/**
 * Built-in scorer: checks if expected tools appear in the tool sequence.
 */
export function toolSequenceScorer(context: {
  input: string;
  output: AgentResult;
  expected: unknown;
}): ScorerResult {
  const expected = context.expected as { tools?: string[] };
  if (!expected.tools || expected.tools.length === 0) {
    return { score: 1, reason: "No expected tools specified" };
  }

  const { toolSequence } = context.output;
  const foundTools = expected.tools.filter((t) => toolSequence.includes(t));
  const score = foundTools.length / expected.tools.length;

  return {
    score,
    reason:
      score === 1
        ? "All expected tools found"
        : `Found ${foundTools.length}/${expected.tools.length} expected tools`,
    details: {
      expected: expected.tools,
      found: foundTools,
      missing: expected.tools.filter((t) => !toolSequence.includes(t)),
      actual: toolSequence,
    },
  };
}

/**
 * Built-in scorer: checks tool sequence order.
 */
export function toolOrderScorer(context: {
  input: string;
  output: AgentResult;
  expected: unknown;
}): ScorerResult {
  const expected = context.expected as { toolOrder?: string[] };
  if (!expected.toolOrder || expected.toolOrder.length === 0) {
    return { score: 1, reason: "No expected tool order specified" };
  }

  const { toolSequence } = context.output;

  // Check if expected tools appear in the correct order (not necessarily consecutive)
  let lastIndex = -1;
  let inOrderCount = 0;

  for (const tool of expected.toolOrder) {
    const index = toolSequence.indexOf(tool, lastIndex + 1);
    if (index > lastIndex) {
      inOrderCount++;
      lastIndex = index;
    }
  }

  const score = inOrderCount / expected.toolOrder.length;

  return {
    score,
    reason:
      score === 1
        ? "Tools appeared in expected order"
        : `${inOrderCount}/${expected.toolOrder.length} tools in correct order`,
    details: {
      expectedOrder: expected.toolOrder,
      actualSequence: toolSequence,
      inOrderCount,
    },
  };
}

/**
 * Built-in scorer: checks that certain tools were NOT used.
 */
export function toolExclusionScorer(context: {
  input: string;
  output: AgentResult;
  expected: unknown;
}): ScorerResult {
  const expected = context.expected as { excludeTools?: string[] };
  if (!expected.excludeTools || expected.excludeTools.length === 0) {
    return { score: 1, reason: "No excluded tools specified" };
  }

  const { toolSequence } = context.output;
  const usedExcluded = expected.excludeTools.filter((t) =>
    toolSequence.includes(t)
  );
  const score = usedExcluded.length === 0 ? 1 : 0;

  return {
    score,
    reason:
      score === 1
        ? "No excluded tools were used"
        : `Used excluded tools: ${usedExcluded.join(", ")}`,
    details: {
      excludeTools: expected.excludeTools,
      usedExcluded,
      actualSequence: toolSequence,
    },
  };
}

/**
 * Built-in scorer: checks agent completed successfully (exit code 0, no timeout).
 */
export function completionScorer(context: {
  input: string;
  output: AgentResult;
  expected: unknown;
}): ScorerResult {
  const { runResult } = context.output;

  if (runResult.timedOut) {
    return { score: 0, reason: "Agent timed out" };
  }

  if (runResult.exitCode !== 0) {
    return {
      score: 0,
      reason: `Agent exited with code ${runResult.exitCode}`,
      details: { stderr: runResult.stderr.slice(0, 500) },
    };
  }

  return { score: 1, reason: "Agent completed successfully" };
}

/**
 * Combine multiple scorers with optional weights.
 */
export function combineScorers(
  scorers: Array<{ scorer: Scorer; weight?: number }>
): Scorer {
  return async (context) => {
    const results: Array<{ result: ScorerResult; weight: number }> = [];
    let totalWeight = 0;

    for (const { scorer, weight = 1 } of scorers) {
      const result = await scorer(context);
      results.push({ result, weight });
      totalWeight += weight;
    }

    const weightedScore = results.reduce(
      (sum, { result, weight }) => sum + result.score * weight,
      0
    );
    const score = weightedScore / totalWeight;

    return {
      score,
      reason: `Combined score from ${scorers.length} scorers`,
      details: {
        scorers: results.map(({ result, weight }) => ({
          score: result.score,
          weight,
          reason: result.reason,
        })),
      },
    };
  };
}
