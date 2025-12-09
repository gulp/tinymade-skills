# Mode 5: Orchestrator Operations

## Overview

This mode enables the main worktree to act as an orchestrator for parallel task work. The orchestrator stays on the main/master branch and coordinates work happening in parallel worktrees created from cc-sessions task files.

## When to Use

- User says "create worktree from task [task-name]"
- User says "show tasks in worktrees"
- User says "peek at [file] in [worktree/task]"
- User wants to coordinate multiple parallel tasks
- User says "orchestrate tasks" or "parallel tasks"

## Core Concepts

### Orchestrator Pattern

```
/project/                          ← orchestrator (main/master branch)
├── .trees/                        ← gitignored worktrees
│   ├── feature-pick-cli/          ← worktree for pick-cli tasks
│   └── feature-auth/              ← worktree for auth tasks
└── sessions/tasks/
    ├── m-implement-pick-cli.md         ← branch: feature/pick-cli
    ├── m-implement-pick-preview.md     ← branch: feature/pick-cli (same!)
    └── m-implement-auth.md             ← branch: feature/auth
```

**Key principles:**
- Orchestrator stays on main branch
- Multiple tasks can share a single worktree (same branch)
- Orchestrator can read files from any worktree
- Worktrees are keyed by **branch name**, not task name

---

## Workflow

### Phase 0: Prerequisites

#### Step 0.1: Verify Orchestrator Context

```bash
# Verify we're in a git repo
git rev-parse --is-inside-work-tree

# Check current branch (should be main/master for orchestrator)
CURRENT_BRANCH=$(git branch --show-current)

# Warn if not on main/master
if [[ "$CURRENT_BRANCH" != "main" && "$CURRENT_BRANCH" != "master" ]]; then
  echo "⚠️  Warning: Orchestrator typically runs on main/master branch"
  echo "   Current branch: $CURRENT_BRANCH"
fi
```

#### Step 0.2: Verify cc-sessions Structure

```bash
# Check for sessions/tasks directory
if [ -d "sessions/tasks" ]; then
  echo "✓ cc-sessions task directory found"
else
  echo "✗ No sessions/tasks directory - cc-sessions not installed?"
fi
```

---

### Phase 1: Create Worktree from Task

#### Step 1.1: Parse Task File

**Extract branch from task frontmatter:**

```bash
# Read task file
TASK_FILE="sessions/tasks/m-implement-pick-cli.md"

# Extract branch from YAML frontmatter
BRANCH=$(sed -n '/^---$/,/^---$/p' "$TASK_FILE" | grep "^branch:" | sed 's/branch: *//')

echo "Task: $TASK_FILE"
echo "Branch: $BRANCH"
```

**Example task frontmatter:**
```yaml
---
name: m-implement-pick-cli
branch: feature/pick-cli
status: in-progress
created: 2025-12-07
---
```

#### Step 1.2: Normalize Branch to Folder Name

```bash
# Normalize branch name for folder (/ and _ → -)
FOLDER_NAME="${BRANCH//\//-}"
FOLDER_NAME="${FOLDER_NAME//_/-}"

WORKTREE_PATH=".trees/$FOLDER_NAME"

echo "Worktree path: $WORKTREE_PATH"
```

**Examples:**
- `feature/pick-cli` → `.trees/feature-pick-cli`
- `feature/ui_login` → `.trees/feature-ui-login`
- `bugfix/auth-error` → `.trees/bugfix-auth-error`

#### Step 1.3: Check if Worktree Already Exists

```bash
# Check if worktree already exists for this branch
if git worktree list | grep -q "\[$BRANCH\]"; then
  EXISTING_PATH=$(git worktree list | grep "\[$BRANCH\]" | awk '{print $1}')
  echo "ℹ️  Worktree already exists for branch: $BRANCH"
  echo "   Path: $EXISTING_PATH"
  echo "   No action needed - navigate to existing worktree"
else
  echo "Creating new worktree for branch: $BRANCH"
fi
```

#### Step 1.4: Create Worktree

**Use existing mode1 logic, but with task-derived branch:**

