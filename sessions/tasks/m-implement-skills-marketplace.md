---
name: m-implement-skills-marketplace
branch: feature/skills-marketplace
status: in-progress
created: 2025-12-07
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

### Current Implementation Status: What Has Been Built

The marketplace repository has been largely implemented and is in a functional state. Here's what currently exists:

**Core marketplace structure is complete.** The repository now contains a valid `.claude-plugin/marketplace.json` file at `/home/gulp/projects/tinymade-skills/.claude-plugin/marketplace.json` that follows the Claude Code marketplace schema. This file declares the marketplace metadata (name: "tinymade-skills", owner information, version 0.1.0) and registers two plugins. The `pluginRoot` is set to `./plugins`, establishing the convention for where plugin directories live.

**Two complete plugins are implemented and registered.** The first is `example-skill`, a minimal template plugin that demonstrates the plugin structure. It contains a simple `/hello` command in `commands/hello.md` and an example agent in `agents/example-agent.md`. The plugin.json declares these resources via directory paths (`commands/` and `agents/`). The second is `worktree-orchestrator`, a comprehensive skill for git worktree management with cc-sessions integration. This is a production-ready plugin with extensive documentation, Python utility scripts, reference materials, and template assets. Its plugin.json declares skills via `SKILL.md`, which contains the full skill definition with YAML frontmatter for auto-triggering.

**Repository documentation exists.** The README.md at `/home/gulp/projects/tinymade-skills/README.md` provides installation instructions for both GitHub-based and local path-based marketplace addition. It documents the usage commands (`/plugin marketplace add`, `/plugin install`, `/plugin list`) and includes a table of available plugins. It also has instructions for adding new plugins to the marketplace, showing the directory structure and marketplace.json registration process. The repository has an MIT license file committed.

**Work has been committed to the feature branch.** All changes are on the `feature/skills-marketplace` branch with working tree clean. Two commits exist: the initial project setup and a comprehensive commit adding the marketplace structure, both plugins, LICENSE, and README. The commit messages follow the repository's convention including Claude Code attribution.

### Understanding Claude Code Plugin Marketplace Architecture

**How plugin marketplaces work in Claude Code.** When a user runs `/plugin marketplace add <source>`, Claude Code reads the marketplace.json file from the specified source (GitHub repo URL or local file path). The source can be either a GitHub repository (format: `username/repo-name`) or an absolute local path (format: `/absolute/path/to/marketplace`). Claude Code parses the marketplace.json to discover available plugins and their metadata, then makes them browseable via `/plugin` and installable via `/plugin install plugin-name@marketplace-name`.

**The marketplace.json schema structure.** The schema has three top-level sections. The `name` field is the marketplace identifier used in install commands. The `owner` object has `name` and `email` fields identifying the marketplace maintainer. The `metadata` object contains `description` (human-readable marketplace description), `version` (semantic version string), and `pluginRoot` (relative path from repo root to plugins directory, typically "./plugins"). The `plugins` array lists all available plugins, where each entry has `name` (plugin identifier), `source` (relative path from pluginRoot to plugin directory), `description` (human-readable description), `version` (semantic version), optional `keywords` (array of strings for search/filtering), and optional `category` (string like "utility", "development", etc.).

**Plugin structure requirements.** Each plugin must have a `plugin.json` manifest at its root directory. This manifest declares `name`, `description`, `version`, `author` (object with `name` field), optional `keywords` array, and resource pointers. Resources can be declared three ways: `commands` points to command files or directories containing .md files, `agents` points to agent files or directories containing .md files, and `skills` points to SKILL.md files with embedded frontmatter. Commands are invoked via `/command-name` and contain instructions below a `---` separator. Agents are invoked by Claude automatically or explicitly and contain instructions with optional "When to Use" sections. Skills use YAML frontmatter with `name` and `description` fields to declare auto-trigger patterns and contain comprehensive reference documentation.

**How plugins integrate with existing codebases.** When installed, plugin resources become available in the Claude Code session. Commands extend the slash command namespace. Agents become available for task delegation. Skills inject their SKILL.md content as reference material into Claude's context when their trigger patterns match user input or when explicitly loaded. Plugins can include bundled scripts (like the Python utilities in worktree-orchestrator) that are referenced from the skill documentation but executed in the user's project directory, not the plugin directory.

### What Remains to Validate Success Criteria

**Testing local installation is the primary remaining work.** Success criterion 4 ("Successfully installable via `/plugin marketplace add` locally") has not been verified. This requires testing in a Claude Code session by running `/plugin marketplace add /home/gulp/projects/tinymade-skills` and confirming that the marketplace appears in `/plugin` output, the plugins are browseable, and at least one plugin (example-skill or worktree-orchestrator) can be successfully installed via `/plugin install example-skill@tinymade-skills`.

