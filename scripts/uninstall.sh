#!/usr/bin/env bash
# Unregister a runner from GitHub and remove its local directory.
#
# Usage: scripts/uninstall.sh <key> [--help]
#   <key>  runner key from runners.json
#
# Stops any launchd service for the runner first. Safe to run even if
# registration failed midway or the local state is inconsistent.
set -euo pipefail
if [[ "${1-}" == "--help" || "${1-}" == "-h" ]]; then
  awk '/^#!/{next} /^#/{sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0
fi
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${1:-}"
[[ -z "$KEY" ]] && { echo "usage: $0 <runner-key>   (see runners.json)" >&2; exit 1; }

CONFIG="$CI_ROOT/runners.json"
REPO="$(jq -er ".runners[\"$KEY\"].repo" "$CONFIG")"
DEST="$CI_ROOT/runners/$KEY"

if [[ -f "$DEST/.runner" ]]; then
  echo "Removing runner '$KEY' from $REPO..."
  TOKEN="$(gh api -X POST "/repos/$REPO/actions/runners/remove-token" -q .token 2>/dev/null || true)"
  if [[ -n "$TOKEN" ]]; then
    (cd "$DEST" && ./config.sh remove --token "$TOKEN" || true)
  fi
  # Stop launchd service if installed
  if [[ -f "$DEST/svc.sh" ]]; then
    (cd "$DEST" && ./svc.sh stop 2>/dev/null || true)
    (cd "$DEST" && ./svc.sh uninstall 2>/dev/null || true)
  fi
fi

rm -rf "$DEST"
echo "✓ runner '$KEY' uninstalled"
