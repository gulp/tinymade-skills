---
name: plane-link
description: Link task file to Plane issue. Use when user says "link task to plane", "connect to issue", or "link PROJ-XX".
---

# Plane Link Skill

Creates bidirectional link between a local task file and a Plane.so issue.

## Bundled Scripts

```bash
# Add link to cache
python scripts/add_link.py --issue CCPRISM-27 --task m-implement-feature.md

# Remove link
python scripts/add_link.py --issue CCPRISM-27 --remove

# Check existing links
python scripts/read_cache.py --linked

# Get specific issue info
python scripts/read_cache.py --issue CCPRISM-27
```

## Quick Workflow

```bash
# 1. Add link to cache
python scripts/add_link.py --issue CCPRISM-27 --task m-implement-feature.md

# 2. Update task frontmatter (use Edit tool to add plane_issue field)
```

## Instructions

### 1. Identify What to Link

User provides task file and/or issue key. If only one:
```bash
python scripts/read_cache.py --unlinked   # Show unlinked issues
python scripts/discover.py --tasks-dir sessions/tasks  # Show unlinked tasks
```

### 2. Add Link to Cache

```bash
python scripts/add_link.py --issue CCPRISM-27 --task m-implement-feature.md
```

Output: `{"success": true, "linked": "CCPRISM-27 ↔ m-implement-feature.md"}`

### 3. Update Task Frontmatter

Use Edit tool to add `plane_issue` field:
```yaml
plane_issue: CCPRISM-27
```

### 4. Optional: Sync Status

If mismatch, use MCP to update Plane:
```
mcp__plane__update_issue(project_id, issue_id, {"state": "state-uuid"})
```

### 5. Confirm

```
Linked: m-implement-feature.md ↔ CCPRISM-27 (Issue Title)
```

## Error Handling

- Issue not in cache: "Run plane-sync first"
- Already linked: "Already linked to {task}. Use --remove first."