**GitHub publishing preparation needs final review.** Success criterion 5 ("Ready for GitHub publishing") requires confirming the repository structure matches GitHub best practices. Currently we have: proper README with clear installation and usage instructions, MIT LICENSE file, .gitignore in place, meaningful commit history, and no sensitive data or credentials. What should be verified: ensure .claude-plugin directory should not be in .gitignore (it needs to be committed for marketplace discovery), confirm README references placeholder `<github-username>` should be replaced with actual GitHub username before publishing, verify all file permissions are appropriate (no executables unless intended), and consider adding a CONTRIBUTING.md if the repository will accept external contributions.

**Documentation accuracy verification.** The README's "Available Plugins" table currently only lists example-skill but the marketplace actually has two plugins (example-skill and worktree-orchestrator). This table should be updated to include worktree-orchestrator with its description before publishing. Additionally, the README could be enhanced with a "Features" or "What's Included" section highlighting the sophisticated worktree-orchestrator skill as a flagship example of what the marketplace offers.

### Technical Reference Details

#### Marketplace Schema (marketplace.json)

```json
{
  "name": "marketplace-identifier",
  "owner": {
    "name": "Owner Name",
    "email": "email@example.com"
  },
  "metadata": {
    "description": "Human-readable description",
    "version": "0.1.0",
    "pluginRoot": "./plugins"
  },
  "plugins": [
    {
      "name": "plugin-identifier",
      "source": "./plugins/plugin-directory",
      "description": "What this plugin does",
      "version": "1.0.0",
      "keywords": ["tag1", "tag2"],
      "category": "utility"
    }
  ]
}
```

#### Plugin Manifest Schema (plugin.json)

```json
{
  "name": "plugin-name",
  "description": "Plugin description",
  "version": "1.0.0",
  "author": {
    "name": "Author Name"
  },
  "keywords": ["tag1", "tag2"],
  "commands": ["./commands/"],
  "agents": ["./agents/"],
  "skills": ["./SKILL.md"]
}
```

#### Command File Format (.md in commands/)

```markdown
# /command-name

Brief description of what this command does.

---

Instructions for Claude when this command is invoked...
```

#### Skill File Format (SKILL.md)

```markdown
---
name: skill-name
description: Auto-trigger on "keyword" or "phrase". Contains comprehensive instructions.
---

# Skill Title

Full documentation, reference materials, examples...
```

#### File Locations

- Marketplace manifest: `/home/gulp/projects/tinymade-skills/.claude-plugin/marketplace.json`
- Plugin directories: `/home/gulp/projects/tinymade-skills/plugins/`
- Example skill: `/home/gulp/projects/tinymade-skills/plugins/example-skill/`
- Worktree orchestrator: `/home/gulp/projects/tinymade-skills/plugins/worktree-orchestrator/`
- Documentation: `/home/gulp/projects/tinymade-skills/README.md`
- License: `/home/gulp/projects/tinymade-skills/LICENSE`

#### Testing Commands

```bash
# Test local marketplace addition (in Claude Code)
/plugin marketplace add /home/gulp/projects/tinymade-skills

# Browse available plugins
/plugin

# Install example plugin
/plugin install example-skill@tinymade-skills

# Test command
/hello

# List installed plugins
/plugin list

# Uninstall for re-testing
/plugin uninstall example-skill
```

#### Pre-Publishing Checklist

- [ ] Test local marketplace addition with `/plugin marketplace add`
- [ ] Verify example-skill installs and /hello command works
- [ ] Update README table to include worktree-orchestrator
- [ ] Replace `<github-username>` placeholder in README with actual username
- [ ] Verify .claude-plugin directory is committed (not gitignored)
- [ ] Review file permissions (scripts should be executable if intended)
- [ ] Test GitHub installation path once published: `/plugin marketplace add username/tinymade-skills`
- [ ] Consider adding GitHub topics/tags for discoverability
- [ ] Consider adding repository description on GitHub
- [ ] Consider adding a CHANGELOG.md for version tracking

### Discovered During Implementation
[Date: 2025-12-10 / Worktree-orchestrator enhancement session]

During implementation of the worktree-orchestrator plugin, several critical discoveries were made about Claude Code plugin architecture and terminal spawning patterns that weren't documented in the original context.

**Claude Code Skills Must Use Subdirectory Pattern**

While implementing skill auto-triggering for worktree-orchestrator, we discovered that skills don't load when SKILL.md is placed at the plugin root. The plugin was initially structured as:

```
plugins/worktree-orchestrator/
├── plugin.json (with "skills": ["./SKILL.md"])
├── SKILL.md
├── scripts/
└── references/
```

This structure prevented Claude Code from recognizing the skill entirely - it wouldn't appear in the Skill tool's available skills list and wouldn't auto-trigger on description keywords. Investigation of working plugins (anthropic-agent-skills) revealed the required pattern:

