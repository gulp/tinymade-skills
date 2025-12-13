---
name: h-implement-gemini-offloader-state-persistence
branch: feature/gemini-offloader-state-persistence
status: in_progress
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
- [x] `~/.gemini_offloader/` directory structure implemented with config, projects, cache, sessions
- [x] One-shot offloads cached by source hash with staleness detection
- [x] Multi-turn sessions persist with timestamped responses (`full_response-{ISO8601}.md`)
- [x] mem0 integration with rich metadata schema (temporal, source, session, topics)
- [x] Query filters working: `--since`, `--source`, `--session`, `--topic`, `--global`
- [x] Sync protocol: filesystem ↔ mem0 with rebuild/prune commands
- [x] Only `summary.md` content returns to Claude context
- [x] Local `index.json` fallback when mem0 unavailable
- [x] Existing scripts updated: query.ts uses cache

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

## Implementation Status

Core persistence layer completed:
- [x] Filesystem structure and state manager
- [x] Query caching with staleness detection
- [x] mem0 integration with OffloadMetadata schema
- [x] Sync operations (rebuild, prune, check, stats)
- [x] Session persistence integration (cmdCreate/cmdContinue now persist to ~/.gemini_offloader)
- [x] Query filter flags (--since, --source, --session, --topic, --global) via `memory.ts filter-local`

## Context Manifest

### Current Architecture

The gemini-offloader skill bridges Claude's context with Gemini's 1M token window via Bun TypeScript scripts. Scripts communicate with `gemini-cli` and now include a persistent state layer at `~/.gemini_offloader/` with mem0 vector storage integration.

#### Script Inventory

**Core Scripts:**
- `query.ts` - Single-shot queries with caching (now cache-aware)
- `session.ts` - Multi-turn warm sessions (needs persistence integration)
- `memory.ts` - mem0 vector storage with `indexOffload()` for automatic indexing
- `status.ts` - Installation and authentication verification

**State Management (New):**
- `state.ts` - Core persistence module (hashing, caching, directory management)
- `init.ts` - Scaffold state directory with --status, --repair, --reset options
- `sync.ts` - Filesystem ↔ mem0 synchronization (rebuild, prune, check, stats)

#### Query Flow (With Caching)

**Cache-aware flow:**
1. Generate source hash from prompt + files + model
2. Check `~/.gemini_offloader/projects/{hash}/cache/{source_hash}/`
3. If cache hit and not stale: return `summary.md` (instant)
4. If cache miss or stale: call gemini-cli
5. Store full response, generate summary, index in mem0
6. Return summary to Claude (full response stays on disk)

#### Session Flow (Integrated)

Sessions provide a naming layer over gemini-cli's numeric indices and persist to `~/.gemini_offloader/projects/{hash}/sessions/{name}/`. The `session.ts` script uses `appendSessionTurn()` to save full responses with timestamps and index summaries in mem0.

#### Memory Integration (Enhanced)

`memory.ts` now includes `indexOffload()` function that accepts full `OffloadMetadata` schema. `query.ts` automatically indexes cache entries. Local `index.json` fallback when mem0 unavailable.

#### Key Implementation Details

**State Manager (`state.ts`):**
- Project hashing: SHA256 of `git remote url:cwd` or fallback to `cwd`
- Source hashing: Combined hash of prompt + file paths + file sizes + model
- Staleness detection: Compare cached file mtimes with current mtimes
- Lazy directory initialization: Creates dirs only when needed
- Summary generation: Smart truncation at sentence/paragraph boundaries

**Cache Integration (`query.ts`):**
- Hash-based cache lookup before calling gemini
- Returns `summary.md` content (not full response) to keep Claude context clean
- Stores full response at `~/.gemini_offloader/.../full_response.md`
- Automatic mem0 indexing with fallback to local `index.json`
- `--no-cache` flag to force fresh query

**Sync Operations (`sync.ts`):**
- `rebuild`: Re-index all cached responses into mem0
- `prune`: Remove orphaned entries from local index
- `check`: Report drift between filesystem and index
- `stats`: Show counts of projects, cache entries, sessions, index entries

### Discovered During Implementation
[Date: 2024-12-13]

During implementation, we discovered two critical issues that weren't documented in the original context:

**1. Script Module Import Side-Effect Bug**

When `memory.ts` was imported as a module by `query.ts` (for the `indexOffload()` function), the `main()` function was executing unconditionally. This happened because the original script structure had `main()` called at the module top level without a guard.

