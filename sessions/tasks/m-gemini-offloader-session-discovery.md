---
name: m-gemini-offloader-session-discovery
branch: feature/gemini-offloader-session-discovery
status: completed
created: 2025-12-14
---

# Gemini Offloader Session Discovery & Adoption

## Problem/Goal

Sessions created directly via `gemini` CLI or from different contexts are invisible to the skill. Testing revealed 43 gemini-cli sessions exist but only 3 are tracked. Users lose access to valuable research because sessions aren't discoverable or adoptable.

Key issues:
1. No way to discover unmapped gemini-cli sessions
2. No way to adopt/link existing sessions to named mappings
3. Cross-project sessions not visible
4. SKILL.md doesn't document these limitations
5. `filter-local` vs `search` distinction unclear

## Success Criteria

### Core Features
- [x] `session.ts discover` - Scan gemini-cli sessions, show unmapped ones with preview
- [x] `session.ts adopt --index N --name "name"` - Link existing session to named mapping
- [x] `session.ts adopt` indexes session content to mem0/local cache
- [x] Discovery shows sessions across all project contexts (optional `--all-projects` flag)

### Documentation
- [x] SKILL.md documents session tracking limitations
- [x] SKILL.md clarifies `filter-local` (keyword) vs `search` (semantic)
- [x] SKILL.md documents `discover` and `adopt` commands
- [x] SKILL.md explains cross-project session behavior

### Edge Cases
- [x] Handle sessions with no readable content gracefully
- [x] Handle duplicate adoption attempts (session already mapped)
- [x] Show session preview (first prompt + response snippet) in discover output

## Technical Notes

### gemini-cli Session Storage
```
~/.gemini/tmp/{project_hash}/chats/session-{timestamp}-{uuid}.json
```

Session file structure:
```json
{
  "sessionId": "uuid",
  "projectHash": "hash",
  "startTime": "iso",
  "lastUpdated": "iso",
  "messages": [
    {"id": "uuid", "timestamp": "iso", "type": "user|gemini", "content": "..."}
  ]
}
```

### Existing Functions to Leverage
- `listGeminiSessionFiles(projectHash)` in launcher.ts - parses session files
- `getGeminiProjectHash()` - gets current project's gemini hash
- `persistSessionTurn()` - persists to cache + indexes in mem0

### Implementation Approach

**discover command:**
1. Scan all project hashes in `~/.gemini/tmp/`
2. Parse session files, extract sessionId + first prompt
3. Compare against `state.named_sessions` mappings
4. Return unmapped sessions with preview

**adopt command:**
1. Validate session exists (by index or sessionId)
2. Create `SessionMapping` entry in state
3. For each turn in session: call `persistSessionTurn()` to index
4. Return success with turn count indexed

## Context Manifest

### How Session Tracking Currently Works

The gemini-offloader skill provides a persistence layer on top of gemini-cli's native session management. When you create or continue a session through the skill, here's the complete flow:

**Session Creation Flow:**

When a user runs `session.ts create --name "research" --prompt "..."`, the script first calls gemini-cli to create a new session. gemini-cli stores session data at `~/.gemini/tmp/{project_hash}/chats/session-{timestamp}-{uuid_prefix}.json`. Each session file contains:
- `sessionId`: A persistent UUID (e.g., `e028b0d3-80ff-4250-8fe0-84cbe6de2e77`)
- `projectHash`: SHA256 hash of the current working directory
- `messages`: Array of conversation turns
- `startTime` and `lastUpdated`: ISO timestamps

After gemini responds, the skill creates a **SessionMapping** in `~/.config/gemini-offloader/sessions.json` that links the user's friendly name ("research") to the underlying sessionId. This mapping contains:
- `sessionId`: The persistent UUID from gemini's session file
- `sessionFile`: Full path to the session-*.json file
- `geminiProjectHash`: The project hash (for session file lookups)
- `createdAt`: When the mapping was created
- `lastTurn`: Turn counter (incremented on each continue)
- `lastPromptPreview`: First 100 chars of the last prompt

The skill also persists the session turn to `~/.gemini_offloader/projects/{project_hash}/sessions/{session_name}/` with:
- `session.json`: Session metadata including turn count and gemini index
- `full_response-{ISO8601}.md`: The full response from this turn
- `summary.md`: Cumulative summary updated after each turn

Finally, the turn is indexed into mem0 (vector memory) with rich metadata including session name, turn number, timestamp, and project hash. This enables semantic search across all research sessions.

