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
| worktree-orchestrator | Git worktree management with cc-sessions integration |

## Adding New Plugins

1. Create a new directory under `plugins/`:
   ```
   plugins/my-new-skill/
   ├── plugin.json
   ├── commands/
   │   └── my-command.md
   └── agents/
       └── my-agent.md
   ```

2. Add the plugin to `.claude-plugin/marketplace.json`:
   ```json
   {
     "name": "my-new-skill",
     "source": "./plugins/my-new-skill",
     "description": "Description of what it does",
     "version": "1.0.0",
     "keywords": ["relevant", "tags"]
   }
   ```

3. Commit and push to make available across projects.

## License

MIT
