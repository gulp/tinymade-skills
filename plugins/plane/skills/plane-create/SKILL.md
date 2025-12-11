---
name: plane-create
description: Create Plane issue from task or task from issue. Use when user says "create issue from task", "create task from plane", or "add to plane".
---

# Plane Create Skill

Creates Plane issue from task, or task from Plane issue.

## Bundled Scripts

```bash
# Get cache/project info
python scripts/read_cache.py

# Get specific issue details
python scripts/read_cache.py --issue CCPRISM-25

# Add new issue to cache after MCP creation
python scripts/add_issue.py --key CCPRISM-28 --id UUID --name "Title" --state "In Progress" --state-id UUID

# Add link after creation
python scripts/add_link.py --issue CCPRISM-28 --task m-new-task.md
```

## Mode 1: Task → Plane Issue

### Workflow

```bash
# 1. Get project info from cache
python scripts/read_cache.py
# → project_id, state UUIDs

# 2. Create issue via MCP
mcp__plane__create_issue(project_id, {name, description_html, state})

# 3. Add to cache
python scripts/add_issue.py --key CCPRISM-28 --id UUID --name "Title" --state "In Progress" --state-id UUID

# 4. Link
python scripts/add_link.py --issue CCPRISM-28 --task m-task.md

# 5. Update task frontmatter (Edit tool)
# Add: plane_issue: CCPRISM-28
```

### Instructions

1. Parse task frontmatter for name, status, description
2. Map status to Plane state UUID (from cache)
3. Create issue via MCP
4. Add to cache and link
5. Update task frontmatter

## Mode 2: Plane Issue → Task

### Workflow

```bash
# 1. Get issue details
python scripts/read_cache.py --issue CCPRISM-25
# → name, state, id

# 2. Generate task filename
# "Fix Asciinema Regression" → m-fix-asciinema-regression.md

# 3. Create task file (Write tool)

# 4. Add link
python scripts/add_link.py --issue CCPRISM-25 --task m-fix-asciinema-regression.md
```

### Instructions

1. Get issue from cache (or fetch via MCP if not cached)
2. Generate filename: lowercase, hyphenate, add size prefix
3. Create task file with frontmatter including `plane_issue`
4. Add link to cache

## Task Template

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
{issue description}

## Success Criteria
- [ ] {from issue or ask user}

## Context Manifest
<!-- To be gathered during task startup -->

## Work Log
- [{date}] Created from CCPRISM-25
```

## State Mapping

| Task Status | Plane State | Get UUID from |
|------------|-------------|---------------|
| pending | Todo | `states.pending` |
| in_progress | In Progress | `states.in_progress` |
| completed | Done | `states.completed` |
| backlog | Backlog | `states.backlog` |
