---
name: task-breakdown
description: Use PROACTIVELY when user says "break down this task", "create subtasks for", "decompose task into", "plan subtasks", or when a task has > 5 success criteria suggesting complexity. Auto-trigger when directory task is started without subtasks.
---

# Task Breakdown

Systematic task decomposition into cc-sessions directory structure with subtasks and index management. Automates the manual process of breaking complex tasks into manageable phases.

## When to Use

- User requests task breakdown or subtask creation
- Task file has many success criteria (> 5) suggesting complexity
- Directory task exists but has no subtask files
- User wants to plan parallel work via worktree-orchestrator

## Bundled Scripts

Execute these directly for deterministic, token-efficient operations:

```bash
# Analyze task file and extract metadata for breakdown
bun scripts/analyze_task.ts sessions/tasks/h-implement-system.md

# Generate subtask files from a breakdown proposal
bun scripts/generate_subtasks.ts --parent h-implement-system --subtasks '[...]'

# Update index entries to reflect directory structure
bun scripts/update_indexes.ts --task h-implement-system
```

## Quick Decision Matrix

| Request | Action |
|---------|--------|
| "break down this task" | Run full breakdown workflow below |
| "create subtasks for X" | Analyze task → propose subtasks → generate files |
| "how many subtasks?" | Run `analyze_task.ts` and count success criteria |
| "convert to directory task" | Create directory, move file to README.md |

## Core Workflow: Task Breakdown

### Step 1: Analyze Parent Task

```bash
# Get task metadata and complexity indicators
TASK_INFO=$(bun scripts/analyze_task.ts sessions/tasks/[task-file].md --json)
```

Output includes:
- `name`: Task name from frontmatter
- `branch`: Branch for all subtasks (inherited)
- `success_criteria`: Array of criteria (used to propose subtasks)
- `is_directory`: Whether already a directory task
- `has_subtasks`: Whether subtask files exist

### Step 2: Propose Subtask Breakdown

Based on analysis, propose subtasks to user:

```markdown
[PREVIEW: Task Breakdown]

Parent Task: h-implement-parallel-agent-system
Branch: feature/parallel-agent-system
Success Criteria: 8 items

Proposed Subtasks:

1. 01-core-infrastructure.md
   - Problem: [derived from criteria 1-2]
   - Success: [specific measurable outcomes]

2. 02-agent-communication.md
   - Problem: [derived from criteria 3-4]
   - Success: [specific measurable outcomes]

3. 03-monitoring-integration.md
   - Problem: [derived from criteria 5-6]
   - Success: [specific measurable outcomes]

This will create:
- Directory: sessions/tasks/h-implement-parallel-agent-system/
- Parent: README.md (moved from .md file)
- 3 subtask files with frontmatter

Approve this breakdown? (yes/no/revise)
```

### Step 3: Generate Subtask Files

After user approval:

```bash
# Generate subtasks from approved proposal
bun scripts/generate_subtasks.ts \
  --parent h-implement-parallel-agent-system \
  --subtasks '[
    {"name": "01-core-infrastructure", "problem": "...", "criteria": ["...", "..."]},
    {"name": "02-agent-communication", "problem": "...", "criteria": ["...", "..."]}
  ]'
```

This creates:
- Directory structure (if not exists)
- Moves parent .md to README.md (if converting)
- Creates subtask files with proper frontmatter:
  ```yaml
  ---
  name: 01-core-infrastructure
  parent: h-implement-parallel-agent-system
  status: pending
  created: 2025-12-14
  ---
  ```
- Updates parent README.md with "## Subtasks" section

### Step 4: Update Indexes

```bash
# Update index entries to show directory notation
bun scripts/update_indexes.ts --task h-implement-parallel-agent-system
```

This:
- Finds indexes containing the task
- Updates entry from `task.md` to `task/` format
- Preserves description text

## Subtask File Structure

Subtask files follow this format:

```markdown
---
name: 01-subtask-name
parent: parent-task-name
status: pending
created: YYYY-MM-DD
---

# [Subtask Title]

## Problem/Goal
[Specific problem this subtask addresses]

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Context Manifest
<!-- Added by context-gathering agent if needed -->

## Work Log
- [YYYY-MM-DD] Subtask created from breakdown
```

## Key Conventions

### Naming
- Parent tasks: `[priority]-[type]-[descriptive-name]` (e.g., `h-implement-auth`)
- Subtasks: `[01-99]-[descriptive-name].md` (e.g., `01-core-setup.md`)
- Numeric prefix ensures filesystem ordering

### Frontmatter
- **Parent tasks** have `branch` field
- **Subtasks** have `parent` field, NO `branch` field (inherit from parent)
- All share the same branch for worktree-orchestrator compatibility

### Directory Structure
```
sessions/tasks/h-implement-system/
├── README.md              ← Parent task (has branch field)
├── 01-phase-one.md        ← Subtask (has parent field)
├── 02-phase-two.md
└── 03-phase-three.md
```

## Integration with Worktree-Orchestrator

After breakdown, tasks are ready for parallel execution:

```bash
# Parse parent to get branch
BRANCH=$(bun scripts/analyze_task.ts sessions/tasks/h-implement-system/README.md --json | jq -r '.branch')

# Create worktree for all subtasks (via worktree-orchestrator)
git worktree add .trees/${BRANCH//\//-} $BRANCH

# Spawn agent for specific subtask
python plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/spawn_terminal.py \
  --worktree .trees/feature-system \
  --autonomous \
  --task h-implement-system/01-phase-one.md
```

## Error Handling

| Error | Resolution |
|-------|------------|
| Task file not found | Verify path, check if in `done/` directory |
| Already a directory task | Skip conversion, proceed with subtask creation |
| No success criteria | Ask user to define criteria first |
| Index not found | Skip index update, warn user |