**Session Continuation Flow:**

When continuing a session with `session.ts continue --name "research" --prompt "..."`, the skill:

1. Loads the SessionMapping from `~/.config/gemini-offloader/sessions.json`
2. Resolves the sessionId to the current gemini-cli index by calling `listSessions(geminiPath)` (which parses `gemini --list-sessions` output)
3. Verifies the session still exists in `~/.gemini/tmp/{project_hash}/chats/`
4. If the session was purged, cleans up the stale mapping and returns an error with available sessions
5. If healthy, calls `gemini --resume {index}` with the prompt
6. Persists the new turn to `~/.gemini_offloader/` and indexes in mem0
7. Increments the turn counter in the SessionMapping

This architecture solves a critical problem: gemini-cli assigns **volatile indices** (0, 1, 2...) that shift when sessions are purged, but our skill needs **persistent names**. By tracking sessionId (which never changes) and resolving it to the current index just-in-time, the skill maintains stable session names even as gemini-cli's internal indices shift.

**Why This Matters for Session Discovery:**

Currently, the skill only tracks sessions that were created through `session.ts create`. If a user creates a session directly via `gemini` CLI or from a different tool/context, that session exists in `~/.gemini/tmp/` but has NO entry in `sessions.json`. The user loses access to that research because:
- `session.ts list` only shows sessions in `sessions.json` (not all gemini sessions)
- The skill has no way to "adopt" an existing gemini session into a named mapping
- Cross-project sessions (different project hashes) are invisible
- There's no discovery command to scan for unmapped sessions

The task seeks to add `discover` (scan for unmapped sessions) and `adopt` (create mappings for existing sessions) commands to solve this gap.

### Current State Management Architecture

**State File Locations:**

The skill maintains state in two locations:

1. **Session mappings**: `~/.config/gemini-offloader/sessions.json`
   - Contains `named_sessions` object: `{ [sessionName: string]: number | SessionMapping }`
   - Legacy format: `number` (just an index, volatile)
   - New format: `SessionMapping` object (includes sessionId, persistent)
   - Also tracks `last_used` session info

2. **Skill cache/persistence**: `~/.gemini_offloader/`
   - Per-project directories: `projects/{project_hash}/`
   - Sessions: `projects/{project_hash}/sessions/{session_name}/`
   - Cache: `projects/{project_hash}/cache/{source_hash}/`
   - Global index: `index.json` (fallback when mem0 unavailable)

**gemini-cli Storage Structure:**

gemini-cli stores sessions independently at:
- Base: `~/.gemini/tmp/{gemini_project_hash}/chats/`
- Files: `session-{timestamp}-{uuid_prefix}.json`
- Project hash: SHA256 of current working directory (full hash, not truncated)

The key insight: **gemini-cli's project hash is different from the skill's project hash**. The skill uses `SHA256(git_remote:cwd).slice(0,16)` while gemini uses `SHA256(cwd)` (full hash). This means you can't directly map between the two - you need to compute gemini's hash separately using `getGeminiProjectHash()`.

**Session Resolution Functions:**

The skill has several key functions for working with sessions (all in `state.ts` and `session.ts`):

1. `getGeminiProjectHash(cwd?)`: Computes gemini's project hash (SHA256 of cwd)
2. `listGeminiSessionFiles(geminiProjectHash)`: Scans `~/.gemini/tmp/{hash}/chats/` for session files
3. `parseGeminiSession(filePath)`: Extracts sessionId, projectHash, messages, timestamps from a session file
4. `findSessionFile(sessionId, geminiProjectHash)`: Finds session file by sessionId (searches by UUID prefix in filename)
5. `getMostRecentSession(geminiProjectHash)`: Returns the most recently updated session
6. `sessionIdToIndex(sessionId, geminiProjectHash, geminiPath)`: Resolves sessionId to current index via `gemini --list-sessions`
7. `listSessions(geminiPath)`: Parses `gemini --list-sessions` stderr output to get index, description, sessionId

**How Session Health is Determined:**

In `launcher.ts`, when displaying active sessions, the code checks session health:

```typescript
const geminiSessionIds = new Set(geminiSessions.map(s => s.parsed.sessionId));
const isHealthy = geminiSessionIds.has(sessionMapping.sessionId);
```

Health states:
- `healthy`: sessionId exists in gemini's current sessions
- `stale`: sessionId not found (session was purged)
- `legacy`: Old index-only mapping (no sessionId)

