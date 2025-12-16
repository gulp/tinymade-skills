/**
 * Git worktree isolation for parallel test execution.
 *
 * Provides utilities for running tests across multiple git worktrees
 * simultaneously without cross-contamination of test outputs.
 *
 * Key isolation mechanisms:
 * 1. TEST_RUN_ID environment variable namespaces hook outputs
 * 2. Per-worktree test-output directories
 * 3. Worktree-aware path resolution
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, basename, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";

/**
 * Information about a git worktree.
 */
export interface WorktreeInfo {
  /** Absolute path to the worktree */
  path: string;
  /** Current branch or commit */
  branch: string;
  /** Whether this is the main worktree */
  isMain: boolean;
  /** Worktree name (directory name) */
  name: string;
}

/**
 * Options for setting up a worktree test environment.
 */
export interface WorktreeTestEnvOptions {
  /** Unique test ID for this run */
  testId: string;
  /** Path to the worktree (defaults to cwd) */
  worktreePath?: string;
  /** Additional environment variables to set */
  env?: Record<string, string>;
}

/**
 * Test environment configuration for a worktree.
 */
export interface WorktreeTestEnv {
  /** Path to test output directory */
  outputDir: string;
  /** Path to tool calls JSONL file */
  toolCallsPath: string;
  /** Path to cassettes directory */
  cassettesDir: string;
  /** Environment variables to set when running tests */
  env: Record<string, string>;
}

/**
 * Get the git root directory for the current or specified path.
 */
export function getGitRoot(cwd?: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
    }).trim();
  } catch {
    throw new Error("Not in a git repository");
  }
}

/**
 * Check if the current directory is a git worktree (not the main repo).
 */
export function isWorktree(cwd?: string): boolean {
  try {
    const gitDir = execSync("git rev-parse --git-dir", {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
    }).trim();
    // Worktrees have git dir like ../.git/worktrees/<name>
    return gitDir.includes("/worktrees/");
  } catch {
    return false;
  }
}

/**
 * Get information about the current worktree.
 */
export function getWorktreeInfo(cwd?: string): WorktreeInfo {
  const path = resolve(cwd || process.cwd());
  const gitRoot = getGitRoot(path);

  let branch: string;
  try {
    branch = execSync("git branch --show-current", {
      cwd: path,
      encoding: "utf-8",
    }).trim();
    if (!branch) {
      // Detached HEAD
      branch = execSync("git rev-parse --short HEAD", {
        cwd: path,
        encoding: "utf-8",
      }).trim();
    }
  } catch {
    branch = "unknown";
  }

  return {
    path: gitRoot,
    branch,
    isMain: !isWorktree(path),
    name: basename(gitRoot),
  };
}

/**
 * List all worktrees for the repository.
 */
export function listWorktrees(cwd?: string): WorktreeInfo[] {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd: cwd || process.cwd(),
      encoding: "utf-8",
    });

    const worktrees: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};

    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          worktrees.push(current as WorktreeInfo);
        }
        current = {
          path: line.slice(9),
          name: basename(line.slice(9)),
          isMain: false,
        };
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice(7).replace("refs/heads/", "");
      } else if (line === "bare") {
        current.branch = "(bare)";
      } else if (line.startsWith("HEAD ")) {
        current.branch = line.slice(5, 12); // Short SHA
      }
    }

    if (current.path) {
      worktrees.push(current as WorktreeInfo);
    }

    // Mark the first one as main
    if (worktrees.length > 0) {
      worktrees[0].isMain = true;
    }

    return worktrees;
  } catch {
    return [];
  }
}

/**
 * Generate a unique test run ID for the current worktree.
 *
 * Format: {worktree-name}-{timestamp}
 */
export function generateWorktreeTestId(testName?: string, cwd?: string): string {
  const info = getWorktreeInfo(cwd);
  const timestamp = Date.now();
  const name = testName
    ? testName.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()
    : "test";
  return `${info.name}-${name}-${timestamp}`;
}

/**
 * Set up a test environment for a worktree.
 *
 * Creates the necessary directories and returns environment configuration.
 */
