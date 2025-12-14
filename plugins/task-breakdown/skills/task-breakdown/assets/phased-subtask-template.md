---
name: P[PHASE]_[TASK]_[descriptive-name]
parent: [parent-task-name]
phase: [PHASE_NUMBER]
parallel: [true|false]
depends_on: []
blocks: []
status: pending
created: YYYY-MM-DD
---

# Task: [Specific Task Name]

## Context
This task is part of a larger project breakdown for: [Original Task Title]

### Task Position
- **Phase**: Phase [X] - [Parallel/Sequential]
- **Task ID**: P[X]_[Y] (e.g., P1_2 = Phase 1, Task 2)
- **Execution**: [Runs in parallel with P1_1, P1_3 / Runs after P1 completes / etc.]

### Related Tasks
- **Dependencies**: [List tasks this depends on, if any]
- **Parallel Tasks**: [List tasks running in same phase]
- **Dependent Tasks**: [List tasks that depend on this one]
- **Shared Resources**: [APIs, databases, or files used by multiple tasks]

## Objective
[Clear, specific objective for this subtask]

## Detailed Requirements
[Specific implementation details and requirements]

## Success Criteria
- [ ] [Specific measurable outcome 1]
- [ ] [Specific measurable outcome 2]

## Context Manifest
<!-- Added by context-gathering agent if needed -->
<!-- Reference specs/data-model.md and specs/contracts/ for shared definitions -->

## Para Finish Command
When complete, run: `para finish "[Descriptive commit message]" --branch [parent-branch]`
