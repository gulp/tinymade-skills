#!/usr/bin/env python3
"""
List all tasks grouped by branch.

Usage:
    python scripts/list_tasks_by_branch.py [tasks-dir]
    python scripts/list_tasks_by_branch.py sessions/tasks

Output:
    JSON mapping branches to their tasks
"""

import sys
import json
import re
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


def main():
    tasks_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('sessions/tasks')

    if not tasks_dir.exists():
        print(json.dumps({"error": f"Directory not found: {tasks_dir}"}))
        sys.exit(1)

    # Group tasks by branch
    branches = defaultdict(list)
    tasks_without_branch = []

    for task_file in tasks_dir.glob('*.md'):
        # Skip templates and special files
        if 'TEMPLATE' in task_file.name:
            continue
        if task_file.is_dir():
            continue

        content = task_file.read_text()
        frontmatter = parse_frontmatter(content)

        task_info = {
            'file': task_file.name,
            'name': frontmatter.get('name', task_file.stem),
            'status': frontmatter.get('status', 'unknown'),
            'created': frontmatter.get('created', ''),
        }

        branch = frontmatter.get('branch')
        if branch:
            task_info['branch'] = branch
            branches[branch].append(task_info)
        else:
            tasks_without_branch.append(task_info)

    # Build output
    output = {
        'branches': {},
        'summary': {
            'total_branches': len(branches),
            'total_tasks': sum(len(tasks) for tasks in branches.values()),
            'tasks_without_branch': len(tasks_without_branch),
        }
    }

    for branch, tasks in sorted(branches.items()):
        folder = normalize_branch_to_folder(branch)
        worktree_path = f".trees/{folder}"
        worktree_exists = Path(worktree_path).exists()

        output['branches'][branch] = {
            'folder': folder,
            'worktree_path': worktree_path,
            'worktree_exists': worktree_exists,
            'task_count': len(tasks),
            'tasks': tasks,
            'statuses': {
                'pending': sum(1 for t in tasks if t['status'] == 'pending'),
                'in-progress': sum(1 for t in tasks if t['status'] == 'in-progress'),
                'completed': sum(1 for t in tasks if t['status'] == 'completed'),
                'blocked': sum(1 for t in tasks if t['status'] == 'blocked'),
            }
        }

    if tasks_without_branch:
        output['tasks_without_branch'] = tasks_without_branch

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
