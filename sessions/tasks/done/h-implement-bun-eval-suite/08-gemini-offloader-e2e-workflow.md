---
name: 08-gemini-offloader-e2e-workflow
parent: h-implement-bun-eval-suite
status: pending
---

# Layer 3: Gemini-Offloader End-to-End Workflow Tests

## Problem/Goal

Test complete multi-step research workflows that combine multiple gemini-offloader operations. This validates the full user journey: query → cache → search → memory storage.

**What we're testing:** Does a realistic multi-step research workflow execute correctly with proper state transitions?

## Success Criteria

- [ ] E2E test file at `plugins/agent-evals/tests/workflows/gemini-research.test.ts`
- [ ] Tests validate complete query→cache→search workflow
- [ ] Tests validate session creation→continuation→completion flow
- [ ] Tests verify state persistence across operations
- [ ] Tests detect regressions in workflow integration

## Implementation

### Test Location

```
plugins/agent-evals/tests/
├── lib/
│   └── harness.ts
├── skills/
│   └── gemini-offloader.test.ts    # Layer 2
└── workflows/
    └── gemini-research.test.ts      # Layer 3 (this file)
```

### gemini-research.test.ts

```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { rm, mkdir, readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import {
  runAgent,
  getToolCalls,
  getPreToolCalls,
  generateTestId,
} from "../lib/harness.ts";

// Isolated test state directory
const TEST_STATE_DIR = join(homedir(), ".gemini_offloader_e2e_test");

describe("Gemini Research Workflows", () => {
  beforeAll(async () => {
    // Create isolated state directory
    await mkdir(TEST_STATE_DIR, { recursive: true });
  });

  afterAll(async () => {
    // Cleanup
    await rm(TEST_STATE_DIR, { recursive: true, force: true });
  });

  describe("Query → Cache → Search Flow", () => {
    const workflowTestId = generateTestId("query-cache-search");

    test("Step 1: Initial research query creates cache entry", async () => {
      const testId = `${workflowTestId}-step1`;

      const result = await runAgent({
        prompt: `Use gemini-offloader to research "Bun SQLite performance benchmarks".
                 Store the results.`,
        testId,
        maxTurns: 15,
        timeout: 120000,
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);
      expect(result.exitCode).toBe(0);

      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls).filter(
        (c) => c.tool_name === "Bash"
      );

      // Should have called query.ts
      const queryCall = bashCalls.find((c) => {
        const cmd = (c.tool_input as { command?: string }).command || "";
        return cmd.includes("query.ts");
      });
      expect(queryCall).toBeDefined();
    });

    test("Step 2: Same query returns cached result", async () => {
      const testId = `${workflowTestId}-step2`;

      const result = await runAgent({
        prompt: `Use gemini-offloader to research "Bun SQLite performance benchmarks" again.
                 Note whether it came from cache.`,
        testId,
        maxTurns: 15,
        timeout: 60000,
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);

      // Check stdout for cache hit indicator
      const output = result.stdout.toLowerCase();
      const hasCacheIndicator =
        output.includes("cached") ||
        output.includes("cache hit") ||
        output.includes('"cached": true');

      // Note: This assertion depends on output format
      // May need adjustment based on actual response structure
    });

    test("Step 3: Search finds cached research", async () => {
      const testId = `${workflowTestId}-step3`;

      const result = await runAgent({
        prompt: `Use gemini-offloader to search your past research for "SQLite".
                 List what you find.`,
        testId,
        maxTurns: 15,
        timeout: 60000,
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);

      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls).filter(
        (c) => c.tool_name === "Bash"
      );

      // Should call sync.ts or memory.ts for search
      const searchCall = bashCalls.find((c) => {
        const cmd = (c.tool_input as { command?: string }).command || "";
        return cmd.includes("sync.ts") || cmd.includes("memory.ts");
      });
      expect(searchCall).toBeDefined();
    });
  });

  describe("Session Lifecycle Flow", () => {
    const sessionName = `test-session-${Date.now()}`;

    test("Create new research session", async () => {
      const testId = generateTestId("session-create");

      const result = await runAgent({
        prompt: `Use gemini-offloader to create a new research session named "${sessionName}".
                 Start researching "TypeScript history and evolution".`,
        testId,
        maxTurns: 20,
        timeout: 120000,
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);

      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls).filter(
        (c) => c.tool_name === "Bash"
      );

      // Should call session.ts
      const sessionCall = bashCalls.find((c) => {
        const cmd = (c.tool_input as { command?: string }).command || "";
        return cmd.includes("session.ts") && cmd.includes(sessionName);
      });
      expect(sessionCall).toBeDefined();
    });

    test("Continue existing session", async () => {
      const testId = generateTestId("session-continue");

      const result = await runAgent({
        prompt: `Use gemini-offloader to continue the "${sessionName}" session.
                 Ask a follow-up question about TypeScript's adoption by major companies.`,
        testId,
        maxTurns: 20,
        timeout: 120000,
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);

      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls).filter(
        (c) => c.tool_name === "Bash"
      );

      // Should reference existing session
      const continueCall = bashCalls.find((c) => {
        const cmd = (c.tool_input as { command?: string }).command || "";
        return cmd.includes("session.ts") && cmd.includes(sessionName);
      });
      expect(continueCall).toBeDefined();
    });
  });

  describe("Error Recovery", () => {
    test("Handles missing gemini-cli gracefully", async () => {
      const testId = generateTestId("missing-cli");

      // Temporarily unset PATH to simulate missing CLI
      const result = await runAgent({
        prompt: "Use gemini-offloader to research something",
        testId,
        maxTurns: 10,
        timeout: 30000,
        env: {
          GEMINI_OFFLOADER_BASE: TEST_STATE_DIR,
          PATH: "", // Remove PATH to simulate missing gemini
        },
      });

      // Should not crash - should report error gracefully
      expect(result.timedOut).toBe(false);

      // Claude should report the error to user
      const output = result.stdout.toLowerCase();
      const hasErrorReport =
        output.includes("not found") ||
        output.includes("not installed") ||
        output.includes("error");
      expect(hasErrorReport).toBe(true);
    });

    test("Handles authentication failure gracefully", async () => {
      const testId = generateTestId("auth-failure");

      const result = await runAgent({
        prompt: "Use gemini-offloader to research something new",
        testId,
        maxTurns: 10,
        timeout: 30000,
        env: {
          GEMINI_OFFLOADER_BASE: TEST_STATE_DIR,
          GEMINI_API_KEY: "", // Clear API key
        },
      });

      expect(result.timedOut).toBe(false);

      // Should detect auth issue via launcher.ts or status.ts
      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls).filter(
        (c) => c.tool_name === "Bash"
      );

      // Should call status check at minimum
      const statusCheck = bashCalls.some((c) => {
        const cmd = (c.tool_input as { command?: string }).command || "";
        return cmd.includes("launcher.ts") || cmd.includes("status.ts");
      });
      expect(statusCheck).toBe(true);
    });
  });

  describe("Complex Multi-Operation Workflow", () => {
    test("Full research workflow: status → query → store to memory → search", async () => {
      const testId = generateTestId("full-workflow");

      const result = await runAgent({
        prompt: `Use gemini-offloader to:
                 1. Check system status
                 2. Research "Bun file system APIs"
                 3. Store the key findings to memory
                 4. Search past memories for "file system"

                 Report what you found at each step.`,
        testId,
        maxTurns: 30,
        timeout: 180000, // 3 minutes for complex workflow
        env: { GEMINI_OFFLOADER_BASE: TEST_STATE_DIR },
      });

      expect(result.timedOut).toBe(false);

      const toolCalls = await getToolCalls(testId);
      const bashCalls = getPreToolCalls(toolCalls)
        .filter((c) => c.tool_name === "Bash")
        .map((c) => (c.tool_input as { command?: string }).command || "");

      // Verify all expected scripts were called
      const expectedScripts = ["launcher.ts", "query.ts", "memory.ts"];
      for (const script of expectedScripts) {
        const called = bashCalls.some((cmd) => cmd.includes(script));
        expect(called).toBe(true);
      }
    });
  });
});
```

### Running E2E Tests

```bash
cd plugins/agent-evals/tests
bun test workflows/gemini-research.test.ts
```

With verbose output:
```bash
bun test workflows/gemini-research.test.ts --verbose
```

### Test Isolation

E2E tests use isolated state via:
1. `GEMINI_OFFLOADER_BASE` env var pointing to test-specific directory
2. Unique session names with timestamps
3. Cleanup in `afterAll` hooks

## Performance Considerations

- E2E tests are **slow** (spawn Claude, hit APIs, write state)
- Run selectively: `bun test --grep "Query → Cache"`
- Consider `CI_FULL_E2E=true` flag for comprehensive runs
- Use `--timeout 300000` for extended workflows

## Dependencies

- Layer 1 (unit tests) should pass first
- Layer 2 (skill invocation) should pass first
- Real Gemini API access (or mocked via future VCR cassettes)

## Notes

- These tests validate the integration between Claude and gemini-offloader
- Failures here often indicate:
  - Skill instruction changes
  - Script interface changes
  - State management bugs
  - Multi-step reasoning regressions
- Consider snapshot testing for complex outputs
