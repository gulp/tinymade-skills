# cc-sessions Integration Reference

This document describes the cc-sessions task file format and how the worktree-orchestrator skill integrates with it.

## Task File Format

### Location

Task files are stored in `sessions/tasks/`:

```
sessions/tasks/
├── TEMPLATE.md                    # Template for new tasks
├── indexes/                       # Task grouping indexes
│   └── project-name.md
├── m-implement-feature.md         # Medium priority implementation
├── h-fix-critical-bug.md          # High priority fix
└── l-research-options.md          # Low priority research
```

### Naming Convention

Task files follow the pattern: `{priority}-{type}-{description}.md`

**Priority prefixes:**
- `h-` High priority
- `m-` Medium priority
- `l-` Low priority

**Type indicators:**
- `implement-` New feature implementation
- `fix-` Bug fix
- `research-` Research/investigation
- `refactor-` Code refactoring

### Frontmatter Schema

```yaml
---
name: m-implement-feature-name       # Required: task identifier
branch: feature/feature-name         # Required: git branch
status: pending                      # Required: task status
created: 2025-12-08                  # Required: creation date
completed: 2025-12-10                # Optional: completion date
---
```

**Status values:**
- `pending` - Task not started
- `in-progress` - Work actively happening
- `completed` - Task finished
- `blocked` - Task cannot proceed

### Full Task File Example

```markdown
---
name: m-implement-pick-cli
branch: feature/pick-cli
status: in-progress
created: 2025-12-07
---

# Interactive Fragment Picker CLI

## Problem/Goal
Build an interactive TUI command to select message ranges.

## Success Criteria
- [ ] Interactive TUI with Ink/React
- [ ] Browse/scroll through messages
- [ ] Mark selections

## Context Manifest
<!-- Added by context-gathering agent -->

## User Notes
- Reference implementation: fzf
- Must support keyboard navigation

## Work Log
- [2025-12-07] Task created
- [2025-12-08] Started implementation
```

---

## Task Index Format

### Location

Index files group related tasks in `sessions/tasks/indexes/`:

```
sessions/tasks/indexes/
├── INDEX_TEMPLATE.md
└── project-name.md
```

### Index File Structure

```yaml
---
index: project-name
name: Project Name Development
description: Tasks for building project-name
---
```

### Index Content Format

```markdown
# Project Name Development

## Active Tasks

### High Priority
- `h-fix-critical.md` - Critical bug fix

### Medium Priority
- `m-implement-feature.md` - New feature
- `m-implement-related.md` - Related feature

### Low Priority
- `l-research-options.md` - Research task

### Investigate
- Items to investigate

## Completed Tasks

### Implementation
- `m-implement-done.md` - Completed feature (completed 2025-12-07)
  - Bullet points with details
  - More details

### Research
- `m-research-done.md` - Completed research
```

---

## Multi-Task Branch Pattern

### Concept

cc-sessions supports multiple tasks sharing a single git branch. This is useful when:

- Tasks are closely related (same feature area)
- Tasks should be reviewed/merged together
- Tasks represent phases of a larger effort

### Example

```
sessions/tasks/
├── m-implement-pick-cli.md        → branch: feature/pick-cli
├── m-implement-pick-preview.md    → branch: feature/pick-cli
└── m-implement-pick-export.md     → branch: feature/pick-cli
```

All three tasks share the `feature/pick-cli` branch and thus share the same worktree.

### Worktree Mapping

```
Branch                  → Worktree Folder        → Tasks
feature/pick-cli        → .trees/feature-pick-cli → [pick-cli, pick-preview, pick-export]
feature/auth            → .trees/feature-auth     → [auth]
```

### Implications

1. **One worktree per branch** - Not per task
2. **Cleanup requires all tasks complete** - Can't remove worktree if any task is active
3. **Shared working directory** - All tasks work in same files

---

## Branch Extraction

### Algorithm

```bash
# 1. Read task file
# 2. Extract YAML frontmatter (between --- markers)
# 3. Find line starting with "branch:"
# 4. Extract value after colon

extract_branch() {
  local task_file="$1"
  sed -n '/^---$/,/^---$/p' "$task_file" | grep "^branch:" | sed 's/branch: *//'
}
```

### Branch to Folder Normalization

```bash
# Replace / with -
# Replace _ with -

normalize_branch() {
  local branch="$1"
  local folder="${branch//\//-}"
  folder="${folder//_/-}"
  echo "$folder"
}
```

