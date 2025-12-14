---
name: gemini-offloader
description: Offload context-heavy tasks to Google Gemini via gemini-cli with warm session support and persistent vector memory. Use when user requests research with web search, large document summarization, multi-turn research sessions, or exploratory searches that would pollute Claude's context. Triggers include "ask Gemini", "offload to Gemini", "Gemini search", "research with Gemini", "continue Gemini session", "remember this research", or any request explicitly delegating work to Gemini. Also use proactively when a task would benefit from Gemini's 1M token context, Google Search grounding, or when building on previous research. **TIMEOUT:** Default 1800s (30min) supports complex research. For timely queries use `--timeout 60` or `--timeout 120`.
---

# Gemini Context Offloader

Delegate context-heavy work to Gemini via CLI with warm sessions for multi-turn research and mem0 vector store for persistent memory.

## On Activation

When this skill is activated, **run launcher.ts first** to understand the current state and user intent:

```bash
bun run scripts/launcher.ts
```

Based on the output, use **AskUserQuestion** to clarify the user's intent:

### Question 1: Primary Intent

```
"What would you like to do with Gemini?"
```

| Option | Description | Maps To |
|--------|-------------|---------|
| Research a new topic | Send a query with optional file context | `query.ts` |
| Manage research sessions | Create, continue, or delete multi-turn sessions | `session.ts` |
| Search past research | Find previously cached research | `memory.ts filter-local` |
| Store or manage memories | Add findings, retrieve, or delete memories | `memory.ts` |
| Check system status | Verify installation and authentication | `status.ts` |
| Manage cache and sync | Stats, rebuild index, prune orphans | `sync.ts` |

### Follow-up Questions (Based on Selection)

**If "Research a new topic":**
```
"How should I configure this research?"
Options:
- Include local files? [Yes - ask which dirs / No]
- Skip cache (force fresh)? [Yes / No]
- Save full output to file? [Yes - ask filename / No]
- Extended timeout? [No (1800s default) / Yes - 60s / Yes - 300s]
```

**TIMEOUT INFERENCE (REQUIRED):** Before asking about timeout, evaluate complexity:
| If prompt contains... | Auto-select timeout |
|----------------------|---------------------|
| "comprehensive", "analyze entire", "deep dive" | Use default 1800s |
| "all files", "entire codebase", "everything" | Use default 1800s |
| `--include-dirs` with multiple paths | Use default 1800s |
| Session continuation (3+ turns) | Use default 1800s |
| Quick fact check or simple query | `--timeout 60` or `--timeout 120` |

For timely tasks, override with `--timeout 60` or `--timeout 120`. Default 1800s (30min) already handles complex research.

**If "Manage research sessions":**
```
"Which session action?"
Options:
- List existing sessions
- Create new session [ask: session name, initial prompt, timeout if complex]
- Continue existing session [show available sessions from launcher output]
- Delete a session [show available sessions]
```

**SESSION TIMEOUT (REQUIRED):** For create/continue, use default 1800s (30min) which supports warm 1M token sessions. For quick follow-ups, override with `--timeout 60` or `--timeout 120`.

**If "Search past research":**
```
"How would you like to filter?"
Options:
- By time (last 7d, 2w, 1m, or specific date)
- By session name
- By source/file pattern
- By keyword search
- Search all projects (--global)
Then ask: "What are you searching for?" or "Which session/time period?"
```

**If "Store or manage memories":**
```
"Which memory action?"
Options:
- Add a new memory [ask: user, topic, text]
- Get all memories [ask: user]
- Delete a memory [ask: memory ID]
- Store a Gemini response [ask: user, topic]
```

**If "Manage cache and sync":**
```
"Which operation?"
Options:
- Show statistics
- Check drift (filesystem vs index)
- Rebuild index (re-index all cache)
- Prune orphans (clean stale entries)
```

### Context-Aware Behavior (REQUIRED)

**BEFORE calling AskUserQuestion**, you MUST evaluate launcher output and adapt options accordingly.

#### Decision Logic

