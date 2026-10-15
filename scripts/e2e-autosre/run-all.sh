#!/bin/bash
# Orchestrator for the RFC 0013 AutoSRE Closed-Loop E2E testbed.
# Creates an isolated local D1 under $STATE_DIR/d1 (your shared
# apps/collector/.wrangler state is never touched), applies every migration,
# starts `wrangler dev` against it, runs `scripts/e2e-autosre/run.sh`, and
# tears down cleanly on exit.

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
STATE_DIR="${STATE_DIR:-$REPO_ROOT/.dev/e2e-autosre}"

COLLECTOR_PORT="${COLLECTOR_PORT:-8795}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"
DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-e2e-dashboard-token}"

# ── preflight ──
for tool in jq wrangler curl; do
  if [ "$tool" = "wrangler" ]; then
    (cd "$COLLECTOR_DIR" && npx --no-install wrangler --version >/dev/null 2>&1) \
      || { echo "missing required tool: wrangler (run pnpm install)" >&2; exit 1; }
  else
    command -v "$tool" >/dev/null 2>&1 \
      || { echo "missing required tool: $tool" >&2; exit 1; }
  fi
done

mkdir -p "$STATE_DIR"

bash "$REPO_ROOT/scripts/setup-local-dev.sh"

INGEST_KEY="${INGEST_KEY:-$({ grep -E '^INGEST_KEY=' "$COLLECTOR_DIR/.dev.vars" | head -1 | cut -d= -f2- ; })}"
[ -n "$INGEST_KEY" ] || { echo "INGEST_KEY not set and not found in apps/collector/.dev.vars" >&2; exit 1; }

echo "── build @obsunified/cli (used by run.sh) ──"
(cd "$REPO_ROOT" && pnpm --filter @obsunified/cli build >/dev/null)
[ -f "$REPO_ROOT/packages/cli/dist/cli.js" ] \
  || { echo "packages/cli/dist/cli.js missing after build" >&2; exit 1; }

WRANGLER_PID=""

cleanup() {
  local exit_code=$?
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

D1_STATE="$STATE_DIR/d1"
echo "── reset isolated local D1 ($D1_STATE) and apply migrations ──"
cd "$COLLECTOR_DIR"
rm -rf "$D1_STATE"
for migration in "$REPO_ROOT"/packages/obs-collector/src/migrations/*.sql; do
  npx wrangler d1 execute obs-collector-db --local --persist-to "$D1_STATE" \
    --file "$migration" >/dev/null \
    || { echo "migration failed: $(basename "$migration")" >&2; exit 1; }
done

echo "── start collector (wrangler dev) on :$COLLECTOR_PORT ──"
npx wrangler dev --port "$COLLECTOR_PORT" --local --persist-to "$D1_STATE" --test-scheduled \
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
INGEST_KEY="$INGEST_KEY" \
STATE_DIR="$STATE_DIR" \
  bash "$SCRIPT_DIR/run.sh"