This wasn't documented because the original architecture assumed scripts would only be executed directly via CLI, not imported as modules. The actual behavior is that Bun/TypeScript modules execute all top-level code during import, which means any script serving dual purposes (CLI tool + importable library) needs an `import.meta.main` guard.

**Solution implemented:**
```typescript
// Only run main() when this file is the entry point
if (import.meta.main) {
  main();
}
```

**Future guidance:** All scripts that export functions for use by other scripts must use `import.meta.main` guards around their CLI execution logic. This pattern should be applied to any new scripts created in the skill.

**2. Plugin Cache Invalidation for SKILL.md Changes**

During skill activation debugging, we discovered that Claude Code's plugin system reads SKILL.md from the git `master` branch, not from the working directory. This wasn't documented in the original context because it's a plugin system behavior, not a gemini-offloader behavior.

**Critical constraints discovered:**
- Plugin cache is populated from `master` branch content when plugin is installed
- Uncommitted changes to SKILL.md are **not visible** to Claude Code
- Changes on feature branches are **not visible** until merged to master
- Cache location: `~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/`

**Required workflow for SKILL.md updates:**
```bash
# 1. Commit changes to feature branch
git commit -m "Update SKILL.md documentation"

# 2. Merge to master (or push to master)
git checkout master
git merge feature-branch

# 3. Reinstall plugin (not just clear cache)
# In Claude Code: /plugin uninstall tinymade-skills/gemini-offloader
# Then: /plugin install tinymade-skills/gemini-offloader

# 4. Restart Claude Code
# Required for plugin changes to fully take effect
```

**Impact:** This significantly affects development workflow - documentation updates require a full commit → merge → reinstall → restart cycle before Claude sees changes. During skill development, SKILL.md updates won't be visible in testing until this full workflow is completed. This was the root cause of the "On Activation" section not appearing during Session 8 testing.

**3. AskUserQuestion Tool Validation Requirements**

During implementation of the interactive launcher flow (`launcher.ts`), we discovered that AskUserQuestion has a minimum requirement of 2 options per question. This wasn't documented in Claude Code's tool documentation and caused validation errors during testing.

The original attempt used a single option per question (e.g., "Let me type a name") expecting users could always provide custom input via an "Other" option. This assumption was incorrect.

**Validation error encountered:**
```json
{
  "code": "too_small",
  "minimum": 2,
  "type": "array",
  "inclusive": true,
  "message": "Array must contain at least 2 element(s)",
  "path": ["questions", 0, "options"]
}
```

**Actual behavior:** AskUserQuestion validates that each question has at least 2 options before execution. The tool supports free-text input via an implicit "Other" selection, but developers cannot rely on single-option questions.

**Future guidance:** When designing interactive flows with AskUserQuestion, always provide at least 2 meaningful options per question. If you want open-ended input, provide 2+ suggested options and let users choose "Other" to enter custom text.

**4. mem0ai/oss Provider Architecture Constraints**

During research for mem0 integration, we discovered critical architectural constraints in the TypeScript mem0ai/oss library that weren't clear from initial documentation:

**Provider separation discovered:**
- mem0ai/oss requires separate providers for **LLM** (reasoning) and **embedder** (vectorization)
- Groq provides ONLY LLM inference - they have **no embedding models**
- This wasn't documented clearly in Groq's model listings or mem0ai/oss documentation

**Workaround required:**
Multi-provider configuration is mandatory when using Groq for LLM. Valid combinations:
```typescript
// Option 1: Groq LLM + Google Embeddings
{ llm: 'groq', embedder: 'google' }

// Option 2: Groq LLM + Ollama Embeddings (local)
{ llm: 'groq', embedder: 'ollama' }

// Option 3: Google for both (simpler but requires Google API)
{ llm: 'google', embedder: 'google' }
```

**Cost implications discovered:**
Through manual API research (Groq pricing page), we found:
- `llama-3.1-8b-instant`: $0.05/$0.08 per 1M tokens (cheapest Groq option)
- `qwen/qwen3-32b`: $0.29/$0.59 per 1M tokens (6x more expensive)
- Ollama `nomic-embed-text`: Free, local, 768 dimensions

The original task assumed mem0 could use a single provider. The actual implementation requires multi-provider configuration knowledge and understanding of which providers support embeddings vs LLM inference.

**Future guidance:** When integrating vector memory libraries, explicitly verify which providers support embeddings vs LLM inference. Don't assume a provider offers both capabilities. Document the multi-provider requirement early in architecture decisions.