```
IF launcher.project.active_sessions.length > 0:
  → MUST include "Continue '{session_name}'" as FIRST option for each active session
  → Do NOT use generic "Manage sessions" when specific sessions exist

IF launcher.authenticated == false:
  → MUST disable research/session creation options (show as unavailable)
  → Primary option: "Check system status" marked as "(Recommended)"

IF launcher.suggestion.operation is set:
  → Mark that operation's option as "(Recommended)"

IF launcher.global.total_sessions > 0 AND project.active_sessions is empty:
  → Include "Resume a previous session" option (sessions exist but not in current project)

IF user's request contains session name (e.g., "continue my wasm research"):
  → Skip primary intent question
  → Go directly to session continuation with that session pre-selected
```

#### Validation Checklist

Before presenting options, verify:

| Launcher Field | Condition | Required Action |
|----------------|-----------|-----------------|
| `project.active_sessions` | length > 0 | Include "Continue [name]" for EACH session |
| `authenticated` | false | Disable query/session options, recommend status |
| `suggestion.operation` | set | Mark as "(Recommended)" |
| `operations[].available` | false | Show option as disabled with `reason` |

#### Correct vs Incorrect Examples

**When `project.active_sessions = ["wasm-research", "api-design"]`:**

✅ **CORRECT:**
```json
{
  "options": [
    {"label": "Continue 'wasm-research'", "description": "Resume your active research session"},
    {"label": "Continue 'api-design'", "description": "Resume your API design session"},
    {"label": "Start new research", "description": "Create a new query or session"},
    {"label": "Search past research", "description": "Find previously cached results"}
  ]
}
```

❌ **WRONG:**
```json
{
  "options": [
    {"label": "Research a new topic", "description": "..."},
    {"label": "Manage research sessions", "description": "..."},
    {"label": "Search past research", "description": "..."}
  ]
}
```

**When `authenticated = false`:**

✅ **CORRECT:**
```json
{
  "options": [
    {"label": "Check system status (Recommended)", "description": "Authenticate before using Gemini"},
    {"label": "Search past research", "description": "Search 6 indexed entries (works offline)"}
  ]
}
```

❌ **WRONG:** Showing "Research a new topic" as available when auth is required.

#### Anti-Patterns (Do NOT Do This)

- ❌ Presenting generic "Manage sessions" when you could say "Continue 'wasm-research'"
- ❌ Asking "What would you like to do?" without first checking launcher state
- ❌ Showing research options as available when `authenticated = false`
- ❌ Ignoring `suggestion.operation` and not marking it as recommended
- ❌ Using the static option table (Question 1) without adapting to current state

**Example flow:**
```
User: "continue my wasm research"
→ Skip Q1 (intent is clear: sessions)
→ Show available sessions from launcher.project.active_sessions
→ Ask which session to continue
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude (Main Context)                     │
│                                                             │
│  1. User requests research                                  │
│  2. Claude invokes bundled scripts (Bun - deterministic)    │
│  3. Scripts check cache → call Gemini if miss → store       │
│  4. Returns SUMMARY to Claude (full response stays on disk) │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ gemini-cli   │ │   Sessions   │ │   mem0.ai    │ │ File Cache   │
│ (1M context) │ │ (warm state) │ │ (vector DB)  │ │ (~/.gemini_  │
└──────────────┘ └──────────────┘ └──────────────┘ │  offloader/) │
                                                   └──────────────┘
```

### Cache Flow

```
query.ts receives request
        │
        ▼
┌─────────────────┐     ┌─────────────────┐
│ Generate hash   │────▶│ Check cache     │
│ (prompt+files)  │     │ ~/.gemini_      │
└─────────────────┘     │ offloader/      │
                        └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
              Cache HIT                  Cache MISS
              (not stale)                (or stale)
                    │                         │
                    ▼                         ▼
           Return summary.md          Call gemini-cli
           from disk (instant)              │
                                            ▼
                                    Store full_response.md
                                    Generate summary.md
                                    Index in mem0
                                            │
                                            ▼
                                    Return summary
```

## When to Use

**Good candidates for Gemini offloading:**
- Web research needing Google Search grounding
- Multi-turn research sessions (warm sessions preserve context)
- Summarizing large documents (>50k tokens)
- Building on previous research (mem0 retrieval)
- Comparing technologies or gathering external knowledge

