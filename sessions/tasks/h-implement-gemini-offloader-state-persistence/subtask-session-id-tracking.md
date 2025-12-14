---
name: subtask-session-id-tracking
parent: h-implement-gemini-offloader-state-persistence
status: completed
created: 2025-12-13
completed: 2025-12-14
---

# Subtask: Track Gemini-CLI Native Session IDs

## Problem

Our current session management uses **volatile indices** from `gemini --list-sessions`, but gemini-cli assigns persistent **UUIDs** to sessions. When sessions are purged or indices shift, our stored mappings become invalid, causing "stale_session" errors.

### Current State (Broken)

```typescript
// session.ts stores only volatile index
interface SessionState {
  named_sessions: Record<string, number>;  // name → index (volatile!)
  last_used: {...} | null;
}
```

When user runs `session.ts continue --name "wasm-research"`:
1. We look up `named_sessions["wasm-research"]` → index `0`
2. We run `gemini --resume 0`
3. But session 0 may have been purged, or index shifted
4. Result: Wrong session resumed or "stale_session" error

## Investigation Findings

### Gemini-CLI Storage Structure

```
~/.gemini/tmp/{project_hash}/
├── logs.json                    # Recent interactions with sessionId
└── chats/
    └── session-{timestamp}-{uuid_prefix}.json
```

### Session File Format

```json
// ~/.gemini/tmp/{hash}/chats/session-2025-12-13T12-18-e028b0d3.json
{
  "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77",  // PERSISTENT UUID
  "projectHash": "f9811188e2c6d3d518cfb9287e9477dee415fe2d8435314e6aae644a98dd5cdb",
  "startTime": "2025-12-13T12:18:50.030Z",
  "lastUpdated": "2025-12-13T12:18:50.031Z",
  "messages": [
    {
      "id": "047c6376-7cd8-4d19-b9f1-74f4a2f2e515",
      "timestamp": "2025-12-13T12:18:50.031Z",
      "type": "user",
      "content": "..."
    }
  ]
}
```

### Key Discovery: Session Identification

| Field | Location | Persistence | Use Case |
|-------|----------|-------------|----------|
| `sessionId` | session-*.json | Persistent (UUID) | Unique identifier |
| `index` | --list-sessions output | Volatile | Resume command |
| `sessionFile` | chats/ directory | Persistent (path) | Existence check |
| `projectHash` | tmp/{hash}/ | Persistent | Project scope |

### Gemini-CLI Resume Limitations

```bash
# What gemini-cli supports:
gemini --resume latest     # Most recent session
gemini --resume 0          # By index (volatile!)
gemini --resume 5          # By index

# What it DOESN'T support:
gemini --resume e028b0d3-80ff-4250-8fe0-84cbe6de2e77  # By sessionId (not supported)
```

## Solution Design

### Enhanced SessionState Interface

```typescript
interface SessionState {
  named_sessions: Record<string, {
    sessionId: string;         // gemini-cli's UUID (persistent)
    sessionFile: string;       // Full path to session-*.json
    projectHash: string;       // gemini-cli's project hash
    createdAt: string;         // ISO timestamp
    lastTurn: number;          // Track turn count
    lastPromptPreview: string; // First 100 chars of last prompt
  }>;
  last_used: {
    session: { type: string; name?: string; sessionId?: string };
    timestamp: string;
    prompt_preview: string;
  } | null;
}
```

### New Functions Required

```typescript
// 1. Get gemini-cli's project hash for current directory
function getGeminiProjectHash(cwd: string): string {
  // gemini-cli uses SHA256 of absolute path
  return crypto.createHash('sha256').update(cwd).digest('hex');
}

// 2. Find session file by sessionId
function findSessionFile(sessionId: string, projectHash: string): string | null {
  const chatsDir = join(homedir(), '.gemini', 'tmp', projectHash, 'chats');
  // Find session-*.json containing this sessionId
  // Return full path or null if not found
}

// 3. Parse gemini session file
function parseGeminiSession(filePath: string): {
  sessionId: string;
  startTime: string;
  messageCount: number;
  lastMessage: string;
} | null {
  // Read and parse session-*.json
}

// 4. Map sessionId to current index (dynamic)
async function sessionIdToIndex(
  sessionId: string,
  geminiPath: string
): Promise<number | null> {
  // 1. Run `gemini --list-sessions`
  // 2. For each listed session, find its session file
  // 3. Parse to get sessionId
  // 4. Return index if match found
}

// 5. Verify session still exists
function verifySessionExists(sessionId: string, projectHash: string): boolean {
  const sessionFile = findSessionFile(sessionId, projectHash);
  return sessionFile !== null && existsSync(sessionFile);
}
```

### Improved Resume Flow

