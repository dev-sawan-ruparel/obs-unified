#!/usr/bin/env bash
# Check whether this machine can run the Phase 6 demo validation scenarios.

set -euo pipefail

MIN_DOCKER_MEM_BYTES="${MIN_DOCKER_MEM_BYTES:-6442450944}"

fail=0

format_gib() {
	awk -v bytes="$1" 'BEGIN { printf "%.1f GiB", bytes / 1024 / 1024 / 1024 }'
}

pass() {
	echo "✓ $1"
}

fail_check() {
	echo "✗ $1"
	fail=1
}

require_file_contains() {
	local file="$1"
	local needle="$2"
	local label="$3"

	if [ ! -f "$file" ]; then
		fail_check "$label ($file is missing)"
		return
	fi

	if grep -Fq -- "$needle" "$file"; then
		pass "$label"
	else
		fail_check "$label ($file is missing: $needle)"
	fi
}

require_file_absent() {
	local file="$1"
	local needle="$2"
	local label="$3"

	if [ ! -f "$file" ]; then
		fail_check "$label ($file is missing)"
		return
	fi

	if grep -Fq -- "$needle" "$file"; then
		fail_check "$label ($file still contains: $needle)"
	else
		pass "$label"
	fi
}

require_glob() {
	local pattern="$1"
	local label="$2"

	if compgen -G "$pattern" >/dev/null; then
		pass "$label"
	else
		fail_check "$label ($pattern not found)"
	fi
}

provider_key_pattern='^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)=[[:space:]]*[^[:space:]#]+'
provider_key_files=(
	".env"
	".env.local"
	"apps/obs-demo/.dev.vars"
	"demo/.env"
	"demo/upstream/.env"
)

provider_key_source() {
	if env | grep -Eq "$provider_key_pattern"; then
		echo "process environment"
		return 0
	fi
	for file in "${provider_key_files[@]}"; do
		if [ -f "$file" ] && grep -Eq "$provider_key_pattern" "$file"; then
			echo "$file"
			return 0
		fi
	done
	return 1
}

if ! command -v docker >/dev/null 2>&1; then
	echo "✗ docker is not installed or not on PATH"
	exit 1
fi

docker_mem="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
if [ "${docker_mem:-0}" -lt "$MIN_DOCKER_MEM_BYTES" ]; then
	echo "✗ Docker memory is $(format_gib "$docker_mem"); Astronomy Shop validation needs at least $(format_gib "$MIN_DOCKER_MEM_BYTES")"
	if docker context show 2>/dev/null | grep -qx 'colima'; then
		echo "  Active Docker context is Colima. Try: colima stop && colima start --memory 7 --cpu 4"
	else
		echo "  Increase Docker Desktop/engine memory before running pnpm demo:up."
	fi
	fail=1
else
	pass "Docker memory is $(format_gib "$docker_mem")"
fi

if docker compose -f demo/upstream/compose.yaml config --services >/dev/null 2>&1; then
	pass "demo/upstream/compose.yaml is readable by docker compose"
else
	fail_check "demo/upstream/compose.yaml is not ready; run pnpm demo:setup"
fi

if key_source="$(provider_key_source)"; then
	pass "at least one LLM provider key is present for Scenario B (${key_source})"
else
	echo "✗ no LLM provider key found for Scenario B; set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY"
	echo "  Checked process env plus: ${provider_key_files[*]}"
	echo "  Scenario A does not need an LLM provider key, but Scenario B will be known-empty without one."
	fail=1
fi

require_glob "demo/upstream/.obs-unified/obs-unified-types-*.tgz" "local @obs-unified/types tarball is staged for Docker builds"
require_glob "demo/upstream/.obs-unified/obs-unified-analytics-sdk-*.tgz" "local analytics SDK tarball is staged for Docker builds"
require_glob "demo/upstream/.obs-unified/obs-unified-telemetry-sdk-*.tgz" "local telemetry SDK tarball is staged for Docker builds"

require_file_contains "demo/upstream/src/frontend/Dockerfile" "COPY ./.obs-unified /.obs-unified" "frontend Docker build can install local SDK tarballs"
require_file_contains "demo/upstream/src/frontend/Dockerfile" "COPY ./src/frontend/obs-bootstrap.tsx obs-bootstrap.tsx" "frontend Docker build includes ObsBootstrap overlay"
require_file_contains "demo/upstream/src/frontend/Dockerfile" "COPY ./src/frontend/obs-unified.js obs-unified.js" "frontend Docker build includes Node process metrics bootstrap"
require_file_contains "demo/upstream/src/payment/Dockerfile" "COPY ./.obs-unified /usr/.obs-unified" "payment Docker build can install local SDK tarballs"
require_file_contains "demo/upstream/src/payment/Dockerfile" "COPY ./src/payment/obs-unified.js obs-unified.js" "payment Docker build includes Node process metrics bootstrap"

require_file_contains "demo/upstream/compose.yaml" "OBS_COLLECTOR_URL=http://host.docker.internal:8790" "demo services send telemetry to the local collector"
require_file_contains "demo/upstream/compose.yaml" "NEXT_PUBLIC_OBS_COLLECTOR_URL=http://localhost:8790" "browser SDK sends telemetry to the local collector"
require_file_contains "demo/upstream/compose.yaml" "OBS_INGEST_KEY=" "server-side demo ingest key is injected"
require_file_contains "demo/upstream/compose.yaml" "NEXT_PUBLIC_OBS_INGEST_KEY=" "browser demo ingest key is injected"
require_file_contains "demo/upstream/compose.yaml" "memory: 150M" "LLM service memory limit has the validated local override"

require_file_contains "apps/collector/wrangler.toml" "ALLOWED_ORIGINS = \"http://localhost:8080,http://localhost:5173\"" "collector allows the shop and dashboard origins"
require_file_contains "apps/collector/wrangler.toml" "binding = \"PROFILES_BUCKET\"" "collector profile storage binding is configured"

require_file_contains "demo/upstream/src/otel-collector/otelcol-config-extras.yml" "- span_metrics" "collector extras use the supported span_metrics connector"
require_file_absent "demo/upstream/src/otel-collector/otelcol-config-extras.yml" "spanmetrics" "collector extras do not reference the removed spanmetrics connector"
require_file_absent "demo/upstream/src/otel-collector/otelcol-config-extras.yml" "otlp_grpc/jaeger" "collector extras do not reference unconfigured Jaeger exporter"
require_file_absent "demo/upstream/src/otel-collector/otelcol-config-extras.yml" "otlp_http/prometheus" "collector extras do not reference unconfigured Prometheus exporter"
require_file_absent "demo/upstream/src/otel-collector/otelcol-config-extras.yml" "opensearch" "collector extras do not reference unconfigured OpenSearch exporter"

exit "$fail"
