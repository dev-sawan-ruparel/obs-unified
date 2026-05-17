#!/usr/bin/env bash
# Start a registered runner in the foreground (blocks the terminal).
#
# Usage: scripts/start.sh <key> [--help]
#   <key>  runner key from runners.json
#
# For a background daemon that survives reboot use install-service.sh.
set -euo pipefail
if [[ "${1-}" == "--help" || "${1-}" == "-h" ]]; then
  awk '/^#!/{next} /^#/{sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0
fi
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${1:-}"
[[ -z "$KEY" ]] && { echo "usage: $0 <runner-key>   (see runners.json)" >&2; exit 1; }
DEST="$CI_ROOT/runners/$KEY"
[[ -f "$DEST/.runner" ]] || { echo "runner '$KEY' not registered" >&2; exit 1; }
cd "$DEST"
exec ./run.sh