```
plugins/worktree-orchestrator/
├── plugin.json (with "skills": ["./skills/"])
└── skills/
    └── worktree-orchestrator/
        ├── SKILL.md
        ├── scripts/
        ├── references/
        └── assets/
```

The actual requirement is `skills/skill-name/SKILL.md` subdirectory structure. After restructuring to match this pattern, the skill immediately became available and auto-triggering worked correctly. This wasn't documented in the Claude Code plugin documentation and represents a critical structural requirement for any skill-based plugin development.

**Claude CLI Prompt Invocation Pattern**

When implementing terminal spawning with Claude auto-start, we initially attempted to use `claude -p "prompt"` to pass the startup prompt. This failed silently - the terminal would open but Claude wouldn't receive the prompt. Investigation revealed that `-p` is actually the "print mode" flag (for non-interactive output), NOT for passing prompts.

The correct invocation pattern is:
```bash
claude "your prompt text"  # Positional argument
```

This distinction is critical for programmatic Claude invocation. Using `-p` won't produce an error, it just won't work as expected. Future implementations involving Claude CLI automation need to use positional arguments for prompts, not the `-p` flag.

**Terminal Command Quote Escaping for Bash Wrappers**

When spawning terminal emulators with commands, the quote escaping pattern is non-obvious. The terminal spawn command structure is:

```bash
alacritty -e bash -lc "command to run" &
```

However, when the inner command itself contains quotes (like `claude "prompt with spaces"`), the escaping becomes critical. The working pattern discovered through trial is:

```bash
alacritty -e bash -lc 'claude "prompt text"' &
# Outer: single quotes for bash -lc wrapper
# Inner: double quotes for claude argument
```

NOT:
```bash
alacritty -e bash -lc "claude \"prompt text\"" &
# This pattern fails - the escaping doesn't work properly
```

The single-quote outer wrapper prevents the shell from interpreting the inner double quotes, allowing them to be passed correctly to the bash -lc command. This pattern is essential for spawn_terminal.py to correctly construct terminal commands with nested quoting.

**Autonomous Agent Permission Handling**

The spawn_terminal.py script includes a `--dangerously-skip-permissions` flag specifically for autonomous agent workflows. This allows the script to bypass permission checks when being invoked programmatically by Claude agents, enabling fully automated worktree-with-terminal workflows without human intervention. This wasn't in the original design but emerged as a requirement for the agent orchestration use case.

#### Updated Technical Details

**Skills Directory Structure (REQUIRED):**
```
plugins/plugin-name/
├── plugin.json
│   └── "skills": ["./skills/"]  # Points to directory
└── skills/
    └── skill-name/               # Subdirectory named after skill
        ├── SKILL.md              # Skill definition with frontmatter
        ├── scripts/              # Optional bundled scripts
        ├── references/           # Optional reference docs
        └── assets/               # Optional templates/resources
```

**Claude CLI Invocation:**
```bash
# Correct: Positional argument
claude "your prompt text here"

# Incorrect: -p is print mode, not prompt
claude -p "your prompt"  # This won't work as expected
```

**Terminal Spawn Quote Escaping:**
```bash
# Correct pattern
alacritty -e bash -lc 'claude "prompt text"' &

# Also works for complex commands
alacritty --working-directory "$DIR" -e bash -lc 'claude "multi word prompt"' &

# Key: single quotes around the entire bash command, double quotes inside
```

## User Notes
- Reference: https://code.claude.com/docs/en/plugin-marketplaces
- Goal is personal use across projects + potential public publishing

## Work Log
<!-- Updated as work progresses -->
- [2025-12-07] Task created
- [2025-12-09] Validated local marketplace installation with `/plugin marketplace add`; `/hello` command works. Updated README with GitHub username (gulp) and added worktree-orchestrator to Available Plugins table. All success criteria met.
- [2025-12-10] Enhanced worktree-orchestrator plugin:
  - Investigated skill auto-trigger issue: skills require `skills/skill-name/` subdirectory pattern
  - Restructured plugin to match anthropic-agent-skills structure (moved SKILL.md and resources to `skills/worktree-orchestrator/`)
  - Added terminal spawning capability via spawn_terminal.py:
    - Supports alacritty, kitty, wezterm, gnome-terminal, konsole
    - Configuration via .worktree-orchestrator.yaml or environment variables
    - Auto-starts Claude with context-aware prompt template
  - Fixed spawn_terminal.py CLI issues:
    - Corrected claude invocation: use `claude "prompt"` (positional) not `claude -p` (print mode)
    - Fixed quote escaping: use single quotes for bash wrapper
    - Added `--dangerously-skip-permissions` for autonomous agent work
  - Successfully tested: created m-sample-feature task, spawned worktree at .trees/feature-sample-feature with Claude auto-starting
