# Judgment Labs Tracing - Quickstart

Test the tracing implementation for gemini-offloader scripts.

## Prerequisites

1. **Environment variables** (already in `.envrc`):
   ```bash
   export JUDGMENT_ORG_ID=$(pass judgement/org-id)
   export JUDGMENT_API_KEY=$(pass judgement/api-key)
   ```

2. **Dependencies installed**:
   ```bash
   cd plugins/gemini-offloader/skills/gemini-offloader/scripts
   bun install
   ```

## Test Commands

### Launcher (entry point)
```bash
bun scripts/launcher.ts
```
Traces: `findGemini`, `checkAuthentication`, `getGlobalStats`, `getProjectContext`

### Query (single-shot)
```bash
bun scripts/query.ts --prompt "What is the capital of France?" --timeout 30000
```
Traces: `runQuery` (span type: `llm`)

### Session Commands
```bash
# List sessions
bun scripts/session.ts list

# Create session
bun scripts/session.ts create --name "test-session" --prompt "Let's explore TypeScript patterns"

# Continue session
bun scripts/session.ts continue --name "test-session" --prompt "Tell me more about decorators"

# Delete session
bun scripts/session.ts delete --name "test-session"
```
Traces: `listSessions`, `createSession`, `continueSession`, `deleteSession`, etc.

### Memory Commands
```bash
# Check memory status
bun scripts/memory.ts status

# Search memories
bun scripts/memory.ts search --query "typescript" --limit 5

# Add memory
bun scripts/memory.ts add --content "Test memory entry" --metadata '{"source": "test"}'
```
Traces: `statusCommand`, `searchCommand`, `addCommand`, etc.

## View Traces

1. Go to [Judgment Labs Dashboard](https://app.judgmentlabs.ai)
2. Select project: **tinymade-skills-gemini-offloader**
3. View traces in real-time as you run commands

## Verify Tracing Works

Run any command and check for:
- No errors in terminal output
- Traces appearing in dashboard within ~5 seconds
- Span names matching function names (e.g., `runQuery`, `listSessions`)

## Troubleshooting

**No traces appearing?**
```bash
# Verify env vars are set
echo $JUDGMENT_ORG_ID
echo $JUDGMENT_API_KEY
```

**Script errors?**
```bash
# Reinstall dependencies
bun install
```

**Tracing disabled silently?**
Check script output for warning about missing credentials.
