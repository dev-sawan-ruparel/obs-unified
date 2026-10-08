#!/bin/bash
# Orchestrator for the projects+alerts E2E.
# Starts a webhook receiver and `wrangler dev --test-scheduled` in the
# background, resets the local D1 DB, runs scripts/e2e-alerts/run.sh,
# and tears everything down on exit.
#
# Requires apps/collector/.dev.vars with DASHBOARD_PASSWORD set.
# Ports used: 8790 (collector), 9998 (webhook receiver).

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
STATE_DIR="${STATE_DIR:-/tmp/obs-e2e}"

COLLECTOR_PORT="${COLLECTOR_PORT:-8790}"
WEBHOOK_PORT="${WEBHOOK_PORT:-9998}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"

mkdir -p "$STATE_DIR"

if [ ! -f "$COLLECTOR_DIR/.dev.vars" ]; then
  echo "ERROR: $COLLECTOR_DIR/.dev.vars is missing." >&2
  echo "Create it with at least:" >&2
  echo "  DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD" >&2
  echo "  ALLOW_UNAUTHENTICATED=false" >&2
  exit 1
fi

WEBHOOK_PID=""
WRANGLER_PID=""

cleanup() {
  local exit_code=$?
  [ -n "$WEBHOOK_PID" ] && kill "$WEBHOOK_PID" 2>/dev/null || true
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  # wrangler dev spawns child workerd; nuke the whole process group
  wait 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

echo "── reset local D1 and apply migrations ──"
cd "$COLLECTOR_DIR"
rm -rf .wrangler
pnpm db:setup >/dev/null

echo "── start webhook receiver on :$WEBHOOK_PORT ──"
PORT="$WEBHOOK_PORT" LOG_PATH="$STATE_DIR/webhook.log" \
  node "$SCRIPT_DIR/webhook-receiver.mjs" >"$STATE_DIR/webhook.stdout" 2>&1 &
WEBHOOK_PID=$!

echo "── start collector (wrangler dev --test-scheduled) on :$COLLECTOR_PORT ──"
wrangler dev --port "$COLLECTOR_PORT" --local --test-scheduled \
  >"$STATE_DIR/collector.stdout" 2>&1 &
WRANGLER_PID=$!

# wait for /health
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
WEBHOOK_URL="http://localhost:$WEBHOOK_PORT/fire" \
DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
STATE_DIR="$STATE_DIR" \
  bash "$SCRIPT_DIR/run.sh"
