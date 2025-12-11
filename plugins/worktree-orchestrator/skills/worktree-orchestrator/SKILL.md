---
name: worktree-orchestrator
description: Use PROACTIVELY whenever user mentions "worktree", "worktrees", "parallel tasks", "orchestrate", or "fork terminal". Auto-trigger on "create worktree from task", "show tasks in worktrees", "peek at file in worktree", "list worktrees", "open terminal in worktree", or any worktree-related request. Integrates with cc-sessions for task-based worktree management. Handles creation, listing, cleanup, orchestration, terminal spawning, and multi-task branch patterns.
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

# Spawn terminal in worktree (with optional claude auto-start)
python scripts/spawn_terminal.py --worktree .trees/feature-foo --task m-implement-foo
python scripts/spawn_terminal.py --worktree .trees/feature-foo  # just shell
python scripts/spawn_terminal.py --worktree .trees/feature-foo --command "vim ."
```

## Quick Decision Matrix

| Request | Action |
|---------|--------|
| "create worktree for X" | Create single worktree |
| "create worktree from task X" | Run `parse_task.py`, create worktree from branch |
| "create worktree and open terminal" | Create worktree + run `spawn_terminal.py` |
| "open terminal in worktree X" | Run `spawn_terminal.py --worktree X` |
| "fork terminal for task X" | Run `spawn_terminal.py --worktree X --task X` |
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

## Terminal Spawning

Spawn terminals in worktrees with optional Claude auto-start.

### Configuration

Create `.worktree-orchestrator.yaml` in project root (optional):

```yaml
terminal:
  emulator: alacritty  # or kitty, wezterm, gnome-terminal, konsole
  claude:
    auto_start: true
    prompt_template: |
      You are in a worktree at {worktree_path} on branch {branch}.
      Task files are located at {tasks_path}.
      start^ {task_name}
```

**Fallback chain:** Config file → `$WORKTREE_TERMINAL` → `$TERMINAL` → alacritty

### Spawn Terminal with Claude + Task

```bash
# Parse task, create worktree, spawn terminal with claude
TASK_INFO=$(python scripts/parse_task.py sessions/tasks/m-implement-feature.md)
BRANCH=$(echo "$TASK_INFO" | jq -r '.branch')
FOLDER=$(echo "$TASK_INFO" | jq -r '.folder')
TASK_NAME=$(echo "$TASK_INFO" | jq -r '.name')

# Create worktree if needed
git worktree add ".trees/$FOLDER" "$BRANCH" 2>/dev/null || true

# Spawn terminal with claude auto-start
python scripts/spawn_terminal.py \
  --worktree ".trees/$FOLDER" \
  --task "$TASK_NAME" \
  --project-root "$(pwd)"
```

### Spawn Terminal (Shell Only)

```bash
python scripts/spawn_terminal.py --worktree .trees/feature-foo
```

### Spawn Terminal (Custom Command)

```bash
python scripts/spawn_terminal.py --worktree .trees/feature-foo --command "vim ."
```

### spawn_terminal.py Options

| Flag | Description |
|------|-------------|
| `--worktree, -w` | Path to worktree (required) |
| `--task, -t` | Task name → spawns claude with task-specific prompt and enables autonomous mode |
| `--command, -c` | Custom command instead of claude |
| `--project-root, -r` | Project root for relative paths (default: cwd) |
| `--bypass-sessions, -b` | Configure cc-sessions for autonomous work (sets mode=implementation, bypass_mode=true) |
| `--no-bypass-sessions` | Do NOT configure cc-sessions bypass (default: bypass enabled when --task is used) |
| `--dry-run, -n` | Print command without executing |
| `--json, -j` | Output JSON |

### Autonomous Mode (cc-sessions Integration)

When `--task` flag is provided, spawn_terminal.py automatically:

1. **Configures cc-sessions state** (before Claude starts):
   - Sets `mode: "implementation"` to skip discussion phase
   - Enables `bypass_mode: true` to disable DAIC enforcement
   - Clears `todos.active` to prevent blocking
   - Sets `current_task` with task name and status
   - Creates `sessions-state.json` if it doesn't exist (fresh worktree)

2. **Injects autonomous instructions** into prompt template:
   - Tells Claude it's in AUTONOMOUS MODE
   - Instructs to self-approve implementation plans immediately
   - Directs not to wait for human confirmation
   - Tells Claude to work through entire todo list

3. **Enables permission bypass**:
   - Uses `--dangerously-skip-permissions` flag with Claude
   - Allows uninterrupted autonomous agent execution without permission dialogs

**Example: Spawn autonomous agent for a task**

```bash
python scripts/spawn_terminal.py --worktree .trees/feature-foo --task m-implement-foo
```

This spawns a Claude instance that will:
- Load task file `m-implement-foo.md`
- Skip DAIC discussion phase (implementation mode)
- Self-approve implementation plan
- Execute without pausing for confirmation
- Commit work when complete

**To spawn without autonomous mode** (requires manual approval):

```bash
python scripts/spawn_terminal.py --worktree .trees/feature-foo --no-bypass-sessions --command "claude"
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

**Version**: 3.1.0 | **Author**: tinymade
