# Worktree Orchestrator - Quick Start

## Installation

```bash
# Add the marketplace to Claude Code
/plugin marketplace add tinymade/tinymade-skills

# Or for local development
/plugin marketplace add /path/to/tinymade-skills
```

Restart Claude Code after installation.

## Test the Scripts

```bash
cd /path/to/your/cc-sessions-project

# 1. Parse a task file
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/parse_task.py sessions/tasks/m-implement-feature.md

# 2. List tasks grouped by branch
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/list_tasks_by_branch.py sessions/tasks

# 3. Get worktree status
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/worktree_status.py sessions/tasks

# 4. Check if safe to cleanup
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/check_cleanup_safe.py feature/my-branch sessions/tasks

# 5. Spawn terminal in worktree (autonomous mode)
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/spawn_terminal.py --worktree .trees/feature-foo --autonomous --task m-implement-foo

# 6. Spawn terminal in worktree (interactive mode)
python /path/to/tinymade-skills/plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/spawn_terminal.py --worktree .trees/feature-foo --task m-implement-foo
```

## Basic Usage

### Create Worktree from Task

```
User: Create a worktree from task m-implement-auth.md
```

Claude will:
1. Parse task frontmatter for branch
2. Create `.trees/{branch-normalized}/`
3. Install dependencies
4. Report success

### Create Worktree with Terminal

```
User: Create a worktree from task m-implement-auth.md and open a terminal
```

Claude will create the worktree and spawn a terminal with Claude auto-started.

### List Worktrees with Tasks

```
User: Show my worktrees and their tasks
```

### Peek at Files

```
User: Show me src/auth.ts in the feature-auth worktree
```

### Cleanup

```
User: Remove the feature-auth worktree
```

Claude will check if all tasks are completed before removing.

## Orchestrator Pattern

Keep your main branch as the "orchestrator" that coordinates parallel work:

```
your-project/
├── .trees/                    ← All worktrees here (gitignored)
│   ├── feature-auth/
│   └── feature-dashboard/
└── sessions/tasks/
    ├── m-implement-auth.md         → branch: feature/auth
    └── m-implement-dashboard.md    → branch: feature/dashboard
```

From the orchestrator (main branch), you can:
- See all worktrees and their tasks
- Peek into any worktree's files
- Coordinate parallel work

## Requirements

- Python 3.8+
- Git
- cc-sessions (for task integration)
