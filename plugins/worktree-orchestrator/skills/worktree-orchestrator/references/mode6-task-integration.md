# Mode 6: cc-sessions Task Integration

## Overview

This mode provides deep integration with cc-sessions task files, enabling worktree operations that understand task frontmatter, multi-task branches, task indexes, and task lifecycle states.

## When to Use

- Working with cc-sessions task files
- Need to understand task → branch → worktree relationships
- Managing multiple tasks on the same branch
- Syncing task status with worktree state

## Core Concepts

### Task File Structure

cc-sessions task files have YAML frontmatter:

```yaml
---
name: m-implement-pick-cli
branch: feature/pick-cli
status: pending|in-progress|completed|blocked
created: 2025-12-07
---

# Task Title

## Problem/Goal
...

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

### Multi-Task → Single Branch Pattern

cc-sessions supports multiple tasks sharing a single branch:

```
sessions/tasks/
├── m-implement-pick-cli.md        → branch: feature/pick-cli
├── m-implement-pick-preview.md    → branch: feature/pick-cli  (same!)
├── m-implement-pick-export.md     → branch: feature/pick-cli  (same!)
└── m-implement-auth.md            → branch: feature/auth
```

**Result:**
- `.trees/feature-pick-cli/` serves ALL three pick tasks
- `.trees/feature-auth/` serves the auth task
- Worktrees are keyed by **branch**, not task

### Task Indexes

Task indexes group related tasks:

```
sessions/tasks/indexes/
└── cc-prism.md
```

Index file structure:
```yaml
---
index: cc-prism
name: cc-prism Development
description: Tasks for building cc-prism
---

# cc-prism Development

## Active Tasks

### Medium Priority
- `m-implement-pick-cli.md` - Interactive TUI
- `m-implement-pick-preview.md` - Preview mode

## Completed Tasks
- `m-implement-diff.md` - Diff visualization
```

---

## Workflow

### Phase 1: Parse Task Frontmatter

#### Step 1.1: Extract All Frontmatter Fields

```bash
parse_task_frontmatter() {
  local task_file="$1"

  # Extract frontmatter block
  local frontmatter=$(sed -n '/^---$/,/^---$/p' "$task_file" | grep -v "^---$")

  # Parse each field
  local name=$(echo "$frontmatter" | grep "^name:" | sed 's/name: *//')
  local branch=$(echo "$frontmatter" | grep "^branch:" | sed 's/branch: *//')
  local status=$(echo "$frontmatter" | grep "^status:" | sed 's/status: *//')
  local created=$(echo "$frontmatter" | grep "^created:" | sed 's/created: *//')

  echo "NAME=$name"
  echo "BRANCH=$branch"
  echo "STATUS=$status"
  echo "CREATED=$created"
}

