#!/usr/bin/env python3
"""
Get worktree status overview with task mappings.

Usage:
    python scripts/worktree_status.py [tasks-dir]
    python scripts/worktree_status.py sessions/tasks

Output:
    JSON with worktrees, their branches, and mapped tasks
"""

import sys
import json
import re
import subprocess
from pathlib import Path
from collections import defaultdict


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


def get_git_worktrees() -> list:
    """Get list of git worktrees."""
    try:
        result = subprocess.run(
            ['git', 'worktree', 'list', '--porcelain'],
            capture_output=True, text=True, check=True
        )
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []

    worktrees = []
    current = {}

    for line in result.stdout.strip().split('\n'):
        if line.startswith('worktree '):
            if current:
                worktrees.append(current)
            current = {'path': line[9:]}
        elif line.startswith('HEAD '):
            current['head'] = line[5:]
        elif line.startswith('branch '):
            # refs/heads/branch-name -> branch-name
            current['branch'] = line[7:].replace('refs/heads/', '')
        elif line == 'bare':
            current['bare'] = True
        elif line == 'detached':
            current['detached'] = True

    if current:
        worktrees.append(current)

    return worktrees


def get_current_branch() -> str:
    """Get current git branch."""
    try:
        result = subprocess.run(
            ['git', 'branch', '--show-current'],
            capture_output=True, text=True, check=True
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ''


def main():
    tasks_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('sessions/tasks')

    # Get git worktrees
    worktrees = get_git_worktrees()
    current_branch = get_current_branch()

    # Build branch -> tasks mapping
    branch_tasks = defaultdict(list)

    if tasks_dir.exists():
        for task_file in tasks_dir.glob('*.md'):
            if 'TEMPLATE' in task_file.name or task_file.is_dir():
                continue

            content = task_file.read_text()
            frontmatter = parse_frontmatter(content)
            branch = frontmatter.get('branch')

            if branch:
                branch_tasks[branch].append({
                    'file': task_file.name,
                    'name': frontmatter.get('name', task_file.stem),
                    'status': frontmatter.get('status', 'unknown'),
                })

    # Build output
    output = {
        'current_branch': current_branch,
        'worktrees': [],
        'branches_without_worktree': [],
        'summary': {
            'total_worktrees': len(worktrees),
            'total_branches_with_tasks': len(branch_tasks),
        }
    }

    # Track which branches have worktrees
    branches_with_worktrees = set()

    for wt in worktrees:
        branch = wt.get('branch', '')
        path = wt.get('path', '')
        is_trees = '/.trees/' in path or path.endswith('/.trees')

        worktree_info = {
            'path': path,
            'branch': branch,
            'head': wt.get('head', '')[:8],
            'is_current': branch == current_branch,
            'is_trees_worktree': is_trees,
            'tasks': branch_tasks.get(branch, []),
            'task_count': len(branch_tasks.get(branch, [])),
        }

        if branch:
            branches_with_worktrees.add(branch)

        output['worktrees'].append(worktree_info)

    # Find branches with tasks but no worktree
    for branch, tasks in branch_tasks.items():
        if branch not in branches_with_worktrees:
            folder = normalize_branch_to_folder(branch)
            output['branches_without_worktree'].append({
                'branch': branch,
                'folder': folder,
                'suggested_path': f".trees/{folder}",
                'tasks': tasks,
                'task_count': len(tasks),
            })

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
