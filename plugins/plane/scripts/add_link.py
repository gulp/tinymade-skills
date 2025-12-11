#!/usr/bin/env python3
"""
Add or remove a link between a Plane issue and a local task file.

Usage:
    python add_link.py --issue CCPRISM-27 --task m-implement-feature.md
    python add_link.py --issue CCPRISM-27 --remove

Output (JSON):
    {"success": true, "linked": "CCPRISM-27 ↔ m-implement-feature.md"}
    {"success": true, "unlinked": "CCPRISM-27"}
"""

import argparse
import json
from pathlib import Path


CACHE_FILE = ".claude/plane-sync.json"


def load_cache(cache_path: Path) -> dict:
    """Load existing cache or return empty structure."""
    if cache_path.exists():
        return json.loads(cache_path.read_text())
    return {
        "project": {},
        "states": {},
        "issues": {},
        "linked": {},
        "lastSync": None
    }


def save_cache(cache_path: Path, cache: dict) -> None:
    """Save cache to file."""
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(cache, indent=2) + "\n")


def add_link(cache_path: Path, issue_key: str, task_file: str) -> dict:
    """Add a link between issue and task."""
    cache = load_cache(cache_path)

    # Validate issue exists in cache
    if issue_key not in cache.get("issues", {}):
        return {
            "success": False,
            "error": f"Issue {issue_key} not found in cache. Run plane-sync first."
        }

    # Check if already linked to different task
    existing = cache.get("linked", {}).get(issue_key)
    if existing and existing != task_file:
        return {
            "success": False,
            "error": f"Issue {issue_key} already linked to {existing}. Use --remove first."
        }

    # Check if task already linked to different issue
    for k, v in cache.get("linked", {}).items():
        if v == task_file and k != issue_key:
            return {
                "success": False,
                "error": f"Task {task_file} already linked to {k}."
            }

    if "linked" not in cache:
        cache["linked"] = {}

    cache["linked"][issue_key] = task_file
    save_cache(cache_path, cache)

    issue_name = cache.get("issues", {}).get(issue_key, {}).get("name", "")
    return {
        "success": True,
        "linked": f"{issue_key} ↔ {task_file}",
        "issue_name": issue_name
    }


def remove_link(cache_path: Path, issue_key: str) -> dict:
    """Remove a link."""
    cache = load_cache(cache_path)

    if issue_key not in cache.get("linked", {}):
        return {
            "success": False,
            "error": f"Issue {issue_key} is not linked to any task."
        }

    task_file = cache["linked"].pop(issue_key)
    save_cache(cache_path, cache)

    return {
        "success": True,
        "unlinked": issue_key,
        "was_linked_to": task_file
    }


def main():
    parser = argparse.ArgumentParser(description="Manage issue-task links")
    parser.add_argument("--cache", default=CACHE_FILE, help="Cache file path")
    parser.add_argument("--issue", required=True, help="Issue key (e.g., CCPRISM-27)")
    parser.add_argument("--task", help="Task file name (e.g., m-implement-feature.md)")
    parser.add_argument("--remove", action="store_true", help="Remove the link")
    args = parser.parse_args()

    cache_path = Path(args.cache)

    if args.remove:
        result = remove_link(cache_path, args.issue)
    elif args.task:
        result = add_link(cache_path, args.issue, args.task)
    else:
        result = {"success": False, "error": "Provide --task to link or --remove to unlink"}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
