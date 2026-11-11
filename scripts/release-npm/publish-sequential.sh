#!/usr/bin/env bash
# Kept for existing docs and muscle memory. The publish logic, checks, and
# dependency ordering live in publish.mjs; see its header for details.
#   bash scripts/release-npm/publish-sequential.sh [--dry-run] [--yes]
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/publish.mjs" "$@"
