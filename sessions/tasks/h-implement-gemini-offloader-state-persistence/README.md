---
name: h-implement-gemini-offloader-state-persistence
branch: feature/gemini-offloader-state-persistence
status: pending
created: 2024-12-13
---

# Implement Gemini Offloader State Persistence

## Problem/Goal

The gemini-offloader skill currently lacks persistent state management. Each offload is ephemeral - Claude's context gets polluted with re-reads, Gemini sessions aren't tracked across Claude restarts, and there's no way to query past research semantically.

We need a comprehensive state persistence layer that:
1. Stores offload results in `~/.gemini_offloader/` (filesystem as source of truth)
2. Uses mem0 as the semantic index layer for intelligent retrieval
3. Supports temporal, source-based, and session-based filtering
4. Returns only summaries to Claude (full responses stay on disk)
5. Enables cross-project discovery of related research

## Success Criteria
- [ ] `~/.gemini_offloader/` directory structure implemented with config, projects, cache, sessions
- [ ] One-shot offloads cached by source hash with staleness detection
- [ ] Multi-turn sessions persist with timestamped responses (`full_response-{ISO8601}.md`)
- [ ] mem0 integration with rich metadata schema (temporal, source, session, topics)
- [ ] Query filters working: `--since`, `--source`, `--session`, `--topic`, `--global`
- [ ] Sync protocol: filesystem ↔ mem0 with rebuild/prune commands
- [ ] Only `summary.md` content returns to Claude context
- [ ] Local `index.json` fallback when mem0 unavailable
- [ ] Existing scripts updated: query.ts uses cache, session.ts uses state manager

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Claude Context                                                   │
│   "offload ./sessions/tasks/"                                   │
│         │                                                       │
│         ▼                                                       │
│   ┌─────────────┐     (only summary returns)                    │
│   │ offload.ts  │◄────────────────────────────────────┐         │
│   └─────────────┘                                     │         │
└───────────────────────────────────────────────────────│─────────┘
                    │                                   │
                    ▼                                   │
┌─────────────────────────────────────────────────────────────────┐
│ Gemini (1M context) - Heavy lifting                             │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ ~/.gemini_offloader/projects/<proj>/cache/<hash>/               │
│   metadata.json, full_response.md, summary.md                   │
└─────────────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│ mem0 - Semantic index + metadata filtering                      │
│   Indexes summary.md with rich metadata for retrieval           │
└─────────────────────────────────────────────────────────────────┘
```

## Filesystem Structure

```
~/.gemini_offloader/
├── config.json                          # Global settings
├── projects/
│   └── {project_hash}/
│       ├── project.json                 # Project metadata
│       ├── cache/                       # One-shot offloads
│       │   └── {source_hash}/
│       │       ├── metadata.json
│       │       ├── full_response.md
│       │       └── summary.md
│       └── sessions/                    # Multi-turn research
│           └── {session_name}/
│               ├── session.json
│               ├── full_response-{ISO8601}.md
│               └── summary.md
└── index.json                           # Local fallback
```

## Metadata Schema (mem0)

```typescript
interface OffloadMetadata {
  // Identity
  project_hash: string;
  project_path: string;

  // Source
  source_path: string;
  source_hash: string;
  source_type: "folder" | "file" | "stdin";

  // Session
  session_name: string | null;
  turn_number: number | null;

  // Temporal
  timestamp: string;  // ISO8601

  // Classification
  type: "offload" | "research" | "synthesis";
  topics: string[];
  model: string;

