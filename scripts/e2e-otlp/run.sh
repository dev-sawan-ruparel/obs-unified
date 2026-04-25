#!/bin/bash
# Runs the OTLP acceptance suite end-to-end:
#   1. Apply all migrations to an isolated local D1 state dir (`--persist-to`)
#   2. Start `wrangler dev` on :18790 with ALLOW_UNAUTHENTICATED=true,
#      pointed at that same state dir
#   3. Wait for /health
#   4. Run `vitest run packages/obs-collector/src/otlp/acceptance.test.ts`
#      with OTLP_ACCEPTANCE_URL pointing at the live collector
#   5. Tear down on exit
#
# Port 18790 (deliberately offset from 8790) and state dir under
# /tmp/obs-e2e-otlp/wrangler-state so a concurrent `pnpm run dev:collector`
# is left completely untouched. Override via COLLECTOR_PORT / STATE_DIR.

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
MIGRATIONS_DIR="$REPO_ROOT/packages/obs-collector/src/migrations"
STATE_DIR="${STATE_DIR:-/tmp/obs-e2e-otlp}"
WRANGLER_STATE="$STATE_DIR/wrangler-state"
COLLECTOR_PORT="${COLLECTOR_PORT:-18790}"

mkdir -p "$STATE_DIR"
rm -rf "$WRANGLER_STATE"

WRANGLER_PID=""

cleanup() {
  local exit_code=$?
  [ -n "$WRANGLER_PID" ] && kill "$WRANGLER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

cd "$COLLECTOR_DIR"

echo "── apply migrations to isolated state ($WRANGLER_STATE) ──"
for migration in "$MIGRATIONS_DIR"/*.sql; do
  wrangler d1 execute obs-collector-db --local \
    --persist-to "$WRANGLER_STATE" \
    --file "$migration" >/dev/null
done

echo "── start collector on :$COLLECTOR_PORT ──"
ALLOW_UNAUTHENTICATED=true wrangler dev \
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

echo "── run OTLP acceptance suite ──"
cd "$REPO_ROOT"
OTLP_ACCEPTANCE_URL="http://localhost:$COLLECTOR_PORT" \
  ./node_modules/.bin/vitest run \
  packages/obs-collector/src/otlp/acceptance.test.ts
