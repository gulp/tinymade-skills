#!/usr/bin/env python3
"""
Read Plane cache summary without loading full contents into context.

Usage:
    python read_cache.py                    # Summary only
    python read_cache.py --issues           # List all issues
    python read_cache.py --linked           # Show linked issues
    python read_cache.py --states           # Show state mapping
    python read_cache.py --issue CCPRISM-27 # Get specific issue

Output (JSON):
    {"project": "CCPRISM", "issues_count": 27, "linked_count": 1, "last_sync": "2025-12-11T..."}
"""

import argparse
import json
from pathlib import Path


CACHE_FILE = ".claude/plane-sync.json"


def load_cache(cache_path: Path) -> dict | None:
    """Load cache or return None if not found."""
    if not cache_path.exists():
        return None
    return json.loads(cache_path.read_text())


def get_summary(cache: dict) -> dict:
    """Get cache summary."""
    project = cache.get("project", {})
    return {
        "project": project.get("identifier", "Unknown"),
        "project_name": project.get("name", "Unknown"),
        "project_id": project.get("id"),
        "workspace": project.get("workspace"),
        "issues_count": len(cache.get("issues", {})),
        "linked_count": len(cache.get("linked", {})),
        "states_count": len(cache.get("states", {})),
        "last_sync": cache.get("lastSync")
    }


def get_issues(cache: dict, state_filter: str = None) -> dict:
    """Get all issues, optionally filtered by state."""
    issues = cache.get("issues", {})
    if state_filter:
        issues = {k: v for k, v in issues.items() if v.get("state", "").lower() == state_filter.lower()}

    # Return condensed format
    result = {}
    for key, issue in issues.items():
        result[key] = {
            "name": issue.get("name"),
            "state": issue.get("state")
        }
    return {"issues": result, "count": len(result)}


def get_issue(cache: dict, issue_key: str) -> dict:
    """Get specific issue details."""
    issues = cache.get("issues", {})
    linked = cache.get("linked", {})

    if issue_key not in issues:
        return {"error": f"Issue {issue_key} not found in cache"}

    issue = issues[issue_key]
    issue["linked_task"] = linked.get(issue_key)
    return {"issue": issue_key, **issue}


def get_linked(cache: dict) -> dict:
    """Get all linked issues."""
    linked = cache.get("linked", {})
    issues = cache.get("issues", {})

    result = {}
    for issue_key, task_file in linked.items():
        issue = issues.get(issue_key, {})
        result[issue_key] = {
            "task": task_file,
            "name": issue.get("name"),
            "state": issue.get("state")
        }
    return {"linked": result, "count": len(result)}


def get_states(cache: dict) -> dict:
    """Get state mapping."""
    return {"states": cache.get("states", {})}


def get_unlinked(cache: dict) -> dict:
    """Get issues that are not linked to any task."""
    issues = cache.get("issues", {})
    linked = cache.get("linked", {})

    unlinked = {}
    for key, issue in issues.items():
        if key not in linked:
            unlinked[key] = {
                "name": issue.get("name"),
                "state": issue.get("state")
            }
    return {"unlinked": unlinked, "count": len(unlinked)}


def main():
    parser = argparse.ArgumentParser(description="Read Plane cache summary")
    parser.add_argument("--cache", default=CACHE_FILE, help="Cache file path")
    parser.add_argument("--issues", action="store_true", help="List all issues")
    parser.add_argument("--issue", help="Get specific issue by key (e.g., CCPRISM-27)")
    parser.add_argument("--linked", action="store_true", help="Show linked issues")
    parser.add_argument("--unlinked", action="store_true", help="Show unlinked issues")
    parser.add_argument("--states", action="store_true", help="Show state mapping")
    parser.add_argument("--state-filter", help="Filter issues by state")
    args = parser.parse_args()

    cache_path = Path(args.cache)
    cache = load_cache(cache_path)

    if cache is None:
        result = {"error": f"Cache not found at {cache_path}. Run plane-sync first."}
    elif args.issue:
        result = get_issue(cache, args.issue)
    elif args.issues:
        result = get_issues(cache, args.state_filter)
    elif args.linked:
        result = get_linked(cache)
    elif args.unlinked:
        result = get_unlinked(cache)
    elif args.states:
        result = get_states(cache)
    else:
        result = get_summary(cache)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