**Keep in Claude's context:**
- Codebase analysis (Claude has better tool access)
- File editing and manipulation
- Tasks requiring direct conversation continuity

## Bundled Scripts (Bun/TypeScript)

Execute these directly for deterministic, token-efficient operations.

### Launcher (Interactive Init)
```bash
bun run scripts/launcher.ts
```
Output: System state, available operations, and suggested action for AskUserQuestion flow.
```json
{
  "ready": true,
  "installed": true,
  "authenticated": true,
  "project": { "cache_entries": 5, "active_sessions": ["wasm-research"] },
  "operations": [...],
  "suggestion": { "operation": "sessions", "reason": "You have 1 active session" }
}
```

### Check Status
```bash
bun run scripts/status.ts
```
Output: `{"installed": true, "authenticated": true, "sessions": [...]}`

### Single Query
```bash
# Basic query with JSON output (cached automatically)
bun run scripts/query.ts --prompt "Explain WASM for backends"

# With local directory context
bun run scripts/query.ts --prompt "Analyze architecture" --include-dirs ./src,./docs

# Skip cache (force fresh query)
bun run scripts/query.ts --prompt "Latest news on X" --no-cache

# Save full response to file (summary still returned)
bun run scripts/query.ts --prompt "Research topic X" --output research.md

# Pipe content for summarization
cat large-doc.md | bun run scripts/query.ts --prompt "Summarize key points"
```

**Cache Behavior:**
- Queries are cached by hash of prompt + included files + model
- Returns **summary** (not full response) to keep Claude's context clean
- Full response stored at `~/.gemini_offloader/.../full_response.md`
- Cache invalidates when source files change (mtime-based staleness)
- Automatically indexed in mem0 for semantic search

Output includes cache status:
```json
{
  "success": true,
  "response": "Summary of the response...",
  "model": "gemini-2.5-pro",
  "cached": true,
  "full_response_path": "~/.gemini_offloader/projects/.../full_response.md",
  "error": null
}
```

### Warm Sessions (Multi-turn Research)
```bash
# List existing sessions
bun run scripts/session.ts list

# Create named session for ongoing research
bun run scripts/session.ts create --name "wasm-research" --prompt "Research WebAssembly for server-side"

# Create with custom timeout (default: 90 seconds)
bun run scripts/session.ts create --name "large-ctx" --prompt "Analyze" --timeout 300

# Continue named session
bun run scripts/session.ts continue --name "wasm-research" --prompt "Compare Wasmtime vs Wasmer"

# Continue with custom timeout
bun run scripts/session.ts continue --timeout 180 --prompt "Long analysis"

# Continue latest session
bun run scripts/session.ts continue --prompt "Go deeper on performance"

# Resume specific session by index
bun run scripts/session.ts resume --index 2 --prompt "Continue from here"

# Delete old session
bun run scripts/session.ts delete --index 5

# Migrate legacy sessions to sessionId-based tracking
bun run scripts/session.ts migrate

# Discover unmapped gemini-cli sessions
bun run scripts/session.ts discover

# Discover sessions across all projects
bun run scripts/session.ts discover --all-projects

# Adopt an existing session by discovery index
bun run scripts/session.ts adopt --index 0 --name "my-research"

# Adopt by session ID
bun run scripts/session.ts adopt --session-id "e028b0d3-..." --name "my-research"
```

**Session Discovery & Adoption:**

Sessions created directly via `gemini` CLI (outside this skill) are not automatically tracked. The `discover` and `adopt` commands let you find and adopt these sessions:

- **discover**: Scans gemini-cli's session storage and shows sessions not tracked by the skill
- **adopt**: Creates a SessionMapping for an existing session and indexes all historical turns in mem0

Discovery output includes a preview of each session's first prompt and response:
```json
{
  "action": "discover",
  "unmapped_sessions": [
    {
      "index": 0,
      "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77",
      "projectHash": "f3c7b...",
      "preview": {
        "firstPrompt": "Research WebAssembly for server-side...",
        "firstResponse": "WebAssembly (WASM) for server-side...",
        "totalTurns": 3
      },
      "isCurrentProject": true
    }
  ],
  "total_gemini_sessions": 45,
  "total_tracked_sessions": 3
}
```

