#!/usr/bin/env python3
"""Apply obs-unified overlays to the cloned OpenTelemetry demo."""

from __future__ import annotations

import json
import re
from pathlib import Path

DEFAULT_INGEST_KEY = "obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504"
SDK_DEPENDENCIES = {
    "@obs-unified/telemetry-sdk": "file:../../.obs-unified/obs-unified-telemetry-sdk-1.0.0.tgz",
    "@obs-unified/types": "file:../../.obs-unified/obs-unified-types-1.0.0.tgz",
}


def read_env_value(path: Path, key: str) -> str | None:
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        if name.strip() == key:
            return value.strip().strip("'\"") or None
    return None


def resolve_ingest_key() -> str:
    return (
        read_env_value(Path("../apps/collector/.dev.vars"), "INGEST_KEY")
        or DEFAULT_INGEST_KEY
    )


def inject_ingest_key(text: str, ingest_key: str) -> str:
    return text.replace(DEFAULT_INGEST_KEY, ingest_key)


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


def patch_frontend_instrumentation(path: Path) -> None:
    text = path.read_text()
    if "'@opentelemetry/instrumentation-http'" not in text:
        text = text.replace(
            "      // disable fs instrumentation to reduce noise\n",
            "      '@opentelemetry/instrumentation-http': {\n"
            "        applyCustomAttributesOnSpan: (span, request) => {\n"
            "          const interaction = request.headers?.['x-obs-interaction'];\n"
            "          const interactionId = Array.isArray(interaction) ? interaction[0] : interaction;\n"
            "          if (typeof interactionId === 'string' && interactionId.length > 0) {\n"
            "            span.setAttribute('obs.interaction.id', interactionId);\n"
            "          }\n"
            "        },\n"
            "      },\n"
            "      // disable fs instrumentation to reduce noise\n",
        )
    path.write_text(text)


def patch_frontend_dockerfile(path: Path) -> None:
    text = path.read_text()
    if "COPY ./.obs-unified /.obs-unified" not in text:
        text = text.replace(
            "COPY ./src/frontend/package-lock.json package-lock.json\n\nRUN npm ci\n",
            "COPY ./src/frontend/package-lock.json package-lock.json\n"
            "COPY ./.obs-unified /.obs-unified\n\n"
            "RUN npm ci\n",
        )
        text = text.replace(
            "COPY ./src/frontend/package-lock.json package-lock.json\n\nRUN npm ci --omit=dev\n",
            "COPY ./src/frontend/package-lock.json package-lock.json\n"
            "COPY ./.obs-unified /.obs-unified\n\n"
            "RUN npm ci --omit=dev\n",
        )
    if "COPY ./src/frontend/obs-bootstrap.tsx obs-bootstrap.tsx" not in text:
        text = text.replace(
            "COPY ./src/frontend/pages/ pages/\n",
            "COPY ./src/frontend/pages/ pages/\n"
            "COPY ./src/frontend/obs-bootstrap.tsx obs-bootstrap.tsx\n",
        )
    if "COPY ./src/frontend/obs-unified.js obs-unified.js" not in text:
        text = text.replace(
            "COPY ./src/frontend/utils/telemetry/Instrumentation.js Instrumentation.js\n",
            "COPY ./src/frontend/utils/telemetry/Instrumentation.js Instrumentation.js\n"
            "COPY ./src/frontend/obs-unified.js obs-unified.js\n",
        )
    text = text.replace("COPY ./src/frontend/obs-unified.js /obs-unified.js\n", "")
    path.write_text(text)


def patch_payment_dockerfile(path: Path) -> None:
    text = path.read_text()
    if "COPY ./.obs-unified /usr/.obs-unified" not in text:
        text = text.replace(
            "COPY ./src/payment/package-lock.json package-lock.json\n\nRUN npm ci --omit=dev\n",
            "COPY ./src/payment/package-lock.json package-lock.json\n"
            "COPY ./.obs-unified /usr/.obs-unified\n\n"
            "RUN npm ci --omit=dev\n",
        )
    if "COPY ./src/payment/obs-unified.js obs-unified.js" not in text:
        text = text.replace(
            "COPY ./src/payment/opentelemetry.js opentelemetry.js\n",
            "COPY ./src/payment/opentelemetry.js opentelemetry.js\n"
            "COPY ./src/payment/obs-unified.js obs-unified.js\n",
        )
    path.write_text(text)


def append_require_once(path: Path, require_line: str) -> None:
    text = path.read_text()
    if require_line not in text:
        text += f"\n{require_line}\n"
    path.write_text(text)


def patch_require_once(path: Path, old_line: str, new_line: str) -> None:
    text = path.read_text().replace(old_line, new_line)
    if new_line not in text:
        text += f"\n{new_line}\n"
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


def patch_service_memory_limit(
    compose_text: str,
    service_name: str,
    memory: str,
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
    patched = re.sub(
        r"(?m)^          memory: .+$",
        f"          memory: {memory}",
        service_block,
        count=1,
    )
    return compose_text[:service_start] + patched + compose_text[service_end:]


def patch_compose(path: Path, ingest_key: str) -> None:
    text = path.read_text()
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
    text = patch_service_memory_limit(text, "llm", "150M")
    path.write_text(text)


def main() -> None:
    root = Path("upstream")
    overlays = Path("overlays")
    ingest_key = resolve_ingest_key()

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
        inject_ingest_key((overlays / "frontend/obs-bootstrap.tsx").read_text(), ingest_key)
    )
    (root / "src/frontend/obs-unified.js").write_text(
        inject_ingest_key((overlays / "node/obs-unified.js").read_text(), ingest_key)
    )
    (root / "src/payment/obs-unified.js").write_text(
        inject_ingest_key((overlays / "node/obs-unified.js").read_text(), ingest_key)
    )
    extras_path = root / "src/otel-collector/otelcol-config-extras.yml"
    extras_path.write_text(inject_ingest_key(extras_path.read_text(), ingest_key))

    patch_frontend_app(root / "src/frontend/pages/_app.tsx")
    patch_frontend_dockerfile(root / "src/frontend/Dockerfile")
    patch_frontend_instrumentation(
        root / "src/frontend/utils/telemetry/Instrumentation.js"
    )
    patch_require_once(
        root / "src/frontend/utils/telemetry/Instrumentation.js",
        "require('../../obs-unified.js');",
        "require('./obs-unified.js');",
    )
    append_require_once(
        root / "src/payment/opentelemetry.js",
        "require('./obs-unified.js');",
    )
    patch_payment_dockerfile(root / "src/payment/Dockerfile")
    patch_payment_handler(root / "src/payment/index.js")
    patch_compose(root / "compose.yaml", ingest_key)


if __name__ == "__main__":
    main()
