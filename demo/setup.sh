#!/usr/bin/env bash
# Clone the OpenTelemetry Demo into demo/upstream/ and patch its
# otel-collector to fan out OTLP to our collector at :8790.
#
# Idempotent — re-running just refreshes the extras file.

set -euo pipefail

cd "$(dirname "$0")"

UPSTREAM_REPO="${UPSTREAM_REPO:-https://github.com/open-telemetry/opentelemetry-demo.git}"
UPSTREAM_REF="${UPSTREAM_REF:-main}"
UPSTREAM_DIR="upstream"

if [ ! -d "$UPSTREAM_DIR/.git" ]; then
	echo "▸ cloning $UPSTREAM_REPO ($UPSTREAM_REF) → $UPSTREAM_DIR/"
	git clone --depth=1 --branch "$UPSTREAM_REF" "$UPSTREAM_REPO" "$UPSTREAM_DIR"
else
	echo "▸ upstream already present — skipping clone (delete $UPSTREAM_DIR/ to refresh)"
fi

EXTRAS_DEST="$UPSTREAM_DIR/src/otel-collector/otelcol-config-extras.yml"
echo "▸ copying otelcol-config-extras.yml → $EXTRAS_DEST"
cp otelcol-config-extras.yml "$EXTRAS_DEST"

SDK_VENDOR_DIR="$UPSTREAM_DIR/.obs-unified"
mkdir -p "$SDK_VENDOR_DIR"

echo "▸ packing obs-unified SDK tarballs → $SDK_VENDOR_DIR"
(cd .. && pnpm --filter @obs-unified/types pack --pack-destination "demo/$SDK_VENDOR_DIR" >/dev/null)
(cd .. && pnpm --filter @obs-unified/analytics-sdk pack --pack-destination "demo/$SDK_VENDOR_DIR" >/dev/null)
(cd .. && pnpm --filter @obs-unified/telemetry-sdk pack --pack-destination "demo/$SDK_VENDOR_DIR" >/dev/null)

echo "▸ applying obs-unified frontend and backend overlays"
python3 apply-obs-overlays.py

echo "▸ refreshing patched upstream package locks"
(cd "$UPSTREAM_DIR/src/frontend" && npm install --package-lock-only >/dev/null)
(cd "$UPSTREAM_DIR/src/payment" && npm install --package-lock-only >/dev/null)

cat <<'EOF'

✓ Setup complete.

Next:
   1. Make sure the obs-unified collector is running locally:
         pnpm dev:collector

   2. Boot the demo (in a new terminal):
         pnpm demo:up

   3. After ~30 seconds the demo's load-generator starts hitting the frontend
      and you should see traces, logs, and metrics flowing into:
         - Traces       http://localhost:5173/#/traces
         - Service Map  http://localhost:5173/#/service-map
         - Issues       http://localhost:5173/#/issues
         - Logs         http://localhost:5173/#/logs

      The demo's own UI is at:
         http://localhost:8080/

   4. Tear down with:
         pnpm demo:down
EOF