Adopt creates a mapping and indexes historical turns:
```json
{
  "action": "adopt",
  "session_name": "my-research",
  "sessionId": "e028b0d3-...",
  "turns_indexed": 3,
  "success": true
}
```

**Session Tracking Limitations:**

The skill only automatically tracks sessions created through `session.ts create`. Sessions created by:
- Running `gemini` CLI directly
- Other tools using gemini-cli
- Different project directories

...will NOT appear in `session.ts list` until adopted. Use `discover` to find these sessions.

**Cross-Project Sessions:**

By default, `discover` only shows sessions from the current project directory. Use `--all-projects` to scan all project hashes in `~/.gemini/tmp/`. Each discovered session shows `isCurrentProject: true/false` to indicate origin.

**Session Persistence:** All session turns automatically persist to `~/.gemini_offloader/`:
- Full responses saved as timestamped files: `full_response-{ISO8601}.md`
- Summary updated after each turn
- Indexed in mem0 with session metadata (searchable via `filter-local --session`)
- Sessions tracked by persistent **sessionId** (UUID) rather than volatile index

**Timeout Configuration:**
- Default timeout: 90 seconds
- Use `--timeout` or `-t` flag to override (value in seconds)
- Applies to `create`, `continue`, and `resume` commands

**When to Use Longer Timeouts (REQUIRED):**

| Condition | Timeout |
|-----------|---------|
| `--include-dirs` with >10 files | `--timeout 180` |
| `--include-dirs` with >30 files | `--timeout 300` |
| Piping documents >5000 words | `--timeout 180` |
| Multi-step reasoning or comparison | `--timeout 180` |
| "Analyze entire codebase" queries | `--timeout 300` |
| Session with accumulated context (3+ turns) | `--timeout 180` |

**Default 90s is appropriate for:**
- Simple factual queries
- Single file analysis (<1000 lines)
- Short prompts with minimal context

**Session Health Status:**
- `healthy` - Session exists in gemini-cli and can be resumed
- `stale` - Session was purged by gemini-cli, mapping will be auto-cleaned on next use
- `legacy` - Old index-based mapping, run `migrate` to upgrade

**Output Format:**

Success response:
```json
{
  "action": "continue",
  "session": {
    "type": "named",
    "name": "wasm-research",
    "index": 6,
    "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77"
  },
  "response": "Summary of response...",
  "persisted": true,
  "indexed": true,
  "turn": 3,
  "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77",
  "success": true,
  "diagnostic": {
    "type": "success",
    "message": "Completed in 1234ms",
    "suggestion": ""
  }
}
```

Error response with diagnostic:
```json
{
  "success": false,
  "error": "Session e028b0d3... no longer exists (purged by gemini-cli)",
  "session": {
    "type": "named",
    "name": "deep-dive",
    "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77"
  },
  "diagnostic": {
    "type": "stale_session",
    "message": "Session e028b0d3-80ff-4250-8fe0-84cbe6de2e77 ('deep-dive') was purged. Session file: /path/to/session.json",
    "suggestion": "Create a new session with 'create --name \"deep-dive\" --prompt \"...\"'"
  },
  "available_sessions": [
    { "index": 1, "description": "Research WebAssembly...", "sessionId": "abc123..." },
    { "index": 2, "description": "Compare Wasmtime...", "sessionId": "def456..." }
  ]
}
```

**Diagnostic Types:**
- `success` - Operation completed successfully
- `timeout` - Request took too long (exit 124 or internal timeout)
- `rate_limit` - Rate/quota throttling (exit 144)
- `auth` - Authentication required or expired
- `stale_session` - Session was purged by gemini-cli (auto-cleaned from mappings)
- `unknown` - Other errors (check message field)

### Persistent Memory (mem0)
```bash
# Check mem0 status (shows current mode: hosted/local)
bun run scripts/memory.ts status

# Store research finding (works in both modes)
bun run scripts/memory.ts add --user "research" --topic "wasm" \
  --text "Key finding: Wasmtime has best cold-start performance at 0.5ms"

# Search past research (semantic via mem0, works in both modes)
bun run scripts/memory.ts search --user "research" --query "WASM performance"

# Search local index (fallback when mem0 unavailable)
bun run scripts/memory.ts search-local --query "WASM performance"

# Store gemini response directly
bun run scripts/query.ts -p "Research X" | bun run scripts/memory.ts store-response \
  --user "research" --topic "topic-x"

# Get all memories on a topic
bun run scripts/memory.ts get --user "research"
```

