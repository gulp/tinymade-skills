#!/usr/bin/env python3
"""
Add or update a single issue in the Plane cache.

Usage:
    python add_issue.py --key CCPRISM-27 --id UUID --name "Issue Title" --state "In Progress" --state-id UUID
    python add_issue.py --key CCPRISM-27 --data '{"id": "...", "name": "...", "state": "...", "state_id": "..."}'

Output (JSON):
    {"success": true, "issue": "CCPRISM-27", "action": "added"}
    {"success": true, "issue": "CCPRISM-27", "action": "updated"}
"""

import argparse
import json
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


def add_issue(cache_path: Path, key: str, issue_data: dict) -> dict:
    """Add or update an issue in the cache."""
    cache = load_cache(cache_path)

    action = "updated" if key in cache.get("issues", {}) else "added"

    if "issues" not in cache:
        cache["issues"] = {}

    # Build issue entry
    cache["issues"][key] = {
        "id": issue_data.get("id"),
        "name": issue_data.get("name"),
        "state": issue_data.get("state"),
        "state_id": issue_data.get("state_id"),
        "priority": issue_data.get("priority", "none"),
        "updated_at": issue_data.get("updated_at", datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
    }

    save_cache(cache_path, cache)

    return {
        "success": True,
        "issue": key,
        "action": action,
        "name": issue_data.get("name")
    }


def main():
    parser = argparse.ArgumentParser(description="Add or update issue in cache")
    parser.add_argument("--cache", default=CACHE_FILE, help="Cache file path")
    parser.add_argument("--key", required=True, help="Issue key (e.g., CCPRISM-27)")
    parser.add_argument("--data", help="JSON issue data")
    parser.add_argument("--id", help="Issue UUID")
    parser.add_argument("--name", help="Issue name/title")
    parser.add_argument("--state", help="State name (e.g., 'In Progress')")
    parser.add_argument("--state-id", help="State UUID")
    parser.add_argument("--priority", default="none", help="Priority level")
    args = parser.parse_args()

    cache_path = Path(args.cache)

    if args.data:
        issue_data = json.loads(args.data)
    else:
        issue_data = {
            "id": args.id,
            "name": args.name,
            "state": args.state,
            "state_id": args.state_id,
            "priority": args.priority
        }

    if not issue_data.get("id") or not issue_data.get("name"):
        result = {"success": False, "error": "Missing required fields: id and name"}
    else:
        result = add_issue(cache_path, args.key, issue_data)

    print(json.dumps(result))


if __name__ == "__main__":
    main()
