#!/usr/bin/env python3
"""
Manage warm gemini sessions for context preservation.
Supports listing, resuming, continuing, and deleting sessions.

Usage:
    # List available sessions
    python gemini_session.py list

    # Continue latest session with new prompt
    python gemini_session.py continue --prompt "Follow up question"

    # Resume specific session by index
    python gemini_session.py resume --index 2 --prompt "Continue from here"

    # Create named session (starts new, saves reference)
    python gemini_session.py create --name "research-wasm" --prompt "Research WASM"

    # Continue named session
    python gemini_session.py continue --name "research-wasm" --prompt "More details"

    # Delete session
    python gemini_session.py delete --index 3

Output JSON:
    {
        "action": "continue",
        "session": {"index": 0, "name": "research-wasm"},
        "response": "Gemini's response text",
        "success": true,
        "error": null
    }
"""

import json
import subprocess
import sys
import argparse
import shutil
import os
import re
from pathlib import Path
from datetime import datetime


# Session state file location (per-project or user-level)
def get_session_state_path():
    """Get path to session state file."""
    # Try project-level first
    project_state = Path(".gemini-offloader-sessions.json")
    if project_state.exists():
        return project_state

    # Fall back to user-level
    user_state = Path.home() / ".config" / "gemini-offloader" / "sessions.json"
    user_state.parent.mkdir(parents=True, exist_ok=True)
    return user_state


def load_session_state():
    """Load named session mappings."""
    state_path = get_session_state_path()
    if state_path.exists():
        try:
            with open(state_path) as f:
                return json.load(f)
        except:
            pass
    return {"named_sessions": {}, "last_used": None}


def save_session_state(state):
    """Save named session mappings."""
    state_path = get_session_state_path()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with open(state_path, "w") as f:
        json.dump(state, f, indent=2)


def find_gemini():
    """Find gemini executable."""
    path = shutil.which("gemini")
    if not path:
        return None, "gemini-cli not found"
    return path, None


def list_sessions(gemini_path):
    """List available gemini sessions."""
    try:
        result = subprocess.run(
            [gemini_path, "--list-sessions"],
            capture_output=True,
            text=True,
            timeout=10
        )
        output = result.stdout + result.stderr

        if "No previous sessions" in output:
            return []

        # Parse session list
        sessions = []
        for line in output.strip().split("\n"):
            line = line.strip()
            if not line:
                continue

            # Parse various formats gemini might use
            # Format: "1: Session description" or "1. Session (date)"
            match = re.match(r"(\d+)[:\.\s]+(.+)", line)
            if match:
                sessions.append({
                    "index": int(match.group(1)),
                    "description": match.group(2).strip()
                })

        return sessions
    except Exception as e:
        return []


def run_with_session(gemini_path, prompt, resume=None, timeout=300):
    """Run gemini with optional session resume."""
    cmd = [gemini_path]

    if resume is not None:
        if resume == "latest":
            cmd.extend(["--resume", "latest"])
        else:
            cmd.extend(["--resume", str(resume)])

    cmd.extend(["-o", "json"])
    cmd.append(prompt)

    try:
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout
        )

        # Parse response
        if process.stdout.strip():
            try:
                data = json.loads(process.stdout)
                if "error" in data:
                    return None, data["error"].get("message", str(data["error"]))
                return data.get("response") or data.get("text"), None
            except json.JSONDecodeError:
                # Plain text response
                return process.stdout.strip(), None

        return None, process.stderr.strip() or "No response"

    except subprocess.TimeoutExpired:
        return None, f"Timeout after {timeout}s"
    except Exception as e:
        return None, str(e)


def cmd_list(args):
    """List sessions command."""
    gemini_path, error = find_gemini()
    if error:
        return {"success": False, "error": error}

    sessions = list_sessions(gemini_path)
    state = load_session_state()

    # Enhance with named session info
    named = state.get("named_sessions", {})
    for session in sessions:
        for name, idx in named.items():
            if idx == session["index"]:
                session["name"] = name
                break

    return {
        "action": "list",
        "sessions": sessions,
        "named_sessions": named,
        "last_used": state.get("last_used"),
        "success": True
    }