**Dual-mode support:**
- **Hosted mode**: Uses mem0.ai cloud API (requires MEM0_API_KEY)
- **Local mode**: Uses mem0ai/oss with Groq LLM + Ollama embeddings (requires GROQ_API_KEY)
- Both modes provide semantic search and vector memory
- Local index always maintained as fallback

**Entity Scoping Model:**

mem0 requires each memory to belong to exactly ONE entity space for reliable querying. The skill uses this scoping:

- **Project memories**: `user_id=project_hash` only (queryable per-project)
- **Session memories**: `user_id=project_hash` + `run_id=session_name` (queryable per-session)
- **Agent memories**: `user_id="gemini-offloader"` (cross-project agent knowledge)

IMPORTANT: Do NOT combine `agent_id + user_id` in the same memory - this creates unretrievable memories because mem0 queries one entity space at a time. Each memory must have a single entity scope.

Query patterns:
```bash
# Project scope: Search all memories for current project
bun run scripts/memory.ts search-scoped --scope project --project "abc123" --query "patterns"

# Session scope: Search memories for specific session
bun run scripts/memory.ts search-scoped --scope session --project "abc123" --session "research-1" --query "findings"

# Agent scope: Search cross-project agent knowledge
bun run scripts/memory.ts search-scoped --scope agent --query "best practices"
```

### Filter Past Research

**`filter-local` vs `search` - Understanding the Difference:**

| Command | Method | Use When |
|---------|--------|----------|
| `filter-local` | Keyword/metadata matching on local index | Looking for specific sessions, time ranges, known keywords |
| `search` | Semantic vector search via mem0 | Finding conceptually similar content, fuzzy matching |

`filter-local` is fast and works offline, but only matches exact keywords and metadata. `search` understands meaning (e.g., "WASM performance" finds "WebAssembly benchmarks") but requires mem0.

**Important:** Both commands only find **tracked** sessions (created via `session.ts create` or adopted via `adopt`). Sessions created directly via `gemini` CLI won't appear until adopted.

```bash
# Filter local index with various criteria
bun run scripts/memory.ts filter-local --since 7d              # Last 7 days
bun run scripts/memory.ts filter-local --since 2w              # Last 2 weeks
bun run scripts/memory.ts filter-local --since 2024-12-01      # Since specific date
bun run scripts/memory.ts filter-local --session "wasm-research"  # By session name
bun run scripts/memory.ts filter-local --source "sessions/*"   # By source path pattern
bun run scripts/memory.ts filter-local --topic "performance"   # By topic tag
bun run scripts/memory.ts filter-local --query "memory"        # Keyword search
bun run scripts/memory.ts filter-local --global                # Search all projects
bun run scripts/memory.ts filter-local --limit 20              # Max results

# Combine filters
bun run scripts/memory.ts filter-local --since 1m --session "research" --query "wasm"
```

Output includes match reasons:
```json
{
  "success": true,
  "filters": { "since": "7d", "session": null, ... },
  "count": 3,
  "results": [
    {
      "id": "abc123",
      "summary": "Research findings on WebAssembly...",
      "timestamp": "2024-12-13T10:00:00Z",
      "source_path": "session:wasm-research",
      "session_name": "wasm-research",
      "type": "research",
      "match_reasons": ["after 7d"]
    }
  ]
}
```

### State Persistence

The skill maintains a persistent cache at `~/.gemini_offloader/` with automatic indexing.

#### Initialize State Directory
```bash
# Scaffold directory structure (auto-creates on first use)
bun run scripts/init.ts

# Check current state
bun run scripts/init.ts --status

# Repair/validate installation
bun run scripts/init.ts --repair

# Reset config to defaults (keeps cached data)
bun run scripts/init.ts --reset

# Set mem0 mode
bun run scripts/init.ts --mem0-mode hosted   # Use mem0.ai cloud API
bun run scripts/init.ts --mem0-mode local    # Use self-hosted OSS stack
```