```bash
# Ensure .trees directory exists and is gitignored
mkdir -p .trees
if ! grep -q "^\.trees/$" .gitignore 2>/dev/null; then
  echo ".trees/" >> .gitignore
fi

# Check if branch exists
if git show-ref --verify "refs/heads/$BRANCH" &>/dev/null; then
  # Existing branch
  git worktree add "$WORKTREE_PATH" "$BRANCH"
else
  # New branch
  git worktree add "$WORKTREE_PATH" -b "$BRANCH"
fi
```

#### Step 1.5: Report Success

```
✓ Worktree created from task: m-implement-pick-cli
  Branch: feature/pick-cli
  Path: .trees/feature-pick-cli

Other tasks using this worktree:
  - m-implement-pick-preview.md (same branch)

Next steps:
  cd .trees/feature-pick-cli
  claude
```

---

### Phase 2: List Tasks per Worktree

#### Step 2.1: Gather Worktree Information

```bash
# Get all worktrees
git worktree list
```

#### Step 2.2: Map Tasks to Worktrees

```bash
# For each task file, extract branch and map to worktree
for task in sessions/tasks/*.md; do
  # Skip templates and indexes
  [[ "$task" == *"TEMPLATE"* ]] && continue
  [[ "$task" == *"indexes"* ]] && continue

  # Extract branch from frontmatter
  branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')
  status=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^status:" | sed 's/status: *//')

  # Normalize to folder name
  folder="${branch//\//-}"
  folder="${folder//_/-}"

  echo "$task|$branch|$status|.trees/$folder"
done
```

#### Step 2.3: Display Organized View

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks by Worktree
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

● main (orchestrator)
  /home/user/project
  No tasks assigned to main branch

○ feature/pick-cli → .trees/feature-pick-cli
  ✓ Worktree exists
  Tasks:
    - m-implement-pick-cli.md [in-progress]
    - m-implement-pick-preview.md [pending]
    - m-implement-pick-export.md [completed]

○ feature/auth → .trees/feature-auth
  ✗ Worktree not created
  Tasks:
    - m-implement-auth.md [pending]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Summary: 2 branches, 4 tasks, 1 worktree active
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Phase 3: Peek into Parallel Worktrees

#### Step 3.1: Read File from Worktree

**From orchestrator, read a file in a parallel worktree:**

```bash
# Syntax: peek <worktree-or-branch> <file-path>

WORKTREE_REF="feature-pick-cli"  # Can be branch name or folder name
FILE_PATH="src/picker.ts"

# Normalize to folder path
FOLDER="${WORKTREE_REF//\//-}"
WORKTREE_PATH=".trees/$FOLDER"

# Check worktree exists
if [ -d "$WORKTREE_PATH" ]; then
  if [ -f "$WORKTREE_PATH/$FILE_PATH" ]; then
    cat "$WORKTREE_PATH/$FILE_PATH"
  else
    echo "File not found: $WORKTREE_PATH/$FILE_PATH"
  fi
else
  echo "Worktree not found: $WORKTREE_PATH"
  echo "Available worktrees:"
  ls -la .trees/
fi
```

#### Step 3.2: Compare Files Across Worktrees

```bash
# Compare file between orchestrator and worktree
FILE="src/config.ts"
WORKTREE=".trees/feature-pick-cli"

diff "$FILE" "$WORKTREE/$FILE"
```

#### Step 3.3: Search Across All Worktrees

```bash
# Search for pattern in all worktrees
PATTERN="TODO"

echo "Searching in orchestrator..."
grep -r "$PATTERN" src/

for worktree in .trees/*/; do
  echo ""
  echo "Searching in $worktree..."
  grep -r "$PATTERN" "$worktree/src/" 2>/dev/null || echo "  (no matches)"
done
```

---

### Phase 4: Coordinate Task Status

#### Step 4.1: Show Status Overview

```bash
# Quick status of all tasks and their worktrees
echo "Task Status Overview"
echo "===================="

for task in sessions/tasks/*.md; do
  [[ "$task" == *"TEMPLATE"* ]] && continue
  [[ -d "$task" ]] && continue

  name=$(basename "$task" .md)
  branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')
  status=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^status:" | sed 's/status: *//')

  folder="${branch//\//-}"
  worktree_exists="✗"
  [ -d ".trees/$folder" ] && worktree_exists="✓"

  printf "%-40s %-15s %-20s %s\n" "$name" "[$status]" "$branch" "$worktree_exists"
done
```

