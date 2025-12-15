---
index: skills-infrastructure
name: Skills Infrastructure
description: Tasks related to Claude Code skills/plugins - development, enhancement, state management, and cross-skill utilities
---

# Skills Infrastructure

Tasks for building and maintaining Claude Code skills and plugins - development patterns, state persistence, memory management, and shared utilities.

## Active Tasks

### High Priority
- `h-implement-bun-eval-suite/` - Bun native eval suite for testing Claude Code subagents with tool call capture, trajectory matching, and VCR cassette replay
- `h-implement-gemini-observer.md` - Observable research sessions with traces, hardened prompts, status polling, and orthogonal INITIALIZE/OFFLOAD/OBSERVE separation
- `h-implement-gemini-offloader-state-persistence/` - State persistence layer for gemini-offloader with filesystem cache, mem0 integration, and cross-session discovery

### Medium Priority
- `m-implement-gemini-context-offloading-skill.md` - Original gemini-offloader skill implementation
- `m-implement-skills-marketplace.md` - Skills marketplace infrastructure

### Low Priority

### Investigate
- `?-research-claude-skills-patterns.md` - Research Claude Code skills/hooks patterns from egghead.io sources

## Completed Tasks
- `m-fix-initializer-critical-issues.md` - Fix critical issues in parallel agent coordination system (race condition, cleanup integration)