```
User: session.ts continue --name "wasm-research"
                │
                ▼
┌─────────────────────────────────────┐
│ 1. Load our state                   │
│    Get sessionId for "wasm-research"│
│    sessionId = "e028b0d3-..."       │
└─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────┐
│ 2. Verify session file exists       │
│    Check ~/.gemini/tmp/{hash}/chats/│
│    for session-*-e028b0d3.json      │
└─────────────────────────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
   EXISTS           NOT EXISTS
        │               │
        ▼               ▼
┌───────────────┐ ┌─────────────────────┐
│ 3. Find index │ │ Return stale_session│
│ by sessionId  │ │ with diagnostics    │
│ via list+parse│ └─────────────────────┘
└───────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ 4. Resume with verified index       │
│    gemini --resume {index} -p "..." │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ 5. After success, update state      │
│    - Capture new sessionId if new   │
│    - Update lastTurn, timestamp     │
└─────────────────────────────────────┘
```

### Edge Cases to Handle

1. **Session file exists but not in --list-sessions**
   - gemini-cli may have internal limits
   - Fallback: Create new session, warn user

2. **Multiple sessions match prompt content**
   - Use sessionId as authoritative identifier
   - Don't rely on content matching

3. **Project hash mismatch**
   - User changed directories
   - Store project path, verify before resume

4. **Index resolution race condition**
   - Between list and resume, session could be purged
   - Catch error, re-resolve, retry once

## Implementation Tasks

- [x] Add `getGeminiProjectHash()` function to state.ts
- [x] Add `findSessionFile()` function to state.ts
- [x] Add `parseGeminiSession()` function to state.ts
- [x] Add `sessionIdToIndex()` resolver to session.ts
- [x] Update `SessionState` interface with new fields
- [x] Modify `cmdCreate()` to capture sessionId after creation
- [x] Modify `cmdContinue()` to use sessionId → index resolution
- [x] Add session existence verification before resume
- [x] Update state persistence to store sessionId
- [x] Add migration command (`cmdMigrate()`)
- [x] Update diagnostic messages with sessionId info
- [x] E2E test all session flows
- [x] Surface sessionId info to users via launcher.ts
- [x] Document migrate command in SKILL.md

## Success Criteria

- [x] Sessions resume reliably after gemini-cli purges other sessions
- [x] SessionId stored persistently (not volatile index)
- [x] Session existence verified before resume
- [x] Clear error messages with recovery suggestions
- [x] No "wrong session resumed" bugs

## Work Log

### 2025-12-14 (Session 1: SessionId Implementation)

#### Completed
- Implemented sessionId-based session tracking in session.ts and state.ts
- Fixed bug: `listSessions` was reading stdout instead of stderr
- Fixed bug: `sessionIdToIndex` had incorrect index mapping (oldest-first vs newest-first mismatch)
- E2E tested all flows: create, list, continue, stale detection, migration
- Updated launcher.ts to surface sessionId and session health status
- Updated SKILL.md with migrate command and sessionId transparency
- Merged all commits to master via fast-forward

#### Commits
- `767f789` - feat(gemini-offloader): implement sessionId-based session tracking
- `e3efdf4` - fix(gemini-offloader): fix listSessions stderr and sessionIdToIndex mapping
- `c2e3b9d` - feat(gemini-offloader): surface sessionId info to users
- `b9acf1c` - chore: update mcp and sessions config

### 2025-12-14 (Session 2: Mem0 Entity Model Restructuring)

#### Completed
- Investigated mem0 field usage: found 40 memories under user_id="offloads" from prior field agent work
- Read mem0 documentation on memory types (short-term vs long-term) and entity-scoped memory
- Restructured memory.ts to use proper entity model:
  - `agent_id`: "gemini-offloader" (cross-project agent knowledge)
  - `user_id`: project_hash (project-specific context)
  - `run_id`: session_name (short-term session context, when applicable)
- Added scoped search functions: `searchScoped()`, `getAllScoped()`
- Added CLI commands: `search-scoped`, `get-scoped`, `migrate-legacy`
- Fixed .mcp.json trailing comma issue

#### Decisions
- Use entity-scoped memory model instead of monolithic "offloads" user_id
- Store project_hash as user_id for project-level scoping
- Use session_name as run_id for ephemeral session context
- Preserve all metadata fields for future migration flexibility
- Legacy memories under "offloads" remain accessible via migration command

#### Discovered
- mem0 hosted API stores user_id correctly but agent_id may not be supported in current tier
- Metadata preserves all critical fields (project_hash, session_name, source_hash, etc.)
- Local index and mem0 serve different purposes: local = audit trail, mem0 = semantic search
- Mem0 extracts multiple semantic chunks from single offload (e.g., 15 memories from blog analysis)

## Technical References