# Usage
eval $(parse_task_frontmatter "sessions/tasks/m-implement-pick-cli.md")
echo "Task $NAME is on branch $BRANCH with status $STATUS"
```

#### Step 1.2: Validate Task File

```bash
validate_task_file() {
  local task_file="$1"
  local errors=()

  # Check file exists
  if [ ! -f "$task_file" ]; then
    errors+=("File not found: $task_file")
  fi

  # Check has frontmatter
  if ! grep -q "^---$" "$task_file"; then
    errors+=("No YAML frontmatter found")
  fi

  # Check required fields
  local branch=$(sed -n '/^---$/,/^---$/p' "$task_file" | grep "^branch:")
  if [ -z "$branch" ]; then
    errors+=("Missing required field: branch")
  fi

  local name=$(sed -n '/^---$/,/^---$/p' "$task_file" | grep "^name:")
  if [ -z "$name" ]; then
    errors+=("Missing required field: name")
  fi

  # Report errors
  if [ ${#errors[@]} -gt 0 ]; then
    echo "✗ Validation failed for $task_file:"
    for err in "${errors[@]}"; do
      echo "  - $err"
    done
    return 1
  fi

  echo "✓ Task file valid: $task_file"
  return 0
}
```

---

### Phase 2: Handle Multi-Task Branches

#### Step 2.1: Find All Tasks for a Branch

```bash
find_tasks_for_branch() {
  local target_branch="$1"
  local matching_tasks=()

  for task in sessions/tasks/*.md; do
    # Skip non-task files
    [[ "$task" == *"TEMPLATE"* ]] && continue
    [[ -d "$task" ]] && continue

    local branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')

    if [ "$branch" == "$target_branch" ]; then
      matching_tasks+=("$task")
    fi
  done

  printf '%s\n' "${matching_tasks[@]}"
}

# Usage
echo "Tasks on feature/pick-cli:"
find_tasks_for_branch "feature/pick-cli"
```

#### Step 2.2: Group Tasks by Branch

```bash
group_tasks_by_branch() {
  declare -A branch_tasks

  for task in sessions/tasks/*.md; do
    [[ "$task" == *"TEMPLATE"* ]] && continue
    [[ -d "$task" ]] && continue

    local branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')
    local name=$(basename "$task")

    if [ -n "$branch" ]; then
      if [ -z "${branch_tasks[$branch]}" ]; then
        branch_tasks[$branch]="$name"
      else
        branch_tasks[$branch]="${branch_tasks[$branch]},$name"
      fi
    fi
  done

  # Output
  for branch in "${!branch_tasks[@]}"; do
    echo "$branch:"
    IFS=',' read -ra tasks <<< "${branch_tasks[$branch]}"
    for task in "${tasks[@]}"; do
      echo "  - $task"
    done
  done
}
```

#### Step 2.3: Display Multi-Task Warning

When creating a worktree for a task that shares a branch:

```
Creating worktree for: m-implement-pick-preview.md
Branch: feature/pick-cli

ℹ️  Note: This branch is shared by multiple tasks:
  - m-implement-pick-cli.md [completed]
  - m-implement-pick-preview.md [in-progress] ← this task
  - m-implement-pick-export.md [pending]

All tasks will use the same worktree: .trees/feature-pick-cli
```

---

### Phase 3: Task Status Synchronization

#### Step 3.1: Check Task Status

```bash
get_task_status() {
  local task_file="$1"
  sed -n '/^---$/,/^---$/p' "$task_file" | grep "^status:" | sed 's/status: *//'
}

# Status values: pending, in-progress, completed, blocked
```

#### Step 3.2: Recommend Actions Based on Status

```bash
recommend_action() {
  local task_file="$1"
  local status=$(get_task_status "$task_file")
  local branch=$(sed -n '/^---$/,/^---$/p' "$task_file" | grep "^branch:" | sed 's/branch: *//')
  local folder="${branch//\//-}"
  local worktree_exists=false
  [ -d ".trees/$folder" ] && worktree_exists=true

  case "$status" in
    pending)
      if [ "$worktree_exists" = true ]; then
        echo "Task is pending. Worktree exists at .trees/$folder"
        echo "Action: Navigate to worktree and start work"
      else
        echo "Task is pending. No worktree yet."
        echo "Action: Create worktree to begin work"
      fi
      ;;

    in-progress)
      if [ "$worktree_exists" = true ]; then
        echo "Task is in progress. Worktree at .trees/$folder"
        echo "Action: Continue work in worktree"
      else
        echo "⚠️  Task is in-progress but no worktree exists!"
        echo "Action: Create worktree or update task status"
      fi
      ;;

    completed)
      if [ "$worktree_exists" = true ]; then
        echo "Task is completed but worktree still exists."
        echo "Action: Consider cleanup if branch is merged"
      else
        echo "Task is completed. No worktree (expected)."
      fi
      ;;

    blocked)
      echo "Task is blocked."
      echo "Action: Review blockers before proceeding"
      ;;
  esac
}
```

#### Step 3.3: Worktree Cleanup Recommendations

```bash
recommend_cleanup() {
  echo "Cleanup Recommendations"
  echo "======================="

  for task in sessions/tasks/*.md; do
    [[ "$task" == *"TEMPLATE"* ]] && continue
    [[ -d "$task" ]] && continue

    local status=$(get_task_status "$task")
    local branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')
    local folder="${branch//\//-}"

    # Only check completed tasks
    if [ "$status" == "completed" ] && [ -d ".trees/$folder" ]; then
      # Check if ALL tasks on this branch are completed
      local all_complete=true
      for other_task in $(find_tasks_for_branch "$branch"); do
        local other_status=$(get_task_status "$other_task")
        if [ "$other_status" != "completed" ]; then
          all_complete=false
          break
        fi
      done

      if [ "$all_complete" = true ]; then
        echo "✓ .trees/$folder - All tasks completed, safe to remove"
      else
        echo "⚠️  .trees/$folder - Some tasks still active, keep worktree"
      fi
    fi
  done
}
```

---

### Phase 4: Task Index Integration

#### Step 4.1: Parse Task Index

```bash
parse_task_index() {
  local index_file="$1"

  echo "Index: $(basename "$index_file" .md)"
  echo ""

  # Extract task references (lines starting with - `)
  grep -E "^- \`[^`]+\.md\`" "$index_file" | while read -r line; do
    # Extract task filename
    task=$(echo "$line" | grep -oP '`\K[^`]+\.md')
    # Extract description
    desc=$(echo "$line" | sed 's/.*\.md`[^-]*- //')

    if [ -f "sessions/tasks/$task" ]; then
      status=$(get_task_status "sessions/tasks/$task")
      echo "  [$status] $task - $desc"
    else
      echo "  [missing] $task - $desc"
    fi
  done
}
```

#### Step 4.2: Show Index Overview

```
Index: cc-prism
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Active Tasks (by priority):

High Priority:
  (none)

Medium Priority:
  [in-progress] m-implement-pick-cli.md
    Branch: feature/pick-cli
    Worktree: .trees/feature-pick-cli ✓

  [pending] m-implement-pick-preview.md
    Branch: feature/pick-cli
    Worktree: .trees/feature-pick-cli ✓ (shared)

Low Priority:
  (none)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Phase 5: Worktree State File

For tracking task↔worktree relationships persistently:

#### Step 5.1: State File Structure

`.trees/.worktree-state.json`:
```json
{
  "worktrees": {
    "feature-pick-cli": {
      "branch": "feature/pick-cli",
      "path": ".trees/feature-pick-cli",
      "created": "2025-12-07T10:30:00Z",
      "tasks": [
        "m-implement-pick-cli.md",
        "m-implement-pick-preview.md"
      ],
      "lastAccessed": "2025-12-08T14:00:00Z"
    }
  },
  "version": "1.0"
}
```

#### Step 5.2: Update State on Worktree Creation

```bash
update_worktree_state() {
  local branch="$1"
  local folder="${branch//\//-}"
  local state_file=".trees/.worktree-state.json"

  # Find tasks for this branch
  local tasks=$(find_tasks_for_branch "$branch" | xargs -I{} basename {} | tr '\n' ',' | sed 's/,$//')

  # Create or update state file (using jq if available)
  if command -v jq &> /dev/null; then
    if [ -f "$state_file" ]; then
      jq --arg folder "$folder" \
         --arg branch "$branch" \
         --arg path ".trees/$folder" \
         --arg tasks "$tasks" \
         '.worktrees[$folder] = {
           branch: $branch,
           path: $path,
           tasks: ($tasks | split(",")),
           lastAccessed: (now | todate)
         }' "$state_file" > "${state_file}.tmp" && mv "${state_file}.tmp" "$state_file"
    else
      echo '{"worktrees":{},"version":"1.0"}' | jq --arg folder "$folder" \
         --arg branch "$branch" \
         --arg path ".trees/$folder" \
         --arg tasks "$tasks" \
         '.worktrees[$folder] = {
           branch: $branch,
           path: $path,
           tasks: ($tasks | split(",")),
           created: (now | todate)
         }' > "$state_file"
    fi
  fi
}
```

---

## Quick Reference

```bash
# Parse task frontmatter
get_branch() { sed -n '/^---$/,/^---$/p' "$1" | grep "^branch:" | sed 's/branch: *//'; }
get_status() { sed -n '/^---$/,/^---$/p' "$1" | grep "^status:" | sed 's/status: *//'; }
get_name() { sed -n '/^---$/,/^---$/p' "$1" | grep "^name:" | sed 's/name: *//'; }

# Find all tasks for a branch
tasks_for_branch() { grep -l "^branch: $1$" sessions/tasks/*.md 2>/dev/null; }

# Check if worktree exists for task
has_worktree() {
  local branch=$(get_branch "$1")
  local folder="${branch//\//-}"
  [ -d ".trees/$folder" ]
}
```

---

## Error Handling

### Error: Task File Missing Branch

```
Error: Task file has no branch field

File: sessions/tasks/m-implement-feature.md

Required frontmatter format:
---
name: m-implement-feature
branch: feature/feature-name   ← Required!
status: pending
created: 2025-12-08
---

Solution: Add the branch field to the task file
```

### Error: Inconsistent Task Status

```
Warning: Task status inconsistency detected

Task: m-implement-pick-cli.md
Status in file: completed
Worktree: .trees/feature-pick-cli (still exists)

Other tasks on this branch:
  - m-implement-pick-preview.md [in-progress]

Recommendation: Keep worktree (other tasks still active)
```

---

## Success Criteria

- [ ] Can parse task frontmatter (name, branch, status, created)
- [ ] Can find all tasks sharing a branch
- [ ] Can group tasks by branch
- [ ] Can recommend actions based on task status
- [ ] Can identify cleanup candidates (all tasks completed)
- [ ] Can integrate with task indexes
- [ ] Can maintain worktree state file
