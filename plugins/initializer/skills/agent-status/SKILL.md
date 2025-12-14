---
name: agent-status
description: Use PROACTIVELY when working in a worktree as an autonomous agent. Auto-trigger after completing significant work milestones, when tests pass/fail, when blocked on something, or when todo progress changes significantly. Provides status reporting commands for parallel agent coordination.
---

# Agent Status Reporting

Report your work status to the orchestrator for parallel agent coordination.

## When to Report Status

Report status **proactively** after:
- Completing a significant milestone or todo item
- Running tests (report pass/fail)
- Making substantial code changes
- Getting blocked on something
- Every 15-30 minutes of active work

## Bundled Scripts

```bash
# Report status with all options
./scripts/report_status.sh "description" --tests passed --todos 3/7

# Report blocked status
./scripts/report_status.sh "Waiting for API key" --blocked --reason "Need credentials"

# Quick status update
./scripts/report_status.sh "Implementing auth middleware"
```

## Quick Decision Matrix

| Situation | Action |
|-----------|--------|
| Completed a todo item | Report with updated `--todos X/Y` |
| Tests passed | Report with `--tests passed` |
| Tests failed | Report with `--tests failed` |
| Stuck/need help | Report with `--blocked --reason "..."` |
| Major progress | Report current work description |

## CLI Reference

```bash
initializer status <description> [options]

Options:
  --tests <status>    Test status: passed, failed, unknown
  --todos X/Y         Todo progress (e.g., 3/7)
  --blocked           Mark as blocked (orchestrator will be notified)
  --reason <text>     Reason for being blocked
  --task <name>       Override auto-detected task name
```

## Status Reporting Protocol

### After Milestones

```bash
# After completing implementation work
initializer status "Completed auth middleware implementation" --tests passed --todos 4/7

# After fixing a bug
initializer status "Fixed token refresh race condition" --tests passed --todos 5/7
```

### When Blocked

If you encounter a blocker, report it immediately:

```bash
initializer status "Blocked on database schema" --blocked --reason "Need DBA approval for migration"
```

The orchestrator monitors for blocked agents via `initializer monitor` and can intervene.

### Test Results

Always report test status after running tests:

```bash
# Tests passed
initializer status "All unit tests passing" --tests passed --todos 3/5

# Tests failed
initializer status "Integration tests failing" --tests failed --todos 3/5
```

## Integration with AskUserQuestion

When blocked, you can ALSO use the AskUserQuestion tool to notify the orchestrator:

```
I'm blocked and need assistance:

Current task: [task name]
Blocker: [description of what's blocking you]
What I've tried: [list attempts to resolve]

Options:
1. Provide the missing [resource/information]
2. Reassign this task
3. Skip this and continue with next item
```

The orchestrator monitors agent statuses and will see your blocked status via `initializer show` or `initializer monitor`.

## Status File Location

Status files are written to `.trees/.state/{task-name}.status.json` in the main repository. The orchestrator reads these files to track all parallel agents.

## Example Workflow

```
1. Start working on task
   → initializer status "Starting auth implementation" --todos 0/5

2. Complete first item
   → initializer status "Added JWT validation" --tests passed --todos 1/5

3. Complete second item
   → initializer status "Implemented token refresh" --tests passed --todos 2/5

4. Hit a blocker
   → initializer status "Need API credentials" --blocked --reason "Waiting for secrets"

5. Blocker resolved, continue
   → initializer status "Resuming with credentials" --todos 2/5

6. Complete remaining items
   → initializer status "Auth implementation complete" --tests passed --todos 5/5
```

---

**Version**: 1.0.0 | **Author**: tinymade