### Gemini-CLI Session Management
- Session storage: `~/.gemini/tmp/{project_hash}/chats/`
- Session file format: JSON with sessionId, projectHash, messages[]
- Resume command: Only supports index or "latest", not sessionId
- List output: stderr (not stdout), oldest-first ordering
- SessionId: Full UUID, filename uses first 8 chars as prefix

### Mem0 Entity Model
- `agent_id`: Agent's cross-project knowledge (may require enterprise tier)
- `user_id`: Project/user-specific context (confirmed working in hosted tier)
- `run_id`: Ephemeral session/workflow context (short-term memory)
- `metadata`: Preserved fields for custom filtering and migration
- API differences: Hosted uses snake_case, OSS uses camelCase

## Next Steps

- Test agent_id support in production (may need tier upgrade)
- Monitor memory extraction quality across different offload types
- Consider implementing custom categories for better semantic organization

---

## Context Manifest: Critical Discoveries for Future Implementers

### Discovered During Implementation
[Date: 2025-12-14 / Sessions 1-2]

This section documents critical discoveries that significantly changed our understanding of both gemini-cli session management and mem0 memory architecture. Future work on state persistence MUST consider these findings.

#### Discovery 1: Mem0 Entity Model Architecture (Session 2)

**What we thought:** Mem0 is a simple semantic memory store where you dump content under a `user_id`.

**What we discovered:** Mem0 implements a **multi-dimensional entity scoping model** with four orthogonal dimensions:

1. **`agent_id`**: Agent's accumulated knowledge across ALL projects
   - Purpose: Cross-project learning (e.g., "TypeScript patterns the agent has learned work well")
   - Persistence: Forever, spans all users/projects
   - **Critical limitation**: May require enterprise tier on hosted API (free tier rejected agent_id in testing)

2. **`user_id`**: Project or user-specific context
   - Purpose: Long-lived facts scoped to one project/user (e.g., "this codebase uses Deno")
   - Persistence: Long-term, project-scoped
   - **Best practice**: Use `project_hash` as the user_id value for project-level scoping

3. **`run_id`**: Ephemeral session/workflow context
   - Purpose: Short-term memory for multi-turn workflows (e.g., "currently researching WebAssembly")
   - Persistence: Minutes to hours, session-specific
   - **Best practice**: Use `session_name` from gemini-cli sessions

4. **`app_id`**: Application-level organizational scope
   - Less relevant for single-agent use cases

**Why this matters:** The original implementation used a flat `user_id: "offloads"` for everything, creating a monolithic bucket of 40+ memories with no scoping. This prevented:
- Distinguishing agent knowledge from project facts
- Querying session-specific context separately
- Leveraging mem0's multi-dimensional retrieval capabilities
- Clean separation between permanent and ephemeral knowledge

**Corrected pattern:**
```typescript
// GOOD: Entity-scoped
await memory.add(messages, {
  agent_id: "gemini-offloader",      // Agent learns across projects
  user_id: metadata.project_hash,     // Project-specific facts
  run_id: metadata.session_name,      // Ephemeral session context
  metadata: metadata                  // Full tracking
});

// BAD: Flat monolithic bucket
await memory.add(messages, {
  user_id: "offloads",               // Everything lumped together
  metadata: metadata
});
```

**Tier limitations discovered:**
- Free/starter tiers: Only `user_id` + `run_id` confirmed working
- `agent_id` may require enterprise tier (rejected with error in testing)
- Implementation should detect and gracefully degrade

#### Discovery 2: Semantic Chunking Behavior (Session 2)

**What we thought:** One offload → one memory in mem0.

**What we discovered:** Mem0 **semantically extracts multiple discrete facts** from each input. For example:

- 1560 token blog analysis → **15 separate memories** (tone, structure, pacing, voice, etc.)
- 1424 token evaluation → **7 memories**
- 337 token session → **10 memories**

**Why this matters:**
- Local index: 14 entries (1 per offload interaction)
- Mem0 count: 40 memories (semantic chunks across those 14 interactions)
- **UX impact**: Showing "40 memories" vs "14 offloads" confuses users
- **Retrieval impact**: Query results may return multiple chunks from same source

