# tinymade-skills

A personal plugin marketplace for Claude Code.

## Installation

Add this marketplace to your Claude Code installation:

```
/plugin marketplace add gulp/tinymade-skills
```

Or for local development:

```
/plugin marketplace add /path/to/tinymade-skills
```

## Usage

### Browse available plugins

```
/plugin
```

### Install a plugin

```
/plugin install plugin-name@tinymade-skills
```

### List installed plugins

```
/plugin list
```

## Available Plugins

| Plugin | Description |
|--------|-------------|
| example-skill | An example skill demonstrating the plugin structure |
| worktree-orchestrator | Git worktree management with cc-sessions integration and terminal spawning |
| initializer | Parallel agent coordination system with status reporting and monitoring TUI |
| plane | Plane.so integration - sync issues, discover gaps, link tasks, create issues |
| gemini-offloader | Offload context-heavy tasks to Google Gemini via gemini-cli with warm sessions and mem0 memory |

## Adding New Plugins

1. Create a new directory under `plugins/`:
   ```
   plugins/my-new-skill/
   ├── plugin.json
   ├── commands/
   │   └── my-command.md
   ├── agents/
   │   └── my-agent.md
   └── skills/              # For auto-triggering skills
       └── skill-name/
           ├── SKILL.md     # Skill definition with frontmatter
           ├── scripts/     # Optional bundled scripts
           └── references/  # Optional reference docs
   ```

2. Configure `plugin.json`:
   ```json
   {
     "name": "my-new-skill",
     "description": "Description of what it does",
     "version": "1.0.0",
     "author": {"name": "Your Name"},
     "keywords": ["relevant", "tags"],
     "commands": ["./commands/"],
     "agents": ["./agents/"],
     "skills": ["./skills/"]
   }
   ```

3. Add the plugin to `.claude-plugin/marketplace.json`:
   ```json
   {
     "name": "my-new-skill",
     "source": "./plugins/my-new-skill",
     "description": "Description of what it does",
     "version": "1.0.0",
     "keywords": ["relevant", "tags"]
   }
   ```

4. Commit and push to make available across projects.

**Note**: Skills require the `skills/skill-name/SKILL.md` subdirectory pattern for auto-triggering to work correctly.

## License

MIT
