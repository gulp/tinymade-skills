#!/usr/bin/env bash
# show_statuses.sh - Wrapper script for initializer show command
#
# Usage:
#   ./show_statuses.sh [task-name] [--json]
#
# Examples:
#   ./show_statuses.sh                  # Show all statuses (human-readable)
#   ./show_statuses.sh --json           # Show all statuses (JSON)
#   ./show_statuses.sh my-task          # Show specific task status
#   ./show_statuses.sh my-task --json   # Show specific task as JSON

set -euo pipefail

# Find the initializer CLI
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INITIALIZER_BIN="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")/bin/initializer"

# Check if initializer exists
if [[ ! -x "$INITIALIZER_BIN" ]]; then
    echo "Error: initializer CLI not found at $INITIALIZER_BIN" >&2
    exit 1
fi

# Forward all arguments to initializer show
exec "$INITIALIZER_BIN" show "$@"
