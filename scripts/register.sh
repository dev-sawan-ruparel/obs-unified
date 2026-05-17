#!/usr/bin/env bash
# Register a self-hosted runner for one of the repos in runners.json.
# Uses `gh` to mint a registration token (requires repo admin access).
#
# Usage: scripts/register.sh <key>
#   <key> is the runner key from runners.json (e.g. obs-unified, presence)
set -euo pipefail

CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="${1:-}"
[[ -z "$KEY" ]] && { echo "usage: $0 <runner-key>" >&2; exit 1; }

command -v gh >/dev/null || { echo "gh CLI required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq required (brew install jq)" >&2; exit 1; }

CONFIG="$CI_ROOT/runners.json"
REPO="$(jq -er ".runners[\"$KEY\"].repo" "$CONFIG")" || {
  echo "no runner '$KEY' in runners.json" >&2; exit 1;
}
LABELS="$(jq -er ".runners[\"$KEY\"].labels | join(\",\")" "$CONFIG")"

REF="$CI_ROOT/.runner-bin"
if [[ ! -f "$REF/config.sh" ]]; then
  echo "actions-runner not installed. Run scripts/install.sh first." >&2
  exit 1
fi

DEST="$CI_ROOT/runners/$KEY"
if [[ -f "$DEST/.runner" ]]; then
  echo "runner '$KEY' already registered. To re-register: scripts/uninstall.sh $KEY" >&2
  exit 1
fi

echo "Minting registration token for $REPO..."
TOKEN="$(gh api -X POST "/repos/$REPO/actions/runners/registration-token" -q .token)"
[[ -z "$TOKEN" ]] && { echo "failed to mint registration token" >&2; exit 1; }

echo "Copying runner binary to $DEST..."
mkdir -p "$DEST"
# Copy contents (not the .version stamp) into a fresh runner dir.
# Using rsync to preserve executables; tar fallback if rsync absent.
if command -v rsync >/dev/null; then
  rsync -a --exclude='.version' "$REF/" "$DEST/"
else
  (cd "$REF" && tar cf - --exclude=.version .) | (cd "$DEST" && tar xf -)
fi

echo "Configuring runner '$KEY' against $REPO..."
cd "$DEST"
./config.sh \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$KEY" \
  --labels "$LABELS" \
  --work "_work" \
  --unattended \
  --replace

echo
echo "✓ runner '$KEY' registered for $REPO"
echo "  Start it: scripts/start.sh $KEY"
echo "  Or as a launchd service: scripts/install-service.sh $KEY"
