#!/usr/bin/env python3
"""
Check if a worktree/branch is safe to cleanup.

Safety criteria:
- All tasks on the branch are completed
- No uncommitted changes in worktree (if exists)

Usage:
    python scripts/check_cleanup_safe.py <branch-name> [tasks-dir]
    python scripts/check_cleanup_safe.py feature/pick-cli sessions/tasks

Output:
    JSON with safety status and details
"""

import sys
import json
import re
import subprocess
from pathlib import Path


def parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from markdown content."""
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return {}

    frontmatter = {}
    for line in match.group(1).strip().split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip()

    return frontmatter


def normalize_branch_to_folder(branch: str) -> str:
    """Convert branch name to folder name."""
    return branch.replace('/', '-').replace('_', '-')


def check_uncommitted_changes(worktree_path: str) -> tuple[bool, list]:
    """Check for uncommitted changes in worktree."""
    try:
        result = subprocess.run(
            ['git', '-C', worktree_path, 'status', '--porcelain'],
            capture_output=True, text=True, check=True
        )
        changes = [line for line in result.stdout.strip().split('\n') if line]
        return len(changes) > 0, changes
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False, []


def check_branch_merged(branch: str, base: str = 'main') -> bool:
    """Check if branch is merged into base."""
    try:
        result = subprocess.run(
            ['git', 'branch', '--merged', base],
            capture_output=True, text=True, check=True
        )
        merged_branches = [b.strip().lstrip('* ') for b in result.stdout.strip().split('\n')]
        return branch in merged_branches
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: check_cleanup_safe.py <branch-name> [tasks-dir]"}))
        sys.exit(1)

    branch = sys.argv[1]
    tasks_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('sessions/tasks')

    folder = normalize_branch_to_folder(branch)
    worktree_path = f".trees/{folder}"
    worktree_exists = Path(worktree_path).exists()

    # Find all tasks for this branch
    tasks = []
    incomplete_tasks = []

    if tasks_dir.exists():
        for task_file in tasks_dir.glob('*.md'):
            if 'TEMPLATE' in task_file.name or task_file.is_dir():
                continue

            content = task_file.read_text()
            frontmatter = parse_frontmatter(content)

            if frontmatter.get('branch') == branch:
                task_info = {
                    'file': task_file.name,
                    'name': frontmatter.get('name', task_file.stem),
                    'status': frontmatter.get('status', 'unknown'),
                }
                tasks.append(task_info)

                if task_info['status'] != 'completed':
                    incomplete_tasks.append(task_info)

    # Check conditions
    all_tasks_completed = len(incomplete_tasks) == 0
    has_uncommitted = False
    uncommitted_files = []

    if worktree_exists:
        has_uncommitted, uncommitted_files = check_uncommitted_changes(worktree_path)

    is_merged = check_branch_merged(branch)

    # Determine safety
    safe = all_tasks_completed and not has_uncommitted
    warnings = []
    blockers = []

    if not all_tasks_completed:
        blockers.append(f"{len(incomplete_tasks)} task(s) not completed")

    if has_uncommitted:
        blockers.append(f"{len(uncommitted_files)} uncommitted change(s)")

    if not is_merged:
        warnings.append("Branch not merged to main")

    if not worktree_exists:
        warnings.append("Worktree does not exist (nothing to cleanup)")

    output = {
        'branch': branch,
        'folder': folder,
        'worktree_path': worktree_path,
        'worktree_exists': worktree_exists,
        'safe_to_cleanup': safe,
        'checks': {
            'all_tasks_completed': all_tasks_completed,
            'no_uncommitted_changes': not has_uncommitted,
            'branch_merged': is_merged,
        },
        'tasks': {
            'total': len(tasks),
            'completed': len(tasks) - len(incomplete_tasks),
            'incomplete': len(incomplete_tasks),
            'incomplete_list': incomplete_tasks,
        },
        'uncommitted_changes': uncommitted_files if has_uncommitted else [],
        'blockers': blockers,
        'warnings': warnings,
    }

    print(json.dumps(output, indent=2))

    # Exit with appropriate code
    sys.exit(0 if safe else 1)


if __name__ == '__main__':
    main()