def cmd_continue(args):
    """Continue a session (latest or named)."""
    gemini_path, error = find_gemini()
    if error:
        return {"success": False, "error": error}

    state = load_session_state()

    # Determine which session to resume
    resume = "latest"
    session_info = {"type": "latest"}

    if args.name:
        # Named session lookup
        named = state.get("named_sessions", {})
        if args.name not in named:
            return {
                "success": False,
                "error": f"Named session '{args.name}' not found. Use 'create' first."
            }
        resume = named[args.name]
        session_info = {"type": "named", "name": args.name, "index": resume}

    elif args.index is not None:
        resume = args.index
        session_info = {"type": "indexed", "index": resume}

    # Run query
    response, error = run_with_session(
        gemini_path,
        args.prompt,
        resume=resume,
        timeout=args.timeout
    )

    if error:
        return {
            "action": "continue",
            "session": session_info,
            "success": False,
            "error": error
        }

    # Update last used
    state["last_used"] = {
        "session": session_info,
        "timestamp": datetime.now().isoformat(),
        "prompt_preview": args.prompt[:100]
    }
    save_session_state(state)

    return {
        "action": "continue",
        "session": session_info,
        "response": response,
        "success": True
    }


def cmd_create(args):
    """Create a new named session."""
    gemini_path, error = find_gemini()
    if error:
        return {"success": False, "error": error}

    # Run initial query (creates new session)
    response, error = run_with_session(
        gemini_path,
        args.prompt,
        resume=None,  # Don't resume, start fresh
        timeout=args.timeout
    )

    if error:
        return {
            "action": "create",
            "success": False,
            "error": error
        }

    # Get the new session index (should be 0 for most recent)
    sessions = list_sessions(gemini_path)
    new_index = 0  # Most recent is typically 0
    if sessions:
        new_index = sessions[0]["index"]

    # Save named mapping
    state = load_session_state()
    state["named_sessions"][args.name] = new_index
    state["last_used"] = {
        "session": {"type": "named", "name": args.name, "index": new_index},
        "timestamp": datetime.now().isoformat(),
        "prompt_preview": args.prompt[:100]
    }
    save_session_state(state)

    return {
        "action": "create",
        "session": {"name": args.name, "index": new_index},
        "response": response,
        "success": True
    }


def cmd_resume(args):
    """Resume a specific session by index."""
    return cmd_continue(args)  # Same logic, just explicit about index


def cmd_delete(args):
    """Delete a session."""
    gemini_path, error = find_gemini()
    if error:
        return {"success": False, "error": error}

    try:
        result = subprocess.run(
            [gemini_path, "--delete-session", str(args.index)],
            capture_output=True,
            text=True,
            timeout=10
        )

        # Remove from named sessions if exists
        state = load_session_state()
        named = state.get("named_sessions", {})
        to_remove = [name for name, idx in named.items() if idx == args.index]
        for name in to_remove:
            del named[name]
        save_session_state(state)

        return {
            "action": "delete",
            "index": args.index,
            "removed_names": to_remove,
            "success": True
        }

    except Exception as e:
        return {
            "action": "delete",
            "success": False,
            "error": str(e)
        }


def main():
    parser = argparse.ArgumentParser(description="Manage gemini sessions")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # List command
    list_parser = subparsers.add_parser("list", help="List available sessions")

    # Continue command
    continue_parser = subparsers.add_parser("continue", help="Continue a session")
    continue_parser.add_argument("--prompt", "-p", required=True, help="Prompt to continue with")
    continue_parser.add_argument("--name", "-n", help="Named session to continue")
    continue_parser.add_argument("--index", "-i", type=int, help="Session index to continue")
    continue_parser.add_argument("--timeout", "-t", type=int, default=300)

    # Create command
    create_parser = subparsers.add_parser("create", help="Create named session")
    create_parser.add_argument("--name", "-n", required=True, help="Name for the session")
    create_parser.add_argument("--prompt", "-p", required=True, help="Initial prompt")
    create_parser.add_argument("--timeout", "-t", type=int, default=300)

    # Resume command
    resume_parser = subparsers.add_parser("resume", help="Resume session by index")
    resume_parser.add_argument("--index", "-i", type=int, required=True)
    resume_parser.add_argument("--prompt", "-p", required=True)
    resume_parser.add_argument("--timeout", "-t", type=int, default=300)

    # Delete command
    delete_parser = subparsers.add_parser("delete", help="Delete a session")
    delete_parser.add_argument("--index", "-i", type=int, required=True)

    args = parser.parse_args()

    # Dispatch to command handler
    handlers = {
        "list": cmd_list,
        "continue": cmd_continue,
        "create": cmd_create,
        "resume": cmd_resume,
        "delete": cmd_delete
    }

    result = handlers[args.command](args)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
