#!/usr/bin/env bash
# Build the workspace CLI (no-op if already built) and run `doctor` against a
# collector — a no-auth, repo-local way to smoke-test connectivity/CORS without
# the GitHub Packages registry. Args after the command are forwarded to the CLI,
# e.g.:  bash scripts/doctor.sh http://localhost:8790 --origin http://localhost:5173
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

pnpm --filter @obsunified/cli build >/dev/null
exec node packages/cli/dist/cli.js doctor "$@"
