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
cd ..
bun test
```

Run specific test file:
```bash
cd ..
bun test tests/launcher.test.ts
```

Tests validate:
- JSON output structure
- Error handling
- Cache behavior
- Authentication detection
- Session management

See `../tests/README.md` for more details on the test suite.

This project uses [Bun](https://bun.com) as its JavaScript runtime.