  // Provenance
  prompt_hash: string;
  response_file: string;
  token_count: number;
}
```

## Subtasks

Will be created in this directory as work progresses:
- [ ] `01-filesystem-structure.md` - Create ~/.gemini_offloader structure and config
- [ ] `02-state-manager.md` - Implement state.ts for session/cache management
- [ ] `03-mem0-integration.md` - Enhanced memory.ts with rich metadata
- [ ] `04-query-integration.md` - Update query.ts to use cache layer
- [ ] `05-session-integration.md` - Update session.ts with timestamped persistence
- [ ] `06-cli-filters.md` - Implement query filter flags
- [ ] `07-sync-protocol.md` - Filesystem ↔ mem0 sync/rebuild/prune

## Context Manifest

### How the Gemini Offloader Currently Works

The gemini-offloader skill provides a bridge between Claude's context and Google Gemini's 1M token context window, enabling context-heavy research tasks without polluting Claude's working memory. The system is currently implemented as four standalone Bun TypeScript scripts that communicate with the `gemini-cli` tool, with optional mem0 vector storage for persistent memory.

#### Current Entry Points and Script Architecture

When Claude receives a request to offload work to Gemini, it executes one of four bundled scripts located at `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/`:

1. **query.ts** - Single-shot queries with optional file/directory context
2. **session.ts** - Multi-turn warm sessions with context preservation
3. **memory.ts** - mem0 vector storage integration for long-term research memory
4. **status.ts** - Installation and authentication verification

All scripts follow the same architectural pattern:
- Accept CLI arguments via Bun's `parseArgs` utility
- Execute `gemini` CLI commands via Bun's `$` shell operator (from `import { $ } from "bun"`)
- Return structured JSON to stdout for Claude to parse
- Exit with code 0 on success, 1 on failure

#### Query Flow: One-Shot Research

When a user asks Claude to "offload to Gemini" or "research X with Gemini", Claude invokes `query.ts`. Here's the complete flow:

1. **Script receives arguments**: `--prompt "question"`, optional `--model`, `--include-dirs`, `--output`, `--yolo` flags
2. **Stdin detection**: The script checks if data is piped via `Bun.stdin.isTTY`. If stdin contains content (like a piped file), it prepends "Context:\n{content}\n\nTask: {prompt}"
3. **Command construction**: Builds gemini-cli command array:
   ```typescript
   const cmdArgs = [geminiPath, "-m", model, "--include-directories", dirs, "-o", "json", prompt]
   ```
4. **Execution**: Spawns gemini-cli process with `Bun.spawn(cmdArgs, {stdout: "pipe", stderr: "pipe"})`
5. **Response parsing**: Attempts JSON parse of stdout. Falls back to plain text if not valid JSON
6. **Output structure**:
   ```typescript
   interface QueryResult {
     success: boolean;
     response: string | null;
     model: string | null;
     saved_to?: string;  // if --output was specified
     error: string | null;
   }
   ```

The response is ephemeral - it's returned to Claude's context and then lost. There's no caching, no deduplication, no staleness detection. If Claude asks the same question twice about the same files, Gemini processes it twice.

#### Session Flow: Multi-Turn Research with Warm Context

For deep research requiring follow-up questions, Claude uses `session.ts` to maintain warm sessions. The gemini-cli tool has built-in session management that persists conversation history somewhere in its own state (likely `~/.gemini/` but we don't control this).

**Session State Management (Current)**:

The script maintains its own lightweight state mapping in TWO possible locations:
1. **Project-level**: `.gemini-offloader-sessions.json` in the current directory (if it exists)
2. **User-level fallback**: `~/.config/gemini-offloader/sessions.json`

The state file contains:
```typescript
interface SessionState {
  named_sessions: Record<string, number>;  // name -> gemini session index
  last_used: {
    session: { type: string; name?: string; index?: number };
    timestamp: string;
    prompt_preview: string;  // first 100 chars
  } | null;
}
```

**Why this matters**: The script provides a NAMING LAYER on top of gemini-cli's numeric session indices. Users can say "continue wasm-research" instead of "resume session 3". The mapping is stored, but the actual conversation content lives in gemini-cli's hidden state.

**Session commands and flows**:

- `session.ts list`: Calls `gemini --list-sessions`, parses numeric indices, enriches with names from state file
- `session.ts create --name "research" --prompt "..."`: Runs gemini query (creates new session), gets session index from list, stores name->index mapping
- `session.ts continue --name "research" --prompt "..."`: Looks up session index, runs `gemini --resume {index} -o json "prompt"`
- `session.ts delete --index N`: Calls `gemini --delete-session N`, removes from named_sessions mapping

**Critical gap**: When a session creates a response, that response is returned to Claude's context but not persisted to disk. If Claude restarts, the conversation history is in gemini-cli's state, but there's no summary or cache Claude can reference without re-running the session.

#### Memory Flow: mem0 Vector Storage Integration

The `memory.ts` script provides optional long-term semantic memory via mem0.ai (a vector database wrapper). This is currently separate from the query/session flows - it's manually invoked to store research findings.

**mem0 initialization**:
```typescript
async function getMemory() {
  const mem0 = await import("mem0ai");  // dynamic import (may not be installed)
  const config = await loadConfig();    // from ~/.config/gemini-offloader/mem0_config.json
  const m = new Memory(config);         // config can be empty, uses defaults
  return { memory: m, error: null };
}
```

**Storage operations**:
- `memory.ts add --user "research" --text "finding" --topic "wasm"`: Stores text with metadata
- `memory.ts search --user "research" --query "performance"`: Semantic search via embeddings
- `memory.ts get --user "research"`: Retrieve all memories for user
- `memory.ts store-response --user "research" --topic "X"`: Takes JSON from stdin (piped query result), stores the response text

**Metadata currently stored**:
```typescript
{
  timestamp: ISO8601,
  source: "gemini-offloader",
  topic: string,
  model: string,  // from query result
  tokens: number  // from query result
}
```

**Why mem0 exists**: It provides semantic search across research sessions. You can ask "what did we learn about WASM performance?" and get relevant snippets from past queries, even if phrased differently. But it's disconnected from the main query/session flow - you have to manually pipe results into it.

#### Current State Management Patterns in the Codebase

Looking at the existing scripts and the plane plugin, here are the established patterns:

**File I/O with Bun**:
- Read JSON: `const data = await Bun.file(path).json()`
- Write JSON: `await Bun.write(path, JSON.stringify(data, null, 2))`
- Check existence: `import { existsSync } from "fs"`
- Create directories: `import { mkdirSync } from "fs"` with `mkdirSync(dir, { recursive: true })`
- Path operations: `import { join, dirname, homedir } from "path"` and `import { homedir } from "os"`

**State location patterns**:
- User-level config: `~/.config/{plugin-name}/` (used by session.ts, memory.ts)
- Project-level state: Files in project root (like `.gemini-offloader-sessions.json`)
- Centralized cache: The plane plugin uses `.claude/plane-sync.json` in project root

**JSON structure patterns** (from plane's cache):
```typescript
{
  project: { metadata },
  states: { state_mappings },
  issues: { key: { data } },  // keyed by identifier
  linked: { issue_key: task_file },
  lastSync: ISO8601_timestamp
}
```

The plane cache demonstrates:
- Timestamp tracking (`lastSync`)
- Keyed data structures for fast lookup
- Separation of metadata, data, and mappings
- New/updated tracking during sync operations

#### Authentication and Environment

**gemini-cli authentication** (from status.ts):
- Checks `GEMINI_API_KEY` environment variable
- Checks Vertex AI: `GOOGLE_API_KEY` + `GOOGLE_GENAI_USE_VERTEXAI`
- Checks OAuth files: `~/.gemini/oauth_creds.json` and `~/.gemini/settings.json`
- Auth is binary: either authenticated or not. No token refresh logic in scripts.

**Current installation**: Based on status output in context-offloads:
- gemini-cli v0.20.2 at `/home/linuxbrew/.linuxbrew/bin/gemini`
- Authenticated via Google OAuth (oauth-personal method)
- Free tier limits: 60 req/min, 1000 req/day

**Critical stdin requirement**: gemini-cli HANGS if no stdin is provided. The scripts don't currently handle this, relying on `Bun.spawn` to provide empty stdin.

### What This Task Needs to Build

We're implementing a **persistence layer** that sits between Claude and the existing scripts. The goal is to make offloads cacheable, sessions resumable, and research discoverable across Claude restarts.

#### Architecture Integration Points

The new system needs to intercept at two points:

1. **Before calling gemini**: Check if we have a cached response for this exact input
2. **After gemini responds**: Store the response to disk + index in mem0

**Key design principle from task file**: "Filesystem is source of truth, mem0 is semantic index layer". This means:
- All full responses live on disk at `~/.gemini_offloader/`
- mem0 indexes summaries with rich metadata for retrieval
- If mem0 is unavailable, fall back to local `index.json`

#### Directory Structure and State Files

The task specifies:
```
~/.gemini_offloader/
├── config.json                    # Global settings
├── projects/{project_hash}/       # Per-project isolation
│   ├── project.json               # Project metadata (path, name, git remote)
│   ├── cache/{source_hash}/       # One-shot offloads keyed by input hash
│   │   ├── metadata.json          # Offload metadata (prompt, model, timestamp)
│   │   ├── full_response.md       # Complete gemini response
│   │   └── summary.md             # Condensed version for Claude context
│   └── sessions/{session_name}/   # Multi-turn research sessions
│       ├── session.json           # Session metadata
│       ├── full_response-{ISO}.md # Timestamped responses per turn
│       └── summary.md             # Cumulative session summary
└── index.json                     # Local fallback index when mem0 unavailable
```

**Project identification**: Hash of current git remote URL + project path. This allows cross-project research discovery (different projects can benefit from same research) while maintaining boundaries.

**Source hashing for cache**: For one-shot offloads, hash the combination of:
- Prompt text
- Included file paths (if `--include-dirs` used)
- Content of included files (or their mtimes for staleness detection)
- Model selection

This enables deduplication: if Claude asks the same question about unchanged files, return cached summary instantly.

**Session persistence**: Named sessions (like "wasm-research") get a directory. Each turn appends a new `full_response-{timestamp}.md`. The `summary.md` is updated to reflect cumulative learning.

#### Metadata Schema for mem0 Integration

The task specifies this metadata structure for mem0 indexing:

```typescript
interface OffloadMetadata {
  // Identity - which project/path this came from
  project_hash: string;
  project_path: string;

