---
name: m-implement-worktree-skill
branch: feature/worktree-skill
status: completed
created: 2025-12-08
completed: 2025-12-09
---

# Implement Git Worktree Management Skill

## Problem/Goal
Create an agentic skill for managing git worktrees with cc-sessions integration, applying progressive discovery and code-as-API patterns from Anthropic's engineering best practices. Enable orchestrator-style workflow where main branch coordinates parallel task work in `.trees/` directory.

## Success Criteria
- [x] Fork existing git-worktree-setup skill to plugins/worktree-orchestrator
- [x] Add plugin.json for marketplace registration
- [x] Register in marketplace.json
- [x] Add cc-sessions integration (mode5-orchestrator.md, mode6-task-integration.md)
- [x] Support creating worktree from task file (reads `branch:` frontmatter)
- [x] Support multi-task → single branch pattern
- [x] Orchestrator can peek into parallel worktree files

## Context Manifest
<!-- Added by context-gathering agent -->

## User Notes
- Reference: https://www.anthropic.com/engineering/code-execution-with-mcp
- Apply patterns as skill design principles (not MCP server):
  - Progressive discovery - explore/discover context on-demand
  - Code as API - callable functions, filesystem-based structure
  - Local data processing - filter/transform before returning to model
  - State persistence - file-based state for resumable workflows

## Work Log

### 2025-12-09

#### Completed
- Forked git-worktree-setup skill to plugins/worktree-orchestrator
- Created plugin.json and registered in marketplace.json
- Implemented cc-sessions integration layer:
  - mode5-orchestrator.md - Orchestrator pattern with task-based worktree creation
  - mode6-task-integration.md - Task frontmatter parsing and multi-task branch handling
  - references/cc-sessions-integration.md - Task file format documentation
- Refactored to Anthropic best practices:
  - Created Python scripts (parse_task.py, list_tasks_by_branch.py, worktree_status.py, check_cleanup_safe.py)
  - Restructured: modes/ → references/, templates/ → assets/, scripts/ added
  - Removed CHANGELOG.md per best practices
  - Condensed SKILL.md from ~240 to ~150 lines (v3.0.0)
- Created QUICKSTART.md for end users

#### Decisions
- Python scripts for deterministic execution instead of bash commands
- Standard directory structure: scripts/, references/, assets/
- Worktrees in `.trees/` directory (gitignored) for orchestrator access
- Support multi-task → same branch pattern via task file parsing

#### Next Steps
- Test scripts with real cc-sessions projects
- Consider adding worktree template customization
- Potential enhancement: Auto-detect stale worktrees
