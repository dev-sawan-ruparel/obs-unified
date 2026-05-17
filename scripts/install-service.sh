#!/usr/bin/env bash
# Install a registered runner as a launchd service so it starts on boot.
# Usage: scripts/install-service.sh <key>
set -euo pipefail
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${1:-}"
[[ -z "$KEY" ]] && { echo "usage: $0 <runner-key>" >&2; exit 1; }
DEST="$CI_ROOT/runners/$KEY"
[[ -f "$DEST/.runner" ]] || { echo "runner '$KEY' not registered" >&2; exit 1; }
cd "$DEST"
./svc.sh install
./svc.sh start
./svc.sh status
