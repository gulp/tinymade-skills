/**
 * AgentEvals integration for trajectory matching.
 *
 * Provides evaluators that use the `agentevals` library to compare
 * tool call trajectories against expected patterns.
 */

import {
  createTrajectoryMatchEvaluator,
  type TrajectoryMatchMode,
} from "agentevals";
import type { ToolArgsMatchMode, ToolArgsMatchOverrides } from "agentevals";
import type { ToolCallEntry } from "../../scripts/common.ts";
import type { Scorer, ScorerResult, AgentResult } from "./bun-evals.ts";

/**
 * Convert our ToolCallEntry array to ChatCompletionMessage format
 * that agentevals expects.
 *
 * Groups tool calls into assistant messages with tool_calls arrays.
 */
function toolCallsToMessages(
  toolCalls: ToolCallEntry[]
): Array<{ role: "assistant"; content: string; tool_calls: unknown[] }> {
  // Filter to pre-tool calls only (the actual tool invocations)
  const preToolCalls = toolCalls.filter((tc) => tc.phase === "pre");

  if (preToolCalls.length === 0) {
    return [];
  }

  // Group all tool calls into a single assistant message
  // (simplification - real agents may have multiple turns)
  return [
    {
      role: "assistant" as const,
      content: "",
      tool_calls: preToolCalls.map((tc) => ({
        id: tc.tool_use_id,
        type: "function",
        function: {
          name: tc.tool_name,
          arguments: JSON.stringify(tc.tool_input),
        },
      })),
    },
  ];
}

/**
 * Convert expected trajectory spec to ChatCompletionMessage format.
 */
function expectedToMessages(
  expected: ExpectedTrajectory
): Array<{ role: "assistant"; content: string; tool_calls: unknown[] }> {
  if (expected.tools && expected.tools.length > 0) {
    return [
      {
        role: "assistant" as const,
        content: "",
        tool_calls: expected.tools.map((tool, i) => ({
          id: `expected-${i}`,
          type: "function",
          function: {
            name: typeof tool === "string" ? tool : tool.name,
            arguments:
              typeof tool === "string"
                ? "{}"
                : JSON.stringify(tool.args || {}),
          },
        })),
      },
    ];
  }

  return [];
}

/**
 * Expected trajectory specification.
 */
export interface ExpectedTrajectory {
  /** Expected tools (names only or with args) */
  tools?: Array<string | { name: string; args?: Record<string, unknown> }>;
}

/**
 * Options for creating a trajectory match scorer.
 */
export interface TrajectoryMatchScorerOptions {
  /**
   * How to match trajectories:
   * - "strict": Exact match in order and content
   * - "unordered": Match in any order
   * - "subset": Output is a subset of reference (agent used at least these tools)
   * - "superset": Output is a superset of reference
   */
  trajectoryMatchMode?: TrajectoryMatchMode;
  /**
   * How to match tool arguments:
   * - "exact": Arguments must match exactly
   * - "ignore": Don't compare arguments
   * - "subset": Output args contain reference args
   * - "superset": Reference args contain output args
   */
  toolArgsMatchMode?: ToolArgsMatchMode;
  /**
   * Per-tool argument matching overrides.
   * Can be a mode string, array of keys to check, or custom matcher function.
   */
  toolArgsMatchOverrides?: ToolArgsMatchOverrides;
}

/**
 * Create a scorer using AgentEvals trajectory matching.
 *
 * @example
 * ```typescript
 * const scorer = createTrajectoryMatchScorer({
 *   trajectoryMatchMode: "subset",  // Agent used at least these tools
 *   toolArgsMatchMode: "ignore",    // Don't check arguments
 * });
 *
 * describeEval("File Search", {
 *   data: () => [
 *     { name: "find ts", input: "Find .ts files", expected: { tools: ["Glob"] } },
 *   ],
 *   task: defaultTask,
 *   scorers: [scorer],
 * });
 * ```
 */
