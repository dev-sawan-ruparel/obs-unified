#!/bin/bash
# Measure ingest + read latency (Q1) and exercise the read/write-rate
# instrumentation (Q3) against a throwaway local collector.
#
#   1. Apply all migrations to an isolated local D1 state dir (`--persist-to`)
#   2. Start `wrangler dev` on :18792 with ALLOW_UNAUTHENTICATED=true
#   3. Wait for /health
#   4. Run scripts/measure-ingest/traffic.mjs against the live collector
#   5. Tear down on exit
#
# Port 18792 + state dir under /tmp/obs-measure-ingest are deliberately offset
# from `dev:collector` (8790) and `e2e:otlp` (18790) so a concurrent collector
# is left untouched. Override via COLLECTOR_PORT / STATE_DIR, and tune the load
# via INGEST / READS / SPANS (see traffic.mjs).
#
# Run: `pnpm measure:ingest`  (or `bash scripts/measure-ingest/run.sh`)

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
MIGRATIONS_DIR="$REPO_ROOT/packages/obs-collector/src/migrations"
STATE_DIR="${STATE_DIR:-/tmp/obs-measure-ingest}"
WRANGLER_STATE="$STATE_DIR/wrangler-state"
COLLECTOR_PORT="${COLLECTOR_PORT:-18792}"

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

echo "── drive traffic + measure ──"
BASE="http://localhost:$COLLECTOR_PORT" node "$SCRIPT_DIR/traffic.mjs"
