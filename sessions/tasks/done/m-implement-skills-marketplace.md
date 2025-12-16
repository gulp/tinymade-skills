---
name: m-implement-skills-marketplace
branch: feature/skills-marketplace
status: done
created: 2025-12-07
completed: 2025-12-13
---

# Initial Skills Marketplace Setup

## Problem/Goal
Create a Claude Code plugin marketplace repository that can host personal skills/plugins, be used across multiple projects, and potentially be published to GitHub for others to use.

## Success Criteria
- [x] `.claude-plugin/marketplace.json` created with valid schema
- [x] At least one example skill/plugin included (to validate structure works)
- [x] Repository structure documented (README with usage instructions)
- [x] Successfully installable via `/plugin marketplace add` locally
- [x] Ready for GitHub publishing (proper repo structure, license choice)

## Context Manifest

### What Was Built

A Claude Code plugin marketplace repository with two plugins:

1. **example-skill**: Minimal template demonstrating plugin structure with `/hello` command and example agent
2. **worktree-orchestrator**: Production-ready skill for git worktree management with cc-sessions integration, autonomous agent support, and terminal spawning

Repository includes:
- Valid `.claude-plugin/marketplace.json` following Claude Code schema
- Complete documentation (README with installation/usage instructions)
- MIT license
- Both local path and GitHub installation support

### Key Architectural Discoveries

