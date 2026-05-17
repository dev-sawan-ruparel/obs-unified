#!/usr/bin/env bash
# Install a registered runner as a launchd service so it starts on boot
# and restarts on crash.
#
# Usage: scripts/install-service.sh <key> [--help]
#   <key>  runner key from runners.json
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
./svc.sh install
./svc.sh start
./svc.sh status