**5. gemini-cli Session Rotation and Staleness**

During session persistence implementation, we discovered that gemini-cli has session limits and automatically purges old sessions. When a named session mapping points to a purged session index, the resume attempt will hang or timeout rather than return a clear error.

This wasn't documented in gemini-cli's error handling or session management documentation. The actual behavior is that gemini-cli silently accepts invalid session indices and then hangs during the resume attempt, eventually timing out after 60-90 seconds.

**Problem discovered:**
- gemini-cli maintains sessions by numeric index (0, 1, 2, etc.)
- Old sessions get purged when limits are reached
- `session.ts` maintains named mappings (e.g., "research" -> session index 2)
- If session index 2 gets purged, but mapping still points to it, resume attempt hangs/times out
- No clear error message - just timeout or unresponsive behavior

**Solution implemented:**
```typescript
// Pre-flight session verification before resume
async function verifySession(sessionIndex: number): Promise<boolean> {
  // Call gemini-cli --list-sessions
  // Parse output to check if sessionIndex exists
  // Return false if session doesn't exist
}

// In cmdContinue: Auto-cleanup stale mappings
if (!await verifySession(sessionIndex)) {
  // Remove stale mapping from state
  // Return diagnostic with available sessions
  // Suggest creating new session or using existing one
}
```

**Future guidance:** When building session management layers over external CLI tools, always implement pre-flight verification of session existence before attempting operations. Don't assume sessions persist indefinitely. Implement auto-cleanup of stale mappings and provide helpful diagnostics showing available sessions when staleness is detected.

## Work Log

### 2025-12-13 (Session 1)

#### Completed
- Implemented core state persistence layer:
  - Created `state.ts` with project/source hashing, cache management, staleness detection, session scaffolding
  - Created `init.ts` with --status, --repair, --reset options for state directory management
  - Created `sync.ts` with rebuild, prune, check, stats operations for filesystem ↔ mem0 sync
- Enhanced `memory.ts` with `indexOffload()` function accepting full OffloadMetadata schema
- Integrated cache layer into `query.ts`:
  - Hash-based cache lookup before calling gemini
  - Returns summary instead of full response to Claude
  - Automatic mem0 indexing with local index.json fallback
  - Added --no-cache flag
- Updated SKILL.md documentation:
  - Added File Cache component to architecture diagram
  - Documented cache flow
  - Added State Persistence section with init.ts and sync.ts documentation
  - Updated Single Query section with cache behavior
  - Added directory structure explanation
- Fixed bug: Added `import.meta.main` guard to memory.ts to prevent main() execution when imported
- Tested implementation successfully

#### Decisions
- Used simple truncation for summary generation instead of asking Gemini to summarize (avoids extra API call and potential rate limiting)
- Implemented lazy directory initialization - creates structure on first use rather than requiring explicit init
- Chose to keep local index.json as permanent fallback alongside mem0 (not just when mem0 unavailable)

### 2025-12-13 (Session 2)

#### Completed
- Created `launcher.ts` for interactive skill initialization
  - Checks system state (installed, authenticated, state initialized)
  - Gathers project context (cache entries, active sessions)
  - Returns structured operations array for AskUserQuestion
  - Provides context-aware suggestions based on current state
- Updated SKILL.md with comprehensive "On Activation" section
  - Documented AskUserQuestion flow with all 6 operations
  - Added follow-up question patterns for each operation type
  - Included context-aware behavior guidance
  - Added launcher documentation in Bundled Scripts section
- Researched mem0ai/oss configuration options for embedding and LLM providers
  - Investigated Anthropic, Google, Groq, and Ollama options
  - Compared pricing for Groq models (llama-3.1-8b-instant cheapest at $0.05/1M)
  - Confirmed Groq has no embedding models (LLM inference only)
- Set up GROQ_API_KEY environment
  - Created pass entry at `api/groq--mem0-llama`
  - Updated `.envrc` to load key from pass
  - Verified Ollama installed at `/usr/bin/ollama`

#### Decisions
- Selected Groq with llama-3.1-8b-instant for LLM (6x cheaper than qwen3-32b, $0.05/$0.08 per 1M tokens)
- Selected Ollama with nomic-embed-text for embeddings (local, free, 768 dimensions)
- In-memory vector store for mem0ai/oss
- Rejected pure Google/Anthropic stacks to avoid multiple API key dependencies

#### Next Steps
- All planned features completed

### 2025-12-13 (Session 3)