### For New Feature Implementation: What Needs to Connect

**Discover Command Implementation:**

The discover command will scan ALL projects in `~/.gemini/tmp/` (not just the current project) and compare against `state.named_sessions` to find unmapped sessions. Here's what it needs to do:

1. Read all project directories in `~/.gemini/tmp/` to find all gemini-cli sessions across all projects
2. For each session file, parse it to extract sessionId, projectHash, startTime, lastUpdated, and message preview
3. Load the current `sessions.json` to get all tracked SessionMappings
4. Compare: if a sessionId exists in gemini but NOT in `named_sessions`, it's unmapped
5. For unmapped sessions, read the first user message and first gemini response to create a preview
6. Return list of unmapped sessions with index, sessionId, preview, timestamp, project path (derived from projectHash)

The tricky part: **mapping gemini's project hash back to a human-readable path**. gemini uses SHA256(cwd), so you'd need to either:
- Iterate through likely project directories and hash them to match
- Display the hash and let users identify their project
- For `--all-projects` flag, show sessions from all hashes

**Adopt Command Implementation:**

The adopt command creates a SessionMapping for an existing gemini session. It needs to:

1. Accept either `--index N` or `--session-id UUID` to identify the session
2. Accept `--name "friendly-name"` for the mapping
3. Resolve index/sessionId to the actual session file via `findSessionFile()` or session list lookup
4. Parse the session file to get all metadata
5. Create a new SessionMapping in `sessions.json` with:
   - sessionId from the file
   - sessionFile path
   - geminiProjectHash from the file
   - createdAt (use session's startTime)
   - lastTurn (calculate from message count / 2)
   - lastPromptPreview (last user message content)
6. **Critically**: Index all existing turns in mem0 by reading through the messages array and calling `persistSessionTurn()` for each turn
7. Return success with turn count indexed

The mem0 indexing is important because without it, the adopted session won't be semantically searchable. You'll need to iterate through `messages` array, pair user+assistant messages as turns, and index each turn with proper metadata (session_name, turn_number, timestamp, project_hash).

**Cross-Project Session Visibility:**

The `--all-projects` flag for discover means scanning ALL project hashes in `~/.gemini/tmp/`, not just the current project's hash. This requires:
- Reading directory listing of `~/.gemini/tmp/`
- For each project hash directory, scanning its `chats/` subdirectory
- Collecting sessions across all projects
- Annotating each session with its project hash (and potentially resolved project path if possible)

**SKILL.md Documentation Updates:**

The SKILL.md file lives in the plugin and needs comprehensive updates:

1. Add "Session Discovery & Adoption" section explaining the problem (sessions created outside the skill)
2. Document `session.ts discover` command with `--all-projects` flag
3. Document `session.ts adopt` command with `--index`, `--session-id`, `--name` options
4. Explain the difference between tracked and untracked sessions
5. Clarify that `filter-local --session` only finds tracked sessions (not all gemini sessions)
6. Explain `search` (semantic via mem0) vs `filter-local` (keyword/metadata filters)
7. Update the session workflow section to mention discovery as a starting point

**Key Integration Points:**

Where the new code connects to existing systems:

1. `session.ts` will add two new command handlers: `cmdDiscover()` and `cmdAdopt()`
2. Both will import `listGeminiSessionFiles()`, `parseGeminiSession()`, `getGeminiProjectHash()` from `state.ts`
3. `cmdAdopt()` will call `persistSessionTurn()` (already exists) to index historical turns
4. `launcher.ts` may need updates to suggest discover when there are many unmapped sessions
5. The session listing in `cmdList()` could show a hint if unmapped sessions exist
6. The state structure in `sessions.json` won't change (SessionMapping already supports all needed fields)

### Technical Reference Details

#### Key Type Definitions

**SessionMapping** (from state.ts, lines 119-126):
```typescript
export interface SessionMapping {
  sessionId: string;           // gemini-cli's UUID (persistent)
  sessionFile: string;         // Full path to session-*.json
  geminiProjectHash: string;   // gemini-cli's project hash (SHA256 of cwd)
  createdAt: string;           // ISO timestamp
  lastTurn: number;            // Track turn count
  lastPromptPreview: string;   // First 100 chars of last prompt
}
```

**GeminiSessionFile** (from state.ts, lines 131-138):
```typescript
export interface GeminiSessionFile {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messageCount: number;
  lastMessagePreview: string;
}
```

**SessionState** (from session.ts, lines 59-66):
```typescript
interface SessionState {
  named_sessions: Record<string, number | SessionMapping>;
  last_used: {
    session: { type: string; name?: string; index?: number; sessionId?: string };
    timestamp: string;
    prompt_preview: string;
  } | null;
}
```

#### Session File Functions (state.ts)

**getGeminiProjectHash(cwd?: string): string** (lines 690-693)
- Computes gemini-cli's project hash: `SHA256(cwd)` full hash
- Different from skill's project hash which includes git remote

**listGeminiSessionFiles(geminiProjectHash: string)** (lines 783-812)
- Scans `~/.gemini/tmp/{hash}/chats/` for session files
- Returns array of `{ path: string, parsed: GeminiSessionFile }`
- Sorted by timestamp (most recent first)

**parseGeminiSession(filePath: string)** (lines 754-778)
- Reads session JSON file and extracts metadata
- Returns `GeminiSessionFile` or null if invalid

**findSessionFile(sessionId: string, geminiProjectHash: string)** (lines 707-749)
- Searches for session file by sessionId
- Fast path: matches UUID prefix in filename
- Fallback: scans all session files

**getMostRecentSession(geminiProjectHash: string)** (lines 817-832)
- Returns most recently updated session
- Used after `session.ts create` to capture the new session

**persistSessionTurn(args)** (session.ts, lines 445-497)
- Persists turn to `~/.gemini_offloader/projects/{hash}/sessions/{name}/`
- Indexes in mem0 with OffloadMetadata
- Returns `{ persisted: boolean, indexed: boolean, turnNumber: number }`

#### Session Resolution Functions (session.ts)

**listSessions(geminiPath: string)** (lines 136-171)
- Calls `gemini --list-sessions` and parses stderr output
- Extracts index, description, and sessionId from each line
- Returns array of `SessionInfo` objects

**sessionIdToIndex(sessionId, geminiProjectHash, geminiPath)** (lines 200-221)
- Resolves sessionId to current index by calling `listSessions()`
- Returns `{ index: number, sessionFile: string }` or null if not found
- This is the KEY function for persistent session tracking

**resolveSessionMapping(mapping, geminiPath)** (lines 227-271)
- Handles both legacy (number) and new (SessionMapping) formats
- Returns resolved index and health status
- Used by `cmdContinue` to verify session exists before resuming

#### File Locations

**Implementation files:**
- Add discover/adopt commands: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/session.ts`
- Session state utilities: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/state.ts`
- Memory indexing: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/memory.ts`
- Launcher integration: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/scripts/launcher.ts`

**Documentation:**
- Update SKILL.md: `/home/gulp/projects/tinymade-skills/plugins/gemini-offloader/skills/gemini-offloader/SKILL.md`

**State files (runtime):**
- Session mappings: `~/.config/gemini-offloader/sessions.json`
- Skill cache: `~/.gemini_offloader/projects/{hash}/`
- gemini sessions: `~/.gemini/tmp/{gemini_project_hash}/chats/session-*.json`

#### Example Session File Structure

From actual session file at `~/.gemini/tmp/{hash}/chats/session-2025-12-13T12-18-e028b0d3.json`:

```json
{
  "sessionId": "e028b0d3-80ff-4250-8fe0-84cbe6de2e77",
  "projectHash": "f9811188e2c6d3d518cfb9287e9477dee415fe2d8435314e6aae644a98dd5cdb",
  "startTime": "2025-12-13T12:18:00.000Z",
  "lastUpdated": "2025-12-13T12:18:30.000Z",
  "messages": [
    {
      "id": "msg_001",
      "timestamp": "2025-12-13T12:18:00.000Z",
      "type": "user",
      "content": "Research WebAssembly for server-side use"
    },
    {
      "id": "msg_002",
      "timestamp": "2025-12-13T12:18:25.000Z",
      "type": "gemini",
      "content": "WebAssembly (WASM) for server-side..."
    }
  ]
}
```

#### Discovery Algorithm

Pseudocode for `cmdDiscover()`:

```typescript
async function cmdDiscover(opts: { allProjects?: boolean }) {
  // 1. Get current project's gemini hash
  const currentProjectHash = getGeminiProjectHash();

  // 2. Load existing session mappings
  const state = await loadState();
  const trackedSessionIds = new Set(
    Object.values(state.named_sessions)
      .filter(m => !isLegacyMapping(m))
      .map(m => m.sessionId)
  );

  // 3. Scan gemini sessions
  const projectHashes = opts.allProjects
    ? listProjectHashesInGeminiDir()  // All projects
    : [currentProjectHash];            // Current project only

  const unmappedSessions = [];

  for (const projectHash of projectHashes) {
    const sessions = await listGeminiSessionFiles(projectHash);

    for (const { path, parsed } of sessions) {
      if (!trackedSessionIds.has(parsed.sessionId)) {
        // Extract preview (first user message + response snippet)
        const preview = await extractSessionPreview(path);
        unmappedSessions.push({
          sessionId: parsed.sessionId,
          projectHash: parsed.projectHash,
          sessionFile: path,
          startTime: parsed.startTime,
          lastUpdated: parsed.lastUpdated,
          messageCount: parsed.messageCount,
          preview
        });
      }
    }
  }

  // 4. Return unmapped sessions
  return {
    action: "discover",
    unmapped_sessions: unmappedSessions,
    total_gemini_sessions: totalCount,
    total_tracked_sessions: trackedSessionIds.size,
    success: true
  };
}
```

#### Adoption Algorithm

Pseudocode for `cmdAdopt()`:

```typescript
async function cmdAdopt(args: {
  index?: number;
  sessionId?: string;
  name: string
}) {
  const geminiPath = await findGemini();
  const geminiProjectHash = getGeminiProjectHash();

  // 1. Resolve to session file
  let sessionFile: string;
  let sessionId: string;

  if (args.sessionId) {
    sessionFile = await findSessionFile(args.sessionId, geminiProjectHash);
  } else if (args.index !== undefined) {
    const sessions = await listSessions(geminiPath);
    const session = sessions.find(s => s.index === args.index);
    sessionId = session.sessionId;
    sessionFile = await findSessionFile(sessionId, geminiProjectHash);
  }

  // 2. Parse session file
  const parsed = await parseGeminiSession(sessionFile);

  // 3. Create SessionMapping
  const mapping: SessionMapping = {
    sessionId: parsed.sessionId,
    sessionFile,
    geminiProjectHash,
    createdAt: parsed.startTime,
    lastTurn: Math.ceil(parsed.messageCount / 2),
    lastPromptPreview: parsed.lastMessagePreview
  };

  // 4. Save mapping
  const state = await loadState();
  state.named_sessions[args.name] = mapping;
  await saveState(state);

  // 5. Index historical turns in mem0
  const sessionData = await Bun.file(sessionFile).json();
  const turns = pairMessagesIntoTurns(sessionData.messages);

  let indexedCount = 0;
  for (const turn of turns) {
    await persistSessionTurn({
      sessionName: args.name,
      prompt: turn.userMessage,
      response: turn.geminiMessage,
      geminiIndex: args.index || 0,
      isNewSession: false
    });
    indexedCount++;
  }

  return {
    action: "adopt",
    session_name: args.name,
    sessionId: parsed.sessionId,
    turns_indexed: indexedCount,
    success: true
  };
}
```

### Edge Cases & Error Handling

**Session file doesn't exist:**
- `findSessionFile()` returns null
- Return error: "Session not found in gemini's storage"

**Duplicate adoption:**
- Check if sessionId already in `state.named_sessions`
- Return error: "Session already mapped as '{existing_name}'"

**Session with no messages:**
- Handle gracefully in preview extraction
- Show "(empty session)" in preview

**Cross-project hash resolution:**
- gemini's projectHash is SHA256(cwd)
- Can't easily reverse to path
- Option 1: Show hash and let user identify
- Option 2: Attempt to match against known project directories
- Option 3: Show session content preview for identification

**Legacy index-only mappings:**
- Can't discover if user has legacy mappings (no sessionId)
- Suggest running `session.ts migrate` first
- Filter out legacy sessions when checking for duplicates

## User Notes
Discovered during skill testing. User had "sentient design" research in a warm session but couldn't find it via `filter-local` because the session was created outside the skill's tracking.

## Work Log
- [2025-12-14] Task created from gap analysis during skill testing
- [2025-12-14] Implementation complete:
  - Added `listAllProjectHashes()` and `extractSessionPreview()` helpers to state.ts
  - Implemented `cmdDiscover()` - scans all gemini sessions, shows unmapped with preview
  - Implemented `cmdAdopt()` - creates SessionMapping and indexes historical turns in mem0
  - Added command routing with `--all-projects`, `--session-id`, `--project-hash` flags
  - Updated SKILL.md with discover/adopt docs, tracking limitations, filter-local vs search clarification
