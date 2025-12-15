---
name: ?-research-claude-skills-patterns
branch: none
status: pending
created: 2025-12-15
---

# Research Claude Code Skills & Hooks Patterns

## Problem/Goal

Before completing the agent-evals plugin implementation, need to deeply understand Claude Code's skill/hook architecture patterns from authoritative sources. Key areas to research:

1. **Settings pollution** - How subagents inherit settings, isolation strategies
2. **Skills vs MCP tools** - When to use each, integration patterns
3. **Scripts in skills** - `allowed-tools` syntax, script wrapping patterns
4. **Hook best practices** - PreToolUse/PostToolUse patterns, blocking behavior

## Success Criteria
- [ ] Document settings isolation pattern for test harness (avoid hook recursion)
- [ ] Determine if agent-evals should use skills, MCP tools, or pure hooks
- [ ] Document `allowed-tools` syntax for script execution
- [ ] Create reference notes in task file for implementation phase

## Reference URLs

- https://egghead.io/lessons/avoid-the-dangers-of-settings-pollution-in-subagents-hooks-and-scripts~xrecv
- https://egghead.io/claude-skills-compared-to-mcp-tools~bxtpm
- https://egghead.io/claude-skills-compared-to-slash-commands~lhdor
- https://egghead.io/secure-your-claude-skills-with-custom-pre-tool-use-hooks~dhqko
- https://egghead.io/build-better-tools-in-claude-skills-with-scripts~0oa34
- https://egghead.io/control-claude-skills-output-with-references-and-examples~vuns3

## Context Manifest
<!-- Added by context-gathering agent -->

## User Notes
<!-- Any specific notes or requirements from the developer -->

## Work Log
<!-- Updated as work progresses -->
- [2025-12-15] Task created to research patterns before completing h-implement-bun-eval-suite
