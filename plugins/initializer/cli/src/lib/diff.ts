/**
 * Git diff statistics calculation
 */

export interface DiffStats {
  additions: number;
  deletions: number;
}

/**
 * Get diff stats comparing current branch to origin/main (or origin/master)
 */
export async function getDiffStats(): Promise<DiffStats | null> {
  try {
    // Verify we're in a git repository before running git commands
    const checkRepo = Bun.spawn(['git', 'rev-parse', '--git-dir'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await checkRepo.exited;

    if (checkRepo.exitCode !== 0) {
      // Not in a git repository
      return null;
    }

    // Try origin/main first, then origin/master
    let baseBranch = 'origin/main';

    const checkMain = Bun.spawn(['git', 'rev-parse', '--verify', 'origin/main'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await checkMain.exited;

    if (checkMain.exitCode !== 0) {
      const checkMaster = Bun.spawn(['git', 'rev-parse', '--verify', 'origin/master'], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      await checkMaster.exited;

      if (checkMaster.exitCode !== 0) {
        // Neither origin/main nor origin/master exists, try local main/master
        baseBranch = 'main';
        const checkLocalMain = Bun.spawn(['git', 'rev-parse', '--verify', 'main'], {
          stdout: 'pipe',
          stderr: 'pipe',
        });
        await checkLocalMain.exited;

        if (checkLocalMain.exitCode !== 0) {
          baseBranch = 'master';
        }
      } else {
        baseBranch = 'origin/master';
      }
    }

    const proc = Bun.spawn(['git', 'diff', '--numstat', baseBranch], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const output = await new Response(proc.stdout).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      return null;
    }

    let additions = 0;
    let deletions = 0;

    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const parts = line.split('\t');
      if (parts.length >= 2) {
        const add = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!isNaN(add)) additions += add;
        if (!isNaN(del)) deletions += del;
      }
    }

    return { additions, deletions };
  } catch {
    return null;
  }
}
