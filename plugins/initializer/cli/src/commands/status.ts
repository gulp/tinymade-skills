/**
 * status command - Report agent status from worktree
 *
 * Usage:
 *   initializer status <description> [options]
 *
 * Options:
 *   --tests <status>    Test status: passed, failed, unknown
 *   --todos X/Y         Todo progress (e.g., 3/7)
 *   --blocked           Mark as blocked
 *   --reason <text>     Blocked reason
 *   --task <name>       Override task name detection
 */

import { detectContext, getStatusFilePath } from '../lib/context';
import { getDiffStats } from '../lib/diff';
import {
  atomicWriteStatus,
  parseTodos,
  parseTestStatus,
  type AgentStatus,
  type TestStatus,
} from '../lib/state';

interface StatusArgs {
  _: string[];
  tests?: string;
  todos?: string;
  blocked?: boolean;
  reason?: string;
  task?: string;
}

export async function statusCommand(args: StatusArgs): Promise<void> {
  // Get current work description (first positional arg after 'status')
  const currentWork = args._[1];
  if (!currentWork) {
    throw new Error('Missing task description. Usage: initializer status "description" [--tests ...]');
  }

  // Detect context
  const context = detectContext();

  // Determine task name
  let taskName = args.task || context.taskName;
  if (!taskName) {
    throw new Error(
      'Could not determine task name. Use --task <name> or run from a worktree with a recognizable branch name.'
    );
  }

  // Validate task name to prevent path traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(taskName)) {
    throw new Error(
      `Invalid task name '${taskName}'. Task names must contain only letters, numbers, hyphens, and underscores.`
    );
  }

  // Determine project root (where .trees/.state lives)
  let projectRoot = context.projectRoot;
  if (!projectRoot) {
    throw new Error(
      'Could not determine project root. Are you in a git repository?'
    );
  }

  // Parse test status
  let testStatus: TestStatus = 'unknown';
  if (args.tests) {
    const parsed = parseTestStatus(args.tests);
    if (!parsed) {
      throw new Error(
        `Invalid test status '${args.tests}'. Use: passed, failed, or unknown`
      );
    }
    testStatus = parsed;
  }

  // Parse todos
  let todosCompleted: number | null = null;
  let todosTotal: number | null = null;
  if (args.todos) {
    const parsed = parseTodos(args.todos);
    if (!parsed) {
      throw new Error(
        `Invalid todos format '${args.todos}'. Use format: X/Y (e.g., 3/7)`
      );
    }
    todosCompleted = parsed.completed;
    todosTotal = parsed.total;
  }

  // Get diff stats
  const diffStats = await getDiffStats();

  // Build status object
  const status: AgentStatus = {
    task_name: taskName,
    worktree_path: context.worktreePath,
    branch: context.branch,
    current_work: currentWork,
    test_status: testStatus,
    is_blocked: args.blocked ?? false,
    blocked_reason: args.blocked ? (args.reason ?? null) : null,
    todos_completed: todosCompleted,
    todos_total: todosTotal,
    diff_stats: diffStats,
    last_update: new Date().toISOString(),
  };

  // Write status file
  const statusFilePath = getStatusFilePath(projectRoot, taskName);
  await atomicWriteStatus(statusFilePath, status);

  // Output confirmation
  console.log(`Status updated: ${statusFilePath}`);
  console.log(`  Task: ${taskName}`);
  console.log(`  Work: ${currentWork}`);
  console.log(`  Tests: ${testStatus}`);
  if (todosCompleted !== null && todosTotal !== null) {
    console.log(`  Todos: ${todosCompleted}/${todosTotal}`);
  }
  if (status.is_blocked) {
    console.log(`  BLOCKED: ${status.blocked_reason ?? '(no reason given)'}`);
  }
  if (diffStats) {
    console.log(`  Diff: +${diffStats.additions} -${diffStats.deletions}`);
  }
}
