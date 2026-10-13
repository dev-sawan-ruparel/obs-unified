#!/usr/bin/env bash
set -euo pipefail

# scripts/release-docker/check-context.sh
# Builds a throwaway stage from the real build context and fails if any
# local secret file (.env, .dev.vars, .env.deploy, keys) made it in. Run
# before every image build so a developer machine with
# apps/collector/.dev.vars cannot bake credentials into a pushed layer.
#
# Usage: bash scripts/release-docker/check-context.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if ! docker version >/dev/null 2>&1; then
	echo "[check-context] docker daemon not reachable" >&2
	exit 2
fi

# Plant a canary so the check proves the ignore rules, not just the absence
# of secrets on this machine. Removed on exit.
CANARY="$ROOT/apps/collector/.dev.vars.check-context-canary"
trap 'rm -f "$CANARY"' EXIT
echo "CANARY=1" >"$CANARY"

TAG="obs-unified/check-context:$$"
status=0
docker build -q -t "$TAG" -f - . >/dev/null <<'DOCKERFILE' || status=$?
FROM busybox:stable
COPY . /ctx
RUN find /ctx \( -name '.env' -o -name '.env.*' -o -name '.dev.vars' -o -name '.dev.vars.*' -o -name '*.pem' -o -name '*.key' \) \
	! -name '*.example' -type f > /leaked.txt; \
	if [ -s /leaked.txt ]; then echo "secret files in build context:"; cat /leaked.txt; exit 1; fi
DOCKERFILE
docker rmi -f "$TAG" >/dev/null 2>&1 || true
if [ "$status" -ne 0 ]; then
	echo "[check-context] FAILED: build context contains secret files (see above)" >&2
	exit 1
fi
echo "[check-context] ok: no .env/.dev.vars/key files in the build context"