export async function setupWorktreeTestEnv(
  options: WorktreeTestEnvOptions
): Promise<WorktreeTestEnv> {
  const { testId, worktreePath, env = {} } = options;
  const gitRoot = getGitRoot(worktreePath);

  const outputDir = join(gitRoot, "test-output", testId);
  const toolCallsPath = join(outputDir, "tool-calls.jsonl");
  const cassettesDir = join(gitRoot, "cassettes");

  // Create directories
  await mkdir(outputDir, { recursive: true });
  await mkdir(cassettesDir, { recursive: true });

  // Create a marker file
  await writeFile(
    join(outputDir, ".gitkeep"),
    `# Test run: ${testId}\n# Created: ${new Date().toISOString()}\n`
  );

  return {
    outputDir,
    toolCallsPath,
    cassettesDir,
    env: {
      ...env,
      TEST_MODE: "true",
      TEST_RUN_ID: testId,
      CLAUDE_PROJECT_DIR: gitRoot,
      VCR_CASSETTES_DIR: cassettesDir,
    },
  };
}

/**
 * Clean up test output for a specific test run.
 */
export async function cleanupTestOutput(
  testId: string,
  worktreePath?: string
): Promise<void> {
  const gitRoot = getGitRoot(worktreePath);
  const outputDir = join(gitRoot, "test-output", testId);

  try {
    await rm(outputDir, { recursive: true, force: true });
  } catch {
    // Ignore errors if directory doesn't exist
  }
}

/**
 * Clean up all test outputs older than the specified age.
 */
export async function cleanupOldTestOutputs(
  maxAgeMs: number = 24 * 60 * 60 * 1000, // 24 hours
  worktreePath?: string
): Promise<number> {
  const { readdir, stat } = await import("node:fs/promises");
  const gitRoot = getGitRoot(worktreePath);
  const testOutputDir = join(gitRoot, "test-output");

  let cleaned = 0;
  const now = Date.now();

  try {
    const entries = await readdir(testOutputDir);

    for (const entry of entries) {
      const entryPath = join(testOutputDir, entry);
      try {
        const stats = await stat(entryPath);
        if (stats.isDirectory() && now - stats.mtimeMs > maxAgeMs) {
          await rm(entryPath, { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // test-output directory doesn't exist
  }

  return cleaned;
}

/**
 * Run tests in parallel across multiple worktrees.
 *
 * @example
 * ```typescript
 * // Run from main repo
 * const results = await runTestsInWorktrees({
 *   worktrees: [".trees/worktree-a", ".trees/worktree-b"],
 *   command: "bun test",
 * });
 * ```
 */
export interface ParallelTestOptions {
  /** Paths to worktrees (relative to main repo) */
  worktrees: string[];
  /** Test command to run */
  command: string;
  /** Timeout per worktree in ms */
  timeout?: number;
}

export interface ParallelTestResult {
  worktree: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run a command in parallel across worktrees using Bun.spawn.
 *
 * Note: This is a utility for orchestrating parallel test runs.
 * Each worktree gets its own TEST_RUN_ID for output isolation.
 */
export async function runInParallel(
  options: ParallelTestOptions
): Promise<ParallelTestResult[]> {
  const { worktrees, command, timeout = 300000 } = options;
  const mainRoot = getGitRoot();

  const runInWorktree = async (worktreePath: string): Promise<ParallelTestResult> => {
    const fullPath = join(mainRoot, worktreePath);
    const testId = generateWorktreeTestId("parallel", fullPath);
    const startTime = Date.now();

    const proc = Bun.spawn(["sh", "-c", command], {
      cwd: fullPath,
      env: {
        ...process.env,
        TEST_MODE: "true",
        TEST_RUN_ID: testId,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    // Set up timeout
    const timeoutId = setTimeout(() => proc.kill(), timeout);

    const exitCode = await proc.exited;
    clearTimeout(timeoutId);

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    return {
      worktree: worktreePath,
      exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startTime,
    };
  };

  // Run all worktrees in parallel
  return Promise.all(worktrees.map(runInWorktree));
}

/**
 * Print a summary of parallel test results.
 */
export function summarizeParallelResults(results: ParallelTestResult[]): void {
  console.log("\n=== Parallel Test Summary ===\n");

  for (const result of results) {
    const status = result.exitCode === 0 ? "✓" : "✗";
    const duration = (result.durationMs / 1000).toFixed(2);
    console.log(`${status} ${result.worktree} (${duration}s) - exit code ${result.exitCode}`);
  }

  const passed = results.filter((r) => r.exitCode === 0).length;
  const total = results.length;
  console.log(`\n${passed}/${total} worktrees passed\n`);
}
