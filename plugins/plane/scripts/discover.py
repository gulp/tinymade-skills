#!/usr/bin/env python3
"""
Compare Plane cache with local task files to discover gaps and mismatches.

Usage:
    python discover.py --tasks-dir sessions/tasks
    python discover.py --tasks-dir sessions/tasks --status-check

Output (JSON):
    {
        "unlinked_issues": {"CCPRISM-25": {"name": "...", "state": "..."}},
        "unlinked_tasks": ["m-some-task.md"],
        "status_mismatches": [{"issue": "CCPRISM-27", "task_status": "pending", "plane_state": "In Progress"}],
        "summary": {"unlinked_issues": 5, "unlinked_tasks": 2, "mismatches": 1}
    }
"""

import argparse
import json
import re
from pathlib import Path


CACHE_FILE = ".claude/plane-sync.json"


def load_cache(cache_path: Path) -> dict | None:
    """Load cache or return None if not found."""
    if not cache_path.exists():
        return None
    return json.loads(cache_path.read_text())


def parse_task_frontmatter(task_path: Path) -> dict | None:
    """Parse YAML frontmatter from task file."""
    content = task_path.read_text()

    # Extract frontmatter between --- markers
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return None

    frontmatter = {}
    for line in match.group(1).split('\n'):
        if ':' in line:
            key, value = line.split(':', 1)
            frontmatter[key.strip()] = value.strip()

    return frontmatter


def get_task_files(tasks_dir: Path) -> list[Path]:
    """Get all task markdown files."""
    if not tasks_dir.exists():
        return []
    return list(tasks_dir.glob("*.md"))


def map_task_status_to_plane_state(status: str) -> str:
    """Map task status to expected Plane state name."""
    mapping = {
        "backlog": "Backlog",
        "pending": "Todo",
        "in_progress": "In Progress",
        "in-progress": "In Progress",
        "completed": "Done",
        "cancelled": "Cancelled"
    }
    return mapping.get(status.lower(), status)


def discover(cache_path: Path, tasks_dir: Path, check_status: bool = False) -> dict:
    """Discover gaps between cache and local tasks."""
    cache = load_cache(cache_path)

    if cache is None:
        return {"error": f"Cache not found at {cache_path}. Run plane-sync first."}

    issues = cache.get("issues", {})
    linked = cache.get("linked", {})

    # Find issues not linked to any task
    unlinked_issues = {}
    for key, issue in issues.items():
        if key not in linked:
            unlinked_issues[key] = {
                "name": issue.get("name"),
                "state": issue.get("state")
            }

    # Find tasks not linked to any issue
    unlinked_tasks = []
    task_files = get_task_files(tasks_dir)
    linked_tasks = set(linked.values())

    for task_path in task_files:
        task_name = task_path.name
        if task_name not in linked_tasks:
            # Check if task has plane_issue in frontmatter but not in cache
            frontmatter = parse_task_frontmatter(task_path)
            if frontmatter:
                plane_issue = frontmatter.get("plane_issue")
                if plane_issue and plane_issue not in linked:
                    # Task claims a link but cache doesn't have it
                    unlinked_tasks.append({
                        "file": task_name,
                        "claims_issue": plane_issue,
                        "status": frontmatter.get("status")
                    })
                elif not plane_issue:
                    unlinked_tasks.append({
                        "file": task_name,
                        "status": frontmatter.get("status")
                    })

    # Check status mismatches
    status_mismatches = []
    if check_status:
        for issue_key, task_file in linked.items():
            task_path = tasks_dir / task_file
            if not task_path.exists():
                continue

            frontmatter = parse_task_frontmatter(task_path)
            if not frontmatter:
                continue

            task_status = frontmatter.get("status", "")
            expected_state = map_task_status_to_plane_state(task_status)
            actual_state = issues.get(issue_key, {}).get("state", "")

            if expected_state.lower() != actual_state.lower():
                status_mismatches.append({
                    "issue": issue_key,
                    "task": task_file,
                    "task_status": task_status,
                    "plane_state": actual_state,
                    "expected_state": expected_state
                })

    return {
        "unlinked_issues": unlinked_issues,
        "unlinked_tasks": unlinked_tasks,
        "status_mismatches": status_mismatches if check_status else [],
        "summary": {
            "unlinked_issues": len(unlinked_issues),
            "unlinked_tasks": len(unlinked_tasks),
            "mismatches": len(status_mismatches) if check_status else 0,
            "total_issues": len(issues),
            "total_linked": len(linked)
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Discover gaps between Plane and local tasks")
    parser.add_argument("--cache", default=CACHE_FILE, help="Cache file path")
    parser.add_argument("--tasks-dir", default="sessions/tasks", help="Tasks directory")
    parser.add_argument("--status-check", action="store_true", help="Check for status mismatches")
    args = parser.parse_args()

    cache_path = Path(args.cache)
    tasks_dir = Path(args.tasks_dir)

    result = discover(cache_path, tasks_dir, args.status_check)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
