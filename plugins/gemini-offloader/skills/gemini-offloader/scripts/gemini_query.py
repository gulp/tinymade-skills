#!/usr/bin/env python3
"""
Execute a single gemini query with structured output.
Handles prompt formatting, output parsing, and error handling.

Usage:
    python gemini_query.py --prompt "Your question here"
    python gemini_query.py --prompt "Question" --model gemini-2.5-flash
    python gemini_query.py --prompt "Question" --output-file result.md
    python gemini_query.py --prompt "Question" --include-dirs ./src,./docs
    echo "context" | python gemini_query.py --prompt "Summarize this"

Output JSON:
    {
        "success": true,
        "response": "The actual response text",
        "model": "gemini-2.5-pro",
        "tokens": {"prompt": 100, "completion": 200, "total": 300},
        "error": null
    }
"""

import json
import subprocess
import sys
import argparse
import shutil
from pathlib import Path


def find_gemini():
    """Find gemini executable."""
    path = shutil.which("gemini")
    if not path:
        return None, "gemini-cli not found. Install with: npm install -g @google/gemini-cli"
    return path, None


def build_command(gemini_path, args, stdin_data=None):
    """Build the gemini command with arguments."""
    cmd = [gemini_path]

    # Model selection
    if args.model:
        cmd.extend(["-m", args.model])

    # Include directories
    if args.include_dirs:
        for dir_path in args.include_dirs.split(","):
            cmd.extend(["--include-directories", dir_path.strip()])

    # Allowed tools (if specified)
    if args.allowed_tools:
        for tool in args.allowed_tools.split(","):
            cmd.extend(["--allowed-tools", tool.strip()])

    # YOLO mode for auto-approval
    if args.yolo:
        cmd.append("--yolo")

    # Output format - always use json for programmatic parsing
    cmd.extend(["-o", "json"])

    # The prompt (using positional argument, not deprecated -p)
    cmd.append(args.prompt)

    return cmd


def parse_gemini_output(stdout, stderr, return_code):
    """Parse gemini's JSON output."""
    result = {
        "success": False,
        "response": None,
        "model": None,
        "tokens": None,
        "error": None,
        "raw_output": None
    }

    # Try to parse JSON output
    try:
        # gemini outputs JSON when using -o json
        if stdout.strip():
            data = json.loads(stdout)

            # Handle error response
            if "error" in data:
                result["error"] = data["error"].get("message", str(data["error"]))
                result["raw_output"] = stdout
                return result

            # Handle success response
            result["success"] = True
            result["response"] = data.get("response") or data.get("text") or data.get("content")
            result["model"] = data.get("model")

            # Token usage if available
            if "usage" in data:
                result["tokens"] = {
                    "prompt": data["usage"].get("promptTokens", 0),
                    "completion": data["usage"].get("completionTokens", 0),
                    "total": data["usage"].get("totalTokens", 0)
                }

            return result
    except json.JSONDecodeError:
        # Not JSON, treat as plain text
        pass

    # Fallback: treat stdout as plain text response
    if stdout.strip() and return_code == 0:
        result["success"] = True
        result["response"] = stdout.strip()
        return result

    # Error case
    result["error"] = stderr.strip() if stderr.strip() else f"Command failed with code {return_code}"
    result["raw_output"] = stdout + stderr
    return result


def run_query(args):
    """Execute the gemini query."""
    # Find gemini
    gemini_path, error = find_gemini()
    if error:
        return {"success": False, "error": error}

    # Read stdin if available (for piping content)
    stdin_data = None
    if not sys.stdin.isatty():
        stdin_data = sys.stdin.read()
        # Prepend stdin content to prompt
        if stdin_data.strip():
            args.prompt = f"Context:\n{stdin_data}\n\nTask: {args.prompt}"

    # Build command
    cmd = build_command(gemini_path, args, stdin_data)

    try:
        # Run gemini
        process = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=args.timeout
        )

        # Parse output
        result = parse_gemini_output(
            process.stdout,
            process.stderr,
            process.returncode
        )

        # Save to file if requested
        if args.output_file and result["success"] and result["response"]:
            output_path = Path(args.output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(result["response"])
            result["saved_to"] = str(output_path)

        return result

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "error": f"Query timed out after {args.timeout} seconds"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def main():
    parser = argparse.ArgumentParser(
        description="Execute a gemini query with structured output"
    )
    parser.add_argument(
        "--prompt", "-p",
        required=True,
        help="The prompt to send to Gemini"
    )
    parser.add_argument(
        "--model", "-m",
        default=None,
        help="Model to use (e.g., gemini-2.5-flash, gemini-2.5-pro)"
    )
    parser.add_argument(
        "--include-dirs", "-d",
        default=None,
        help="Comma-separated directories to include in context"
    )
    parser.add_argument(
        "--allowed-tools",
        default=None,
        help="Comma-separated tools to allow without confirmation"
    )
    parser.add_argument(
        "--yolo",
        action="store_true",
        help="Auto-approve all tool calls"
    )
    parser.add_argument(
        "--output-file", "-o",
        default=None,
        help="Save response to file"
    )
    parser.add_argument(
        "--timeout", "-t",
        type=int,
        default=300,
        help="Timeout in seconds (default: 300)"
    )

    args = parser.parse_args()

    result = run_query(args)
    print(json.dumps(result, indent=2))

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
