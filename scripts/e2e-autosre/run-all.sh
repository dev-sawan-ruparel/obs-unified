#!/bin/bash
# Orchestrator for the RFC 0013 AutoSRE Closed-Loop E2E testbed.
# Resets local D1, applies all migrations (001..050), starts `wrangler dev`,
# runs `scripts/e2e-autosre/run.sh`, and tears down cleanly on exit.

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
STATE_DIR="${STATE_DIR:-$REPO_ROOT/.dev/e2e-autosre}"

COLLECTOR_PORT="${COLLECTOR_PORT:-8795}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"
DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-e2e-dashboard-token}"

mkdir -p "$STATE_DIR"

bash "$REPO_ROOT/scripts/setup-local-dev.sh"

WRANGLER_PID=""

cleanup() {
  local exit_code=$?
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "── reset local D1 and apply migrations (including 050_autosre_causal_ontology.sql) ──"
cd "$COLLECTOR_DIR"
rm -rf .wrangler
pnpm db:setup >/dev/null

echo "── start collector (wrangler dev) on :$COLLECTOR_PORT ──"
npx wrangler dev --port "$COLLECTOR_PORT" --local --test-scheduled \
  >"$STATE_DIR/collector.stdout" 2>&1 &
WRANGLER_PID=$!

ATTEMPTS=0
until curl -fsS "http://localhost:$COLLECTOR_PORT/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt 30 ]; then
    echo "collector failed to start; see $STATE_DIR/collector.stdout" >&2
    tail -50 "$STATE_DIR/collector.stdout" >&2
    exit 1
  fi
  sleep 1
done
echo "  ready (after ${ATTEMPTS}s)"

COLLECTOR_URL="http://localhost:$COLLECTOR_PORT" \
DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
DASHBOARD_TOKEN="$DASHBOARD_TOKEN" \
STATE_DIR="$STATE_DIR" \
  bash "$SCRIPT_DIR/run.sh"