  // Source - what was analyzed
  source_path: string;      // file/folder path or "stdin"
  source_hash: string;       // content hash for cache key
  source_type: "folder" | "file" | "stdin";

  // Session context
  session_name: string | null;   // null for one-shot queries
  turn_number: number | null;    // which turn in the session

  // Temporal
  timestamp: string;  // ISO8601

  // Classification
  type: "offload" | "research" | "synthesis";
  topics: string[];        // extracted keywords/topics
  model: string;           // gemini-2.5-pro, etc.

  // Provenance
  prompt_hash: string;     // hash of original prompt
  response_file: string;   // path to full_response.md
  token_count: number;     // estimated tokens in response
}
```

**Why this schema matters**: It enables powerful queries like:
- "Show me all research about WASM from the last week" (temporal + topic filter)
- "What have we learned from analyzing ./src?" (source_path filter)
- "Resume the wasm-research session" (session_name filter)
- "Find related research from other projects" (global search ignoring project_hash)

#### Query Integration Points

**How query.ts needs to change**:

Currently, query.ts:
1. Accepts prompt + args
2. Calls gemini directly
3. Returns response to stdout

With persistence layer:
1. Accept prompt + args
2. **Hash source files + prompt** → generate cache key
3. **Check `~/.gemini_offloader/projects/{hash}/cache/{source_hash}/`**
   - If exists AND files haven't changed → return `summary.md` content
   - If exists but files changed → mark stale, re-query
4. If cache miss → call gemini
5. **Store result**:
   - Write `full_response.md`
   - Generate and write `summary.md` (maybe ask gemini to summarize its own response?)
   - Write `metadata.json`
   - **Index in mem0** with full metadata
6. Return `summary.md` content to Claude

**Staleness detection**: Compare file mtimes in source_hash metadata vs. current mtimes. If any file changed, the cache entry is stale.

#### Session Integration Points

**How session.ts needs to change**:

Currently, session.ts:
1. Maintains name->index mapping
2. Calls `gemini --resume {index}`
3. Returns response

With persistence layer:
1. Check/create `~/.gemini_offloader/projects/{hash}/sessions/{name}/`
2. Load `session.json` to get turn count
3. Call `gemini --resume {index}` (still use gemini's session state)
4. **Store turn result**:
   - Write `full_response-{ISO8601}.md`
   - **Regenerate `summary.md`** (summarize entire session history so far)
   - Update `session.json` with turn metadata
   - **Index turn in mem0** with session_name, turn_number
5. Return updated `summary.md` to Claude

**Session summary evolution**: Each turn updates the summary. This is critical - Claude doesn't need to see 10 full responses; it needs a cumulative summary showing "here's what we've learned so far".

#### mem0 Integration Enhancement

Currently, memory.ts is a separate tool. With this task, mem0 becomes integrated:

**Automatic indexing**: query.ts and session.ts automatically index their outputs
**Rich metadata**: Use the full OffloadMetadata schema
**Fallback behavior**: If mem0 is not installed or API key missing, write to `index.json` instead

**Sync protocol** (from subtask 07):
- `rebuild`: Re-index all `~/.gemini_offloader/` files into mem0
- `prune`: Remove mem0 entries for deleted files
- Check sync: Compare filesystem vs. mem0, report drift

#### Return Value Changes

**Critical requirement from task**: "Returns only summaries to Claude (full responses stay on disk)"

Current scripts return the full gemini response. New behavior:
- `query.ts`: Return `summary.md` content (not full_response.md)
- `session.ts`: Return updated cumulative `summary.md` (not the latest turn's full response)
- Include cache hit indicator in JSON: `{"cached": true, "summary": "...", "full_response_path": "..."}`

This keeps Claude's context clean while giving access to full details if needed.

#### Configuration and Global Settings

**config.json structure** (needs definition in subtask 01):
```typescript
{
  version: "1.0.0",
  default_model: "gemini-2.5-pro",
  cache_enabled: boolean,
  cache_ttl_days: number,  // how long before cache is considered stale
  mem0_enabled: boolean,
  summary_max_tokens: number,  // target size for summaries
  projects: {
    [project_hash]: {
      last_access: ISO8601,
      source_count: number,
      session_count: number
    }
  }
}
```

### Technical Reference Details

#### File Locations for Implementation

**New files to create**:
- `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/state.ts` - State manager module
- Updates to existing: `query.ts`, `session.ts`, `memory.ts`

**State manager responsibilities**:
- Project identification and hashing
- Cache key generation
- File I/O for metadata/response files
- Staleness detection
- Summary generation coordination
- mem0 indexing orchestration

#### TypeScript Patterns to Follow

Based on existing scripts:

**Module structure**:
```typescript
#!/usr/bin/env bun
import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

