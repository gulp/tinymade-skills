# Task Breakdown: [Original Task Title]

## Original Task
[Summary of the original task from parent README.md]

## Breakdown Strategy
Applied **[Decomposition Principle]** decomposition because [reasoning].

**T-shirt size**: [XS|S|M|L|XL] ([criteria count] criteria, ~[file count] files, [integration count] integrations)

## Spec Artifacts
- `specs/data-model.md` - Shared entity schemas and type definitions
- `specs/contracts/` - API interface definitions
- `specs/quickstart.md` - Runtime testing guidance

## Execution Plan

### Phase 1: [Phase Name] (Parallel Execution)
**All tasks in this phase run simultaneously:**
- `P1_1_[name].md`: [Brief description]
- `P1_2_[name].md`: [Brief description]

Para dispatch commands:
```bash
# Dispatch all Phase 1 tasks in parallel
para dispatch agent-p1-1 --file [task-dir]/phase_1_parallel/P1_1_[name].md --dangerously-skip-permissions
para dispatch agent-p1-2 --file [task-dir]/phase_1_parallel/P1_2_[name].md --dangerously-skip-permissions
```

### Phase 2: [Phase Name] (Sequential Execution)
**Runs AFTER all Phase 1 tasks complete:**
- `P2_1_[name].md`: [Brief description] (integrates outputs from P1_*)

### Integration Phase
- Final integration and testing tasks

## Dependency Visualization

### Matrix
[Dependency matrix table inserted by visualize_dependencies.ts]

### Graph
```mermaid
[MermaidJS diagram inserted by visualize_dependencies.ts]
```

## Notes
- Total subtasks: [number]
- Parallel execution opportunities: [number]
- Sequential dependencies: [describe key dependencies]
- Integration complexity: [low|medium|high]
