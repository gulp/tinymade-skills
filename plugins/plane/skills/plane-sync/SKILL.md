---
name: plane-sync
description: Sync Plane.so issues to local cache. Use when user says "sync plane", "update plane cache", or "refresh plane issues".
---

# Plane Sync Skill

Fetches all issues from a Plane.so project and caches them locally in `.claude/plane-sync.json`.

## When to Use

- User asks to sync/refresh Plane issues
- Before running plane-discover to compare local vs remote
- After making changes in Plane UI to update local cache

## Prerequisites

- Plane MCP server configured (`.mcp.json` with `plane` server)
- `PLANE_API_KEY` environment variable set
- Project exists in Plane workspace

## Instructions

When invoked, perform these steps:

### 1. Detect Project Context

Check for existing `.claude/plane-sync.json` to get project info. If not found, use MCP to list projects:

```
mcp__plane__get_projects
```

If multiple projects, ask user which to sync. For single project, use it automatically.

### 2. Fetch Project Data

Get all issues and states from the project:

```
mcp__plane__list_project_issues (project_id)
mcp__plane__list_states (project_id)
```

### 3. Build Cache Structure

Create/update `.claude/plane-sync.json` with this structure:

```json
{
  "project": {
    "id": "uuid",
    "identifier": "PROJ",
    "name": "Project Name",
    "workspace": "workspace-slug"
  },
  "states": {
    "backlog": "state-uuid",
    "pending": "state-uuid",
    "in_progress": "state-uuid",
    "completed": "state-uuid"
  },
  "issues": {
    "PROJ-1": {
      "id": "issue-uuid",
      "name": "Issue title",
      "state": "Todo",
      "state_id": "state-uuid",
      "priority": "none",
      "updated_at": "2025-12-11T..."
    }
  },
  "linked": {},
  "lastSync": "2025-12-11T12:00:00Z"
}
```

### 4. State Mapping

Map Plane state groups to task status conventions:
- `backlog` group → `backlog`
- `unstarted` group → `pending`
- `started` group → `in_progress`
- `completed` group → `completed`
- `cancelled` group → `cancelled`

### 5. Write Cache File

Ensure `.claude/` directory exists, then write the JSON cache:

```bash
mkdir -p .claude
```

Write the formatted JSON to `.claude/plane-sync.json`.

### 6. Report Results

Output summary:
- Project synced: {identifier} ({name})
- Issues cached: {count}
- States mapped: {count}
- Last sync: {timestamp}

## Output Format

Keep output concise:

```
Synced CCPRISM (cc-prism)
  25 issues cached
  7 states mapped
  .claude/plane-sync.json updated
```

## Error Handling

- If Plane MCP not available: "Plane MCP server not configured. Add to .mcp.json first."
- If no projects found: "No projects found in workspace."
- If API error: Report the error message from MCP response.