interface SomeResult {
  success: boolean;
  error: string | null;
  // ... specific fields
}

async function mainOperation(args: {...}): Promise<SomeResult> {
  // implementation
}

async function main() {
  // arg parsing with parseArgs
  const result = await mainOperation(parsedArgs);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}

main();
```

**Error handling**: Try/catch with error messages in JSON response, not thrown exceptions

**File operations**:
```typescript
// Read
const data = await Bun.file(path).json();
const text = await Bun.file(path).text();

// Write
await Bun.write(path, JSON.stringify(data, null, 2));
await Bun.write(path, textContent);

// Ensure directory exists
const dir = dirname(filePath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}
```

**Hashing approach** (Bun has crypto built-in):
```typescript
import { createHash } from "crypto";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}
```

#### Data Structures for Metadata Files

**metadata.json** (for cache entries):
```typescript
interface CacheMetadata {
  version: "1.0.0";
  created_at: string;  // ISO8601
  prompt: string;
  prompt_hash: string;
  source_files: Array<{
    path: string;
    mtime: number;  // Unix timestamp for staleness check
    size: number;
  }>;
  model: string;
  response_tokens: number;
  offload_metadata: OffloadMetadata;  // for mem0 indexing
}
```

**session.json** (for sessions):
```typescript
interface SessionMetadata {
  version: "1.0.0";
  session_name: string;
  created_at: string;
  last_turn_at: string;
  turn_count: number;
  gemini_session_index: number;  // link to gemini-cli's session
  turns: Array<{
    turn_number: number;
    timestamp: string;
    prompt: string;
    response_file: string;  // filename of full_response-{timestamp}.md
    tokens: number;
  }>;
}
```

**index.json** (fallback when mem0 unavailable):
```typescript
interface LocalIndex {
  version: "1.0.0";
  last_updated: string;
  entries: Array<{
    id: string;  // hash-based unique ID
    summary: string;  // the summary text
    metadata: OffloadMetadata;
  }>;
}
```

#### Integration with Existing Session State

**Current session state** (`.gemini-offloader-sessions.json`):
```typescript
{
  named_sessions: { "wasm-research": 0 },
  last_used: { session: {...}, timestamp: "...", prompt_preview: "..." }
}
```

**New relationship**: This file continues to exist for backward compatibility and gemini-cli session management. The new `~/.gemini_offloader/projects/{hash}/sessions/{name}/` directories augment it with persistence.

When session.ts runs:
1. Check/update the existing state file (for gemini-cli session mapping)
2. ALSO check/update the new session directory (for persistence and summaries)

#### Query Filter Implementation

The task specifies CLI filters for query operations:

**New query.ts arguments**:
- `--since "2024-12-01"` - Only show results after date
- `--source "./src"` - Filter by source path
- `--session "wasm-research"` - Filter to specific session
- `--topic "performance"` - Filter by topic tag
- `--global` - Search across all projects (ignore project_hash)

These filters query mem0 with appropriate metadata filters, then return matching summaries.

#### Summary Generation Strategy

**Key question**: How to create `summary.md` from `full_response.md`?

**Option 1**: Ask gemini to summarize its own response
```typescript
const summary = await runQuery({
  prompt: `Summarize the following response in 500 words or less, focusing on key findings and actionable insights:\n\n${fullResponse}`,
  model: "gemini-2.5-flash"  // faster model for summarization
});
```

**Option 2**: Simple truncation with smart splitting (fallback if gemini rate-limited)
```typescript
function generateSummary(fullResponse: string, maxTokens: number = 500): string {
  // Take first N chars, break at sentence boundary
  const approxChars = maxTokens * 4;  // ~4 chars per token
  const truncated = fullResponse.slice(0, approxChars);
  const lastPeriod = truncated.lastIndexOf('.');
  return lastPeriod > 0 ? truncated.slice(0, lastPeriod + 1) : truncated;
}
```

**Recommended approach**: Try Option 1, fall back to Option 2 on error. Store which method was used in metadata.

#### Bun Version and Compatibility

**Current Bun version**: 1.3.3 (from environment check)

**Available APIs**:
- `Bun.file()` for efficient file I/O
- `Bun.spawn()` for process execution
- `Bun.write()` for atomic writes
- `Bun.stdin.isTTY` for stdin detection
- Built-in TypeScript support (no compilation needed)
- Node.js stdlib imports (`fs`, `path`, `crypto`)

**No package.json needed**: Scripts run directly with `#!/usr/bin/env bun` shebang. Dependencies like `mem0ai` are dynamically imported if available.

