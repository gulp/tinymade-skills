---
name: m-fix-initializer-critical-issues
branch: fix/initializer-critical-issues
status: pending
created: 2025-12-15
---

# Fix Critical Issues in Initializer CLI

## Problem/Goal

The code review of the parallel agent coordination system (`initializer` CLI) identified 2 critical issues that need to be fixed before the system can be considered production-ready:

1. **Race condition in directory creation**: `mkdirSync` without EEXIST handling can fail when multiple agents write status simultaneously
2. **Missing cleanup integration**: The `cleanupTempFiles()` utility was implemented but never integrated into the commands, allowing orphaned temp files to accumulate

Additionally, there are 5 warnings and 4 suggestions from the code review that should be documented for future work.

## Success Criteria

- [ ] Fix race condition in `state.ts:atomicWriteStatus()` - wrap mkdirSync in try-catch for EEXIST
- [ ] Integrate cleanup utility into monitor startup and show command
- [ ] Verify atomic write safety with explicit fsync consideration
- [ ] Add input validation for task names to prevent path traversal
- [ ] Document remaining warnings and suggestions in task notes

## Context Manifest

### How the Initializer Parallel Agent Coordination System Works

The `initializer` CLI is a standalone Bun-based TypeScript application that enables multiple autonomous Claude agents running in separate git worktrees to report their status back to a central orchestrator. This is a critical piece of infrastructure that allows parallel development workflows where agents work independently on different tasks while maintaining visibility and coordination.

**The Big Picture - Multi-Agent Orchestration Flow:**

