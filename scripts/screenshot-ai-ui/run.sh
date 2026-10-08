#!/bin/bash
# Spins up a throwaway collector on :28790 with auth disabled, applies
# every migration, seeds a representative corpus of AI spans, and prints
# how to start a Vite dashboard instance pointed at it. Useful for
# reviewing the AI dashboard UI without touching the primary `.dev.vars`.

set -eu
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COLLECTOR_DIR="$REPO_ROOT/apps/collector"
MIGRATIONS_DIR="$REPO_ROOT/packages/obs-collector/src/migrations"
STATE_DIR="${STATE_DIR:-/tmp/obs-ui-review}"
WRANGLER_STATE="$STATE_DIR/wrangler-state"
COLLECTOR_PORT="${COLLECTOR_PORT:-28790}"

mkdir -p "$STATE_DIR"
rm -rf "$WRANGLER_STATE"

cd "$COLLECTOR_DIR"

ORIGINAL_DEV_VARS="$COLLECTOR_DIR/.dev.vars"
BACKUP_DEV_VARS="$STATE_DIR/.dev.vars.backup"
if [ -f "$ORIGINAL_DEV_VARS" ]; then
  cp "$ORIGINAL_DEV_VARS" "$BACKUP_DEV_VARS"
fi
cat > "$ORIGINAL_DEV_VARS" <<EOF
ALLOW_UNAUTHENTICATED="true"
DASHBOARD_PASSWORD=""
INGEST_KEY=""
ALLOWED_ORIGINS="http://localhost:5174"
RETENTION_HOURS="72"
EOF

echo "── applying migrations to $WRANGLER_STATE ──"
for m in "$MIGRATIONS_DIR"/*.sql; do
  pnpm exec wrangler d1 execute obs-collector-db --local \
    --persist-to "$WRANGLER_STATE" --file "$m" >/dev/null
done

echo "── starting throwaway collector on :$COLLECTOR_PORT ──"
ALLOW_UNAUTHENTICATED=true pnpm exec wrangler dev \
  --port "$COLLECTOR_PORT" --local \
  --persist-to "$WRANGLER_STATE" \
  --var ALLOW_UNAUTHENTICATED:true \
  > "$STATE_DIR/collector.stdout" 2>&1 &
WRANGLER_PID=$!
echo "$WRANGLER_PID" > "$STATE_DIR/collector.pid"

ATTEMPTS=0
until curl -fsS "http://localhost:$COLLECTOR_PORT/health" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt 30 ]; then
    echo "collector failed to start; log: $STATE_DIR/collector.stdout" >&2
    tail -60 "$STATE_DIR/collector.stdout" >&2
    # Restore original .dev.vars even if we bail.
    if [ -f "$BACKUP_DEV_VARS" ]; then
      mv "$BACKUP_DEV_VARS" "$ORIGINAL_DEV_VARS"
    fi
    exit 1
  fi
  sleep 1
done

# Restore original .dev.vars now that wrangler has it loaded (it won't
# re-read until the next restart). This avoids leaving a clean .dev.vars
# sitting around if the user opens the file.
if [ -f "$BACKUP_DEV_VARS" ]; then
  mv "$BACKUP_DEV_VARS" "$ORIGINAL_DEV_VARS"
fi

echo "  ready (after ${ATTEMPTS}s)"

echo "── seeding corpus ──"
node "$SCRIPT_DIR/seed.mjs" "http://localhost:$COLLECTOR_PORT"

cat <<MSG

────────────────────────────────────────────────────────────────────────
Collector running on :$COLLECTOR_PORT (pid $WRANGLER_PID)
State dir: $WRANGLER_STATE
Seeded corpus includes LLM, TOOL, RETRIEVER spans, 2 sessions, evaluations.

To view the dashboard pointed at this collector:

  DEV_COLLECTOR_URL=http://localhost:$COLLECTOR_PORT \\
  DEV_WEB_PORT=5174 \\
  pnpm --filter @obs-demo/web run dev

Then open http://localhost:5174 (no password — unauth is enabled).

To stop:  kill \$(cat $STATE_DIR/collector.pid)
────────────────────────────────────────────────────────────────────────
MSG