**Implication for future implementation:**
- Design UX around "offloads" not "memories" (users don't understand semantic chunking)
- Group results by `source_hash` when displaying search results
- Metadata preservation is critical for deduplication and grouping

**Filtering behavior:**
- Trivial responses automatically filtered (e.g., test inputs "Four", "Six", "Ten" not indexed)
- Mem0 intelligently skips non-semantic content
- Don't rely on every input creating memories

#### Discovery 3: Legacy Memory Migration Requirement (Session 2)

**Context:** Existing production system has **40 memories stored under `user_id: "offloads"`** from prior work.

**Problem:** These memories used the flat monolithic pattern and need migration to entity-scoped model.

**Migration strategy discovered:**
1. Cannot simply re-scope existing memories (mem0 API doesn't support update)
2. Must list, parse metadata, re-index with correct scoping, then delete originals
3. **Risk**: Losing original memory IDs and creation timestamps
4. **Mitigation**: Preserve via metadata fields before migration

**Decision made:** Provide `migrate-legacy` command for users to upgrade at their discretion, don't auto-migrate (destructive operation).

#### Discovery 4: Metadata Preservation is Robust (Session 2)

**What we verified:** All critical tracking fields survive the mem0 round-trip intact:

```typescript
// Fields confirmed preserved:
- project_hash, project_path
- session_name, turn_number
- source_hash, source_path, source_type
- prompt_hash, timestamp
- token_count, model, type
- response_file
```

**Why this matters:** Enables future migration, deduplication, and advanced queries without data loss. Even though mem0 semantically chunks content, metadata stays attached to every chunk.

#### Discovery 5: Gemini-CLI List Output Quirks (Session 1)

**Bug discovered:** `gemini --list-sessions` writes to **stderr**, not stdout.

**What broke:** `listSessions()` was reading stdout → empty results

**Fix:** Changed to read stderr

**Index ordering discovered:** Sessions listed **oldest-first** (index 0 = oldest), not newest-first as initially assumed.

**What broke:** `sessionIdToIndex()` mapped incorrectly

**Fix:** Reversed index calculation

**Implication:** Future implementations must parse stderr and understand oldest-first ordering.

#### Discovery 6: Local Index vs Mem0 Serve Different Purposes (Session 2)

**What we clarified:**

| System | Purpose | Persistence | Query Type |
|--------|---------|-------------|------------|
| Local index (index.json) | **Audit trail**, exact offload tracking | Append-only JSON | Chronological, source_hash lookup |
| Mem0 | **Semantic search**, knowledge retrieval | Vector-based semantic store | Natural language queries |

**Why both are needed:**
- Local index: Guarantees every offload is tracked (mem0 may filter trivial content)
- Mem0: Enables "what did I learn about X?" queries across semantic chunks
- Local index: Fast project-hash filtering without API calls
- Mem0: Cross-project agent knowledge queries

**Anti-pattern:** Treating them as redundant backups. They're complementary.

#### Discovery 7: Custom Categories and Instructions (Session 2)

**Documentation revealed:** Mem0 supports project-level configuration:

- **Custom categories**: Domain-specific labels (e.g., "api_design", "performance_insights")
- **Custom instructions**: Natural language extraction guidance (e.g., "Extract user pain points separately from feature requests")

**Limitation discovered:** Configured via mem0 dashboard, **not in code**.

**Implication:** Future enhancement could suggest project-specific categories based on usage patterns, but requires manual dashboard configuration.

#### Discovery 8: SessionId Transparency Critical for UX (Session 1)

**User feedback point:** Users need to see sessionIds to debug stale session errors.

**Fix implemented:** Surface sessionId in launcher.ts output:
```
Session: wasm-research (ID: e028b0d3-80ff-4250-8fe0-84cbe6de2e77)
Health: ✓ Valid
```

**Why this matters:** Without sessionId visibility, users couldn't diagnose why resume failed. "Stale session" errors were opaque.

---

### Future Implementation Checklist

When working on memory/session persistence, future developers MUST:

- [ ] Use entity-scoped model (agent_id, user_id, run_id), never flat user_id
- [ ] Handle tier limitations gracefully (agent_id may not work, fallback to user_id only)
- [ ] Design UX around "offloads" not "memories" (semantic chunking confuses users)
- [ ] Group search results by source_hash to avoid duplicate-looking entries
- [ ] Provide migration tools for legacy data, never auto-migrate destructively
- [ ] Parse gemini --list-sessions from **stderr**, not stdout
- [ ] Remember index 0 = **oldest** session, not newest
- [ ] Surface sessionIds in user-facing output for debugging
- [ ] Preserve all metadata fields for future flexibility
- [ ] Understand local index and mem0 serve different purposes (don't treat as redundant)
- [ ] Test semantic chunking behavior on real offloads (count may surprise you)

### Architecture Decision Record

**ADR: Why Entity-Scoped Memory Model**

**Decision:** Use mem0's multi-dimensional entity model (agent_id, user_id, run_id) instead of flat user_id scoping.

**Context:** Original implementation used `user_id: "offloads"` for all memories, discovered mem0 supports sophisticated entity scoping.

**Consequences:**
- **Positive:**
  - Can query agent knowledge separately from project facts
  - Session context automatically expires with run_id
  - Aligns with mem0 best practices
  - Enables future cross-project learning features

- **Negative:**
  - Requires migration of 40 existing memories
  - agent_id may not work in all pricing tiers
  - More complex API calls (3 entity fields vs 1)
  - Must maintain backwards compatibility during migration

**Status:** Accepted. Implementation in progress with graceful degradation for tier limitations.