When a developer on the main branch wants to parallelize work across multiple tasks, they use the `worktree-orchestrator` skill to spawn separate Claude instances in git worktrees. Each worktree is isolated - it has its own `.git` file (pointing to the main repo's `.git/worktrees/` directory), its own branch, and its own `sessions/sessions-state.json` file. This isolation is intentional: it allows agents to work autonomously without interfering with each other's state.

However, isolation creates a visibility problem. The orchestrator on the main branch cannot see what agents are doing, whether they're blocked, or what progress they've made. This is where the `initializer` system bridges the gap.

**The Three-Layer Architecture:**

1. **Agent Layer (Worktrees)**: Each autonomous Claude agent working in `.trees/feature-xyz/` uses the `initializer status` command to report progress. When an agent completes a milestone, runs tests, or gets blocked, it calls: `initializer status "description" --tests passed --todos 3/7`. The agent-status skill (loaded into the agent's context via `SKILL.md`) proactively triggers this reporting after significant work.

2. **Persistence Layer (Shared State)**: Status reports are written to `.trees/.state/{task-name}.status.json` files in the MAIN repository (not the worktree). This is the critical coordination mechanism - all agents write to different files (keyed by task name) in a shared directory that the orchestrator can read. The atomic write pattern (temp file + rename) prevents corruption when multiple agents report simultaneously.

3. **Orchestrator Layer (Main Branch)**: The orchestrator reads all status files using `initializer show` (snapshot view) or `initializer monitor` (real-time TUI dashboard). The agent-monitor skill provides wrapper scripts and instructs when to check agent status. The TUI updates every 2 seconds, displaying status badges (ACTIVE/BLOCKED/STALE), test results, todo progress bars, and git diff statistics.

**Context Detection - How Commands Know Their Role:**

The `initializer` CLI detects whether it's running as an agent or orchestrator by examining the filesystem. In `context.ts` (lines 21-76), the `detectContext()` function checks the `.git` path:

- If `.git` is a FILE (contains `gitdir: /path/to/main/.git/worktrees/branch-name`), we're in a worktree → agent context. The function parses this file to find the main repo's project root (needed to write status files to the shared `.trees/.state/` directory). It also extracts the branch name from the worktree path (folder name with hyphens converted to slashes) and infers the task name by stripping common prefixes like `feature/` or `fix/`.

- If `.git` is a DIRECTORY and `.trees/` exists, we're in the main repo → orchestrator context. The project root is the current directory.

This automatic detection means agents and orchestrators use the same CLI commands but behave differently based on context.

**The Status Reporting Flow - From Agent to Orchestrator:**

When an agent in `.trees/feature-auth/` runs `initializer status "Implementing JWT validation" --tests passed --todos 3/7`, here's the complete execution path:

1. **Command Entry** (`index.ts` lines 70-123): The main function parses arguments using `minimist`, extracting flags like `--tests`, `--todos`, `--blocked`, `--reason`, and `--task`. The command name (`status`) routes to `statusCommand()` in `commands/status.ts`.

2. **Context Detection** (`status.ts` lines 34-61): The command calls `detectContext()` to determine the task name, project root, and worktree path. If `--task` flag isn't provided, it uses the auto-detected task name from the branch. If it can't determine the task name or project root, it throws an error with guidance.

3. **Data Collection** (`status.ts` lines 63-90): The command parses and validates inputs:
   - `parseTestStatus()` converts strings like "passed", "pass", "failed", "fail", "unknown" to the `TestStatus` enum
   - `parseTodos()` parses "X/Y" format (e.g., "3/7") into completed and total integers
   - `getDiffStats()` shells out to `git diff --numstat origin/main` (or origin/master, main, master as fallbacks) to calculate additions/deletions. This runs asynchronously and can return null if git commands fail.

4. **Status Object Construction** (`status.ts` lines 92-105): Builds an `AgentStatus` object with all collected data plus the current ISO 8601 timestamp. The `diff_stats` field uses the result from `getDiffStats()` - this is critical because it shows the orchestrator how much code each agent has produced.

5. **Atomic Write** (`state.ts` lines 28-58): The `atomicWriteStatus()` function implements the temp file + rename pattern that prevents corruption:
   - **Directory Creation** (lines 32-36): THIS IS WHERE CRITICAL ISSUE #1 EXISTS. The code checks if the state directory exists with `existsSync()`, then creates it with `mkdirSync(dir, { recursive: true })`. The problem: if two agents call this simultaneously, both might pass the `existsSync()` check, then both try to create the directory. Without EEXIST error handling, one will crash.
   - **Temp File Write** (lines 38-43): Creates a unique temp file with process PID suffix (e.g., `m-auth.status.json.tmp.12345`), then uses `Bun.write()` to write the JSON string. The comment says "Bun.write flushes by default" - this is WARNING #1 from the code review because Bun's flush guarantees need verification. True durability requires explicit fsync before rename.
   - **Atomic Rename** (line 46): Uses Node's synchronous `renameSync()` which is atomic on POSIX systems. The rename is the critical guarantee - if this succeeds, the status file update is visible to all readers atomically.
   - **Cleanup on Error** (lines 48-56): If anything fails, tries to delete the temp file (ignoring cleanup errors). This prevents orphaned temp files from accumulating.

6. **Confirmation Output** (`status.ts` lines 111-125): Prints a human-readable summary to the agent's terminal showing what was reported.

**The Orchestrator Read Flow - Aggregating Status:**

When the orchestrator runs `initializer show` (or the monitor TUI polls), the read flow is:

1. **Context Detection** (`show.ts` lines 138-145): Verifies we're in the project root (main repo with `.trees/` directory).

2. **Reading All Statuses** (`state.ts` lines 78-98): The `readAllStatuses()` function scans the `.trees/.state/` directory, filters for files matching `*.status.json` (excluding `*.tmp.*` temp files), and calls `readStatus()` for each. The read function wraps JSON parsing in try-catch, returning null for corrupted files (graceful degradation).

3. **Aggregation and Display** (`show.ts` lines 76-132): The `printTable()` function calculates summary statistics (active/blocked/stale counts), sorts agents (blocked first, then active, then stale, then by last update time), and renders a formatted table with:
   - State indicators: emoji badges (red circle for BLOCKED, white circle for STALE, green circle for ACTIVE)
   - Test status: checkmark (passed), X (failed), question mark (unknown)
   - Progress bars: rendered as Unicode block characters showing todos_completed/todos_total
   - Diff stats: "+X -Y" showing git diff statistics
   - Time ago: human-readable relative time since last update ("5m ago", "2h ago", etc.)

The stale detection (lines 23-29) checks if `now - last_update >= STALE_THRESHOLD_HOURS` (hardcoded to 2). This is WARNING #4 - the threshold should be configurable.

**The Monitor TUI - Real-Time Coordination:**

The `initializer monitor` command (`commands/monitor.ts`) implements a real-time dashboard using raw ANSI escape codes (no external dependencies). The architecture:

1. **Initialization** (lines 178-198): Detects project root, sets up cleanup handlers for SIGINT/SIGTERM (shows cursor and exits cleanly), hides the terminal cursor for a clean TUI experience.

2. **Refresh Loop** (lines 200-223): The `refreshLoop()` async function reads all statuses via `readAllStatuses()`, renders the display using the `render()` function, clears the screen with ANSI codes, and writes the output. This runs immediately on startup, then repeats every `REFRESH_INTERVAL_MS` (2000ms) via `setInterval()`.

3. **Infinite Promise** (line 222-224): WARNING #3 from the code review - the monitor uses an unconventional pattern: `await new Promise(() => {})` which never resolves. The process stays alive until SIGINT/SIGTERM triggers the cleanup handler. This works but is unusual - a more idiomatic pattern would be to track the interval and await a signal.

4. **ANSI Rendering** (lines 21-37, 112-176): The `render()` function builds the display using hardcoded ANSI escape sequences:
   - Color codes: `\x1b[31m` (red), `\x1b[32m` (green), `\x1b[33m` (yellow), etc.
   - Background colors: `\x1b[41m` (red bg), `\x1b[42m` (green bg), `\x1b[43m` (yellow bg)
   - Formatting: `\x1b[1m` (bold), `\x1b[2m` (dim), `\x1b[0m` (reset)
   - Control: `\x1b[2J\x1b[H` (clear screen + home cursor), `\x1b[?25l` (hide cursor), `\x1b[?25h` (show cursor)

   This is SUGGESTION #4 - extracting these to a shared module would improve maintainability if the project expands.

**The Diff Stats Calculation - Git Integration:**

The `getDiffStats()` function in `diff.ts` (lines 13-78) shows how the system integrates with git to provide code metrics. This is called by the `status` command on every status report:

1. **Base Branch Detection** (lines 15-46): Uses a fallback chain to find the comparison branch:
   - First tries `git rev-parse --verify origin/main`
   - If that fails, tries `origin/master`
   - If that fails, tries local `main`
   - If that fails, falls back to `master`

   This is WARNING #5 - there's no validation that we're even in a git repository before running git commands. A non-git directory would fail silently.

2. **Diff Calculation** (lines 48-74): Runs `git diff --numstat [base-branch]` using `Bun.spawn()`, captures stdout, parses the output line-by-line. Each line has format: `additions\tdeletions\tfilename`. The function sums all additions and deletions across all changed files.

3. **Error Handling**: Returns null on any error (git command failure, parse error, etc.). The status command accepts null diff_stats - it's optional data.

**The Atomic Write Pattern - Why It Matters:**

The atomic write is the foundation of safe multi-agent coordination. Without it, corruption scenarios would be common:

- **Scenario 1 - Partial Writes**: If Agent A writes directly to `m-auth.status.json` and Agent B reads it mid-write (e.g., during a slow disk flush), Agent B gets malformed JSON and crashes.

- **Scenario 2 - Race Conditions**: If two agents report status for tasks on the same branch simultaneously, their writes could interleave, producing corrupted files.

The temp file + rename pattern prevents these issues because:
- Each agent writes to a unique temp file (PID-based naming ensures uniqueness within a host)
- The final `renameSync()` operation is atomic on POSIX filesystems - readers see either the old file or the new file, never a partial state
- Readers can safely read status files without locking because they're never modified in-place

**The Missing Pieces - Critical Issues:**

**CRITICAL ISSUE #1 - Race Condition in mkdirSync** (state.ts lines 32-36):

```typescript
// Current (UNSAFE):
const dir = dirname(statusFilePath);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });  // Can fail with EEXIST!
}
```

The problem: Time-of-check-to-time-of-use (TOCTOU) race. If Agent A checks `existsSync()` (returns false), then Agent B checks `existsSync()` (returns false), then Agent A calls `mkdirSync()` (succeeds), then Agent B calls `mkdirSync()` (throws EEXIST error), the entire status report fails.

The fix pattern (from cc-sessions' `shared_state.js` lines 777-860):

```typescript
// Safe pattern:
const dir = dirname(statusFilePath);
try {
  mkdirSync(dir, { recursive: true });
} catch (error) {
  if (error.code !== 'EEXIST') {
    throw error;  // Real error, not race condition
  }
  // EEXIST is fine - directory already exists
}
```

This is safe because `mkdirSync` with `recursive: true` is idempotent when the directory exists, we just need to catch and ignore the EEXIST error.

**CRITICAL ISSUE #2 - Missing cleanupTempFiles Integration** (state.ts lines 126-151):

The `cleanupTempFiles()` utility was implemented to handle orphaned temp files (from crashed processes that didn't complete the atomic write), but it's NEVER CALLED. The function:

1. Scans the state directory for files matching `*.tmp.*` pattern
2. Attempts to delete each one (ignoring individual file errors)
3. Returns the count of cleaned files

This needs integration at startup in:
- `monitor.ts`: Call before the first status read (line 186, after context detection)
- `show.ts`: Call before reading statuses (line 145, after context detection)

The cleanup should be silent (no output unless verbose flag is set) because orphaned temp files are expected after crashes - it's normal cleanup, not an error condition.

**The Path Traversal Vulnerability - WARNING #2:**

In `status.ts` line 94 and `context.ts` line 125, task names are used directly in file paths without sanitization:

```typescript
// Vulnerable:
const statusFilePath = join(stateDir, `${taskName}.status.json`);
```

If a malicious task name contains path traversal sequences like `../../etc/passwd`, this could write files outside the state directory. The code review identified this as a warning rather than critical because:
- Task names come from git branch names (user-controlled but typically safe in dev environments)
- The system is intended for trusted autonomous agents, not untrusted user input
- A fix would be: `taskName.replace(/[^a-zA-Z0-9_-]/g, '_')` to sanitize the task name

**Input Validation for Task Names - WARNING #2 Mitigation:**

The success criteria mentions adding input validation to `status.ts` and potentially `diff.ts` to prevent path traversal. This would involve:

1. In `status.ts` (after line 53): Validate task name format before using it in paths
2. In `diff.ts` (at function start): Verify we're in a git repository before running git commands

### For This Fix Implementation: What Needs to Change

**File 1: plugins/initializer/cli/src/lib/state.ts**

**Fix 1 - Wrap mkdirSync in try-catch** (lines 32-36):

Replace the unsafe directory creation with:

```typescript
// Ensure directory exists (handle race condition)
const dir = dirname(statusFilePath);
try {
  mkdirSync(dir, { recursive: true });
} catch (error: any) {
  // Ignore EEXIST - directory already exists (race with another agent)
  if (error.code !== 'EEXIST') {
    throw error;
  }
}
```

This makes the operation safe when multiple agents report simultaneously.

**Fix 2 - Document Bun.write flush guarantees** (line 42-43):

The comment "Bun.write flushes by default" needs verification. According to Bun documentation, `Bun.write()` does flush file data, but whether it guarantees fsync-level durability (surviving power loss) is unclear. For production systems handling critical data, an explicit fsync would be required. For dev tooling with autonomous agents, the current approach is acceptable.

Add a comment documenting the risk:

```typescript
// Bun.write flushes by default, providing reasonable durability for dev tooling.
// For production systems requiring crash-consistency, add explicit fsync:
// const fd = openSync(tempFile, 'w'); writeSync(fd, ...); fsyncSync(fd); closeSync(fd);
await Bun.write(tempFile, JSON.stringify(status, null, 2));
```

**File 2: plugins/initializer/cli/src/commands/monitor.ts**

**Fix 3 - Integrate cleanup at startup** (after line 186):

```typescript
const stateDir = getStateDir(context.projectRoot);

// Clean up orphaned temp files from crashed agents
cleanupTempFiles(stateDir);

// Setup cleanup on exit...
```

Import the function: Add `cleanupTempFiles` to the import from `../lib/state` (line 9).

**File 3: plugins/initializer/cli/src/commands/show.ts**

**Fix 4 - Integrate cleanup before reading** (after line 145):

```typescript
const stateDir = getStateDir(context.projectRoot);

// Clean up orphaned temp files before reading statuses
cleanupTempFiles(stateDir);

if (taskName) {
  // Show specific task...
```

Import the function: Add `cleanupTempFiles` to the import from `../lib/state` (line 9).

**File 4: plugins/initializer/cli/src/commands/status.ts**

**Fix 5 - Add task name validation** (after line 53):

```typescript
if (!taskName) {
  throw new Error(
    'Could not determine task name. Use --task <name> or run from a worktree with a recognizable branch name.'
  );
}

// Validate task name to prevent path traversal
if (!/^[a-zA-Z0-9_-]+$/.test(taskName)) {
  throw new Error(
    `Invalid task name '${taskName}'. Task names must contain only letters, numbers, hyphens, and underscores.`
  );
}
```

This prevents path traversal attacks via malicious task names.

**File 5: plugins/initializer/cli/src/lib/diff.ts**

**Fix 6 - Add git repository validation** (at function start, after line 13):

```typescript
export async function getDiffStats(): Promise<DiffStats | null> {
  try {
    // Verify we're in a git repository before running git commands
    const checkRepo = Bun.spawn(['git', 'rev-parse', '--git-dir'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await checkRepo.exited;

    if (checkRepo.exitCode !== 0) {
      // Not in a git repository
      return null;
    }

    // Try origin/main first, then origin/master...
```

This prevents git command errors when running outside a git repository.

### Technical Reference Details

#### AgentStatus Interface (state.ts lines 11-23)

```typescript
export interface AgentStatus {
  task_name: string;              // Task identifier (from branch or --task flag)
  worktree_path: string | null;   // Absolute path to worktree, or null if main repo
  branch: string | null;          // Git branch name
  current_work: string;           // Human-readable description of current work
  test_status: TestStatus;        // 'passed' | 'failed' | 'unknown'
  is_blocked: boolean;            // Whether agent is blocked
  blocked_reason: string | null;  // Reason for being blocked (if is_blocked)
  todos_completed: number | null; // Completed todo count
  todos_total: number | null;     // Total todo count
  diff_stats: DiffStats | null;   // { additions: number; deletions: number }
  last_update: string;            // ISO 8601 timestamp
}
```

#### File Paths

- **State directory**: `{project_root}/.trees/.state/`
- **Status files**: `{project_root}/.trees/.state/{task-name}.status.json`
- **Temp files**: `{project_root}/.trees/.state/{task-name}.status.json.tmp.{PID}`

#### Atomic Write Sequence

1. Create directory (with EEXIST handling) ← FIX NEEDED
2. Write to temp file with unique PID suffix
3. Flush data (Bun.write default behavior)
4. Rename temp → final (atomic operation)
5. On error: delete temp file (best effort)

#### Context Detection Results

| Scenario | .git Type | .trees Exists | Result | Project Root |
|----------|-----------|---------------|--------|--------------|
| Worktree agent | File | N/A | `worktree_agent` | Parsed from .git file |
| Main repo orchestrator | Directory | Yes | `orchestrator` | cwd |
| Main repo without .trees | Directory | No | `main_repo` | cwd |
| Not a git repo | N/A | N/A | `unknown` | null |

#### Error Handling Philosophy

The system follows a "graceful degradation" pattern:
- **Status reads**: Return null for corrupted files, continue processing others
- **Diff stats**: Return null on git errors, status report continues without diff data
- **Temp file cleanup**: Ignore individual file deletion errors, report total cleaned count
- **Missing directories**: Create them automatically (with race protection)

This is appropriate for dev tooling where partial data is better than complete failure.

## User Notes

### Code Review Findings Reference

**Critical Issues (Must Fix)**:
1. Race condition: `plugins/initializer/cli/src/lib/state.ts:32-36` - mkdirSync without EEXIST handling
2. Missing cleanup: `plugins/initializer/cli/src/lib/state.ts:126-151` - cleanupTempFiles() defined but never called

**Warnings (For Discussion)**:
1. No fsync before rename - Bun.write flush guarantees need verification
2. Path traversal vulnerability - task names used in file paths without sanitization
3. Unconventional infinite promise in monitor loop
4. Hardcoded stale threshold (2 hours) - not configurable
5. No git repository validation before diff calculation

**Suggestions (Nice-to-Have)**:
1. Add velocity/metrics to status display
2. Wrap descriptions instead of truncating
3. Add --watch flag as lightweight monitor alternative
4. Extract ANSI codes to shared module

### Files to Modify

- `plugins/initializer/cli/src/lib/state.ts` - Fix mkdirSync race, integrate cleanup
- `plugins/initializer/cli/src/commands/show.ts` - Call cleanupTempFiles()
- `plugins/initializer/cli/src/commands/monitor.ts` - Call cleanupTempFiles() on startup
- `plugins/initializer/cli/src/commands/status.ts` - Add task name validation
- `plugins/initializer/cli/src/lib/diff.ts` - Add git repo validation

## Work Log
<!-- Updated as work progresses -->
- [YYYY-MM-DD] Started task, initial research
