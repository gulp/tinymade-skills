/**
 * show command - Display agent statuses (orchestrator view)
 *
 * Usage:
 *   initializer show [--json] [task-name]
 */

import { detectContext, getStateDir } from '../lib/context';
import { readAllStatuses, readStatus, type AgentStatus } from '../lib/state';
import { join } from 'path';

interface ShowArgs {
  _: string[];
  json?: boolean;
}

/** Default stale threshold in hours */
const STALE_THRESHOLD_HOURS = 2;

/**
 * Check if a status is stale (no update within threshold)
 */
function isStale(status: AgentStatus, thresholdHours: number = STALE_THRESHOLD_HOURS): boolean {
  const lastUpdate = new Date(status.last_update);
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= thresholdHours;
}

/**
 * Get agent state indicator
 */
function getStateIndicator(status: AgentStatus): string {
  if (status.is_blocked) return '🔴 BLOCKED';
  if (isStale(status)) return '⚪ STALE';
  return '🟢 ACTIVE';
}

/**
 * Format time ago string
 */
function timeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

/**
 * Format progress bar
 */
function progressBar(completed: number | null, total: number | null, width: number = 10): string {
  if (completed === null || total === null || total === 0) {
    return '[---------]';
  }

  const percent = Math.min(completed / total, 1);
  const filled = Math.round(percent * width);
  const empty = width - filled;

  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${completed}/${total}`;
}

/**
 * Print human-readable status table
 */
function printTable(statuses: AgentStatus[]): void {
  if (statuses.length === 0) {
    console.log('No agent statuses found.');
    console.log('\nAgents report status using:');
    console.log('  initializer status "description" --tests passed --todos 3/7');
    return;
  }

  // Calculate summary
  const active = statuses.filter(s => !s.is_blocked && !isStale(s)).length;
  const blocked = statuses.filter(s => s.is_blocked).length;
  const stale = statuses.filter(s => isStale(s) && !s.is_blocked).length;

  // Header
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                           PARALLEL AGENT STATUS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log(`  Active: ${active}  │  Blocked: ${blocked}  │  Stale: ${stale}  │  Total: ${statuses.length}`);
  console.log('───────────────────────────────────────────────────────────────────────────────');

  // Sort: blocked first, then active, then stale
  const sorted = [...statuses].sort((a, b) => {
    if (a.is_blocked && !b.is_blocked) return -1;
    if (!a.is_blocked && b.is_blocked) return 1;
    if (isStale(a) && !isStale(b)) return 1;
    if (!isStale(a) && isStale(b)) return -1;
    return new Date(b.last_update).getTime() - new Date(a.last_update).getTime();
  });

  for (const status of sorted) {
    const state = getStateIndicator(status);
    const tests = status.test_status === 'passed' ? '✓' :
                  status.test_status === 'failed' ? '✗' : '?';
    const progress = progressBar(status.todos_completed, status.todos_total);
    const diff = status.diff_stats
      ? `+${status.diff_stats.additions} -${status.diff_stats.deletions}`
      : '';
    const updated = timeAgo(status.last_update);

    console.log('');
    console.log(`  ${state}  ${status.task_name}`);
    console.log(`    Work: ${status.current_work}`);
    console.log(`    Tests: ${tests}  │  Progress: ${progress}  │  Diff: ${diff || 'n/a'}`);
    console.log(`    Updated: ${updated}  │  Branch: ${status.branch || 'n/a'}`);

    if (status.is_blocked && status.blocked_reason) {
      console.log(`    Blocked reason: ${status.blocked_reason}`);
    }
  }

  console.log('');
  console.log('───────────────────────────────────────────────────────────────────────────────');
  console.log('  Use `initializer monitor` for real-time TUI dashboard');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
}

export async function showCommand(args: ShowArgs): Promise<void> {
  const taskName = args._[1]; // Optional specific task
  const jsonOutput = args.json ?? false;

  // Detect context to find project root
  const context = detectContext();

  if (!context.projectRoot) {
    throw new Error('Could not determine project root. Are you in a git repository?');
  }

  const stateDir = getStateDir(context.projectRoot);

  if (taskName) {
    // Show specific task
    const statusPath = join(stateDir, `${taskName}.status.json`);
    const status = readStatus(statusPath);

    if (!status) {
      throw new Error(`No status found for task: ${taskName}`);
    }

    if (jsonOutput) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      printTable([status]);
    }
  } else {
    // Show all statuses
    const statuses = readAllStatuses(stateDir);

    if (jsonOutput) {
      const summary = {
        total: statuses.length,
        active: statuses.filter(s => !s.is_blocked && !isStale(s)).length,
        blocked: statuses.filter(s => s.is_blocked).length,
        stale: statuses.filter(s => isStale(s) && !s.is_blocked).length,
        statuses,
      };
      console.log(JSON.stringify(summary, null, 2));
    } else {
      printTable(statuses);
    }
  }
}