### Implementation Approach

#### Subtask Breakdown Strategy

The task file lists 7 subtasks:

1. **Filesystem structure** - Create `~/.gemini_offloader/` hierarchy and `config.json` initialization
2. **State manager** - Core `state.ts` module with hashing, cache management, file I/O
3. **mem0 integration** - Enhanced `memory.ts` with OffloadMetadata schema
4. **Query integration** - Update `query.ts` to use cache layer
5. **Session integration** - Update `session.ts` with timestamped persistence
6. **CLI filters** - Implement `--since`, `--source`, `--session`, `--topic`, `--global`
7. **Sync protocol** - Add `rebuild`, `prune`, `check-sync` commands

**Dependency chain**:
- 01 and 02 are prerequisites for everything else
- 03 can happen in parallel with 01-02
- 04 and 05 depend on 02 and 03
- 06 depends on 04 and 05
- 07 depends on all previous

#### Testing Strategy

**Manual testing workflow**:
```bash
# Test cache creation
bun run scripts/query.ts --prompt "What is WASM?" --include-dirs ./docs

# Verify cache hit (should be instant)
bun run scripts/query.ts --prompt "What is WASM?" --include-dirs ./docs

# Test staleness (modify a file in ./docs, re-run)
touch ./docs/something.md
bun run scripts/query.ts --prompt "What is WASM?" --include-dirs ./docs

# Test session persistence
bun run scripts/session.ts create --name "test" --prompt "Explain Rust"
bun run scripts/session.ts continue --name "test" --prompt "Go deeper on ownership"

# Check filesystem
ls -la ~/.gemini_offloader/projects/
cat ~/.gemini_offloader/projects/{hash}/cache/{hash}/summary.md

# Test mem0 indexing
bun run scripts/memory.ts search --user "offloads" --query "WASM"

# Test filtering
bun run scripts/query.ts --since "2024-12-13" --topic "wasm"
```

