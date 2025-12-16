/**
 * VCR (Video Cassette Recorder) style test recording and playback.
 *
 * Records tool call trajectories from live agent runs and replays them
 * for fast, deterministic tests without hitting the Claude API.
 *
 * Two modes of operation:
 * 1. Tool-level VCR: Records/replays tool call sequences (no API calls during playback)
 * 2. Response mocking: Mocks agent responses based on recorded cassettes
 */

import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { ToolCallEntry } from "../../scripts/common.ts";
import type { AgentResult } from "./bun-evals.ts";
import type { RunAgentResult } from "./harness.ts";

/**
 * Cassette metadata stored alongside recordings.
 */
export interface CassetteMetadata {
  /** Name of the test that created this cassette */
  testName: string;
  /** When the cassette was recorded */
  recordedAt: string;
  /** Duration of the original test run in ms */
  durationMs: number;
  /** Version of the cassette format */
  version: number;
  /** Original prompt used */
  prompt: string;
  /** Additional metadata */
  extra?: Record<string, unknown>;
}

/**
 * Full cassette containing recorded test data.
 */
export interface Cassette {
  metadata: CassetteMetadata;
  /** Captured tool calls from the run */
  toolCalls: ToolCallEntry[];
  /** The agent result (exit code, stdout, stderr) */
  agentResult: RunAgentResult;
}

/**
 * VCR mode for test execution.
 */
export type VCRMode = "record" | "playback" | "passthrough";

/**
 * Options for the VCR recorder.
 */
export interface VCROptions {
  /** Base directory for cassette storage */
  cassettesDir?: string;
  /** VCR mode: record, playback, or passthrough */
  mode?: VCRMode;
  /** Whether to fail if cassette is missing in playback mode */
  failOnMissing?: boolean;
}

const CASSETTE_VERSION = 1;

/**
 * Get the VCR mode from environment or default.
 */
export function getVCRMode(): VCRMode {
  const envMode = process.env.VCR_MODE?.toLowerCase();
  if (envMode === "record" || envMode === "playback" || envMode === "passthrough") {
    return envMode;
  }
  return "passthrough";
}

/**
 * Get the cassettes directory path.
 */
export function getCassettesDir(baseDir?: string): string {
  return baseDir || process.env.VCR_CASSETTES_DIR || join(process.cwd(), "cassettes");
}

/**
 * Get the path for a specific cassette.
 */
export function getCassettePath(testName: string, cassettesDir?: string): string {
  const dir = getCassettesDir(cassettesDir);
  const sanitizedName = testName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase();
  return join(dir, `${sanitizedName}.json`);
}

/**
 * Check if a cassette exists.
 */
export async function cassetteExists(testName: string, cassettesDir?: string): Promise<boolean> {
  const path = getCassettePath(testName, cassettesDir);
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a cassette from disk.
 */
export async function loadCassette(
  testName: string,
  cassettesDir?: string
): Promise<Cassette | null> {
  const path = getCassettePath(testName, cassettesDir);
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as Cassette;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Save a cassette to disk.
 */
export async function saveCassette(
  testName: string,
  cassette: Cassette,
  cassettesDir?: string
): Promise<string> {
  const path = getCassettePath(testName, cassettesDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cassette, null, 2), "utf-8");
  return path;
}

/**
 * Create a cassette from a test run.
 */
export function createCassette(
  testName: string,
  prompt: string,
  toolCalls: ToolCallEntry[],
  agentResult: RunAgentResult,
  durationMs: number,
  extra?: Record<string, unknown>
): Cassette {
  return {
    metadata: {
      testName,
      recordedAt: new Date().toISOString(),
      durationMs,
      version: CASSETTE_VERSION,
      prompt,
      extra,
    },
    toolCalls,
    agentResult,
  };
}

/**
 * Create an AgentResult from a cassette (for playback).
 */
export function cassetteToAgentResult(
  cassette: Cassette,
  testId: string
): AgentResult {
  const toolSequence = cassette.toolCalls
    .filter((tc) => tc.phase === "pre")
    .map((tc) => tc.tool_name);

  return {
    input: cassette.metadata.prompt,
    testId,
    runResult: cassette.agentResult,
    toolCalls: cassette.toolCalls,
    toolSequence,
  };
}

/**
 * VCR-enabled task runner.
 *
 * In record mode: Runs the real agent and saves the cassette.
 * In playback mode: Returns results from the cassette without running the agent.
 * In passthrough mode: Runs the real agent without recording.
 *
 * @example
 * ```typescript
 * import { createVCRTask, defaultTask } from "./lib/vcr.ts";
 *
 * const vcrTask = createVCRTask(defaultTask, {
 *   mode: "playback",
 *   failOnMissing: true,
 * });
 *
 * describeEval("File Search", {
 *   data: () => [{ name: "find-ts", input: "Find .ts files", expected: { tools: ["Glob"] } }],
 *   task: vcrTask,
 *   scorers: [toolSequenceScorer],
 * });
 * ```
 */
export function createVCRTask(
  realTask: (input: string, testId: string) => Promise<AgentResult>,
  options: VCROptions = {}
): (input: string, testId: string) => Promise<AgentResult> {
  const {
    cassettesDir,
    mode = getVCRMode(),
    failOnMissing = false,
  } = options;

  return async (input: string, testId: string): Promise<AgentResult> => {
    // Passthrough: just run the real task
    if (mode === "passthrough") {
      return realTask(input, testId);
    }

    // Playback: try to load from cassette
    if (mode === "playback") {
      const cassette = await loadCassette(testId, cassettesDir);

      if (cassette) {
        console.log(`[VCR] Playing back cassette: ${testId}`);
        return cassetteToAgentResult(cassette, testId);
      }

      if (failOnMissing) {
        throw new Error(`[VCR] Cassette not found: ${testId}`);
      }

      // Fall through to recording if cassette doesn't exist
      console.log(`[VCR] Cassette not found, recording: ${testId}`);
    }

    // Record: run the real task and save
    const startTime = Date.now();
    const result = await realTask(input, testId);
    const durationMs = Date.now() - startTime;

    const cassette = createCassette(
      testId,
      input,
      result.toolCalls,
      result.runResult,
      durationMs
    );

    const savedPath = await saveCassette(testId, cassette, cassettesDir);
    console.log(`[VCR] Recorded cassette: ${savedPath}`);

    return result;
  };
}

/**
 * List all available cassettes.
 */
export async function listCassettes(
  cassettesDir?: string
): Promise<string[]> {
  const dir = getCassettesDir(cassettesDir);
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

/**
 * Delete a cassette.
 */
export async function deleteCassette(
  testName: string,
  cassettesDir?: string
): Promise<boolean> {
  const path = getCassettePath(testName, cassettesDir);
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear all cassettes in a directory.
 */
export async function clearCassettes(cassettesDir?: string): Promise<number> {
  const cassettes = await listCassettes(cassettesDir);
  let deleted = 0;
  for (const name of cassettes) {
    if (await deleteCassette(name, cassettesDir)) {
      deleted++;
    }
  }
  return deleted;
}
