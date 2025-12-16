/**
 * Unit tests for launcher.ts - Interactive skill initialization
 *
 * Tests the LauncherResult JSON structure and operations list.
 * These tests work without Gemini API access since launcher only checks system state.
 */
import { describe, test, expect } from "bun:test";
import { $ } from "bun";

const SCRIPTS_DIR = import.meta.dir.replace("/tests", "/scripts");

describe("launcher.ts", () => {
  describe("JSON output structure", () => {
    test("returns structured LauncherResult JSON", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          // Disable tracing for tests
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      // Should return valid JSON
      const result = JSON.parse(stdout);

      // Core structure validation
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("ready");
      expect(result).toHaveProperty("installed");
      expect(result).toHaveProperty("authenticated");
      expect(result).toHaveProperty("state_initialized");
      expect(result).toHaveProperty("operations");
      expect(result).toHaveProperty("error");

      // Types validation
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.ready).toBe("boolean");
      expect(typeof result.installed).toBe("boolean");
      expect(typeof result.authenticated).toBe("boolean");
      expect(typeof result.state_initialized).toBe("boolean");
      expect(Array.isArray(result.operations)).toBe(true);
    });

    test("includes global stats object", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      expect(result).toHaveProperty("global");
      expect(result.global).toHaveProperty("total_projects");
      expect(result.global).toHaveProperty("total_cache_entries");
      expect(result.global).toHaveProperty("total_sessions");
      expect(result.global).toHaveProperty("index_entries");

      // Stats should be numbers
      expect(typeof result.global.total_projects).toBe("number");
      expect(typeof result.global.total_cache_entries).toBe("number");
      expect(typeof result.global.total_sessions).toBe("number");
      expect(typeof result.global.index_entries).toBe("number");
    });

    test("may include project context when in git repo", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      // project can be null or an object
      if (result.project !== null) {
        expect(result.project).toHaveProperty("path");
        expect(result.project).toHaveProperty("hash");
        expect(result.project).toHaveProperty("cache_entries");
        expect(result.project).toHaveProperty("active_sessions");
        expect(Array.isArray(result.project.active_sessions)).toBe(true);
      }
    });

    test("includes suggestion object", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      // suggestion can be null or an object with operation and reason
      if (result.suggestion !== null) {
        expect(result.suggestion).toHaveProperty("operation");
        expect(result.suggestion).toHaveProperty("reason");
        expect(typeof result.suggestion.operation).toBe("string");
        expect(typeof result.suggestion.reason).toBe("string");
      }
    });
  });

  describe("operations list", () => {
    test("operations have required fields", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      expect(result.operations.length).toBeGreaterThan(0);

      for (const op of result.operations) {
        expect(op).toHaveProperty("id");
        expect(op).toHaveProperty("label");
        expect(op).toHaveProperty("description");
        expect(op).toHaveProperty("available");

        expect(typeof op.id).toBe("string");
        expect(typeof op.label).toBe("string");
        expect(typeof op.description).toBe("string");
        expect(typeof op.available).toBe("boolean");
      }
    });

    test("includes research operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const researchOp = result.operations.find((op: any) => op.id === "research");
      expect(researchOp).toBeDefined();
      expect(researchOp.label).toContain("Research");
    });

    test("includes sessions operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const sessionsOp = result.operations.find((op: any) => op.id === "sessions");
      expect(sessionsOp).toBeDefined();
      expect(sessionsOp.label.toLowerCase()).toContain("session");
    });

    test("includes status operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const statusOp = result.operations.find((op: any) => op.id === "status");
      expect(statusOp).toBeDefined();
      // Status should always be available
      expect(statusOp.available).toBe(true);
    });

    test("includes search operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const searchOp = result.operations.find((op: any) => op.id === "search");
      expect(searchOp).toBeDefined();
    });

    test("includes memory operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const memoryOp = result.operations.find((op: any) => op.id === "memory");
      expect(memoryOp).toBeDefined();
      // Memory should always be available
      expect(memoryOp.available).toBe(true);
    });

    test("includes sync operation", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const syncOp = result.operations.find((op: any) => op.id === "sync");
      expect(syncOp).toBeDefined();
      // Sync should always be available
      expect(syncOp.available).toBe(true);
    });
  });

  describe("readiness detection", () => {
    test("ready is true only when installed AND authenticated", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      // Ready should be the AND of installed and authenticated
      expect(result.ready).toBe(result.installed && result.authenticated);
    });

    test("research operation availability matches ready state", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const result = JSON.parse(stdout);

      const researchOp = result.operations.find((op: any) => op.id === "research");

      // Research should be available only when ready
      expect(researchOp.available).toBe(result.ready);

      // If not available, should have a reason
      if (!researchOp.available) {
        expect(researchOp.reason).toBeDefined();
        expect(typeof researchOp.reason).toBe("string");
      }
    });
  });

  describe("exit code", () => {
    test("exits with 0 on success", async () => {
      const proc = Bun.spawn(["bun", `${SCRIPTS_DIR}/launcher.ts`], {
        env: {
          ...process.env,
          JUDGMENT_ORG_ID: "",
          JUDGMENT_API_KEY: "",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Launcher should always succeed (success=true) even if not ready
      expect(exitCode).toBe(0);
    });
  });
});
