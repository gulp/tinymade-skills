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

## Interactive Breakdown Workflow

For complex tasks or when user wants collaborative breakdown, use this conversational flow instead of the automated workflow above.

### Phase 1: Initial Analysis

```bash
# Get task metadata
TASK_INFO=$(bun scripts/analyze_task.ts sessions/tasks/[task-file].md --json)
```

Present findings to user:

```markdown
[ANALYSIS: Task Complexity]

Task: [name]
Branch: [branch]
Success Criteria: [count] items
Complexity: [low/medium/high]

The task has [count] success criteria, suggesting [assessment].

Before I propose subtasks, I have some questions:
```

### Phase 2: Clarifying Questions

Ask these questions based on task characteristics:

**Scope Questions** (ask when criteria seem overlapping):
- "Criteria 2 and 5 both mention [X]. Should these be in the same subtask or separate?"
- "Is [feature Y] a prerequisite for [feature Z], or can they be worked in parallel?"

**Dependency Questions** (ask when order matters):
- "Does the [component] need to exist before [other component] can be built?"
- "Are there any external dependencies (APIs, libraries) that might block certain subtasks?"

**Priority Questions** (ask when not obvious):
- "Which criteria are most critical to the overall task success?"
- "Are there any criteria that could be deferred to a follow-up task?"

**Granularity Questions** (ask when criteria are broad):
- "Criterion [X] seems broad. Should it be split into multiple subtasks?"
- "How detailed should each subtask be? Prefer fewer large subtasks or more small ones?"

### Phase 3: Collaborative Refinement

After gathering answers, present refined proposal:

```markdown
[REFINED PROPOSAL: Task Breakdown]

Based on your input, here's the adjusted breakdown:

1. 01-[name].md (prerequisite for 2, 3)
   - Problem: [refined based on discussion]
   - Success: [criteria derived from user input]
   - Note: [any special considerations mentioned]

2. 02-[name].md (can parallel with 3)
   - Problem: [...]
   - Success: [...]

3. 03-[name].md (can parallel with 2)
   - Problem: [...]
   - Success: [...]

Dependencies: 1 → (2, 3)
Parallel opportunities: Subtasks 2 and 3 can run simultaneously after 1 completes.

Changes from initial proposal:
- [What changed and why based on user feedback]

Ready to generate these subtasks? (yes/revise/cancel)
```

### Phase 4: Iterative Adjustment

If user says "revise":
- Ask which specific subtask(s) need adjustment
- Gather specific feedback
- Re-present updated proposal
- Repeat until user approves

### When to Use Interactive vs Automated

| Situation | Mode |
|-----------|------|
| User says "break down quickly" | Automated (Core Workflow) |
| User says "help me plan" | Interactive |
| Task has > 8 criteria | Interactive (recommend) |
| Criteria have unclear dependencies | Interactive |
| User is unfamiliar with codebase | Interactive |
| Simple, obvious breakdown | Automated |

## Clarifying Question Templates

Reference these when asking questions during interactive breakdown:

### Scope & Boundaries
- "Should [X] include [Y] or is that separate work?"
- "Where does this subtask's responsibility end and the next begin?"
- "Is [edge case] in scope for this breakdown?"

### Technical Dependencies
- "Does [A] need to be complete before [B] can start?"
- "Are there shared utilities/types that multiple subtasks will need?"
- "Which subtask should own the shared infrastructure?"

### Priority & Ordering
- "If we could only complete 2 of these 4 subtasks, which would you prioritize?"
- "Is there a critical path through these subtasks?"
- "Any subtasks that are nice-to-have vs must-have?"

### Complexity Assessment
- "This criterion seems complex. Is it actually multiple tasks in disguise?"
- "Should this be 2 smaller subtasks or 1 larger one?"
- "Are there unknowns here that suggest a research/spike subtask first?"

### Integration Points
- "How should subtask [X] hand off to subtask [Y]?"
- "What's the integration test strategy across subtasks?"
- "Should there be a final integration subtask?"

## Post-Breakdown: Worktree Setup

After breakdown is complete, optionally set up parallel execution:

### Quick Setup (Single Worktree)

```bash
# 1. Get branch from parent task
BRANCH=$(bun scripts/analyze_task.ts sessions/tasks/[task-dir]/README.md --json | jq -r '.branch')
FOLDER=${BRANCH//\//-}

# 2. Create worktree
git worktree add .trees/$FOLDER $BRANCH

# 3. Verify setup
ls .trees/$FOLDER
```

### Spawn Agents for Subtasks

Using worktree-orchestrator:

```bash
# Spawn autonomous agent for a specific subtask
python plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/spawn_terminal.py \
  --worktree .trees/$FOLDER \
  --autonomous \
  --task [task-dir]/01-first-subtask.md
```

### Full Parallel Setup

For maximum parallelism (one agent per subtask):

```bash
# List all subtasks
SUBTASKS=$(ls sessions/tasks/[task-dir]/*.md | grep -v README.md)

# Create worktree (shared by all subtasks)
git worktree add .trees/$FOLDER $BRANCH

# Spawn agent for each subtask
for subtask in $SUBTASKS; do
  python plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/spawn_terminal.py \
    --worktree .trees/$FOLDER \
    --autonomous \
    --task "$subtask"
done
```

**Note**: All subtasks share the same branch/worktree. This is by design - subtasks are phases of the same feature, not independent features.

### Worktree Cleanup

After all subtasks complete:

```bash
# Check if safe to remove
python plugins/worktree-orchestrator/skills/worktree-orchestrator/scripts/check_cleanup_safe.py .trees/$FOLDER

# Remove worktree
git worktree remove .trees/$FOLDER
```

## Error Handling

| Error | Resolution |
|-------|------------|
| Task file not found | Verify path, check if in `done/` directory |
| Already a directory task | Skip conversion, proceed with subtask creation |
| No success criteria | Ask user to define criteria first |
| Index not found | Skip index update, warn user |
| Worktree already exists | Use existing worktree or remove first |
| Branch doesn't exist | Create branch from main before worktree setup |
