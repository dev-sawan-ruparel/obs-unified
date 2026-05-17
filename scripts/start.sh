#!/usr/bin/env bash
# Start a registered runner in the foreground.
# Usage: scripts/start.sh <key>
set -euo pipefail
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${1:-}"
[[ -z "$KEY" ]] && { echo "usage: $0 <runner-key>" >&2; exit 1; }
DEST="$CI_ROOT/runners/$KEY"
[[ -f "$DEST/.runner" ]] || { echo "runner '$KEY' not registered" >&2; exit 1; }
cd "$DEST"
exec ./run.sh
