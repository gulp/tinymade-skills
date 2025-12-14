/**
 * State persistence with atomic writes
 */

import { existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import type { DiffStats } from './diff';

export type TestStatus = 'passed' | 'failed' | 'unknown';

export interface AgentStatus {
  task_name: string;
  worktree_path: string | null;
  branch: string | null;
  current_work: string;
  test_status: TestStatus;
  is_blocked: boolean;
  blocked_reason: string | null;
  todos_completed: number | null;
  todos_total: number | null;
  diff_stats: DiffStats | null;
  last_update: string; // ISO 8601
}

/**
 * Atomically write a status file using temp file + rename pattern
 */
export async function atomicWriteStatus(
  statusFilePath: string,
  status: AgentStatus
): Promise<void> {
  // Ensure directory exists
  const dir = dirname(statusFilePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write to temp file first
  const tempFile = `${statusFilePath}.tmp.${process.pid}`;

  try {
    // Bun.write flushes by default
    await Bun.write(tempFile, JSON.stringify(status, null, 2));

    // Atomic rename
    renameSync(tempFile, statusFilePath);
  } catch (error) {
    // Clean up temp file on error
    try {
      if (existsSync(tempFile)) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Read a status file
 */
export function readStatus(statusFilePath: string): AgentStatus | null {
  if (!existsSync(statusFilePath)) {
    return null;
  }

  try {
    const content = readFileSync(statusFilePath, 'utf-8');
    return JSON.parse(content) as AgentStatus;
  } catch {
    return null;
  }
}

/**
 * Read all status files from the state directory
 */
export function readAllStatuses(stateDir: string): AgentStatus[] {
  if (!existsSync(stateDir)) {
    return [];
  }

  const statuses: AgentStatus[] = [];
  const files = readdirSync(stateDir);

  for (const file of files) {
    if (file.endsWith('.status.json') && !file.includes('.tmp.')) {
      const statusPath = `${stateDir}/${file}`;
      const status = readStatus(statusPath);
      if (status) {
        statuses.push(status);
      }
    }
  }

  return statuses;
}

/**
 * Parse todos string (e.g., "3/7") into completed and total
 */
export function parseTodos(todosStr: string): { completed: number; total: number } | null {
  const match = todosStr.match(/^(\d+)\/(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    completed: parseInt(match[1], 10),
    total: parseInt(match[2], 10),
  };
}

/**
 * Validate test status string
 */
export function parseTestStatus(statusStr: string): TestStatus | null {
  const normalized = statusStr.toLowerCase();
  if (normalized === 'passed' || normalized === 'pass') return 'passed';
  if (normalized === 'failed' || normalized === 'fail') return 'failed';
  if (normalized === 'unknown') return 'unknown';
  return null;
}
