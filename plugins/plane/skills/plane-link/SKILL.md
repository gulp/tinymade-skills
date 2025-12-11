---
name: plane-link
description: Link task file to Plane issue. Use when user says "link task to plane", "connect to issue", or "link PROJ-XX".
---

# Plane Link Skill

Creates bidirectional link between a local task file and a Plane.so issue.

## When to Use

- User has existing task file AND existing Plane issue that should be connected
- After plane-discover shows unlinked items
- User explicitly asks to link task to issue

## Prerequisites

- `.claude/plane-sync.json` exists with issue data
- Task file exists in `sessions/tasks/`
- Plane issue exists (in cache or fetchable)

## Instructions

When invoked, user may provide:
- Task file name (e.g., `m-implement-feature.md`)
- Plane issue identifier (e.g., `CCPRISM-25`)
- Both, or ask to be guided

### 1. Identify What to Link

If user provides both:
- Validate task file exists
- Validate issue exists in cache (or fetch if not)

If user provides only one:
- Show candidates from the other side
- Let user pick

If user provides neither:
- Run plane-discover logic to show options
- Ask user to specify

### 2. Update Task Frontmatter

Add `plane_issue` field to task file's YAML frontmatter:

```yaml
---
name: m-implement-feature
branch: feature/implement-feature
status: in_progress
plane_issue: CCPRISM-25    # <-- Add this
created: 2025-12-11
---
```

Use the Edit tool to add the field after `status` (or at end of frontmatter if status not present).

### 3. Update Plane Issue (Optional)

If user wants bidirectional linking, update Plane issue with task file reference using plane-properties skill or MCP:

```
mcp__plane__update_issue
  - Add comment linking to task file
  - Or set custom property if available
```

Ask user: "Update Plane issue with task file link? (y/n)"

### 4. Update Cache

Add entry to `linked` section of `.claude/plane-sync.json`:

```json
{
  "linked": {
    "CCPRISM-25": "m-implement-feature.md"
  }
}
```

### 5. Sync Status (Optional)

If task status differs from Plane state, ask:
```
Task status: in_progress
Plane state: Todo

Sync status? (task→plane / plane→task / skip)
```

Use state mapping:
- `pending` → Todo
- `in_progress` → In Progress
- `completed` → Done

### 6. Confirm

```
Linked:
  m-implement-feature.md ↔ CCPRISM-25 (Feature Title)

Task frontmatter updated with plane_issue field
Cache updated
```

## Validation

Before linking:
- Check issue not already linked to another task
- Check task not already linked to another issue
- Warn if duplicate detected, ask to proceed or abort

## Error Handling

- Task not found: "Task file not found: {path}"
- Issue not in cache: "Issue {id} not in cache. Run plane-sync or check identifier."
- Already linked: "Task already linked to {issue}. Unlink first or use --force"