#### Step 4.2: Sync Check

```bash
# Check if worktrees are in sync with main
for worktree in .trees/*/; do
  branch=$(cd "$worktree" && git branch --show-current)
  behind=$(cd "$worktree" && git rev-list --count HEAD..origin/main 2>/dev/null || echo "?")
  ahead=$(cd "$worktree" && git rev-list --count origin/main..HEAD 2>/dev/null || echo "?")

  echo "$worktree ($branch): $ahead ahead, $behind behind main"
done
```

---

## Quick Reference Commands

```bash
# Create worktree from task
# (reads branch from task frontmatter)
peek_task() {
  TASK="$1"
  BRANCH=$(sed -n '/^---$/,/^---$/p' "sessions/tasks/$TASK" | grep "^branch:" | sed 's/branch: *//')
  FOLDER="${BRANCH//\//-}"

  if [ ! -d ".trees/$FOLDER" ]; then
    git worktree add ".trees/$FOLDER" -b "$BRANCH" 2>/dev/null || \
    git worktree add ".trees/$FOLDER" "$BRANCH"
  fi

  echo ".trees/$FOLDER"
}

# List all task-worktree mappings
list_task_worktrees() {
  for task in sessions/tasks/*.md; do
    [[ "$task" == *"TEMPLATE"* ]] && continue
    branch=$(sed -n '/^---$/,/^---$/p' "$task" | grep "^branch:" | sed 's/branch: *//')
    echo "$(basename $task): $branch"
  done
}

# Peek at file in worktree
peek_file() {
  BRANCH="$1"
  FILE="$2"
  FOLDER="${BRANCH//\//-}"
  cat ".trees/$FOLDER/$FILE"
}
```

---

## Error Handling

### Error: Task Has No Branch Field

```
Error: Task file has no branch field

Task: m-implement-feature.md

The task file must have a branch field in the YAML frontmatter:
---
name: m-implement-feature
branch: feature/feature-name    ← Missing!
status: pending
---

Solution: Add a branch field to the task file
```

### Error: Branch Already in Use

```
Error: Branch is already checked out in another worktree

Branch: feature/pick-cli
Existing worktree: .trees/feature-pick-cli

This is expected for multi-task branches!
Navigate to existing worktree: cd .trees/feature-pick-cli
```

### Error: Worktree Not Found for Peek

```
Error: Worktree not found for peek operation

Requested: feature/auth
Path tried: .trees/feature-auth

Available worktrees:
  .trees/feature-pick-cli
  .trees/bugfix-login

Solution: Create worktree first:
  "Create worktree from task m-implement-auth.md"
```

---

## Success Criteria

- [ ] Can create worktree from task file (reads branch from frontmatter)
- [ ] Can list tasks grouped by worktree/branch
- [ ] Can peek at files in parallel worktrees from orchestrator
- [ ] Can show task status across all worktrees
- [ ] Handles multi-task → same branch pattern correctly
- [ ] Orchestrator stays on main/master branch

---

## Example: Complete Orchestrator Flow

```
User: Show me the tasks and their worktrees

Claude:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Tasks by Worktree
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

● main (orchestrator) ← you are here
  /home/user/project

○ feature/pick-cli → .trees/feature-pick-cli ✓
  Tasks:
    - m-implement-pick-cli.md [completed]
    - m-implement-pick-preview.md [in-progress]

○ feature/auth → .trees/feature-auth ✗
  Tasks:
    - m-implement-auth.md [pending]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

User: Create worktree for the auth task

Claude:
Creating worktree from task: m-implement-auth.md
  Branch: feature/auth
  Path: .trees/feature-auth

✓ Worktree created successfully!

Next steps:
  cd .trees/feature-auth
  claude

User: Peek at src/auth.ts in the pick-cli worktree

Claude:
Reading: .trees/feature-pick-cli/src/auth.ts

[file contents displayed]
```
