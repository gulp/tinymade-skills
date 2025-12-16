# Gemini Offloader Scripts

TypeScript scripts for offloading context-heavy tasks to Google Gemini via gemini-cli.

## Installation

```bash
bun install
```

## Scripts

- `launcher.ts` - Interactive skill initialization and operations menu
- `query.ts` - Single-shot query with caching and project context
- `session.ts` - Multi-turn conversational sessions with mem0 memory
- `memory.ts` - Memory management utilities for session persistence

## Running Scripts

```bash
bun run launcher.ts
bun run query.ts --prompt "Your question here"
bun run session.ts
```

## Testing

Unit tests are located in `../tests/` directory.

Run all tests:
```bash
cd ../tests
bun test
```

Run specific test file:
```bash
cd ../tests
bun test launcher.test.ts
```

Tests validate:
- **Layer 1 (Unit tests)**: Direct CLI script testing
  - `query.test.ts`: Argument validation, JSON output structure, cache behavior
  - `launcher.test.ts`: Operations list structure, LauncherResult validation
  - `session.test.ts`: Command parsing, session management, error handling
- **Layer 2 (Skill invocation)**: Validate Claude invokes Skill tool correctly
  - Located at `/home/gulp/projects/tinymade-skills/plugins/agent-evals/tests/skills/gemini-offloader.test.ts`

### Running Tests with External Dependencies

Tests that require `gemini-cli` will auto-skip if the CLI is not responsive. To test with the actual CLI:

1. Ensure `gemini` is installed and authenticated
2. Run tests normally

Tests use responsiveness checks to avoid hanging when `gemini-cli` is unavailable or unresponsive.

This project uses [Bun](https://bun.com) as its JavaScript runtime.
