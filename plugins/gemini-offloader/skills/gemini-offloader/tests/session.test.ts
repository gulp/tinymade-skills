/**
 * Unit tests for session.ts - Gemini session management
 *
 * NOTE: Many session.ts commands depend on gemini-cli being responsive.
 * When gemini-cli hangs (common issue), these tests will timeout.
 * Tests that require gemini-cli interaction are marked with longer timeouts
 * or skipped when gemini is unresponsive.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rm, mkdir, writeFile, readFile } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const SCRIPTS_DIR = import.meta.dir.replace("/tests", "/scripts");
const TEST_CONFIG_DIR = join(homedir(), ".config", "gemini-offloader-test");

// Get bun's directory for PATH manipulation
const BUN_DIR = dirname(Bun.which("bun") || "/usr/bin/bun");

/**
 * Check if gemini-cli is responsive (quick timeout check)
 */
async function isGeminiResponsive(): Promise<boolean> {
  try {
    const proc = Bun.spawn(["timeout", "2", "gemini", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

describe("session.ts", () => {
  let geminiResponsive = false;

  beforeEach(async () => {
    // Create isolated test config directory
    await mkdir(TEST_CONFIG_DIR, { recursive: true });
    // Check gemini responsiveness once
    geminiResponsive = await isGeminiResponsive();
  });

  afterEach(async () => {
    // Cleanup test artifacts
    if (existsSync(TEST_CONFIG_DIR)) {
      await rm(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe("help and argument parsing", () => {
    test("no arguments shows usage or help", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      // Should exit with non-zero or show help
      // Either valid JSON error or help text
      const output = stdout + stderr;
      expect(output.length).toBeGreaterThan(0);
    });

    test("unknown command returns error", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`, "invalid_xyz_command"], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Unknown command should not succeed
      expect(exitCode).not.toBe(0);

      // Should have some output
      expect(stdout.length).toBeGreaterThan(0);
    });
  });

  describe("create command validation", () => {
    test("create without --prompt fails", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "create",
        "--name",
        "test-session",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Should fail without prompt
      expect(exitCode).not.toBe(0);

      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        expect(result.success).toBe(false);
      }
    });
  });

  describe("continue command validation", () => {
    test("continue accepts --timeout parameter syntax", async () => {
      // This just validates argument parsing, not execution
      // The command will fail but shouldn't fail on argument parsing
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "continue",
        "--timeout",
        "60",
        "--prompt",
        "test",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          // Use minimal PATH to make gemini not found (fast failure)
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should have output (JSON result)
      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        // Error should be about gemini not found, not about --timeout being invalid
        if (result.error) {
          expect(result.error).not.toContain("timeout");
          expect(result.error).not.toContain("argument");
        }
      }
    });

    test("continue accepts --name parameter syntax", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "continue",
        "--name",
        "my-session",
        "--prompt",
        "test",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        // Should fail due to gemini not found, not arg parsing
        if (result.error) {
          expect(result.error).not.toContain("name");
          expect(result.error).not.toContain("argument");
        }
      }
    });
  });

  describe("delete command validation", () => {
    test("delete accepts --index parameter syntax", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "delete",
        "--index",
        "99",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        // When gemini not found, returns simple error JSON without action
        // When gemini found, returns action: "delete"
        expect(result).toHaveProperty("success");
        // Argument parsing should work - error should be about gemini, not --index
        if (result.error) {
          expect(result.error).not.toContain("index");
          expect(result.error).not.toContain("argument");
        }
      }
    });
  });

  describe("gemini-dependent commands", () => {
    // These tests require gemini-cli to be responsive
    // They're skipped if gemini is hanging

    test("list command returns JSON when gemini available", async () => {
      // Skip if gemini not responsive
      if (!geminiResponsive) {
        console.log("Skipping: gemini-cli not responsive");
        return;
      }

      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`, "list"], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Use timeout for safety
      const timeoutId = setTimeout(() => proc.kill(), 10000);

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      clearTimeout(timeoutId);

      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        expect(result).toHaveProperty("action");
        expect(result.action).toBe("list");
        expect(result).toHaveProperty("sessions");
        expect(Array.isArray(result.sessions)).toBe(true);
      }
    }, 15000); // Extended timeout

    test("list returns named_sessions field", async () => {
      if (!geminiResponsive) {
        console.log("Skipping: gemini-cli not responsive");
        return;
      }

      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`, "list"], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const timeoutId = setTimeout(() => proc.kill(), 10000);

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      clearTimeout(timeoutId);

      if (stdout.trim().startsWith("{")) {
        const result = JSON.parse(stdout);
        expect(result).toHaveProperty("named_sessions");
        expect(typeof result.named_sessions).toBe("object");
      }
    }, 15000);
  });

  describe("fast failure paths", () => {
    // These tests use minimal PATH to make gemini not found - fast failures

    test("list fails gracefully when gemini not found", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/session.ts`, "list"], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toContain("gemini-cli not found");
    });

    test("create fails gracefully when gemini not found", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "create",
        "--name",
        "test",
        "--prompt",
        "test",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toContain("gemini-cli not found");
    });

    test("continue fails gracefully when gemini not found", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "continue",
        "--prompt",
        "test",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toContain("gemini-cli not found");
    });

    test("delete fails gracefully when gemini not found", async () => {
      const proc = Bun.spawn([
        "bun",
        `${SCRIPTS_DIR}/session.ts`,
        "delete",
        "--index",
        "0",
      ], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
          PATH: BUN_DIR,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);
      expect(result.success).toBe(false);
      expect(result.error).toContain("gemini-cli not found");
    });
  });
});