#### Completed
- Configured Ollama service with systemd (autostart enabled)
- Pulled `nomic-embed-text` embedding model (274MB)
- Updated `memory.ts` for mem0ai/oss integration:
  - Import from `mem0ai/oss` instead of `mem0ai`
  - Configured Groq LLM (`llama-3.1-8b-instant`) + Ollama embeddings (`nomic-embed-text`)
  - In-memory vector store with 768 dimensions
  - Fixed API: `userId` (camelCase) instead of `user_id`
  - Added instance caching and GROQ_API_KEY validation
  - Updated `cmdStatus` to show provider configuration
- Fixed AMD GPU/ROCm compatibility:
  - Ollama failed with ROCm errors on AMD GPU
  - Solution: systemd override with `ROCR_VISIBLE_DEVICES=-1` and `HIP_VISIBLE_DEVICES=-1`
  - Override file: `/etc/systemd/system/ollama.service.d/override.conf`
- Verified integration:
  - `indexOffload()` successfully indexes to both mem0 and local fallback
  - Local index persists at `~/.gemini_offloader/index.json`

#### Decisions
- In-memory vector store (non-persistent between runs) is acceptable for now
  - Local index provides persistent keyword-based fallback
  - For persistent semantic search, would need Qdrant/Chroma (future enhancement)
- CPU-only Ollama embeddings (GPU disabled due to ROCm issues)

#### Discovered
- **AMD GPU/ROCm Ollama Issue**: Ollama's ROCm support has compatibility issues with certain AMD GPU configurations. The error `ROCm error: invalid device function` occurs during embedding model inference. Workaround: disable GPU via `ROCR_VISIBLE_DEVICES=-1` in systemd override.
- **mem0ai/oss API differences**: The TypeScript library uses camelCase (`userId`) not snake_case (`user_id`). This wasn't immediately clear from documentation.

### 2025-12-13 (Session 4)

#### Completed
- Integrated session persistence into `session.ts`:
  - Created `persistSessionTurn()` helper function that persists to filesystem and indexes in mem0
  - Updated `cmdCreate` and `cmdContinue` to persist turns automatically
  - Session turns save full response to timestamped files and index in mem0
- Implemented `filter-local` command in `memory.ts` with flexible filtering (--since, --source, --session, --topic, --query)
- Enhanced `session.ts` with structured error diagnostics for timeout/rate-limit/stale-session detection

#### Decisions
- Session responses typed as "research" in OffloadMetadata (distinct from one-shot "offload")

### 2025-12-13 (Session 5)

#### Completed
- **Fixed mem0 integration bugs**:
  - Changed `!== null` to `!= null` in `loadMem0()` to catch both null and undefined
  - Installed `mem0ai@2.1.38` package in skill directory
  - Fixed fire-and-forget indexing in `query.ts` - added `await` to `indexOffload()` calls to ensure completion before process exit
- **Implemented dual-mode mem0 support**:
  - Added `Mem0LocalConfig` interface and `mem0_mode` field to `GlobalConfig` in `state.ts`
  - Refactored `memory.ts` with separate `loadMem0Hosted()` and `loadMem0OSS()` functions
  - Updated `getMemory()` to dispatch based on config mode (hosted vs local)
  - Modified `cmdStatus()` to report current mode and appropriate configuration
  - Added `getMem0Mode()` and `getMem0LocalConfig()` helper functions to `state.ts`
  - Updated `init.ts` with `--mem0-mode` flag and `setMem0Mode()` function
  - Updated `resetConfig()` to include new mem0 configuration fields
- **Environment setup**:
  - Added `MEM0_API_KEY` to `.envrc` via pass (api/mem0)
  - Configured default mode as "hosted" with fallback to local OSS config

#### Decisions
- Default mem0 mode set to "hosted" for persistent semantic search via mem0.ai API
- Local mode uses Groq (llama-3.1-8b-instant) + Ollama (nomic-embed-text) with in-memory vectors
- Per-project mode override supported via `projects[hash].mem0_mode` in config

#### Discovered
- Fire-and-forget async calls exit before completion - `await` required for process-scoped operations

### 2025-12-13 (Session 6)

#### Completed
- **Fixed critical mem0 hosted API integration bug**:
  - Hosted API (`MemoryClient`) expects `Array<Message>` not a plain string for `add()`
  - Hosted API uses `user_id` (snake_case), OSS uses `userId` (camelCase)
  - Updated `cmdAdd()`, `cmdSearch()`, `cmdGet()`, `cmdStoreResponse()`, and `indexOffload()` to dispatch correctly based on mode
