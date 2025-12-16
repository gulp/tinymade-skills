/**
 * Unit tests for query.ts - Gemini query script
 *
 * Tests the CLI behavior without requiring actual Gemini API calls.
 * API-dependent tests are gated behind GEMINI_API_KEY check.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { rm, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const SCRIPTS_DIR = import.meta.dir.replace("/tests", "/scripts");
const TEST_CACHE_DIR = join(homedir(), ".gemini_offloader_test");
// Get bun's directory for minimal PATH that excludes gemini
const BUN_DIR = dirname(Bun.which("bun") || "/usr/bin/bun");

describe("query.ts", () => {
  beforeEach(async () => {
    // Create isolated test cache directory
    await mkdir(TEST_CACHE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test artifacts
    if (existsSync(TEST_CACHE_DIR)) {
      await rm(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  describe("argument validation", () => {
    test("returns error when --prompt is missing", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/query.ts`], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          // Disable tracing for tests
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Should exit with error code
      expect(exitCode).toBe(1);

      // Should return structured JSON error
      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.response).toBeNull();
      expect(result.model).toBeNull();
      expect(result.error).toContain("Missing required --prompt");
    });

    test("accepts --prompt with short form -p", async () => {
      // Use minimal PATH so gemini not found - fast failure
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/query.ts`, "-p", "test prompt"], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          // Minimal PATH ensures gemini not found -> fast failure
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should NOT have "missing prompt" error - will have different error (no gemini)
      const result = JSON.parse(stdout);
      expect(result.error).not.toContain("Missing required --prompt");
      // Should fail due to gemini not found
      expect(result.error).toContain("gemini-cli not found");
    });
  });

  describe("JSON output structure", () => {
    test("returns well-formed QueryResult JSON on error", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/query.ts`, "--prompt", "test"], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          // Minimal PATH with bun but without gemini
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should return valid JSON
      const result = JSON.parse(stdout);

      // Required fields should exist
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("response");
      expect(result).toHaveProperty("model");
      expect(result).toHaveProperty("error");

      // Types should be correct
      expect(typeof result.success).toBe("boolean");
      expect(result.success).toBe(false);
      expect(result.response).toBeNull();
    });

    test("error message indicates gemini-cli not found when missing", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/query.ts`, "--prompt", "test"], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          // Minimal PATH with bun but without gemini
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);
      expect(result.error).toContain("gemini-cli not found");
    });
  });

  describe("cache behavior", () => {
    // These tests require GEMINI_API_KEY and actual gemini-cli installed
    const hasGeminiSetup = !!(process.env.GEMINI_API_KEY);

    test.skipIf(!hasGeminiSetup)("returns structured JSON on success", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/query.ts`,
        "--prompt",
        "What is 2+2? Reply with just the number.",
        "--no-cache",
      ], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);

      const result = JSON.parse(stdout);
      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(typeof result.response).toBe("string");
      expect(result.model).toBeDefined();
      expect(result.cached).toBe(false);
      expect(result.error).toBeNull();
    });

    test.skipIf(!hasGeminiSetup)("returns cached result on second identical query", async () => {
      const prompt = `Test cache query ${Date.now()}`;

      // First call - cache miss
      const first = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/query.ts`,
        "--prompt",
        prompt,
      ], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const firstStdout = await new Response(first.stdout).text();
      await first.exited;
      const firstResult = JSON.parse(firstStdout);

      expect(firstResult.success).toBe(true);
      expect(firstResult.cached).toBe(false);

      // Second call - cache hit
      const second = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/query.ts`,
        "--prompt",
        prompt,
      ], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const secondStdout = await new Response(second.stdout).text();
      await second.exited;
      const secondResult = JSON.parse(secondStdout);

      expect(secondResult.success).toBe(true);
      expect(secondResult.cached).toBe(true);
    });

    test.skipIf(!hasGeminiSetup)("--no-cache flag bypasses cache", async () => {
      const prompt = `Test no-cache flag ${Date.now()}`;

      // First call without --no-cache
      const first = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/query.ts`,
        "--prompt",
        prompt,
      ], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const firstStdout = await new Response(first.stdout).text();
      await first.exited;
      const firstResult = JSON.parse(firstStdout);
      expect(firstResult.success).toBe(true);

      // Second call WITH --no-cache should not use cache
      const second = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/query.ts`,
        "--prompt",
        prompt,
        "--no-cache",
      ], {
        env: {
          ...process.env,
          GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const secondStdout = await new Response(second.stdout).text();
      await second.exited;
      const secondResult = JSON.parse(secondStdout);

      expect(secondResult.success).toBe(true);
      expect(secondResult.cached).toBe(false);
    });
  });
});
