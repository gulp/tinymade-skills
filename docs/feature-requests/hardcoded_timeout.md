# Feature Request: Configurable Timeout for session.ts + Large Context Handling

## Summary

Session script (`session.ts`) has a hardcoded 90-second timeout that cannot be overridden via CLI, while `query.ts` correctly supports `--timeout`/`-t` flag. This inconsistency causes friction when loading large context (e.g., folder of conversation logs).

## Reproduction

```bash
bun run scripts/session.ts create \
  --name "context-load" \
  --prompt "Load and analyze these files" \
  --include-dirs "/path/to/folder/with/87/jsonl/files"

Result:
{
  "success": false,
  "error": "Request timed out after 90s",
  "diagnostic": {
    "type": "timeout",
    "message": "Gemini did not respond within 90 seconds",
    "suggestion": "Try a shorter prompt, or wait 30-60s if rate limited"
  }
}

No way to extend timeout for legitimate large-context operations.

---
Starfish Retrospective

⭐ Keep Doing

- Structured JSON output - Deterministic, parseable, no regex needed
- Diagnostic object pattern - type, message, suggestion fields make error handling clear
- Launcher script - Excellent onboarding; shows state, available operations, and smart suggestions
- Cache architecture - Project-scoped, hash-based, mtime-aware staleness detection
- Dual-mode mem0 - Hosted vs local flexibility is thoughtful
- Documentation quality - The skill markdown is comprehensive with good examples

🔻 Less Of

- Inconsistent CLI interfaces - query.ts has --timeout, session.ts doesn't
- Silent assumptions - No warning when attempting to load context that will likely timeout

🔺 More Of

- Configurable limits - Expose all hardcoded values as CLI flags with sensible defaults
- Pre-flight estimation - Before executing, estimate token count and warn if likely to fail
- Progressive feedback - For long operations, periodic status would help

🛑 Stop Doing

- Hardcoding timeouts without override - Line 152 in session.ts: timeoutMs: number = 90000

🚀 Start Doing

1. Add --timeout/-t to session.ts - Parity with query.ts
// session.ts args parsing
timeout: { type: "string", short: "t" },
// Default to 90s for backward compat, allow override
const timeoutMs = values.timeout ? parseInt(values.timeout) * 1000 : 90000;
2. Pre-load file analysis - Before sending to Gemini:
{
  "warning": "Large context detected",
  "file_count": 87,
  "estimated_tokens": 450000,
  "suggestion": "Consider using --timeout 300 or chunking files"
}
3. Chunking strategy documentation - Add guidance for handling large file sets:
  - Load files in batches
  - Use session continuations to build context incrementally
  - Recommend file filtering patterns
4. Global config for defaults - In ~/.gemini_offloader/config.json:
{
  "defaults": {
    "session_timeout_ms": 180000,
    "query_timeout_ms": 300000,
    "max_include_files": 50,
    "warn_on_large_context": true
  }
}

---
Environment

- gemini-cli: 0.20.2
- Skill version: 1.0.0
- Bun: (current)
- OS: Linux 6.17.7-arch1-1

Workaround

Use query.ts instead of session.ts for large context loads:
bun run scripts/query.ts --timeout 600 --prompt "..." --include-dirs "..."

But this loses session continuity benefits.
```
