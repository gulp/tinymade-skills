---
name: 06-gemini-offloader-unit-tests
parent: h-implement-bun-eval-suite
status: pending
---

# Layer 1: Gemini-Offloader Unit Tests

## Problem/Goal

Test gemini-offloader CLI scripts directly using `bun test`. This validates the scripts' internal behavior (caching, argument parsing, error handling) without involving Claude Code at all.

## Success Criteria

- [ ] Unit tests exist at `plugins/gemini-offloader/skills/gemini-offloader/tests/`
- [ ] `query.ts` tests: missing prompt error, cache hit/miss, JSON output structure
- [ ] `launcher.ts` tests: operations list, authentication detection, project context
- [ ] `session.ts` tests: session creation, continuation, migration
- [ ] Tests run with `bun test` and pass in CI

## Implementation

### Test Structure

```
plugins/gemini-offloader/skills/gemini-offloader/
├── scripts/
│   ├── query.ts
│   ├── launcher.ts
│   └── session.ts
└── tests/
    ├── query.test.ts
    ├── launcher.test.ts
    ├── session.test.ts
    └── fixtures/
        ├── mock-cache/
        └── mock-config.json
```

### Example: query.test.ts

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { rm, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const SCRIPTS_DIR = import.meta.dir.replace("/tests", "/scripts");
const TEST_CACHE_DIR = join(homedir(), ".gemini_offloader_test");

describe("query.ts", () => {
  beforeEach(async () => {
    // Create isolated test cache directory
    await mkdir(TEST_CACHE_DIR, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup test artifacts
    await rm(TEST_CACHE_DIR, { recursive: true, force: true });
  });

  test("returns error when --prompt is missing", async () => {
    const result = await $`bun ${SCRIPTS_DIR}/query.ts`
      .env({ GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR })
      .json()
      .catch((e) => JSON.parse(e.stdout.toString()));

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required --prompt");
  });

  test("returns structured JSON on success", async () => {
    // This test requires GEMINI_API_KEY or mocking
    // Skip if no credentials
    if (!process.env.GEMINI_API_KEY) {
      console.log("Skipping: GEMINI_API_KEY not set");
      return;
    }

    const result = await $`bun ${SCRIPTS_DIR}/query.ts --prompt "What is 2+2?" --no-cache`
      .env({ GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR })
      .json();

    expect(result.success).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.model).toBeDefined();
    expect(result.cached).toBe(false);
  });

  test("returns cached result on second identical query", async () => {
    if (!process.env.GEMINI_API_KEY) {
      console.log("Skipping: GEMINI_API_KEY not set");
      return;
    }

    const prompt = `Test query ${Date.now()}`;

    // First call - cache miss
    const first = await $`bun ${SCRIPTS_DIR}/query.ts --prompt ${prompt}`
      .env({ GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR })
      .json();

    expect(first.success).toBe(true);
    expect(first.cached).toBe(false);

    // Second call - cache hit
    const second = await $`bun ${SCRIPTS_DIR}/query.ts --prompt ${prompt}`
      .env({ GEMINI_OFFLOADER_BASE: TEST_CACHE_DIR })
      .json();

    expect(second.success).toBe(true);
    expect(second.cached).toBe(true);
  });
});
```

### Example: launcher.test.ts

```typescript
import { describe, test, expect } from "bun:test";
import { $ } from "bun";

const SCRIPTS_DIR = import.meta.dir.replace("/tests", "/scripts");

describe("launcher.ts", () => {
  test("returns structured LauncherResult JSON", async () => {
    const output = await $`bun ${SCRIPTS_DIR}/launcher.ts`.text();
    const result = JSON.parse(output);

    // Structure validation
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("ready");
    expect(result).toHaveProperty("installed");
    expect(result).toHaveProperty("authenticated");
    expect(result).toHaveProperty("operations");
    expect(Array.isArray(result.operations)).toBe(true);
  });

  test("operations include required fields", async () => {
    const output = await $`bun ${SCRIPTS_DIR}/launcher.ts`.text();
    const result = JSON.parse(output);

    for (const op of result.operations) {
      expect(op).toHaveProperty("id");
      expect(op).toHaveProperty("label");
      expect(op).toHaveProperty("description");
      expect(op).toHaveProperty("available");
    }
  });

  test("includes research operation when authenticated", async () => {
    const output = await $`bun ${SCRIPTS_DIR}/launcher.ts`.text();
    const result = JSON.parse(output);

    const researchOp = result.operations.find((op: any) => op.id === "research");
    expect(researchOp).toBeDefined();

    // If authenticated, research should be available
    if (result.authenticated) {
      expect(researchOp.available).toBe(true);
    }
  });
});
```

### Running Tests

```bash
cd plugins/gemini-offloader/skills/gemini-offloader
bun test
```

With coverage:
```bash
bun test --coverage
```

## Dependencies

- `bun:test` (built-in)
- Test fixtures for mock cache/config data

## Notes

- Tests that hit real Gemini API should be gated behind `GEMINI_API_KEY` check
- Use isolated directories (`_test` suffix) to avoid polluting real cache
- Consider VCR-style mocking for deterministic API tests (future enhancement)