export function createTrajectoryMatchScorer(
  options: TrajectoryMatchScorerOptions = {}
): Scorer {
  const {
    trajectoryMatchMode = "subset",
    toolArgsMatchMode = "ignore",
    toolArgsMatchOverrides,
  } = options;

  const evaluator = createTrajectoryMatchEvaluator({
    trajectoryMatchMode,
    toolArgsMatchMode,
    toolArgsMatchOverrides,
  });

  return async (context): Promise<ScorerResult> => {
    const expected = context.expected as ExpectedTrajectory;

    // Convert to message format
    const outputs = toolCallsToMessages(context.output.toolCalls);
    const referenceOutputs = expectedToMessages(expected);

    // Skip if no expected trajectory
    if (referenceOutputs.length === 0 || referenceOutputs[0].tool_calls.length === 0) {
      return {
        score: 1,
        reason: "No expected trajectory specified",
      };
    }

    // Skip if no actual tool calls
    if (outputs.length === 0 || outputs[0].tool_calls.length === 0) {
      return {
        score: 0,
        reason: "No tool calls captured",
        details: {
          expected: expected.tools,
          actual: [],
        },
      };
    }

    try {
      const result = await evaluator({
        outputs,
        referenceOutputs,
      });

      const score = typeof result.score === "boolean" ? (result.score ? 1 : 0) : result.score;

      return {
        score,
        reason: result.comment || (score === 1 ? "Trajectory matched" : "Trajectory mismatch"),
        details: {
          expected: expected.tools,
          actual: context.output.toolSequence,
          matchMode: trajectoryMatchMode,
          argsMode: toolArgsMatchMode,
          metadata: result.metadata,
        },
      };
    } catch (error) {
      return {
        score: 0,
        reason: `Evaluator error: ${error instanceof Error ? error.message : String(error)}`,
        details: {
          expected: expected.tools,
          actual: context.output.toolSequence,
        },
      };
    }
  };
}

/**
 * Fuzzy tool argument matcher for Grep patterns.
 * Matches if the actual pattern contains the expected pattern (case-insensitive).
 */
export const grepPatternMatcher = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean => {
  const actualPattern = String(actual.pattern || "").toLowerCase();
  const expectedPattern = String(expected.pattern || "").toLowerCase();
  return actualPattern.includes(expectedPattern);
};

/**
 * Fuzzy tool argument matcher for Glob patterns.
 * Matches if the actual pattern contains the expected extension or path.
 */
export const globPatternMatcher = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean => {
  const actualPattern = String(actual.pattern || "").toLowerCase();
  const expectedPattern = String(expected.pattern || "").toLowerCase();

  // Check if expected pattern is contained in actual
  if (actualPattern.includes(expectedPattern)) {
    return true;
  }

  // Extract extension from expected (e.g., "*.ts" -> "ts")
  const expectedExt = expectedPattern.match(/\*\.(\w+)/)?.[1];
  if (expectedExt && actualPattern.includes(expectedExt)) {
    return true;
  }

  return false;
};

/**
 * Fuzzy tool argument matcher for Read file paths.
 * Matches if the actual path ends with the expected filename.
 */
export const readPathMatcher = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>
): boolean => {
  const actualPath = String(actual.file_path || actual.path || "").toLowerCase();
  const expectedPath = String(expected.file_path || expected.path || "").toLowerCase();

  // Exact match
  if (actualPath === expectedPath) {
    return true;
  }

  // Ends with expected
  if (actualPath.endsWith(expectedPath)) {
    return true;
  }

  // Contains expected filename
  const expectedFilename = expectedPath.split("/").pop();
  if (expectedFilename && actualPath.includes(expectedFilename)) {
    return true;
  }

  return false;
};

/**
 * Pre-configured scorer for common Claude Code tool validation.
 * Uses "subset" mode with fuzzy argument matching for Grep and Glob.
 */
export const claudeToolScorer = createTrajectoryMatchScorer({
  trajectoryMatchMode: "subset",
  toolArgsMatchMode: "subset",
  toolArgsMatchOverrides: {
    Grep: grepPatternMatcher,
    Glob: globPatternMatcher,
    Read: readPathMatcher,
  },
});

/**
 * Strict scorer that requires exact tool order and arguments.
 */
export const strictTrajectoryScorer = createTrajectoryMatchScorer({
  trajectoryMatchMode: "strict",
  toolArgsMatchMode: "exact",
});

/**
 * Unordered scorer that allows tools in any order.
 */
export const unorderedTrajectoryScorer = createTrajectoryMatchScorer({
  trajectoryMatchMode: "unordered",
  toolArgsMatchMode: "ignore",
});
