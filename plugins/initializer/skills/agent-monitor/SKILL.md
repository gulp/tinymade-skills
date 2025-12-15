---
name: agent-monitor
description: Use PROACTIVELY when orchestrating parallel agents from the main branch. Auto-trigger when user asks about agent status, wants to check on parallel work, needs to see what agents are doing, or wants to monitor autonomous agents. Provides commands to view agent statuses and launch the monitoring TUI.
---

# Agent Monitor (Orchestrator View)

View and monitor parallel agent statuses from the main branch orchestrator context.

## When to Use

Use this skill when:
- Checking on parallel agent progress
- Looking for blocked agents that need intervention
- Viewing overall status of autonomous work
- Launching the monitoring TUI dashboard

## Bundled Scripts

```bash
# Show all agent statuses (human-readable)
./scripts/show_statuses.sh

# Show all agent statuses (JSON for processing)
./scripts/show_statuses.sh --json

# Show specific agent status
./scripts/show_statuses.sh my-task-name
```

## Quick Decision Matrix

| Request | Action |
|---------|--------|
| "check on agents" / "agent status" | Run `initializer show` |
| "are any agents blocked?" | Run `initializer show` and check for BLOCKED |
| "monitor agents" / "watch agents" | Run `initializer monitor` |
| "what are agents working on?" | Run `initializer show` |
| "agent progress" | Run `initializer show --json` for detailed data |

## CLI Reference

### Show Command

```bash
initializer show [task-name] [--json]

Options:
  task-name       Show status for specific task only
  --json          Output in JSON format (for scripting)
```

### Monitor Command

```bash
initializer monitor

Launches a TUI dashboard showing:
  - All active agents
  - Test status per agent (passed/failed/unknown)
  - Todo progress bars
  - Blocked/stale indicators
  - Real-time updates every 2 seconds
```

## Status Indicators

| Indicator | Meaning |
|-----------|---------|
| ACTIVE | Agent is working normally (updated recently) |
| BLOCKED | Agent is blocked and needs intervention |
| STALE | No status update in >2 hours (may need attention) |

## Intervention Patterns

### When Agent is Blocked

1. Check the blocked reason via `initializer show`
2. Resolve the blocker (provide credentials, answer questions, etc.)
3. The agent will automatically resume when it detects the blocker is resolved

### When Agent is Stale

1. Check if the agent terminal is still running
2. The agent may have crashed or completed without final status
3. Consider restarting the agent with `spawn_terminal.py`

### Manual Intervention

To interact with an agent directly:

```bash
# Open terminal in agent's worktree
python scripts/spawn_terminal.py --worktree .trees/feature-foo

# Or navigate directly
cd .trees/feature-foo
claude
```

## JSON Output Schema

```json
{
  "total": 3,
  "active": 2,
  "blocked": 1,
  "stale": 0,
  "statuses": [
    {
      "task_name": "m-implement-auth",
      "worktree_path": "/project/.trees/feature-auth",
      "branch": "feature/auth",
      "current_work": "Implementing JWT validation",
      "test_status": "passed",
      "is_blocked": false,
      "blocked_reason": null,
      "todos_completed": 3,
      "todos_total": 7,
      "diff_stats": { "additions": 150, "deletions": 20 },
      "last_update": "2025-12-14T12:00:00Z"
    }
  ]
}
```

## System Reliability

The monitoring system automatically handles edge cases:

- **Orphaned temp files**: Cleaned up silently when `show` or `monitor` commands run
- **Corrupted status files**: Skipped gracefully (logged but don't crash the monitor)
- **Missing git repository**: Diff stats return null (status reporting continues)
- **Concurrent writes**: Atomic rename pattern prevents corruption when agents report simultaneously
- **Stale agents**: Detected when no update received in >2 hours

## Integration with worktree-orchestrator

This skill complements the `worktree-orchestrator` skill:

| Skill | Purpose |
|-------|---------|
| **worktree-orchestrator** | Manages WHERE agents work (worktrees, branches, spawning) |
| **agent-monitor** | Monitors WHAT agents are doing (status, progress, blockers) |

Typical workflow:
1. Use `worktree-orchestrator` to spawn agents in worktrees
2. Use `agent-monitor` to track their progress
3. Intervene via `worktree-orchestrator` when needed

## Example Session

```
User: Check on the parallel agents

Claude: Running `initializer show` to check agent statuses...

═══════════════════════════════════════════════════════════════════════════════
                           PARALLEL AGENT STATUS
═══════════════════════════════════════════════════════════════════════════════
  Active: 2  │  Blocked: 1  │  Stale: 0  │  Total: 3
───────────────────────────────────────────────────────────────────────────────

  🔴 BLOCKED  m-implement-api
    Work: Waiting for database credentials
    Tests: ?  │  Progress: [██░░░░░░░░] 2/8  │  Diff: +45 -10
    Updated: 5m ago  │  Branch: feature/api
    Blocked reason: Need DATABASE_URL environment variable

  🟢 ACTIVE  m-implement-auth
    Work: Implementing token refresh
    Tests: ✓  │  Progress: [██████░░░░] 5/8  │  Diff: +230 -45
    Updated: 2m ago  │  Branch: feature/auth

  🟢 ACTIVE  m-implement-tests
    Work: Writing integration tests
    Tests: ✓  │  Progress: [████░░░░░░] 4/10  │  Diff: +180 -20
    Updated: 1m ago  │  Branch: feature/tests

───────────────────────────────────────────────────────────────────────────────

One agent is blocked. The m-implement-api agent needs DATABASE_URL.
Would you like me to help resolve this blocker?
```

---

**Version**: 1.0.0 | **Author**: tinymade
