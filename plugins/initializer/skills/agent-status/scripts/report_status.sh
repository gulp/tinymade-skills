#!/usr/bin/env bash
# report_status.sh - Wrapper script for initializer status command
#
# Usage:
#   ./report_status.sh "description" [--tests passed|failed|unknown] [--todos X/Y] [--blocked] [--reason "text"]
#
# Examples:
#   ./report_status.sh "Implementing auth" --tests passed --todos 3/7
#   ./report_status.sh "Stuck on API" --blocked --reason "Need credentials"

set -euo pipefail

# Find the initializer CLI
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INITIALIZER_BIN="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")/bin/initializer"

# Check if initializer exists
if [[ ! -x "$INITIALIZER_BIN" ]]; then
    echo "Error: initializer CLI not found at $INITIALIZER_BIN" >&2
    exit 1
fi

# Forward all arguments to initializer status
exec "$INITIALIZER_BIN" status "$@"
