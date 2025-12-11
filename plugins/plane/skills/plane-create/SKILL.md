---
name: plane-create
description: Create Plane issue from task or task from issue. Use when user says "create issue from task", "create task from plane", or "add to plane".
---

# Plane Create Skill

Creates a new Plane issue from a local task, or creates a new local task from a Plane issue.

## When to Use

- User has local task that needs corresponding Plane issue
- User wants to start work on a Plane issue locally
- After plane-discover shows items needing creation

## Prerequisites

- `.claude/plane-sync.json` exists with project info
- Plane MCP server available for issue creation
- Task template available (if creating task from issue)

## Instructions

### Mode Detection

Determine direction from user request:
- "create issue from task" / "add to plane" → Task → Plane
- "create task from issue" / "start PROJ-XX" → Plane → Task

### Mode 1: Task → Plane Issue

User provides task file or current task context.

#### 1. Read Task File

Parse frontmatter for:
- `name` → Issue title
- `status` → Initial state
- Content under `## Problem/Goal` → Issue description

#### 2. Create Plane Issue

```
mcp__plane__create_issue
  project_id: (from cache)
  issue_data:
    name: (from task name/title)
    description_html: "<p>description from task</p>"
    state: (mapped from task status)
```

#### 3. Link Back

Add `plane_issue: PROJ-XX` to task frontmatter (use plane-link logic).

#### 4. Update Cache

Add issue to cache and linked mapping.

#### 5. Report

```
Created Plane issue:
  CCPRISM-26: Implement Feature X

Task linked: m-implement-feature-x.md
```

### Mode 2: Plane Issue → Task

User provides issue identifier (e.g., CCPRISM-25).

#### 1. Fetch Issue Details

If not in cache, fetch from API:
```
mcp__plane__get_issue_using_readable_identifier
  project_identifier: CCPRISM
  issue_identifier: 25
```

#### 2. Generate Task Filename

Convert issue name to task filename:
- Lowercase
- Replace spaces with hyphens
- Add size prefix based on estimate (default: m-)
- Example: "Fix Asciinema Regression" → `m-fix-asciinema-regression.md`

Ask user to confirm or modify filename.

#### 3. Create Task File

Use task template or minimal structure:

```markdown
---
name: m-fix-asciinema-regression
branch: feature/fix-asciinema-regression
status: pending
plane_issue: CCPRISM-25
created: 2025-12-11
---

# Fix Asciinema Regression

## Problem/Goal
{issue description from Plane}

## Success Criteria
- [ ] {derived from issue or ask user}

## Context Manifest
<!-- To be gathered during task startup -->

## User Notes

## Work Log
- [{date}] Task created from Plane issue CCPRISM-25
```

#### 4. Update Cache

Add to linked mapping in `.claude/plane-sync.json`.

#### 5. Report

```
Created task file:
  sessions/tasks/m-fix-asciinema-regression.md

Linked to: CCPRISM-25 (Fix Asciinema Regression)
```

## State Mapping

When creating, map status/state:

| Task Status | Plane State |
|-------------|-------------|
| `pending` | Todo |
| `in_progress` | In Progress |
| `completed` | Done |
| `backlog` | Backlog |

## Validation

- Check issue/task doesn't already exist before creating
- Validate project_id is available
- Confirm filename doesn't conflict with existing task

## Error Handling

- Task already has plane_issue: "Task already linked. Use plane-link to change."
- Issue already linked: "Issue already has local task: {filename}"
- API error: Report error message from MCP
- Missing project context: "Run plane-sync first to set project context"
