#!/usr/bin/env bash
set -euo pipefail

export PGDATA="${PGDATA:-/var/lib/postgresql/15/main}"
export DATABASE_URL="${DATABASE_URL:-postgres://obs:obs@127.0.0.1:5432/obs_unified}"
export BLOB_STORE="${BLOB_STORE:-file}"
export BLOB_DIR="${BLOB_DIR:-/data/blobs}"
if [ "${REQUIRE_AUTH_CONFIG:-false}" = "true" ]; then
	# shellcheck source=docker/local/auth-guard.sh
	. "$(dirname "${BASH_SOURCE[0]}")/auth-guard.sh"
	if ! obs_validate_release_auth; then
		exit 1
	fi
	export INGEST_KEY
	export OBS_INGEST_KEY="${OBS_INGEST_KEY:-$INGEST_KEY}"
	export DASHBOARD_PASSWORD
	export DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-}"
else
	export INGEST_KEY="${INGEST_KEY:-dev-ingest-key}"
	export OBS_INGEST_KEY="${OBS_INGEST_KEY:-$INGEST_KEY}"
	export DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-e2e-test-pass}"
	export DASHBOARD_TOKEN="${DASHBOARD_TOKEN:-e2e-dashboard-token}"
fi
export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,http://localhost:3000,http://127.0.0.1:3000}"
export PORT="${PORT:-8790}"
export OBS_DASHBOARD_PORT="${OBS_DASHBOARD_PORT:-5173}"
export OBS_COLLECTOR_URL="${OBS_COLLECTOR_URL:-http://127.0.0.1:8790}"

mkdir -p /data/blobs
chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql
# Everything the collector writes lives under /data; it runs as `node`.
chown -R node:node /data

# Run the Node processes unprivileged. The exported environment above is
# inherited; only HOME/USER/SHELL are reset for the target user.
run_node() {
	runuser -u node -- "$@"
}

if [ ! -d "$PGDATA" ] || [ -z "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
	echo "[obs-unified] initializing postgres cluster at $PGDATA"
	mkdir -p "$(dirname "$PGDATA")"
	chown postgres:postgres "$(dirname "$PGDATA")"
	pg_createcluster 15 main
fi

echo "[obs-unified] starting postgres"
pg_ctlcluster 15 main start

until pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; do
	sleep 0.2
done

run_pg() {
	runuser -u postgres -- "$@"
}

if ! run_pg psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='obs'" | grep -q 1; then
	run_pg createuser obs
fi
run_pg psql -q -c "ALTER USER obs WITH PASSWORD 'obs';"
if ! run_pg psql -tAc "SELECT 1 FROM pg_database WHERE datname='obs_unified'" | grep -q 1; then
	run_pg createdb -O obs obs_unified
fi

echo "[obs-unified] running migrations"
run_node node apps/collector-node/scripts/migrate-pg.mjs

echo "[obs-unified] starting collector (as node)"
run_node node apps/collector-node/dist/server.js &
collector_pid="$!"

echo "[obs-unified] starting dashboard (as node)"
run_node node docker/local/serve-dashboard.mjs &
dashboard_pid="$!"

cleanup() {
	kill "$collector_pid" "$dashboard_pid" 2>/dev/null || true
	# runuser may not forward the signal to its child; stop those too.
	pkill -u node node 2>/dev/null || true
	pg_ctlcluster 15 main stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

until curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; do
	sleep 0.2
done

if [ "${OBS_LOCAL_SEED:-true}" = "true" ]; then
	echo "[obs-unified] seeding local sample data"
	# Credentials reach the seeder via the exported DASHBOARD_PASSWORD / OBS_INGEST_KEY
	# environment, not argv, so they never appear in process listings or logs.
	run_node node scripts/seed-everything/run.mjs \
		--collector "http://127.0.0.1:${PORT}" \
		--rounds "${OBS_LOCAL_SEED_ROUNDS:-6}" || true
fi

if [ "${REQUIRE_AUTH_CONFIG:-false}" = "true" ]; then
cat <<EOF

obs-unified is ready.

Dashboard:  http://localhost:${OBS_DASHBOARD_PORT}
Collector:  http://localhost:${PORT}
Auth:       configured via environment (credentials masked in logs)

Verify:
  pnpm dlx @obsunified/cli doctor http://localhost:${PORT} --origin http://localhost:${OBS_DASHBOARD_PORT}

EOF
else
cat <<EOF

obs-unified local is ready.

Dashboard:  http://localhost:${OBS_DASHBOARD_PORT}
Collector:  http://localhost:${PORT}
Ingest key: ${INGEST_KEY}
Password:   ${DASHBOARD_PASSWORD}

Verify:
  pnpm dlx @obsunified/cli doctor http://localhost:${PORT} --origin http://localhost:${OBS_DASHBOARD_PORT}

EOF
fi

wait -n "$collector_pid" "$dashboard_pid"