**Edge cases to handle**:
- gemini-cli not installed (graceful error)
- mem0 not installed (fall back to local index)
- Permission errors creating `~/.gemini_offloader/` (clear error message)
- Empty responses from gemini (store with error flag)
- Rate limiting (exit code 144) - don't cache errors
- Timeout (exit code 124) - retry logic?

#### Migration from Current State

**Existing session state**: Keep `.gemini-offloader-sessions.json` working for backward compatibility. New sessions create both the old state entry AND the new session directory.

**Existing mem0 memories**: No migration needed - they're separate from new automated indexing. Old manual memories coexist with new automated ones.

**No breaking changes**: All existing script invocations continue to work. New behavior (caching, persistence) is transparent upgrades.

### Critical Implementation Details

#### Project Hash Generation

```typescript
import { createHash } from "crypto";

async function getProjectHash(): Promise<string> {
  // Try git remote first
  try {
    const remote = await $`git remote get-url origin`.text();
    const cwd = process.cwd();
    return createHash("sha256")
      .update(`${remote.trim()}:${cwd}`)
      .digest("hex")
      .slice(0, 16);
  } catch {
    // Fallback to just cwd if not a git repo
    return createHash("sha256")
      .update(process.cwd())
      .digest("hex")
      .slice(0, 16);
  }
}
```

