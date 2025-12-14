/**
 * monitor command - Launch TUI dashboard for real-time monitoring
 *
 * Usage:
 *   initializer monitor
 */

import { detectContext, getStateDir } from '../lib/context';
import { readAllStatuses, type AgentStatus } from '../lib/state';

interface MonitorArgs {
  _: string[];
}

/** Default refresh interval in milliseconds */
const REFRESH_INTERVAL_MS = 2000;

/** Default stale threshold in hours */
const STALE_THRESHOLD_HOURS = 2;

// ANSI escape codes
const CLEAR_SCREEN = '\x1b[2J\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const BG_RED = '\x1b[41m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';

/**
 * Check if a status is stale
 */
function isStale(status: AgentStatus): boolean {
  const lastUpdate = new Date(status.last_update);
  const now = new Date();
  const diffMs = now.getTime() - lastUpdate.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours >= STALE_THRESHOLD_HOURS;
}

/**
 * Format time ago string
 */
function timeAgo(isoDate: string): string {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(diffMs / (1000 * 60 * 60));

  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  return `${seconds}s ago`;
}

/**
 * Format progress bar with color
 */
function progressBar(completed: number | null, total: number | null, width: number = 15): string {
  if (completed === null || total === null || total === 0) {
    return `${DIM}[${'─'.repeat(width)}]${RESET} --`;
  }

  const percent = Math.min(completed / total, 1);
  const filled = Math.round(percent * width);
  const empty = width - filled;

  const color = percent >= 1 ? GREEN : percent >= 0.5 ? YELLOW : WHITE;
  return `${color}[${'█'.repeat(filled)}${'░'.repeat(empty)}]${RESET} ${completed}/${total}`;
}

/**
 * Get status badge
 */
function getStatusBadge(status: AgentStatus): string {
  if (status.is_blocked) {
    return `${BG_RED}${WHITE}${BOLD} BLOCKED ${RESET}`;
  }
  if (isStale(status)) {
    return `${BG_YELLOW}${WHITE} STALE ${RESET}`;
  }
  return `${BG_GREEN}${WHITE} ACTIVE ${RESET}`;
}

/**
 * Get test status indicator
 */
function getTestIndicator(status: AgentStatus): string {
  switch (status.test_status) {
    case 'passed':
      return `${GREEN}✓ PASS${RESET}`;
    case 'failed':
      return `${RED}✗ FAIL${RESET}`;
    default:
      return `${DIM}? ----${RESET}`;
  }
}

/**
 * Render the monitor display
 */
function render(statuses: AgentStatus[], stateDir: string): string {
  const lines: string[] = [];
  const now = new Date().toLocaleTimeString();

  // Calculate summary
  const active = statuses.filter(s => !s.is_blocked && !isStale(s)).length;
  const blocked = statuses.filter(s => s.is_blocked).length;
  const stale = statuses.filter(s => isStale(s) && !s.is_blocked).length;

  // Header
  lines.push('');
  lines.push(`${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════════════════════╗${RESET}`);
  lines.push(`${BOLD}${CYAN}║${RESET}                    ${BOLD}PARALLEL AGENT MONITOR${RESET}                    ${DIM}${now}${RESET}  ${BOLD}${CYAN}║${RESET}`);
  lines.push(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);

  // Summary bar
  const summaryParts = [
    `${GREEN}● Active: ${active}${RESET}`,
    `${RED}● Blocked: ${blocked}${RESET}`,
    `${YELLOW}● Stale: ${stale}${RESET}`,
    `${DIM}Total: ${statuses.length}${RESET}`,
  ];
  lines.push(`${BOLD}${CYAN}║${RESET}  ${summaryParts.join('  │  ')}`.padEnd(90) + `${BOLD}${CYAN}║${RESET}`);
  lines.push(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);

  if (statuses.length === 0) {
    lines.push(`${BOLD}${CYAN}║${RESET}  ${DIM}No agents reporting status.${RESET}`.padEnd(90) + `${BOLD}${CYAN}║${RESET}`);
    lines.push(`${BOLD}${CYAN}║${RESET}  ${DIM}Agents report using: initializer status "description" --tests passed --todos X/Y${RESET}`.padEnd(90) + `${BOLD}${CYAN}║${RESET}`);
  } else {
    // Sort: blocked first, then active, then stale
    const sorted = [...statuses].sort((a, b) => {
      if (a.is_blocked && !b.is_blocked) return -1;
      if (!a.is_blocked && b.is_blocked) return 1;
      if (isStale(a) && !isStale(b)) return 1;
      if (!isStale(a) && isStale(b)) return -1;
      return new Date(b.last_update).getTime() - new Date(a.last_update).getTime();
    });

    for (const status of sorted) {
      const badge = getStatusBadge(status);
      const testIndicator = getTestIndicator(status);
      const progress = progressBar(status.todos_completed, status.todos_total);
      const diff = status.diff_stats
        ? `${GREEN}+${status.diff_stats.additions}${RESET} ${RED}-${status.diff_stats.deletions}${RESET}`
        : `${DIM}n/a${RESET}`;
      const updated = timeAgo(status.last_update);

      lines.push(`${BOLD}${CYAN}║${RESET}`);
      lines.push(`${BOLD}${CYAN}║${RESET}  ${badge}  ${BOLD}${status.task_name}${RESET}`);
      lines.push(`${BOLD}${CYAN}║${RESET}    ${WHITE}Work:${RESET} ${status.current_work.slice(0, 55)}${status.current_work.length > 55 ? '...' : ''}`);
      lines.push(`${BOLD}${CYAN}║${RESET}    ${testIndicator}  │  ${progress}  │  Diff: ${diff}  │  ${DIM}${updated}${RESET}`);

      if (status.is_blocked && status.blocked_reason) {
        lines.push(`${BOLD}${CYAN}║${RESET}    ${RED}Reason: ${status.blocked_reason}${RESET}`);
      }
    }
  }

  lines.push(`${BOLD}${CYAN}╠══════════════════════════════════════════════════════════════════════════════╣${RESET}`);
  lines.push(`${BOLD}${CYAN}║${RESET}  ${DIM}Press Ctrl+C to exit${RESET}  │  ${DIM}Refresh: ${REFRESH_INTERVAL_MS / 1000}s${RESET}  │  ${DIM}State: ${stateDir}${RESET}`);
  lines.push(`${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════════════════════╝${RESET}`);
  lines.push('');

  return lines.join('\n');
}

export async function monitorCommand(_args: MonitorArgs): Promise<void> {
  // Detect context to find project root
  const context = detectContext();

  if (!context.projectRoot) {
    throw new Error('Could not determine project root. Are you in a git repository?');
  }

  const stateDir = getStateDir(context.projectRoot);

  // Setup cleanup on exit
  const cleanup = () => {
    process.stdout.write(SHOW_CURSOR);
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Hide cursor
  process.stdout.write(HIDE_CURSOR);

  // Main loop
  const refreshLoop = async () => {
    try {
      const statuses = readAllStatuses(stateDir);
      const output = render(statuses, stateDir);

      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(output);
    } catch (error) {
      // Continue on error - don't crash the monitor
      process.stdout.write(CLEAR_SCREEN);
      process.stdout.write(`Error reading statuses: ${error}\n`);
    }
  };

  // Initial render
  await refreshLoop();

  // Refresh loop
  const interval = setInterval(refreshLoop, REFRESH_INTERVAL_MS);

  // Keep process alive
  await new Promise(() => {
    // This promise never resolves - we wait for SIGINT/SIGTERM
  });
}
