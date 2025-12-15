# Initializer CLI

A standalone Bun-based CLI for parallel agent coordination in git worktrees.

## Overview

The `initializer` CLI enables autonomous Claude agents working in separate git worktrees to report their status to a central orchestrator. It provides visibility and coordination for parallel development workflows.

## Architecture

The system uses a three-layer architecture:

1. **Agent Layer** (Worktrees): Agents use `initializer status` to report progress
2. **Persistence Layer** (Shared State): Status written to `.trees/.state/{task}.status.json`
3. **Orchestrator Layer** (Main Branch): Orchestrator reads status via `initializer show` or `initializer monitor`

## Commands

### status - Report agent status

```bash
initializer status <description> [options]

Options:
  --tests <status>    Test status: passed, failed, unknown
  --todos X/Y         Todo progress (e.g., 3/7)
  --blocked           Mark as blocked
  --reason <text>     Blocked reason
  --task <name>       Override task name detection
```

Example:
```bash
initializer status "Implementing JWT validation" --tests passed --todos 3/7
```

### show - Display agent statuses

```bash
initializer show [task-name] [--json]

Options:
  task-name    Show status for specific task only
  --json       Output in JSON format
```

### monitor - Launch TUI dashboard

```bash
initializer monitor
```

Displays real-time agent status with:
- Status badges (ACTIVE/BLOCKED/STALE)
- Test results
- Todo progress bars
- Git diff statistics
- Auto-refresh every 2 seconds

## Technical Details

### Atomic Write Pattern

Status files are written atomically using a temp file + rename pattern to prevent corruption when multiple agents report simultaneously:

1. **Directory Creation**: Uses `mkdirSync()` with EEXIST error handling for safe concurrent access
2. **Temp File Write**: Writes to `{status-file}.tmp.{PID}` with unique process ID
3. **Atomic Rename**: Uses `renameSync()` for atomic replacement (guaranteed on POSIX systems)
4. **Cleanup on Error**: Removes temp file if write fails

This pattern ensures orchestrators never see partial/corrupted status files.

### Cleanup of Orphaned Temp Files

The `cleanupTempFiles()` utility automatically removes orphaned `.tmp.*` files from crashed agents:

- Integrated into `monitor` startup and `show` pre-read
- Silent cleanup (no output unless files are actually removed)
- Graceful handling of individual file deletion errors

### Input Validation

Task names are validated using regex `^[a-zA-Z0-9_-]+$` to prevent path traversal attacks. This ensures malicious task names like `../../etc/passwd` cannot write files outside the state directory.

### Git Repository Validation

The diff calculation validates git repository presence before running git commands using `git rev-parse --git-dir`. Returns null gracefully if not in a git repository.

### Fsync Considerations

`Bun.write()` flushes file data by default, providing reasonable durability for dev tooling. For production systems requiring crash-consistency (surviving power loss), explicit fsync would be required:

```typescript
const fd = openSync(tempFile, 'w');
writeSync(fd, data);
fsyncSync(fd);
closeSync(fd);
renameSync(tempFile, finalFile);
```

The current approach is appropriate for autonomous agent coordination in development environments.

## Context Detection

The CLI automatically detects its execution context:

| Scenario | Detection Method | Project Root Source |
|----------|------------------|---------------------|
| Worktree agent | `.git` is a file | Parsed from `.git` file |
| Main repo orchestrator | `.git` is directory + `.trees/` exists | Current directory |

## Status File Schema

```json
{
  "task_name": "string",
  "worktree_path": "string | null",
  "branch": "string | null",
  "current_work": "string",
  "test_status": "passed" | "failed" | "unknown",
  "is_blocked": boolean,
  "blocked_reason": "string | null",
  "todos_completed": number | null,
  "todos_total": number | null,
  "diff_stats": {
    "additions": number,
    "deletions": number
  } | null,
  "last_update": "ISO 8601 timestamp"
}
```

## Development

Built with:
- **Runtime**: Bun
- **Language**: TypeScript
- **Dependencies**: Zero (pure Bun/Node.js APIs)
- **TUI**: Raw ANSI escape codes

## Integration with cc-sessions

The initializer system is decoupled from cc-sessions but integrates seamlessly:

- Agents spawned by `worktree-orchestrator` automatically load the `agent-status` skill
- The orchestrator uses the `agent-monitor` skill to view statuses
- Status files colocate with worktrees in `.trees/.state/` (already gitignored)

## Security Considerations

**For trusted agent environments**:
- Task name validation prevents path traversal
- Atomic writes prevent corruption
- No external dependencies reduce attack surface

**Not suitable for**:
- Untrusted user input
- Production systems requiring crash-consistency guarantees
- Multi-host coordination (PID-based temp files assume single host)

## Version

1.0.0

## See Also

- `agent-status` skill - For agents in worktrees
- `agent-monitor` skill - For orchestrators on main branch
- `worktree-orchestrator` skill - For spawning and managing agents
