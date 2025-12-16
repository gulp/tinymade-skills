# Design Decision: Claude Code Plugin Version Management

**Date**: 2025-12-16
**Status**: Documented
**Context**: Discovered through debugging why plugin version updates weren't reflected

## Problem Statement

When bumping `gemini-offloader` from v1.0.0 to v1.0.2, Claude Code continued to:
1. Display v1.0.0 in marketplace UI
2. Cache files under `1.0.0/` directory
3. Run scripts from stale cache path

## Investigation

Traced through multiple cache layers:

| Layer | File | Issue |
|-------|------|-------|
| User settings | `~/.claude/settings.json` | `enabledPlugins` entry persists after uninstall |
| Plugin registry | `~/.claude/plugins/installed_plugins.json` | Entry recreated with old version |
| Plugin cache | `~/.claude/plugins/cache/{market}/{plugin}/{version}/` | Directory named with old version |
| Marketplace | `.claude-plugin/marketplace.json` | Had old version initially |

## Root Cause

**Three version sources exist** - Claude Code reads from `.claude-plugin/plugin.json` inside each plugin directory, NOT from the root `plugin.json`:

```
plugins/gemini-offloader/
├── plugin.json                    # v1.0.2 (we updated this)
├── .claude-plugin/
│   └── plugin.json                # v1.0.0 (CC reads THIS)
└── skills/
```

## Decision

**Always update all three version locations when bumping:**

1. `plugins/{name}/.claude-plugin/plugin.json` - **Primary** (CC reads this)
2. `.claude-plugin/marketplace.json` - Marketplace listing
3. `plugins/{name}/plugin.json` - Root manifest (optional, for humans)

## Implementation

Created version bump script pattern:

```bash
# Example: bump gemini-offloader to 1.0.3
NEW_VERSION="1.0.3"
PLUGIN="gemini-offloader"

# Update all three locations
sed -i "s/\"version\": \".*\"/\"version\": \"$NEW_VERSION\"/" \
  plugins/$PLUGIN/.claude-plugin/plugin.json \
  plugins/$PLUGIN/plugin.json

# Update marketplace.json (requires jq for safe JSON edit)
jq --arg v "$NEW_VERSION" \
  '(.plugins[] | select(.name == "'"$PLUGIN"'") | .version) = $v' \
  .claude-plugin/marketplace.json > tmp && mv tmp .claude-plugin/marketplace.json
```

## Cache Invalidation Procedure

If Claude Code shows stale version after proper update:

```bash
# Nuclear option - full cleanup
PLUGIN="gemini-offloader"
MARKET="tinymade-skills"

# 1. Remove enabled entry
sed -i "/$PLUGIN@$MARKET/d" ~/.claude/settings.json

# 2. Edit installed_plugins.json (manual - remove plugin block)

# 3. Clear cache
rm -rf ~/.claude/plugins/cache/$MARKET/$PLUGIN/

# 4. Restart Claude Code
# 5. Update marketplace in /plugin UI
# 6. Reinstall
```

## Related Issues

- [anthropics/claude-code#9537](https://github.com/anthropics/claude-code/issues/9537) - Removal doesn't clean settings.json
- [anthropics/claude-code#9431](https://github.com/anthropics/claude-code/issues/9431) - Cached plugin.json loses metadata

## Lessons Learned

1. Claude Code has multiple cache layers with different TTLs
2. The `.claude-plugin/` subdirectory is the authoritative source
3. `installed_plugins.json` and `settings.json` are separate concerns
4. Auto-update behavior can recreate stale entries from cached metadata
