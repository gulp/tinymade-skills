# Gemini Offloader Unit Tests

Layer 1 unit tests for gemini-offloader CLI scripts. These tests validate script behavior without invoking Claude Code.

## Test Files

### query.test.ts (9 tests)

Tests for `query.ts` script:

- Argument validation (missing prompt, missing project)
- JSON output structure (`success`, `message` fields)
- Cache behavior when gemini unavailable
- Error handling for authentication failures

### launcher.test.ts (11 tests)

Tests for `launcher.ts` script:

- LauncherResult structure validation
- Operations list presence and format
- JSON output parsing

### session.test.ts (13 tests)

Tests for `session.ts` script:

- Command parsing (`list`, `show`, `delete`)
- Session ID validation
- Graceful failures when gemini-cli unavailable
- Error message format validation

## Running Tests

From this directory:

```bash
bun test
```

Run specific test file:

```bash
bun test query.test.ts
```

## Test Patterns

### External CLI Dependency Handling

Tests that depend on `gemini-cli` use auto-skip logic to avoid hangs:

```typescript
let geminiResponsive = false;

beforeAll(async () => {
  geminiResponsive = await isGeminiResponsive();
});

test("gemini integration test", async () => {
  if (!geminiResponsive) {
    console.log("Skipping: gemini-cli not responsive");
    return;
  }
  // Test logic here
});
```

### Minimal PATH Environment

Tests use minimal PATH to force fast "command not found" errors instead of hangs:

```typescript
const BUN_DIR = dirname(Bun.which("bun") || "/usr/bin/bun");

const proc = Bun.spawn(["bun", "../scripts/session.ts", "list"], {
  env: {
    ...process.env,
    PATH: BUN_DIR, // Only bun available, gemini not found
  },
});
```

This produces instant errors when gemini is unavailable rather than multi-second timeouts.

## Test Results

Expected output when gemini-cli is unavailable:

```
query.test.ts:
✓ query.ts > missing prompt argument [12ms]
✓ query.ts > JSON output on auth error (no gemini) [45ms]
...
13 pass
0 fail
```

Expected output when gemini-cli is available and authenticated:

```
query.test.ts:
✓ query.ts > missing prompt argument [12ms]
✓ query.ts > successful query execution [892ms]
...
13 pass
0 fail
```

## Known Issues

### gemini-cli Can Hang Indefinitely

The `gemini --list-sessions` command can hang when:
- Running in CI/automated test environments
- Spawned without proper stdin configuration
- System has authentication issues

Solution: Use responsiveness checks before running tests that depend on gemini-cli.

### Bun.spawn with stdin: "inherit" Hangs in Test Context

The session.ts script uses `stdin: "inherit"` when spawning gemini-cli. This works in interactive shells but hangs in test runners.

Solution: Tests use minimal PATH to exclude gemini, forcing fast "command not found" errors.

## Related Testing

**Layer 2 tests** (Skill invocation): Validate that Claude Code invokes the Skill tool correctly when asked to use gemini-offloader.

Location: `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/skills/gemini-offloader.test.ts`

**Layer 3 tests** (End-to-end workflows): Multi-agent coordination tests (planned).