Output:
```json
{
  "success": true,
  "action": "status",
  "paths": {
    "base_dir": "~/.gemini_offloader",
    "config_file": "~/.gemini_offloader/config.json",
    "projects_dir": "~/.gemini_offloader/projects"
  },
  "stats": {
    "project_count": 3,
    "total_cache_entries": 47,
    "total_sessions": 5,
    "index_entries": 52
  }
}
```

#### Sync Operations
```bash
# Show sync statistics
bun run scripts/sync.ts stats

# Check drift between filesystem and mem0 index
bun run scripts/sync.ts check

# Re-index all cached responses into mem0
bun run scripts/sync.ts rebuild

# Remove orphaned entries from index
bun run scripts/sync.ts prune
```

#### Directory Structure
```
~/.gemini_offloader/
├── config.json                    # Global settings
├── index.json                     # Local fallback index (when mem0 unavailable)
└── projects/
    └── {project_hash}/
        ├── project.json           # Project metadata
        ├── cache/                 # One-shot query cache
        │   └── {source_hash}/
        │       ├── metadata.json  # Query metadata, file mtimes
        │       ├── full_response.md
        │       └── summary.md     # What gets returned to Claude
        └── sessions/              # Multi-turn session persistence
            └── {session_name}/
                ├── session.json
                ├── full_response-{timestamp}.md
                └── summary.md     # Cumulative session summary
```

## Workflows

### One-Shot Research
```bash
# Check status
bun run scripts/status.ts

# Execute query
bun run scripts/query.ts --prompt "Provide comprehensive 2024 overview of [TOPIC]: current state, key players, use cases, limitations, trajectory"
```

### Multi-Turn Deep Dive
```bash
# Start named session
bun run scripts/session.ts create --name "deep-dive-X" \
  --prompt "I'm researching X. Give me an overview to start."

# Follow up questions (context preserved)
bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "Go deeper on the performance characteristics"

bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "What are the main criticisms and limitations?"

# Store final synthesis
bun run scripts/session.ts continue --name "deep-dive-X" \
  --prompt "Synthesize everything into actionable recommendations" \
  | bun run scripts/memory.ts store-response --user "research" --topic "X"
```

### Research with Memory Retrieval
```bash
# Search past research first
bun run scripts/memory.ts search --user "research" --query "topic keywords"

# If relevant memories found, include in new query
bun run scripts/query.ts --prompt "Building on prior research that [MEMORY], now explore [NEW ANGLE]"

# Store new findings
bun run scripts/memory.ts add --user "research" --topic "topic" \
  --text "New finding: ..."
```

## Prompt Patterns

| Task Type | Prompt Structure |
|-----------|------------------|
| Research | "Provide comprehensive overview of X: current state, key features, use cases, recent developments" |
| Comparison | "Compare A vs B across: features, performance, ecosystem, learning curve, use cases" |
| Summarization | "Summarize the following, extracting key points, decisions, and action items" |
| Examples | "Find 3-5 real-world production examples of X pattern with explanations" |
| Deep Dive | "Go deeper on [aspect]. Include technical details, tradeoffs, and edge cases" |
| Synthesis | "Synthesize everything discussed into actionable recommendations" |

## Error Handling

All scripts return structured error responses with a `diagnostic` object containing:
- `type` - Error category (timeout, rate_limit, auth, stale_session, unknown)
- `message` - Detailed error description
- `suggestion` - Actionable next steps

| Error | Diagnostic Type | Resolution |
|-------|-----------------|------------|
| `gemini-cli not found` | N/A | `npm install -g @google/gemini-cli` |
| `authentication required` | `auth` | Run `gemini` interactively to login, or set `GEMINI_API_KEY` |
| `rate limit exceeded` | `rate_limit` | Free tier: 60 req/min, 1000 req/day. Wait 30-60s or use API key |
| `mem0 not installed` | N/A | `bun add mem0ai` and set `MEM0_API_KEY` (hosted) or `GROQ_API_KEY` (local) |
| `session not found` | `stale_session` | Check `available_sessions` in response or run `session.ts list` |
| `exit code 124` | `timeout` | Timeout - context too large or slow response. Chunk your input. |
| `exit code 144` | `rate_limit` | Rate/quota throttling - wait 30-60s before retrying |
| `command hangs` | N/A | gemini-cli needs stdin. Use: `echo "" \| gemini ...` |

