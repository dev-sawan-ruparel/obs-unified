#!/usr/bin/env bash
set -euo pipefail

# scripts/release-docker/smoke.sh
# Validates the built release Docker image for obs-unified end-to-end.
#
# Usage:
#   ./scripts/release-docker/smoke.sh [image-tag] [--clean]
#
# Example:
#   ./scripts/release-docker/smoke.sh ghcr.io/dev-sawan-ruparel/obs-unified:2.0.1

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
	DEFAULT_VERSION=$(node -p "try { require('./packages/obs-collector/package.json').version } catch { '0.1.0' }" 2>/dev/null || echo "0.1.0")
	IMAGE="ghcr.io/dev-sawan-ruparel/obs-unified:${DEFAULT_VERSION}"
fi

CLEAN_MODE=false
for arg in "$@"; do
	if [ "$arg" = "--clean" ]; then
		CLEAN_MODE=true
	fi
done

CONTAINER_NAME="obs-release-smoke-$$"
DASHBOARD_PORT="${DASHBOARD_PORT:-15173}"
COLLECTOR_PORT="${COLLECTOR_PORT:-18790}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-180}"
INGEST_KEY="${INGEST_KEY:-smoke-release-key-$(date +%s)}"
DASHBOARD_PASSWORD="${DASHBOARD_PASSWORD:-smoke-release-pass-$(date +%s)}"

LOG_FILE="$(mktemp -t obs-release-smoke.XXXXXX.log)"

cleanup() {
	echo "[smoke:release-image] cleaning up container $CONTAINER_NAME..."
	docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
	rm -f "$LOG_FILE"
}
trap cleanup EXIT

echo "=========================================================="
echo "obs-unified Release Image Smoke Validation"
echo "=========================================================="
echo "Target Image:    $IMAGE"
echo "Container:       $CONTAINER_NAME"
echo "Collector Port:  $COLLECTOR_PORT"
echo "Dashboard Port:  $DASHBOARD_PORT"
echo "Clean Mode:      $CLEAN_MODE"
echo "=========================================================="

# Check if image exists locally
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
	echo "Error: Docker image '$IMAGE' not found locally." >&2
	echo "Build it first with: bash scripts/release-docker/build.sh" >&2
	exit 1
fi

echo "Verifying fail-closed behavior without credentials..."
if docker run --rm "$IMAGE" >/dev/null 2>&1; then
	echo "[smoke:release-image] FAIL: Container did not fail closed when run without production credentials!" >&2
	exit 1
fi
echo "Verified: Container correctly fails closed when required auth config is missing."

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

RUN_CMD=(
	"docker" "run" "--rm"
	"--name" "$CONTAINER_NAME"
	"-p" "${DASHBOARD_PORT}:5173"
	"-p" "${COLLECTOR_PORT}:8790"
	"-e" "INGEST_KEY=${INGEST_KEY}"
	"-e" "DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}"
)

if [ "$CLEAN_MODE" = true ]; then
	RUN_CMD+=("-e" "OBS_LOCAL_SEED=false")
fi

RUN_CMD+=("$IMAGE")

"${RUN_CMD[@]}" >"$LOG_FILE" 2>&1 &

container_pid="$!"

echo "Waiting for container readiness..."
deadline=$((SECONDS + TIMEOUT_SECONDS))
while ! grep -Eq "obs-unified (local )?is ready" "$LOG_FILE"; do
	if ! kill -0 "$container_pid" 2>/dev/null; then
		echo "[smoke:release-image] container exited prematurely" >&2
		cat "$LOG_FILE"
		exit 1
	fi
	if [ "$SECONDS" -ge "$deadline" ]; then
		echo "[smoke:release-image] timed out waiting for readiness (${TIMEOUT_SECONDS}s)" >&2
		cat "$LOG_FILE"
		exit 1
	fi
	sleep 1
done

echo "Container reported ready. Checking logs for critical errors..."
if grep -Eq "Internal Server Error|storage error|ERR_MODULE_NOT_FOUND|duplicate key value|syntax error" "$LOG_FILE"; then
	echo "[smoke:release-image] startup log contains an error" >&2
	cat "$LOG_FILE"
	exit 1
fi

echo "Verifying collector health endpoint..."
health_resp=$(curl -fsS "http://127.0.0.1:${COLLECTOR_PORT}/health")
echo "Health: $health_resp"

echo "Verifying dashboard HTML response..."
dashboard_html=$(curl -fsS "http://127.0.0.1:${DASHBOARD_PORT}/")
if ! echo "$dashboard_html" | grep -q "<title>obs-unified</title>"; then
	echo "[smoke:release-image] dashboard index HTML missing expected title" >&2
	exit 1
fi

echo "Verifying dashboard authentication..."
auth_resp=$(curl -fsS \
	-X POST "http://127.0.0.1:${COLLECTOR_PORT}/auth/login" \
	-H "content-type: application/json" \
	--data "{\"password\":\"${DASHBOARD_PASSWORD}\"}")
if ! echo "$auth_resp" | grep -q '"success":true'; then
	echo "[smoke:release-image] dashboard login failed: $auth_resp" >&2
	exit 1
fi

echo "Verifying OTLP traces ingest pipeline..."
trace_now="$(date +%s)"
trace_ingest_resp=$(curl -sS -w "\n%{http_code}" -X POST "http://127.0.0.1:${COLLECTOR_PORT}/v1/traces" \
	-H "Content-Type: application/json" \
	-H "Authorization: Bearer ${INGEST_KEY}" \
	-d "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"smoke-release\"}}]},\"scopeSpans\":[{\"spans\":[{\"traceId\":\"4bf92f3577b34da6a3ce929d0e0e4736\",\"spanId\":\"00f067aa0ba902b7\",\"name\":\"smoke-span\",\"kind\":1,\"startTimeUnixNano\":\"${trace_now}000000000\",\"endTimeUnixNano\":\"${trace_now}000000001\"}]}]}]}")

status_code=$(echo "$trace_ingest_resp" | tail -n1)
if [ "$status_code" != "200" ]; then
	echo "[smoke:release-image] trace ingest returned unexpected status code $status_code" >&2
	echo "$trace_ingest_resp" >&2
	exit 1
fi

echo "=========================================================="
echo "[smoke:release-image] OK! All verification checks passed."
echo "=========================================================="
