/**
 * Context detection for worktree agents vs orchestrators
 */

import { existsSync, statSync, readFileSync } from 'fs';
import { join, dirname, basename } from 'path';

export type ContextType = 'worktree_agent' | 'orchestrator' | 'main_repo' | 'unknown';

export interface WorktreeContext {
  type: ContextType;
  projectRoot: string | null;
  worktreePath: string | null;
  branch: string | null;
  taskName: string | null;
}

/**
 * Detect whether we're running in a worktree agent context or orchestrator context
 */
export function detectContext(): WorktreeContext {
  const cwd = process.cwd();
  const gitPath = join(cwd, '.git');

  const result: WorktreeContext = {
    type: 'unknown',
    projectRoot: null,
    worktreePath: null,
    branch: null,
    taskName: null,
  };

  if (!existsSync(gitPath)) {
    return result;
  }

  const stat = statSync(gitPath);

  if (stat.isFile()) {
    // .git is a file → we're in a worktree
    result.type = 'worktree_agent';
    result.worktreePath = cwd;

    // Parse .git file to find the main repo
    // Format: gitdir: /path/to/main/.git/worktrees/branch-name
    const gitContent = readFileSync(gitPath, 'utf-8').trim();
    const match = gitContent.match(/^gitdir:\s*(.+)$/);
    if (match) {
      const worktreeGitDir = match[1];
      // Go up from .git/worktrees/branch-name to find main repo
      const mainGitDir = dirname(dirname(dirname(worktreeGitDir)));
      result.projectRoot = dirname(mainGitDir);
    }

    // Get branch name from worktree path (folder name with hyphens → slashes)
    result.branch = basename(cwd).replace(/-/g, '/');

    // Try to infer task name from branch
    result.taskName = inferTaskFromBranch(result.branch);

  } else if (stat.isDirectory()) {
    // .git is a directory → we're in the main repo
    const treesDir = join(cwd, '.trees');

    if (existsSync(treesDir)) {
      result.type = 'orchestrator';
    } else {
      result.type = 'main_repo';
    }

    result.projectRoot = cwd;
    result.branch = getCurrentBranch(cwd);
  }

  return result;
}

/**
 * Get the current git branch
 */
function getCurrentBranch(repoPath: string): string | null {
  const headPath = join(repoPath, '.git', 'HEAD');
  if (!existsSync(headPath)) {
    return null;
  }

  const headContent = readFileSync(headPath, 'utf-8').trim();
  const match = headContent.match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1] : null;
}

/**
 * Infer task name from branch name
 * Convention: feature/task-name → task-name, feature/m-task-name → m-task-name
 */
function inferTaskFromBranch(branch: string): string | null {
  if (!branch) return null;

  // Remove common prefixes
  const prefixes = ['feature/', 'fix/', 'hotfix/', 'release/', 'chore/'];
  let taskName = branch;

  for (const prefix of prefixes) {
    if (taskName.startsWith(prefix)) {
      taskName = taskName.slice(prefix.length);
      break;
    }
  }

  return taskName || null;
}

/**
 * Find the .trees/.state directory, creating it if needed
 */
export function getStateDir(projectRoot: string): string {
  return join(projectRoot, '.trees', '.state');
}

/**
 * Get the status file path for a given task
 */
export function getStatusFilePath(projectRoot: string, taskName: string): string {
  const stateDir = getStateDir(projectRoot);
  return join(stateDir, `${taskName}.status.json`);
}
