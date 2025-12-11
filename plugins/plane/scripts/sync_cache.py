#!/usr/bin/env python3
"""
Sync Plane issues to local cache.

This script is meant to be called AFTER Claude has fetched data via MCP tools.
It takes the fetched data as JSON input and updates the cache file.

Usage:
    # Pipe project/issues/states JSON from MCP response
    echo '{"project": {...}, "issues": [...], "states": [...]}' | python sync_cache.py

    # Or pass as argument
    python sync_cache.py --data '{"project": {...}, "issues": [...], "states": [...]}'

    # Just update timestamp (no data changes)
    python sync_cache.py --touch

Output (JSON):
    {"success": true, "issues_count": 27, "states_count": 7, "new": ["CCPRISM-27"], "updated": ["CCPRISM-25"]}
"""

import argparse
import json
import sys
from datetime import datetime, timezone
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


def map_state_group_to_status(group: str) -> str:
    """Map Plane state group to task status convention."""
    mapping = {
        "backlog": "backlog",
        "unstarted": "pending",
        "started": "in_progress",
        "completed": "completed",
        "cancelled": "cancelled"
    }
    return mapping.get(group, group)


def get_state_name(state_id: str, states_by_id: dict) -> str:
    """Get human-readable state name from state_id."""
    state = states_by_id.get(state_id, {})
    return state.get("name", "Unknown")


def sync_cache(data: dict, cache_path: Path) -> dict:
    """Sync data to cache and return summary."""
    cache = load_cache(cache_path)

    new_issues = []
    updated_issues = []

    # Update project info
    if "project" in data:
        proj = data["project"]
        cache["project"] = {
            "id": proj.get("id"),
            "identifier": proj.get("identifier"),
            "name": proj.get("name"),
            "workspace": proj.get("workspace", cache.get("project", {}).get("workspace"))
        }

    # Update states mapping
    states_by_id = {}
    if "states" in data:
        for state in data["states"]:
            states_by_id[state["id"]] = state
            group = state.get("group", "")
            status_key = map_state_group_to_status(group)

            # Handle multiple states in same group (e.g., "In Review" and "In Progress" both in "started")
            # Use specific names for non-primary states
            name_lower = state["name"].lower().replace(" ", "_")
            if name_lower in ["in_review", "ready_to_merge"]:
                cache["states"][name_lower] = state["id"]
            elif status_key not in cache["states"]:
                cache["states"][status_key] = state["id"]

    # Update issues
    if "issues" in data:
        identifier = cache.get("project", {}).get("identifier", "PROJ")

        for issue in data["issues"]:
            issue_key = f"{identifier}-{issue['sequence_id']}"
            state_id = issue.get("state", {}).get("id") if isinstance(issue.get("state"), dict) else issue.get("state")
            state_name = get_state_name(state_id, states_by_id) if states_by_id else "Unknown"

            issue_data = {
                "id": issue["id"],
                "name": issue["name"],
                "state": state_name,
                "state_id": state_id,
                "priority": issue.get("priority", {}).get("id", "none") if isinstance(issue.get("priority"), dict) else issue.get("priority", "none"),
                "updated_at": issue.get("updated_at")
            }

            if issue_key not in cache["issues"]:
                new_issues.append(issue_key)
            elif cache["issues"][issue_key].get("updated_at") != issue_data["updated_at"]:
                updated_issues.append(issue_key)

            cache["issues"][issue_key] = issue_data

    # Update timestamp
    cache["lastSync"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    save_cache(cache_path, cache)

    return {
        "success": True,
        "issues_count": len(cache["issues"]),
        "states_count": len(cache["states"]),
        "new": new_issues,
        "updated": updated_issues
    }


def touch_cache(cache_path: Path) -> dict:
    """Just update the timestamp."""
    cache = load_cache(cache_path)
    cache["lastSync"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    save_cache(cache_path, cache)
    return {
        "success": True,
        "issues_count": len(cache["issues"]),
        "touched": True
    }


def main():
    parser = argparse.ArgumentParser(description="Sync Plane data to local cache")
    parser.add_argument("--data", help="JSON data from Plane MCP response")
    parser.add_argument("--touch", action="store_true", help="Just update timestamp")
    parser.add_argument("--cache", default=CACHE_FILE, help="Cache file path")
    args = parser.parse_args()

    cache_path = Path(args.cache)

    if args.touch:
        result = touch_cache(cache_path)
    elif args.data:
        data = json.loads(args.data)
        result = sync_cache(data, cache_path)
    elif not sys.stdin.isatty():
        data = json.load(sys.stdin)
        result = sync_cache(data, cache_path)
    else:
        result = {"success": False, "error": "No data provided. Use --data, --touch, or pipe JSON to stdin."}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
