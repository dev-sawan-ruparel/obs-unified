#!/usr/bin/env bash
# Check whether this machine can run the Phase 6 demo validation scenarios.

set -euo pipefail

MIN_DOCKER_MEM_BYTES="${MIN_DOCKER_MEM_BYTES:-6442450944}"

fail=0

if ! command -v docker >/dev/null 2>&1; then
	echo "✗ docker is not installed or not on PATH"
	exit 1
fi

docker_mem="$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)"
if [ "${docker_mem:-0}" -lt "$MIN_DOCKER_MEM_BYTES" ]; then
	echo "✗ Docker memory is ${docker_mem} bytes; Astronomy Shop validation needs at least ${MIN_DOCKER_MEM_BYTES} bytes"
	fail=1
else
	echo "✓ Docker memory is ${docker_mem} bytes"
fi

if docker compose -f demo/upstream/compose.yaml config --services >/dev/null 2>&1; then
	echo "✓ demo/upstream/compose.yaml is readable by docker compose"
else
	echo "✗ demo/upstream/compose.yaml is not ready; run pnpm demo:setup"
	fail=1
fi

if env | grep -Eq '^(OPENAI_API_KEY|ANTHROPIC_API_KEY|GOOGLE_API_KEY|GEMINI_API_KEY)='; then
	echo "✓ at least one LLM provider key is present for Scenario B"
else
	echo "✗ no LLM provider key found; set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or GEMINI_API_KEY"
	fail=1
fi

exit "$fail"
