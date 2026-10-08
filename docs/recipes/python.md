# Python — OpenTelemetry + obs-unified

obs-unified does not (yet) ship a first-party Python SDK. The standard
OpenTelemetry Python SDK plus three small helpers is enough to participate fully
in the platform's identity skeleton.

## Install

```bash
pip install \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-requests \
  opentelemetry-instrumentation-flask
```

## Init — point OTel at your collector

```python
# obs_setup.py
import os
from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

def init_obs(service_name: str, project_id: str | None = None) -> None:
    resource = Resource.create(
        {
            "service.name": service_name,
            **({"project.id": project_id} if project_id else {}),
        }
    )
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=f"{os.environ['OBS_COLLECTOR_URL']}/v1/traces",
        headers={"Authorization": f"Bearer {os.environ['OBS_INGEST_KEY']}"},
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
```

Call `init_obs("my-service")` once at process startup. Standard OTel
auto-instrumentation (`opentelemetry-instrumentation-flask`, `-django`,
`-fastapi`, `-requests`, `-psycopg2`, …) populates HTTP + DB + RPC spans
automatically.

## interaction_id — read inbound, stamp the active span

```python
# obs_interaction.py
import re
from opentelemetry import trace

INTERACTION_HEADER = "x-obs-interaction"
INTERACTION_ATTR = "obs.interaction.id"
_INTERACTION_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")

def stamp_interaction(request_headers: dict) -> None:
    """
    Read the x-obs-interaction header and stamp the current span.
    No-op when the header is missing or malformed. Wire spec:
    `docs/spec/interaction-id.md` in the obs-unified repo.
    """
    raw = request_headers.get(INTERACTION_HEADER) or request_headers.get(
        INTERACTION_HEADER.title()
    )
    if not raw or not _INTERACTION_RE.fullmatch(raw):
        return
    span = trace.get_current_span()
    if span and span.is_recording():
        span.set_attribute(INTERACTION_ATTR, raw)
```

### Flask example

```python
from flask import Flask, request
from obs_setup import init_obs
from obs_interaction import stamp_interaction

init_obs("checkout-api")
app = Flask(__name__)

@app.before_request
def _stamp():
    stamp_interaction(dict(request.headers))
```

### FastAPI example

```python
from fastapi import FastAPI, Request

app = FastAPI()

@app.middleware("http")
async def stamp(request: Request, call_next):
    stamp_interaction(dict(request.headers))
    return await call_next(request)
```

## AI calls — OpenInference attributes

For LLM call sites, follow OpenInference's typed-attribute convention so the AI
tab renders correctly:

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)

with tracer.start_as_current_span("openai.chat.completions") as span:
    span.set_attribute("openinference.span.kind", "LLM")
    span.set_attribute("gen_ai.system", "openai")
    span.set_attribute("gen_ai.request.model", "gpt-4o-mini")
    response = client.chat.completions.create(...)
    span.set_attribute(
        "gen_ai.usage.input_tokens", response.usage.prompt_tokens
    )
    span.set_attribute(
        "gen_ai.usage.output_tokens", response.usage.completion_tokens
    )
```

The collector's `gen-ai-normalizer` plugin reads these attributes off the span
and writes a row into the denormalized `ai_calls` table.

## What you give up vs. a first-party SDK

Manual `stamp_interaction` call instead of auto-correlation — you need to
remember to wire the middleware. Other than that, every signal type (spans,
logs, AI calls) flows end-to-end identically. If you find a gap, please open an
issue.
