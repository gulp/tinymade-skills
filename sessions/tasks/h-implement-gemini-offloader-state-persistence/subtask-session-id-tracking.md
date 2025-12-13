---
name: subtask-session-id-tracking
parent: h-implement-gemini-offloader-state-persistence
status: pending
created: 2025-12-13
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

- [ ] Add `getGeminiProjectHash()` function to state.ts
- [ ] Add `findSessionFile()` function to session.ts
- [ ] Add `parseGeminiSession()` function to session.ts
- [ ] Add `sessionIdToIndex()` resolver to session.ts
- [ ] Update `SessionState` interface with new fields
- [ ] Modify `createSession()` to capture sessionId after creation
- [ ] Modify `continueSession()` to use sessionId → index resolution
- [ ] Add session existence verification before resume
- [ ] Update state persistence to store sessionId
- [ ] Add migration for existing state files (add sessionId field)
- [ ] Update diagnostic messages with sessionId info
- [ ] Test with session purge scenarios

## Success Criteria

- [ ] Sessions can be resumed reliably even after gemini-cli purges other sessions
- [ ] SessionId stored in our state, not just volatile index
- [ ] Session existence verified before resume attempt
- [ ] Proper error messages when session truly gone (with recovery suggestions)
- [ ] No more "wrong session resumed" bugs

## Files to Modify

- `plugins/gemini-offloader/skills/gemini-offloader/scripts/session.ts`
- `plugins/gemini-offloader/skills/gemini-offloader/scripts/state.ts`
- `plugins/gemini-offloader/skills/gemini-offloader/scripts/launcher.ts` (surface sessionIds)

## References

- gemini-cli session storage: `~/.gemini/tmp/{project_hash}/chats/`
- Session file format: JSON with sessionId, projectHash, messages[]
- gemini-cli resume: Only supports index or "latest", not sessionId