**Stale Session Handling:**

When a session is purged by gemini-cli, the script:
1. Auto-detects staleness via pre-flight verification
2. Cleans up invalid named mappings
3. Returns `available_sessions` array with current sessions
4. Provides suggestion to create new session or continue existing one

See Warm Sessions section for diagnostic output examples.

## Rate Limiting & Best Practices

### Understanding Exit Codes

**Exit 124 (Timeout)**: "You asked me to think too long"
- Prompt or context is too large
- Backend didn't respond within timeout
- Common with large repos, long transcripts, deep reasoning requests

**Exit 144 (Throttling)**: "Stop asking for a bit"
- Hitting per-minute token or request limits
- Rapid consecutive calls trigger this
- Often follows a 124 when retrying immediately

These aren't bugs—they're guardrails. Gemini is generous on paper (1M tokens) but conservative in execution.

### Best Practices

**1. Use Gemini as a compressor, not a deep thinker**
```
# Good: Summarization and compression
"Summarize this codebase structure in 500 words"

# Bad: Deep exhaustive analysis
"Analyze every aspect of this repo comprehensively"
```

**2. Chunk aggressively**
```bash
# Instead of:
bun run scripts/query.ts --prompt "analyze ./repo" --include-dirs ./repo

# Do this:
bun run scripts/query.ts --prompt "summarize ./repo/src" --include-dirs ./repo/src
bun run scripts/query.ts --prompt "summarize ./repo/docs" --include-dirs ./repo/docs
# Then reason over the summaries
```

**3. Cap reasoning explicitly**
Add to your prompts:
```
Reason concisely.
If context is large, summarize first.
Avoid exhaustive analysis.
Limit response to key points.
```

**4. Serialize calls (no bursts)**
- Don't auto-retry on 124
- Wait 20-60s after 144 before retrying
- Avoid parallel requests to Gemini

**5. Prefer multi-turn sessions for deep dives**
```bash
# Session 1: Get overview
bun run scripts/session.ts create --name "research" --prompt "Overview of X"

# Session 2: Drill down (context preserved, no re-upload)
bun run scripts/session.ts continue --name "research" --prompt "Details on aspect Y"
```

### Mental Model

| Task | Use Gemini For | Keep in Claude |
|------|----------------|----------------|
| Large doc | Summarize → return summary | Reason over summary |
| Research | Gather facts, compress | Synthesize, decide |
| Codebase | High-level overview | Detailed analysis, edits |
| Multi-step | Each step independently | Orchestration logic |

## Installation

**Required:**
```bash
npm install -g @google/gemini-cli
```

**For running scripts (Bun):**
```bash
# Bun is typically pre-installed with Claude Code
# If not: curl -fsSL https://bun.sh/install | bash
```

**Optional (for mem0 memory):**

The skill supports two mem0 modes: **hosted** (mem0.ai cloud API) and **local** (self-hosted with Groq+Ollama).

**Hosted mode** (default):
```bash
cd plugins/gemini-offloader/skills/gemini-offloader
bun add mem0ai
export MEM0_API_KEY="..."  # Required for mem0.ai hosted API
```

**Local mode** (self-hosted):
```bash
cd plugins/gemini-offloader/skills/gemini-offloader
bun add mem0ai
export GROQ_API_KEY="..."  # Required for LLM (Groq/llama-3.1-8b-instant)
# Install Ollama and ensure nomic-embed-text model is available for embeddings
```

Configure the mode globally:
```bash
bun run scripts/init.ts --mem0-mode hosted   # Use mem0.ai cloud API
bun run scripts/init.ts --mem0-mode local    # Use self-hosted OSS stack
```

Per-project mode overrides are supported via config.json.

## Notes

- Gemini has 1M token context (vs Claude's ~200k in conversation)
- Free tier available with Google login (no API key needed)
- Warm sessions persist across CLI invocations (per-project)
- mem0 provides semantic search across all research sessions
- Scripts output JSON for reliable parsing - no code regeneration needed
- Bun scripts start faster than Python (~10ms vs ~100ms cold start)
