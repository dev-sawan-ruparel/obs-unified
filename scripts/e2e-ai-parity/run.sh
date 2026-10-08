#!/bin/bash
# End-to-end AI observability parity suite.
#
# Mirrors scripts/e2e-otlp/run.sh:
#   1. Apply all migrations to an isolated local D1 state dir
#   2. Start `wrangler dev` with ALLOW_UNAUTHENTICATED=true on :28790
#   3. Wait for /health
#   4. Run vitest against the live collector with AI_PARITY_URL set
#   5. Tear down on exit
#
# Port 28790 and state dir under /tmp/obs-e2e-ai-parity are deliberately
# isolated from any developer-local `pnpm run dev:collector` session.

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
MIGRATIONS_DIR="$REPO_ROOT/packages/obs-collector/src/migrations"
STATE_DIR="${STATE_DIR:-/tmp/obs-e2e-ai-parity}"
WRANGLER_STATE="$STATE_DIR/wrangler-state"
COLLECTOR_PORT="${COLLECTOR_PORT:-28790}"

mkdir -p "$STATE_DIR"
rm -rf "$WRANGLER_STATE"

WRANGLER_PID=""

cleanup() {
  local exit_code=$?
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  # Defined below when the script reaches the staging step; guard for early exits.
  if declare -f restore_dev_vars >/dev/null 2>&1; then
    restore_dev_vars
  fi
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

cd "$COLLECTOR_DIR"

echo "── apply migrations to isolated state ($WRANGLER_STATE) ──"
for migration in "$MIGRATIONS_DIR"/*.sql; do
  pnpm exec wrangler d1 execute obs-collector-db --local \
    --persist-to "$WRANGLER_STATE" \
    --file "$migration" >/dev/null
done

echo "── start collector on :$COLLECTOR_PORT ──"
# Isolate from developer-local .dev.vars: apps/collector/.dev.vars often has
# DASHBOARD_PASSWORD / INGEST_KEY set which would route /internal/* through
# cookie-based auth and reject the test's unauthenticated probes. We stage a
# minimal .dev.vars just for this run and restore the original on teardown.
ORIGINAL_DEV_VARS="$COLLECTOR_DIR/.dev.vars"
BACKUP_DEV_VARS="$STATE_DIR/.dev.vars.backup"
if [ -f "$ORIGINAL_DEV_VARS" ]; then
  cp "$ORIGINAL_DEV_VARS" "$BACKUP_DEV_VARS"
fi
cat > "$ORIGINAL_DEV_VARS" <<EOF
ALLOW_UNAUTHENTICATED="true"
DASHBOARD_PASSWORD=""
INGEST_KEY=""
RETENTION_HOURS="72"
EOF

restore_dev_vars() {
  if [ -f "$BACKUP_DEV_VARS" ]; then
    mv "$BACKUP_DEV_VARS" "$ORIGINAL_DEV_VARS"
  else
    rm -f "$ORIGINAL_DEV_VARS"
  fi
}

ALLOW_UNAUTHENTICATED=true pnpm exec wrangler dev \
  --port "$COLLECTOR_PORT" --local \
  --persist-to "$WRANGLER_STATE" \
  --var ALLOW_UNAUTHENTICATED:true \
  >"$STATE_DIR/collector.stdout" 2>&1 &
WRANGLER_PID=$!

ATTEMPTS=0
until curl -fsS "http://localhost:$COLLECTOR_PORT/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt 30 ]; then
    echo "collector failed to start; see $STATE_DIR/collector.stdout" >&2
    tail -60 "$STATE_DIR/collector.stdout" >&2
    exit 1
  fi
  sleep 1
done
echo "  ready (after ${ATTEMPTS}s)"

echo "── run AI parity suite ──"
cd "$REPO_ROOT"
AI_PARITY_URL="http://localhost:$COLLECTOR_PORT" \
  ./node_modules/.bin/vitest run \
  packages/obs-collector/src/ai-parity/ai-parity.acceptance.test.ts
