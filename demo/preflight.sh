#!/usr/bin/env bash
# Check whether this machine can run the Phase 6 demo validation scenarios.

set -euo pipefail

MIN_DOCKER_MEM_BYTES="${MIN_DOCKER_MEM_BYTES:-6442450944}"

fail=0

format_gib() {
	awk -v bytes="$1" 'BEGIN { printf "%.1f GiB", bytes / 1024 / 1024 / 1024 }'
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
		echo "  Active Docker context is Colima. Try: colima stop && colima start --memory 6 --cpu 4"
	else
		echo "  Increase Docker Desktop/engine memory before running pnpm demo:up."
	fi
	fail=1
else
	echo "✓ Docker memory is $(format_gib "$docker_mem")"
fi

if docker compose -f demo/upstream/compose.yaml config --services >/dev/null 2>&1; then
	echo "✓ demo/upstream/compose.yaml is readable by docker compose"
else
	echo "✗ demo/upstream/compose.yaml is not ready; run pnpm demo:setup"
	fail=1
fi

if key_source="$(provider_key_source)"; then
	echo "✓ at least one LLM provider key is present for Scenario B (${key_source})"
else
	echo "✗ no LLM provider key found for Scenario B; set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY"
	echo "  Checked process env plus: ${provider_key_files[*]}"
	echo "  Scenario A does not need an LLM provider key, but Scenario B will be known-empty without one."
	fail=1
fi

exit "$fail"
