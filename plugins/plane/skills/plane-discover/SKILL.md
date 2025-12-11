---
name: plane-discover
description: Compare local tasks with Plane issues. Use when user says "discover plane", "compare tasks", "show unlinked issues", or "plane backlog".
---

# Plane Discover Skill

Compares local task files against cached Plane issues to show unlinked items.

## Bundled Scripts

```bash
# Find unlinked issues and tasks
python scripts/discover.py --tasks-dir sessions/tasks

# Also check status mismatches
python scripts/discover.py --tasks-dir sessions/tasks --status-check

# Get cache summary
python scripts/read_cache.py

# List unlinked issues only
python scripts/read_cache.py --unlinked
```

## Quick Workflow

```bash
python scripts/discover.py --tasks-dir sessions/tasks --status-check
```

Output:
```json
{
  "unlinked_issues": {"CCPRISM-25": {"name": "Fix Bug", "state": "Todo"}},
  "unlinked_tasks": [{"file": "m-task.md", "status": "pending"}],
  "status_mismatches": [{"issue": "CCPRISM-27", "task_status": "pending", "plane_state": "In Progress"}],
  "summary": {"unlinked_issues": 5, "unlinked_tasks": 2, "mismatches": 1}
}
```

## Instructions

### 1. Run Discovery

```bash
python scripts/discover.py --tasks-dir sessions/tasks --status-check
```

### 2. Report Results

```
Plane ↔ Tasks Discovery

Unlinked Plane Issues (5):
  CCPRISM-25: Fix Asciinema Regression (Todo)
  CCPRISM-26: Test sync workflow (Backlog)

Unlinked Local Tasks (2):
  m-implement-feature.md (pending)
  m-another-task.md (in_progress)

Status Mismatches (1):
  CCPRISM-27: task=pending, plane=In Progress

Actions:
  - Use plane-link to connect issue ↔ task
  - Use plane-create to create missing items
```

### 3. Suggest Actions

- **Unlinked issues** → offer plane-create (issue → task)
- **Unlinked tasks** → offer plane-create (task → issue)
- **Status mismatches** → offer to sync status

## Cache Freshness

Check `last_sync` from `read_cache.py`. If stale:
```
Cache is X hours old. Run plane-sync to refresh.
```
