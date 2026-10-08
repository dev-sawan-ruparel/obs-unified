#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COLLECTOR_VARS="$ROOT/apps/collector/.dev.vars"
COLLECTOR_EXAMPLE="$ROOT/apps/collector/.dev.vars.example"

if [ ! -f "$COLLECTOR_VARS" ]; then
	cp "$COLLECTOR_EXAMPLE" "$COLLECTOR_VARS"
	echo "[setup] created apps/collector/.dev.vars from .dev.vars.example"
else
	echo "[setup] apps/collector/.dev.vars already exists"
fi

if ! grep -Eq '^DASHBOARD_PASSWORD=' "$COLLECTOR_VARS"; then
	echo "[setup] warning: apps/collector/.dev.vars is missing DASHBOARD_PASSWORD" >&2
fi

if ! grep -Eq '^INGEST_KEY=' "$COLLECTOR_VARS"; then
	echo "[setup] warning: apps/collector/.dev.vars is missing INGEST_KEY" >&2
fi