**cc-sessions Autonomous Agent Configuration:**
- Claude API cannot activate `bypass_mode` directly - only pre-configuration works
- Must create/modify `sessions-state.json` BEFORE Claude starts
- Fresh worktrees need state file created (doesn't exist initially)
- cc-sessions hooks MERGE with initial state (preserving `bypass_mode: true`)
- Autonomous agents require BOTH `bypass_mode` AND explicit self-approval instructions in prompt

**Claude Code Skills Directory Structure:**
- Skills MUST use `skills/skill-name/SKILL.md` subdirectory pattern
- Placing SKILL.md at plugin root prevents skill recognition
- This requirement wasn't documented in official Claude Code plugin docs

**Terminal Spawning Details:**
- Claude CLI: use positional argument `claude "prompt"`, NOT `-p` flag (which is print mode)
- Quote escaping: `alacritty -e bash -lc 'claude "prompt"' &` (single quotes outer, double quotes inner)
- Permission handling: `--dangerously-skip-permissions` enables autonomous workflows

### File Locations

- Marketplace: `/home/gulp/projects/tinymade-skills/.claude-plugin/marketplace.json`
- Plugins: `/home/gulp/projects/tinymade-skills/plugins/`
- Documentation: `/home/gulp/projects/tinymade-skills/README.md`

## User Notes
- Reference: https://code.claude.com/docs/en/plugin-marketplaces
- Goal is personal use across projects + potential public publishing

## Work Log

### 2025-12-07
- Task created

### 2025-12-09
- Validated local marketplace installation with `/plugin marketplace add`
- Confirmed `/hello` command works
- Updated README with GitHub username (gulp)
- Added worktree-orchestrator to Available Plugins table
- All success criteria marked complete

### 2025-12-10
#### Completed
- Enhanced spawn_terminal.py with cc-sessions bypass functionality:
  - Added setup_sessions_bypass() function to configure sessions state before Claude starts
  - Implemented check for cc-sessions installation (looks for hooks/ or bin/ directories)
  - Added creation of sessions-state.json if missing (handles fresh worktree scenario)
  - Sets mode="implementation" and flags.bypass_mode=true for autonomous operation
  - Added CLI flags: --bypass-sessions, --no-bypass-sessions (default: bypass enabled when --task provided)
- Added autonomous mode override to prompt template:
  - Agent receives explicit instruction to self-approve and execute immediately
  - Paired with bypass_mode to prevent DAIC enforcement blocking
- Tested autonomous agent execution end-to-end:
  - Created m-test-autonomous-agent task file
  - Spawned worktree at .trees/feature-test-autonomous
  - Agent started with bypass enabled, self-approved plan, executed unattended
  - Created proof file and committed changes (commit 541a6f7)
  - Confirmed fully autonomous workflow without human intervention

#### Decisions
- Fixed sessions bypass logic: changed from failing on missing sessions-state.json to creating it with bypass enabled
- This ensures fresh worktrees don't lose bypass configuration during startup
- Checked for cc-sessions presence by looking for hooks/ or bin/ directories rather than assuming file existence

#### Discovered
- cc-sessions hooks merge/augment the minimal state file we create, preserving our bypass_mode=true setting
- Autonomous agent requires BOTH bypass_mode AND explicit self-approval instructions in prompt template
- Fresh worktrees need state file created before Claude starts, as it's created by hooks during startup otherwise

### 2025-12-13
#### Completed
- Cleaned up test artifacts:
  - Removed test worktrees (.trees/feature-test-autonomous, .trees/feature-sample-feature)
  - Deleted m-test-autonomous-agent.md test task file
  - Removed test-blocking-demo.txt
  - Cleaned up plugins/plane/scripts/__pycache__
- Updated .gitignore with Python cache patterns (__pycache__/, *.pyc, *.pyo)
- Added --autonomous (-a) convenience flag to spawn_terminal.py:
  - Requires --task (errors with clear message if missing)
  - Implies --bypass-sessions automatically
  - Outputs "Mode: AUTONOMOUS (self-approving agent)" in human-readable output
  - Includes autonomous_mode: true in JSON output
- Task marked complete - all success criteria met and enhancements implemented

---

### Discovered During Implementation
**Date: 2025-12-16 / Session: Plugin Version Debugging**

During subsequent work with marketplace plugins (gemini-offloader version bump), we discovered a critical but undocumented aspect of Claude Code's plugin versioning system that caused version updates to not reflect in the UI, cache paths, or plugin execution.

#### Plugin Versioning Requires THREE Files in Sync

**Root Cause:** Claude Code reads plugin versions from `.claude-plugin/plugin.json` inside each plugin directory, NOT from the root `plugin.json`. When bumping versions, three separate locations must be updated:

```
Required Updates:
1. plugins/{name}/.claude-plugin/plugin.json  ← PRIMARY (Claude Code reads THIS)
2. .claude-plugin/marketplace.json            ← Marketplace listing
3. plugins/{name}/plugin.json                 ← Root manifest (optional, for humans)
```

**What Happened:**
- Bumped `plugins/gemini-offloader/plugin.json` from v1.0.0 → v1.0.2
- Claude Code continued showing v1.0.0 in marketplace UI
- Cache paths remained `.../cache/.../gemini-offloader/1.0.0/`
- Scripts ran from stale cache instead of updated source

**Investigation Revealed:**
The `.claude-plugin/plugin.json` subdirectory is the authoritative source for Claude Code. Updating only the root `plugin.json` has no effect on the system.

#### Multi-Layer Caching System

Claude Code maintains multiple cache layers with different update behaviors:

| Layer | Location | Purpose | Cleanup Required |
|-------|----------|---------|------------------|
| User settings | `~/.claude/settings.json` | `enabledPlugins` registry | Manual removal after uninstall |
| Plugin registry | `~/.claude/plugins/installed_plugins.json` | Installation metadata | Entry persists with stale version |
| Plugin cache | `~/.claude/plugins/cache/{market}/{plugin}/{version}/` | Installed files | Directory named with cached version |
| Marketplace | `.claude-plugin/marketplace.json` | Available plugins listing | Must update manually |

**Cache Invalidation Issues:**
- `/plugin` UI removal doesn't clean `settings.json` entries (bug [#9537](https://github.com/anthropics/claude-code/issues/9537))
- Auto-update can recreate stale entries from cached metadata
- `installed_plugins.json` entries persist even after cache deletion
- Marketplace updates don't trigger cache invalidation

#### Implementation Pattern for Version Bumps

**Correct procedure** (documented in `docs/design-decision-plugin-versioning.md`):

```bash
# Example: bump plugin to 1.0.3
NEW_VERSION="1.0.3"
PLUGIN="plugin-name"

# Update all three locations
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" \
  plugins/$PLUGIN/.claude-plugin/plugin.json \
  plugins/$PLUGIN/plugin.json

# Update marketplace.json (requires jq)
jq --arg v "$NEW_VERSION" \
  '(.plugins[] | select(.name == "'"$PLUGIN"'") | .version) = $v' \
  .claude-plugin/marketplace.json > tmp && mv tmp .claude-plugin/marketplace.json
```

**Cache cleanup when Claude shows stale version:**
```bash
# Nuclear option - full cleanup
PLUGIN="plugin-name"
MARKET="marketplace-name"

# 1. Remove enabled entry
sed -i "/$PLUGIN@$MARKET/d" ~/.claude/settings.json

# 2. Edit installed_plugins.json (manual - remove plugin block)

# 3. Clear cache
rm -rf ~/.claude/plugins/cache/$MARKET/$PLUGIN/

# 4. Restart Claude Code
# 5. Update marketplace in /plugin UI
# 6. Reinstall
```

#### Lessons Learned

1. **Hidden authoritative source** - The `.claude-plugin/` subdirectory is poorly documented but critical
2. **Triple version tracking** - Three separate files must be kept in sync manually
3. **Persistent cache entries** - Multiple layers of caching require manual cleanup
4. **No atomic updates** - No single command updates all version locations
5. **UI removal incomplete** - `/plugin` uninstall leaves persistent entries ([upstream bug](https://github.com/anthropics/claude-code/issues/9537))

This discovery is now documented in `docs/design-decision-plugin-versioning.md` for future reference. Future plugin developers should be aware that version updates require coordinated changes across multiple files and potential manual cache cleanup.
