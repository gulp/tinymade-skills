---
name: plane-sync
description: Sync Plane.so issues to local cache. Use when user says "sync plane", "update plane cache", or "refresh plane issues".
---

# Plane Sync Skill

Fetches all issues from a Plane.so project and caches them locally.

## Bundled Scripts

```bash
# Get cache summary (no full file read)
python scripts/read_cache.py

# Update cache with MCP data (pipe JSON)
echo '{"project": {...}, "issues": [...], "states": [...]}' | python scripts/sync_cache.py

# Just update timestamp
python scripts/sync_cache.py --touch
```

## Quick Workflow

```bash
# 1. Check current cache status
python scripts/read_cache.py

# 2. Fetch from Plane MCP, pipe to sync script
# (MCP calls return JSON, pipe directly)
```

## Instructions

### 1. Check Existing Cache

```bash
python scripts/read_cache.py
```

If cache exists, you'll get project_id. If not, fetch projects via MCP.

### 2. Fetch Data via MCP

```
mcp__plane__get_projects              # Get project list
mcp__plane__list_project_issues       # Get all issues
mcp__plane__list_states               # Get state mappings
```

### 3. Pipe to Sync Script

Combine MCP responses into single JSON and pipe:

```bash
python scripts/sync_cache.py --data '{
  "project": {"id": "...", "identifier": "CCPRISM", "name": "cc-prism", "workspace": "tinymade"},
  "issues": [...],
  "states": [...]
}'
```

Output:
```json
{"success": true, "issues_count": 27, "states_count": 7, "new": ["CCPRISM-27"], "updated": []}
```

### 4. Report

```
Synced CCPRISM (cc-prism)
  27 issues cached (+1 new)
  7 states mapped
```

## Error Handling

- No Plane MCP: "Plane MCP server not configured"
- No projects: "No projects found in workspace"
- API error: Report MCP error message
