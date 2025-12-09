---
name: worktree-orchestrator
description: Use PROACTIVELY whenever user mentions "worktree", "worktrees", "parallel tasks", or "orchestrate". Auto-trigger on "create worktree from task", "show tasks in worktrees", "peek at file in worktree", "list worktrees", or any worktree-related request. Integrates with cc-sessions for task-based worktree management. Handles creation, listing, cleanup, orchestration, and multi-task branch patterns.
---

# Worktree Orchestrator

Git worktree management with cc-sessions integration for parallel task orchestration.

## Bundled Scripts

Execute these directly for deterministic, token-efficient operations:

```bash
# Parse task frontmatter → JSON
python scripts/parse_task.py sessions/tasks/m-implement-feature.md

# List tasks grouped by branch → JSON
python scripts/list_tasks_by_branch.py sessions/tasks

# Get worktree status with task mappings → JSON
python scripts/worktree_status.py sessions/tasks

# Check if safe to cleanup branch → JSON (exits 0 if safe, 1 if not)
python scripts/check_cleanup_safe.py feature/pick-cli sessions/tasks
```

## Quick Decision Matrix

| Request | Action |
|---------|--------|
| "create worktree for X" | Create single worktree |
| "create worktree from task X" | Run `parse_task.py`, create worktree from branch |
| "list worktrees" / "show tasks" | Run `worktree_status.py` |
| "remove worktree X" | Run `check_cleanup_safe.py` first, then remove |

## Orchestrator Pattern

```
/project/                          ← orchestrator (main branch)
├── .trees/                        ← gitignored worktrees
│   ├── feature-pick-cli/          ← worktree for pick-cli tasks
│   └── feature-auth/              ← worktree for auth tasks
└── sessions/tasks/
    ├── m-implement-pick-cli.md         ← branch: feature/pick-cli
    ├── m-implement-pick-preview.md     ← branch: feature/pick-cli (same!)
    └── m-implement-auth.md             ← branch: feature/auth
```

**Key concepts:**
- Orchestrator stays on main/master branch
- **Multiple tasks can share one worktree** (same branch)
- Worktrees keyed by **branch name**, not task name
- Orchestrator can peek into any worktree: `cat .trees/feature-pick-cli/src/file.ts`

## Core Workflows

### Create Worktree from Task

```bash
# 1. Parse task for branch
TASK_INFO=$(python scripts/parse_task.py sessions/tasks/m-implement-feature.md)
BRANCH=$(echo "$TASK_INFO" | jq -r '.branch')
FOLDER=$(echo "$TASK_INFO" | jq -r '.folder')

# 2. Ensure .trees is gitignored
mkdir -p .trees
grep -q "^\.trees/$" .gitignore || echo ".trees/" >> .gitignore

# 3. Create worktree
git worktree add ".trees/$FOLDER" -b "$BRANCH" 2>/dev/null || \
git worktree add ".trees/$FOLDER" "$BRANCH"
```

### Create Worktree (Direct Branch)

```bash
# Normalize branch name
BRANCH="feature/my-feature"
FOLDER="${BRANCH//\//-}"

# Create
git worktree add ".trees/$FOLDER" -b "$BRANCH" main
```

### List Worktrees with Tasks

```bash
python scripts/worktree_status.py sessions/tasks
```

### Cleanup Worktree

```bash
# 1. Check safety (all tasks completed, no uncommitted changes)
python scripts/check_cleanup_safe.py feature/pick-cli sessions/tasks

# 2. If safe, remove
git worktree remove .trees/feature-pick-cli
git branch -d feature/pick-cli  # Optional: delete branch
```

## Quick Reference

```bash
# Git worktree commands
git worktree list                           # List all
git worktree add .trees/name -b branch      # Create new branch
git worktree add .trees/name branch         # Existing branch
git worktree remove .trees/name             # Remove
git worktree prune                          # Clean orphans

# Peek at file in worktree
cat .trees/feature-pick-cli/src/file.ts
```

## Package Manager Detection

| Lock File | Manager |
|-----------|---------|
| pnpm-lock.yaml | pnpm |
| yarn.lock | yarn |
| bun.lockb | bun |
| package-lock.json | npm |

## Common Issues

| Issue | Fix |
|-------|-----|
| "invalid reference" | Use `-b` flag for new branch |
| "already exists" | Directory exists; remove or use different path |
| "already checked out" | Branch in another worktree; navigate there instead |

## Reference Materials

- `references/mode1-single-worktree.md` - Detailed single worktree workflow
- `references/mode2-batch-worktrees.md` - Batch creation
- `references/mode3-cleanup.md` - Cleanup procedures
- `references/mode4-list-manage.md` - List and management
- `references/mode5-orchestrator.md` - Orchestrator operations
- `references/mode6-task-integration.md` - Task file integration
- `references/cc-sessions-integration.md` - Task file format reference
- `references/troubleshooting.md` - Error solutions
- `references/best-practices.md` - Worktree best practices

---

**Version**: 3.0.0 | **Author**: tinymade
