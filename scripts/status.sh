#!/usr/bin/env bash
# Show status of all configured runners locally + as known to GitHub.
#
# Usage: scripts/status.sh [--help]
#
# "LOCAL" column reports whether runners/<key>/ is configured on this host.
# "GITHUB" column reports the runner's online/offline state as GitHub sees it.
set -euo pipefail
if [[ "${1-}" == "--help" || "${1-}" == "-h" ]]; then
  awk '/^#!/{next} /^#/{sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"; exit 0
fi
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$CI_ROOT/runners.json"

command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

printf "%-22s %-32s %-12s %s\n" "KEY" "REPO" "LOCAL" "GITHUB"
printf "%-22s %-32s %-12s %s\n" "---" "----" "-----" "------"

for KEY in $(jq -r '.runners | keys[]' "$CONFIG"); do
  REPO="$(jq -er ".runners[\"$KEY\"].repo" "$CONFIG")"
  LOCAL="not-registered"
  [[ -f "$CI_ROOT/runners/$KEY/.runner" ]] && LOCAL="registered"

  GH_STATUS="?"
  if command -v gh >/dev/null; then
    GH_STATUS="$(gh api "/repos/$REPO/actions/runners" 2>/dev/null \
      | jq -r --arg n "$KEY" '.runners[]? | select(.name==$n) | .status' \
      || echo "?")"
    [[ -z "$GH_STATUS" ]] && GH_STATUS="not-registered"
  fi
  printf "%-22s %-32s %-12s %s\n" "$KEY" "$REPO" "$LOCAL" "$GH_STATUS"
done
