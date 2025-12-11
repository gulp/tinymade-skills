---
name: plane-discover
description: Compare local tasks with Plane issues. Use when user says "discover plane", "compare tasks", "show unlinked issues", or "plane backlog".
---

# Plane Discover Skill

Compares local task files against cached Plane issues to show unlinked items in both directions.

## When to Use

- User wants to see which Plane issues have no local task
- User wants to see which local tasks aren't linked to Plane
- Before creating new tasks to avoid duplicates
- During backlog grooming/discovery

## Prerequisites

- `.claude/plane-sync.json` exists (run plane-sync first if not)
- Task files in `sessions/tasks/` with YAML frontmatter

## Instructions

When invoked, perform these steps:

### 1. Load Plane Cache

Read `.claude/plane-sync.json`. If not found:
```
No Plane cache found. Run plane-sync first to fetch issues.
```

### 2. Scan Local Tasks

Find all task files in `sessions/tasks/`:
```bash
ls sessions/tasks/*.md
```

For each task file, parse YAML frontmatter looking for:
- `plane_issue: PROJ-XX` field (linked)
- `status` field (for comparison)
- `name` field (for display)

### 3. Build Comparison

Create two lists:

**Plane issues not linked locally:**
- Issues in cache where identifier not in any task's `plane_issue` field

**Local tasks not linked to Plane:**
- Task files without `plane_issue` field in frontmatter

### 4. Display Results

Format output as:

```
Plane Issues Not Linked Locally:
  CCPRISM-25  Fix Asciinema Regression         Todo
  CCPRISM-24  Markdown-to-ANSI Parsing         Backlog
  CCPRISM-17  Agent Visualization Modes        Todo
  ... (N more)

Local Tasks Not in Plane:
  m-implement-plane-integration.md    in_progress
  s-fix-something.md                  pending
  ... (N more)

Summary:
  Plane issues without local task: X
  Local tasks without Plane link: Y
  Linked tasks: Z
```

### 5. Optional: Suggest Actions

If user asks, offer next steps:
- "Use plane-link to connect existing task to issue"
- "Use plane-create to create task from issue (or vice versa)"

## Matching Logic

Tasks are considered linked when:
- Task frontmatter contains `plane_issue: PROJ-XX`
- The identifier matches an issue in the cache

Do NOT match by name/title - only explicit `plane_issue` field counts as linked.

## Cache Freshness

Check `lastSync` timestamp in cache. If older than 1 hour, suggest:
```
Cache is X hours old. Run plane-sync to refresh.
```

## Output Modes

**Default**: Show summary counts and first 5 items per category
**Verbose** (if user asks "show all"): List all items

## Error Handling

- Missing cache: "Run plane-sync first"
- No tasks directory: "No sessions/tasks/ directory found"
- Parse errors: Skip file and note in output
