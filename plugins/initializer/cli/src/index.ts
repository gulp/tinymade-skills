#!/usr/bin/env bun
/**
 * initializer CLI - Parallel agent coordination system
 *
 * Commands:
 *   status "task description" --tests <status> --todos X/Y [--blocked]
 *   show [--json] [task-name]
 *   monitor
 */

import minimist from 'minimist';
import { statusCommand } from './commands/status';
import { showCommand } from './commands/show';
import { monitorCommand } from './commands/monitor';

const VERSION = '1.0.0';

interface ParsedArgs {
  _: string[];
  help?: boolean;
  h?: boolean;
  version?: boolean;
  v?: boolean;
  json?: boolean;
  tests?: string;
  todos?: string;
  blocked?: boolean;
  task?: string;
  reason?: string;
}

function printHelp(): void {
  console.log(`
initializer v${VERSION} - Parallel agent coordination CLI

USAGE:
  initializer <command> [options]

COMMANDS:
  status <description>   Report agent status from worktree
  show [task-name]       Display agent statuses (orchestrator view)
  monitor                Launch TUI dashboard for real-time monitoring

STATUS OPTIONS:
  --tests <status>       Test status: passed, failed, or unknown
  --todos X/Y            Todo progress as completed/total (e.g., 3/7)
  --blocked              Mark agent as blocked
  --reason <text>        Reason for being blocked
  --task <name>          Override auto-detected task name

SHOW OPTIONS:
  --json                 Output in JSON format

GLOBAL OPTIONS:
  -h, --help             Show this help message
  -v, --version          Show version number

EXAMPLES:
  initializer status "Implementing auth" --tests passed --todos 3/7
  initializer status "Stuck on API" --blocked --reason "Need API key"
  initializer show --json
  initializer monitor
`);
}

function printVersion(): void {
  console.log(`initializer v${VERSION}`);
}

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2), {
    boolean: ['help', 'h', 'version', 'v', 'json', 'blocked'],
    string: ['tests', 'todos', 'task', 'reason'],
    alias: {
      h: 'help',
      v: 'version',
    },
  }) as ParsedArgs;

  // Handle global flags
  if (args.help || args.h) {
    printHelp();
    process.exit(0);
  }

  if (args.version || args.v) {
    printVersion();
    process.exit(0);
  }

  const command = args._[0];

  if (!command) {
    console.error('Error: No command specified\n');
    printHelp();
    process.exit(1);
  }

  try {
    switch (command) {
      case 'status':
        await statusCommand(args);
        break;
      case 'show':
        await showCommand(args);
        break;
      case 'monitor':
        await monitorCommand(args);
        break;
      default:
        console.error(`Error: Unknown command '${command}'\n`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    } else {
      console.error('An unexpected error occurred');
    }
    process.exit(1);
  }
}

main();