#### Source Hash Generation

```typescript
async function generateSourceHash(args: {
  prompt: string;
  includeDirs?: string;
  model?: string;
}): Promise<{hash: string; files: FileInfo[]}> {
  const hashInput = [args.prompt, args.model || "default"];
  const files: FileInfo[] = [];

  if (args.includeDirs) {
    for (const dir of args.includeDirs.split(",")) {
      // Recursively collect files from dir
      const dirFiles = await collectFiles(dir.trim());
      for (const file of dirFiles) {
        const stat = await Bun.file(file).stat();
        files.push({
          path: file,
          mtime: stat.mtime.getTime(),
          size: stat.size
        });
        hashInput.push(file);
        hashInput.push(String(stat.size));
      }
    }
  }

  const hash = createHash("sha256")
    .update(hashInput.join("|"))
    .digest("hex")
    .slice(0, 16);

  return { hash, files };
}
```

#### Cache Staleness Check

```typescript
async function isCacheStale(metadata: CacheMetadata): Promise<boolean> {
  for (const fileInfo of metadata.source_files) {
    if (!existsSync(fileInfo.path)) {
      return true;  // File deleted
    }
    const stat = await Bun.file(fileInfo.path).stat();
    if (stat.mtime.getTime() !== fileInfo.mtime) {
      return true;  // File modified
    }
  }
  return false;
}
```

#### mem0 Indexing with Error Handling

```typescript
async function indexInMem0(summary: string, metadata: OffloadMetadata): Promise<boolean> {
  try {
    const { memory, error } = await getMemory();
    if (error) {
      // Fall back to local index
      await appendToLocalIndex(summary, metadata);
      return false;
    }

    await memory.add(summary, {
      user_id: "offloads",
      metadata: metadata
    });
    return true;
  } catch (e) {
    // Fall back to local index
    await appendToLocalIndex(summary, metadata);
    return false;
  }
}
```

### Success Criteria Verification

**How to verify each success criterion**:

- [ ] `~/.gemini_offloader/` directory structure → `ls -la ~/.gemini_offloader/`
- [ ] One-shot offloads cached → Run same query twice, check timestamps
- [ ] Multi-turn sessions persist → Check `sessions/{name}/full_response-*.md` files
- [ ] mem0 integration → `bun run scripts/memory.ts search` returns results
- [ ] Query filters working → Test each flag, verify filtered results
- [ ] Sync protocol → Run `rebuild`, verify mem0 matches filesystem
- [ ] Only summary returns → Check JSON output has summary, not full response
- [ ] Local index fallback → Uninstall mem0, verify index.json updated
- [ ] Scripts updated → Run existing workflows, verify cache layer transparent

## User Notes
- Design discussion captured in conversation on 2024-12-13
- Key insight: mem0 as first-class citizen, not afterthought
- Filesystem is source of truth, mem0 is semantic index
- Research sources: Anthropic MCP blog, mem0 docs, vector DB best practices

## Work Log
<!-- Updated as work progresses -->
- [2024-12-13] Task created from design discussion