- **Verified both mem0 modes work end-to-end**:
  - Hosted mode: Successfully adds memories (queued for processing), search/get work
  - Local mode: Groq LLM + Ollama embeddings working, immediate vector storage

#### Discovered
- **mem0ai package has incompatible APIs between hosted and OSS versions**:
  - `mem0ai` (hosted): `add(messages: Array<Message>, options?: MemoryOptions)` with `user_id`
  - `mem0ai/oss` (local): `add(messages: string | Message[], config: AddMemoryOptions)` with `userId`
  - This wasn't documented and caused silent failures (API errors like "Expected a list of items but got type str")
  - Return types also differ: hosted returns `Array<Memory>`, OSS returns `SearchResult` with nested `results`

#### API Signature Reference
```typescript
// Hosted (MemoryClient from mem0ai)
add(messages: Array<{role: "user"|"assistant", content: string}>, options?: {user_id, metadata, ...})
search(query: string, options?: {user_id, limit, ...})
getAll(options?: {user_id, ...})

// Local (Memory from mem0ai/oss)
add(messages: string | Message[], config: {userId, metadata, ...})
search(query: string, config: {userId, limit, ...})
getAll(config: {userId, ...})
```

### 2025-12-13 (Session 7)

#### Completed
- **Fixed sync.ts mem0 integration bug**:
  - Removed broken `getMem0Memory()` function that lacked API key configuration
  - Removed broken `checkMem0Available()` function
  - Updated `rebuild()` to use `indexOffload()` from memory.ts (handles both hosted and local modes correctly)
  - Updated `prune()` to remove reference to deleted functions
- **Verified rebuild now works correctly**:
  - `bun run sync.ts rebuild` successfully indexed 3 cache entries to mem0
  - Confirmed entries visible via `bun run memory.ts get --user "offloads"`
- Committed fix: `05fb17c`

#### Discovered
- **sync.ts had duplicate, incorrect mem0 initialization**: The sync.ts file contained its own `getMem0Memory()` implementation that didn't use the API key from environment and passed strings directly to memory.add() instead of the required `Array<Message>` format. This caused silent failures where rebuild appeared to succeed but entries weren't actually added to mem0.

### 2025-12-13 (Session 8)

#### Completed
- **Debugged SKILL.md "On Activation" section not loading**:
  - Discovered plugin cache reads from master branch, not working directory
  - Uncommitted changes aren't picked up by Claude Code
  - Documented workflow: commit to master, reinstall plugin (clear cache), restart Claude Code
- **Fixed project auto-initialization bug**:
  - Problem: `filter-local` returned 0 results while global had 6 entries
  - Root cause: Launcher returned `project: null` because project directory didn't exist
  - Added `isProjectDirectory()` guard to check for `.git` before initialization
  - Added `getOrCreateProject()` to auto-initialize project on first access
  - Updated `launcher.ts` to auto-create project directory for valid git repos
  - Updated `filter-local` in `memory.ts` to show hint when no local results but global entries exist
- **Successfully tested AskUserQuestion flow** after skill loaded with "On Activation" section
- Committed fix: `5f9f5c2`

#### Decisions
- Auto-initialize project directories only for valid git repos (`.git` guard prevents non-project initialization)
- Show helpful hint in `filter-local` output when no results for current project but global entries exist

#### Discovered
- **Plugin cache invalidation required for SKILL.md updates**: Claude Code caches SKILL.md from master branch. Development workflow requires committing changes to master and clearing plugin cache (`rm -rf ~/.config/claude-code/plugin-cache`) before Claude sees updates.

## Subtasks

### `subtask-session-id-tracking.md` (pending)

**Problem:** Session management uses volatile indices from `gemini --list-sessions`, but gemini-cli assigns persistent UUIDs. When sessions are purged, indices shift and our mappings become invalid.

**Solution:** Track gemini-cli's native `sessionId` UUIDs instead of volatile indices. Map sessionId → index dynamically before resume. Verify session file exists before attempting operations.

**Key findings:**
- gemini-cli stores sessions at `~/.gemini/tmp/{project_hash}/chats/session-*.json`
- Each session file contains persistent `sessionId` (UUID), `projectHash`, `messages[]`
- `gemini --resume` only accepts index or "latest", not sessionId (requires dynamic mapping)
- Session files can be parsed to verify existence and map sessionId to current index

See `subtask-session-id-tracking.md` for full investigation findings and implementation plan.
