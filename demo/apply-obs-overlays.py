#!/usr/bin/env python3
"""Apply obs-unified overlays to the cloned OpenTelemetry demo."""

from __future__ import annotations

import json
import re
from pathlib import Path

INGEST_KEY = "obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504"
SDK_DEPENDENCIES = {
    "@obs-unified/telemetry-sdk": "file:../../.obs-unified/obs-unified-telemetry-sdk-1.0.0.tgz",
    "@obs-unified/types": "file:../../.obs-unified/obs-unified-types-1.0.0.tgz",
}


def patch_json(path: Path, dependencies: dict[str, str]) -> None:
    data = json.loads(path.read_text())
    data.setdefault("dependencies", {}).update(dependencies)
    path.write_text(json.dumps(data, indent=2) + "\n")


def patch_frontend_app(path: Path) -> None:
    text = path.read_text()
    if "import { ObsBootstrap } from '../obs-bootstrap';" not in text:
        text = text.replace(
            "import { FlagdWebProvider } from '@openfeature/flagd-web-provider';\n",
            "import { FlagdWebProvider } from '@openfeature/flagd-web-provider';\n"
            "import { ObsBootstrap } from '../obs-bootstrap';\n",
        )
    text = text.replace(
        "  FrontendTracer();",
        "  // Browser OTel tracing is replaced by obs-unified AnalyticsProvider.\n"
        "  // FrontendTracer();",
    )
    if "<ObsBootstrap>" not in text:
        text = text.replace(
            "    <ThemeProvider theme={Theme}>\n",
            "    <ObsBootstrap>\n      <ThemeProvider theme={Theme}>\n",
        )
        text = text.replace(
            "    </ThemeProvider>\n",
            "      </ThemeProvider>\n    </ObsBootstrap>\n",
        )
    path.write_text(text)


def append_require_once(path: Path, require_line: str) -> None:
    text = path.read_text()
    if require_line not in text:
        text += f"\n{require_line}\n"
    path.write_text(text)


def patch_payment_handler(path: Path) -> None:
    text = path.read_text()
    if "recordObsTraceId" in text:
        return
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
    path.write_text(text)


def patch_service_env(
    compose_text: str,
    service_name: str,
    marker: str,
    block: str,
) -> str:
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


def patch_compose(path: Path) -> None:
    text = path.read_text()
    text = patch_service_env(
        text,
        "frontend",
        "      - WEB_OTEL_SERVICE_NAME=frontend-web\n",
        "      - OBS_COLLECTOR_URL=http://host.docker.internal:8790\n"
        f"      - OBS_INGEST_KEY={INGEST_KEY}\n"
        "      - NEXT_PUBLIC_OBS_COLLECTOR_URL=http://localhost:8790\n"
        f"      - NEXT_PUBLIC_OBS_INGEST_KEY={INGEST_KEY}\n",
    )
    text = patch_service_env(
        text,
        "payment",
        "      - OTEL_SERVICE_NAME=payment\n",
        "      - OBS_COLLECTOR_URL=http://host.docker.internal:8790\n"
        f"      - OBS_INGEST_KEY={INGEST_KEY}\n",
    )
    path.write_text(text)


def main() -> None:
    root = Path("upstream")
    overlays = Path("overlays")

    patch_json(
        root / "src/frontend/package.json",
        {
            "@obs-unified/analytics-sdk": "file:../../.obs-unified/obs-unified-analytics-sdk-1.0.0.tgz",
            **SDK_DEPENDENCIES,
        },
    )
    patch_json(
        root / "src/payment/package.json",
        {
            "@datadog/pprof": "^5.11.0",
            **SDK_DEPENDENCIES,
        },
    )

    (root / "src/frontend/obs-bootstrap.tsx").write_text(
        (overlays / "frontend/obs-bootstrap.tsx").read_text()
    )
    (root / "src/frontend/obs-unified.js").write_text(
        (overlays / "node/obs-unified.js").read_text()
    )
    (root / "src/payment/obs-unified.js").write_text(
        (overlays / "node/obs-unified.js").read_text()
    )

    patch_frontend_app(root / "src/frontend/pages/_app.tsx")
    append_require_once(
        root / "src/frontend/utils/telemetry/Instrumentation.js",
        "require('../../obs-unified.js');",
    )
    append_require_once(
        root / "src/payment/opentelemetry.js",
        "require('./obs-unified.js');",
    )
    patch_payment_handler(root / "src/payment/index.js")
    patch_compose(root / "compose.yaml")


if __name__ == "__main__":
    main()
