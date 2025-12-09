#!/usr/bin/env python3
"""
Parse cc-sessions task file frontmatter.

Usage:
    python scripts/parse_task.py <task-file>
    python scripts/parse_task.py sessions/tasks/m-implement-feature.md

Output:
    JSON with name, branch, status, created fields
"""

import sys
import json
import re
from pathlib import Path


def parse_frontmatter(content: str) -> dict:
    """Extract YAML frontmatter from markdown content."""
    # Match content between --- markers
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
    """Convert branch name to folder name (/ and _ become -)."""
    return branch.replace('/', '-').replace('_', '-')


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: parse_task.py <task-file>"}))
        sys.exit(1)

    task_file = Path(sys.argv[1])

    if not task_file.exists():
        print(json.dumps({"error": f"File not found: {task_file}"}))
        sys.exit(1)

    content = task_file.read_text()
    frontmatter = parse_frontmatter(content)

    if not frontmatter:
        print(json.dumps({"error": "No frontmatter found"}))
        sys.exit(1)

    # Add computed fields
    if 'branch' in frontmatter:
        frontmatter['folder'] = normalize_branch_to_folder(frontmatter['branch'])
        frontmatter['worktree_path'] = f".trees/{frontmatter['folder']}"

    frontmatter['file'] = str(task_file)
    frontmatter['filename'] = task_file.name

    print(json.dumps(frontmatter, indent=2))


if __name__ == '__main__':
    main()
