#!/usr/bin/env bash
set -euo pipefail

IMAGE="${IMAGE:-obs-unified/local:dev}"
CONTAINER_NAME="${CONTAINER_NAME:-obs-local-smoke}"
DASHBOARD_PORT="${DASHBOARD_PORT:-15173}"
COLLECTOR_PORT="${COLLECTOR_PORT:-18790}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-180}"
BUILD_IMAGE="${BUILD_IMAGE:-true}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_FILE="$(mktemp -t obs-local-smoke.XXXXXX.log)"

cleanup() {
	docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
	rm -f "$LOG_FILE"
}
trap cleanup EXIT

cd "$ROOT"

if [ "$BUILD_IMAGE" = "true" ]; then
	docker build -f Dockerfile.local -t "$IMAGE" .
fi

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

docker run --rm \
	--name "$CONTAINER_NAME" \
	-p "${DASHBOARD_PORT}:5173" \
	-p "${COLLECTOR_PORT}:8790" \
	"$IMAGE" >"$LOG_FILE" 2>&1 &
container_pid="$!"

deadline=$((SECONDS + TIMEOUT_SECONDS))
while ! grep -q "obs-unified local is ready" "$LOG_FILE"; do
	if ! kill -0 "$container_pid" 2>/dev/null; then
		echo "[smoke:local-image] container exited before readiness"
		cat "$LOG_FILE"
		exit 1
	fi
	if [ "$SECONDS" -ge "$deadline" ]; then
		echo "[smoke:local-image] timed out waiting for readiness"
		cat "$LOG_FILE"
		exit 1
	fi
	sleep 1
done

if grep -Eq "Internal Server Error|storage error|ERR_MODULE_NOT_FOUND|not valid JSON|duplicate key value|syntax error|ERROR:" "$LOG_FILE"; then
	echo "[smoke:local-image] startup log contains an error"
	cat "$LOG_FILE"
	exit 1
fi

for expected in \
	"migrate] done (" \
	"usage / sessions / timeline" \
	"traces / service map / issues" \
	"logs (/v1/logs)" \
	"AI calls (/v1/traces with LLM kind)" \
	"user profiles (/v1/identify)" \
	"alert rules (/internal/alerts/rules)"; do
	if ! grep -q "$expected" "$LOG_FILE"; then
		echo "[smoke:local-image] missing expected log line: $expected"
		cat "$LOG_FILE"
		exit 1
	fi
done

curl -fsS "http://127.0.0.1:${COLLECTOR_PORT}/health" >/dev/null
curl -fsS "http://127.0.0.1:${DASHBOARD_PORT}/" | grep -q "<title>obs-unified</title>"
curl -fsS \
	-X POST "http://127.0.0.1:${COLLECTOR_PORT}/auth/login" \
	-H "content-type: application/json" \
	--data '{"password":"e2e-test-pass"}' | grep -q '"success":true'

echo "[smoke:local-image] ok"
