#!/usr/bin/env python3
"""
Check gemini-cli installation and authentication status.
Outputs JSON with installation path, version, auth method, and session list.

Usage:
    python gemini_status.py [--verbose]

Output JSON:
    {
        "installed": true,
        "path": "/usr/local/bin/gemini",
        "version": "0.20.2",
        "authenticated": true,
        "auth_method": "google_login",
        "sessions": [
            {"index": 0, "timestamp": "2024-12-13T10:30:00", "turns": 5}
        ],
        "error": null
    }
"""

import json
import subprocess
import shutil
import sys
import os
import re
from pathlib import Path


def check_installation():
    """Check if gemini-cli is installed and get path."""
    gemini_path = shutil.which("gemini")
    return gemini_path


def get_version(gemini_path):
    """Get gemini-cli version."""
    try:
        result = subprocess.run(
            [gemini_path, "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        # Version output is usually just the version number
        version = result.stdout.strip() or result.stderr.strip()
        return version
    except Exception as e:
        return f"error: {e}"


def check_authentication(gemini_path):
    """Check if authentication is configured."""
    # Check environment variables
    env_vars = {
        "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY"),
        "GOOGLE_API_KEY": os.environ.get("GOOGLE_API_KEY"),
        "GOOGLE_GENAI_USE_VERTEXAI": os.environ.get("GOOGLE_GENAI_USE_VERTEXAI"),
    }

    # Determine auth method from env
    if env_vars["GEMINI_API_KEY"]:
        return True, "api_key"
    elif env_vars["GOOGLE_API_KEY"] and env_vars["GOOGLE_GENAI_USE_VERTEXAI"]:
        return True, "vertex_ai"

    # Check settings file for OAuth
    settings_path = Path.home() / ".gemini" / "settings.json"
    if settings_path.exists():
        try:
            with open(settings_path) as f:
                settings = json.load(f)
                if settings.get("auth") or settings.get("oauth"):
                    return True, "google_login"
        except:
            pass

    # Try a test query to verify auth
    try:
        result = subprocess.run(
            [gemini_path, "-p", "test", "-o", "json"],
            capture_output=True,
            text=True,
            timeout=30
        )
        if "authentication" in result.stderr.lower() or "auth" in result.stderr.lower():
            return False, None
        if result.returncode == 0:
            return True, "unknown"
    except:
        pass

    return False, None


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

        # Parse session list (format may vary)
        sessions = []
        for line in output.strip().split("\n"):
            if line.strip():
                # Try to parse session info
                match = re.search(r"(\d+)[:\s]+(.+)", line)
                if match:
                    sessions.append({
                        "index": int(match.group(1)),
                        "description": match.group(2).strip()
                    })
        return sessions
    except Exception as e:
        return []


def main():
    verbose = "--verbose" in sys.argv or "-v" in sys.argv

    result = {
        "installed": False,
        "path": None,
        "version": None,
        "authenticated": False,
        "auth_method": None,
        "sessions": [],
        "error": None
    }

    # Check installation
    gemini_path = check_installation()
    if not gemini_path:
        result["error"] = "gemini-cli not found. Install with: npm install -g @google/gemini-cli"
        print(json.dumps(result, indent=2))
        sys.exit(1)

    result["installed"] = True
    result["path"] = gemini_path

    # Get version
    result["version"] = get_version(gemini_path)

    # Check authentication
    authenticated, auth_method = check_authentication(gemini_path)
    result["authenticated"] = authenticated
    result["auth_method"] = auth_method

    if not authenticated:
        result["error"] = "Authentication required. Run 'gemini' interactively to login, or set GEMINI_API_KEY"

    # List sessions
    result["sessions"] = list_sessions(gemini_path)

    print(json.dumps(result, indent=2))
    sys.exit(0 if authenticated else 1)


if __name__ == "__main__":
    main()