**Examples:**
| Branch | Folder |
|--------|--------|
| `feature/pick-cli` | `feature-pick-cli` |
| `feature/ui_login` | `feature-ui-login` |
| `bugfix/auth-error` | `bugfix-auth-error` |
| `main` | `main` |

---

## Status Extraction

### Algorithm

```bash
extract_status() {
  local task_file="$1"
  sed -n '/^---$/,/^---$/p' "$task_file" | grep "^status:" | sed 's/status: *//'
}
```

### Status → Action Mapping

| Status | Worktree Exists | Recommended Action |
|--------|-----------------|-------------------|
| `pending` | No | Create worktree to start |
| `pending` | Yes | Navigate to worktree |
| `in-progress` | No | Create worktree (inconsistent state) |
| `in-progress` | Yes | Continue work |
| `completed` | No | Normal (expected) |
| `completed` | Yes | Consider cleanup |
| `blocked` | Any | Review blockers |

---

## Integration Points

### 1. Create Worktree from Task

```bash
# Input: task file path
# Output: worktree path

create_from_task() {
  local task="$1"
  local branch=$(extract_branch "$task")
  local folder=$(normalize_branch "$branch")
  local path=".trees/$folder"

  # Check if already exists
  if [ -d "$path" ]; then
    echo "$path"
    return 0
  fi

  # Create worktree
  mkdir -p .trees
  if git show-ref --verify "refs/heads/$branch" &>/dev/null; then
    git worktree add "$path" "$branch"
  else
    git worktree add "$path" -b "$branch"
  fi

  echo "$path"
}
```

### 2. List Tasks for Worktree

```bash
# Input: branch name
# Output: list of task files

tasks_for_branch() {
  local branch="$1"
  for task in sessions/tasks/*.md; do
    [[ "$task" == *"TEMPLATE"* ]] && continue
    [[ -d "$task" ]] && continue

    local task_branch=$(extract_branch "$task")
    if [ "$task_branch" == "$branch" ]; then
      echo "$task"
    fi
  done
}
```

### 3. Check Cleanup Safety

```bash
# Input: branch name
# Output: true if all tasks completed, false otherwise

safe_to_cleanup() {
  local branch="$1"

  for task in $(tasks_for_branch "$branch"); do
    local status=$(extract_status "$task")
    if [ "$status" != "completed" ]; then
      return 1  # Not safe
    fi
  done

  return 0  # Safe to cleanup
}
```

### 4. Get Task Summary

```bash
# Input: task file
# Output: formatted summary

task_summary() {
  local task="$1"
  local name=$(basename "$task" .md)
  local branch=$(extract_branch "$task")
  local status=$(extract_status "$task")
  local folder=$(normalize_branch "$branch")
  local has_worktree="✗"
  [ -d ".trees/$folder" ] && has_worktree="✓"

  echo "$name [$status] → $branch $has_worktree"
}
```

---

## File Locations

| Item | Path |
|------|------|
| Task files | `sessions/tasks/*.md` |
| Task template | `sessions/tasks/TEMPLATE.md` |
| Task indexes | `sessions/tasks/indexes/*.md` |
| Index template | `sessions/tasks/indexes/INDEX_TEMPLATE.md` |
| Worktrees | `.trees/*/` |
| Worktree state | `.trees/.worktree-state.json` |
| Sessions config | `sessions/sessions-config.json` |

---

## Quick Reference

### Parse Frontmatter

```bash
# All fields
parse_frontmatter() {
  local file="$1"
  sed -n '/^---$/,/^---$/p' "$file" | grep -v "^---$"
}

# Specific field
get_field() {
  local file="$1"
  local field="$2"
  sed -n '/^---$/,/^---$/p' "$file" | grep "^$field:" | sed "s/$field: *//"
}
```

### Common Operations

```bash
# Get branch from task
get_branch "sessions/tasks/m-implement-feature.md"

# Get status from task
get_status "sessions/tasks/m-implement-feature.md"

# Normalize branch to folder
normalize_branch "feature/my-feature"  # → feature-my-feature

# Find tasks for branch
tasks_for_branch "feature/pick-cli"

# Check if safe to cleanup
safe_to_cleanup "feature/pick-cli" && echo "Safe" || echo "Not safe"
```
