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
cp overlays/frontend/obs-bootstrap.tsx "$UPSTREAM_DIR/src/frontend/obs-bootstrap.tsx"
cp overlays/node/obs-unified.js "$UPSTREAM_DIR/src/frontend/obs-unified.js"
cp overlays/node/obs-unified.js "$UPSTREAM_DIR/src/payment/obs-unified.js"

python3 <<'PY'
import json
import re
from pathlib import Path

root = Path("upstream")
ingest_key = "obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504"


def patch_json(path: Path, dependencies: dict[str, str]) -> None:
    data = json.loads(path.read_text())
    deps = data.setdefault("dependencies", {})
    deps.update(dependencies)
    path.write_text(json.dumps(data, indent=2) + "\n")


patch_json(
    root / "src/frontend/package.json",
    {
        "@obs-unified/analytics-sdk": "file:../../.obs-unified/obs-unified-analytics-sdk-1.0.0.tgz",
        "@obs-unified/telemetry-sdk": "file:../../.obs-unified/obs-unified-telemetry-sdk-1.0.0.tgz",
        "@obs-unified/types": "file:../../.obs-unified/obs-unified-types-1.0.0.tgz",
    },
)
patch_json(
    root / "src/payment/package.json",
    {
        "@datadog/pprof": "^5.11.0",
        "@obs-unified/telemetry-sdk": "file:../../.obs-unified/obs-unified-telemetry-sdk-1.0.0.tgz",
        "@obs-unified/types": "file:../../.obs-unified/obs-unified-types-1.0.0.tgz",
    },
)

app = root / "src/frontend/pages/_app.tsx"
text = app.read_text()
if "import { ObsBootstrap } from '../obs-bootstrap';" not in text:
    text = text.replace(
        "import { FlagdWebProvider } from '@openfeature/flagd-web-provider';\n",
        "import { FlagdWebProvider } from '@openfeature/flagd-web-provider';\n"
        "import { ObsBootstrap } from '../obs-bootstrap';\n",
    )
text = text.replace("  FrontendTracer();", "  // Browser OTel tracing is replaced by obs-unified AnalyticsProvider.\n  // FrontendTracer();")
if "<ObsBootstrap>" not in text:
    text = text.replace(
        "    <ThemeProvider theme={Theme}>\n",
        "    <ObsBootstrap>\n      <ThemeProvider theme={Theme}>\n",
    )
    text = text.replace(
        "    </ThemeProvider>\n",
        "      </ThemeProvider>\n    </ObsBootstrap>\n",
    )
app.write_text(text)

frontend_instrumentation = root / "src/frontend/utils/telemetry/Instrumentation.js"
text = frontend_instrumentation.read_text()
if "obs-unified.js" not in text:
    text += "\nrequire('../../obs-unified.js');\n"
frontend_instrumentation.write_text(text)

payment_otel = root / "src/payment/opentelemetry.js"
text = payment_otel.read_text()
if "obs-unified.js" not in text:
    text += "\nrequire('./obs-unified.js');\n"
payment_otel.write_text(text)

payment_index = root / "src/payment/index.js"
text = payment_index.read_text()
if "recordObsTraceId" not in text:
    text = text.replace(
        "const opentelemetry = require('@opentelemetry/api')\n",
        "const opentelemetry = require('@opentelemetry/api')\n"
        "const { recordObsTraceId } = require('./obs-unified')\n",
    )
    text = text.replace(
        "  const span = opentelemetry.trace.getActiveSpan();\n",
        "  const span = opentelemetry.trace.getActiveSpan();\n"
        "  recordObsTraceId(span?.spanContext?.().traceId);\n",
    )
payment_index.write_text(text)

compose = root / "compose.yaml"
text = compose.read_text()


def patch_service_env(compose_text: str, service_name: str, marker: str, block: str) -> str:
    service_match = re.search(rf"^  {re.escape(service_name)}:\n", compose_text, re.M)
    if not service_match:
        raise RuntimeError(f"Could not find compose service {service_name}")
    service_start = service_match.start()
    next_service = re.search(
        r"\n  [A-Za-z0-9_-]+:\n",
        compose_text[service_start + len(f"  {service_name}:\n") :],
    )
    service_end = (
        service_start + len(f"  {service_name}:\n") + next_service.start()
        if next_service
        else len(compose_text)
    )
    service_block = compose_text[service_start:service_end]
    if block.strip() in service_block:
        return compose_text
    patched = service_block.replace(marker, marker + block)
    return compose_text[:service_start] + patched + compose_text[service_end:]


text = patch_service_env(
    text,
    "frontend",
    "      - WEB_OTEL_SERVICE_NAME=frontend-web\n",
    "      - OBS_COLLECTOR_URL=http://host.docker.internal:8790\n"
    f"      - OBS_INGEST_KEY={ingest_key}\n"
    "      - NEXT_PUBLIC_OBS_COLLECTOR_URL=http://localhost:8790\n"
    f"      - NEXT_PUBLIC_OBS_INGEST_KEY={ingest_key}\n",
)
text = patch_service_env(
    text,
    "payment",
    "      - OTEL_SERVICE_NAME=payment\n",
    "      - OBS_COLLECTOR_URL=http://host.docker.internal:8790\n"
    f"      - OBS_INGEST_KEY={ingest_key}\n",
)
compose.write_text(text)
PY

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
