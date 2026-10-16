# Instrument a Python Flask app

This walkthrough wires a Flask service into obs-unified using the standard
OpenTelemetry Python SDK. obs-unified does not ship a first-party Python SDK
yet; the only obs-specific pieces are the collector endpoint, ingest key,
interaction header stamping, and AI-call attributes.

## Install

```bash
pip install \
  flask \
  flask-cors \
  opentelemetry-api \
  opentelemetry-sdk \
  opentelemetry-exporter-otlp-proto-http \
  opentelemetry-instrumentation-flask \
  opentelemetry-instrumentation-requests
```

## Environment

```bash
export OBS_COLLECTOR_URL=http://localhost:8790
export OBS_INGEST_KEY=<your key>   # the collector's INGEST_KEY, or a key from `obs-unified keys mint`
# Your Flask app's own CORS allowlist — not the collector's ALLOWED_ORIGINS.
export OBS_ALLOWED_ORIGIN=http://localhost:5173
```

`OBS_INGEST_KEY` must be a key your collector accepts: the prebuilt GHCR image rejects the sample `dev-ingest-key`, so use the value you passed as `INGEST_KEY`. If you send `x-obs-interaction` by hand, use a 26-character uppercase Crockford-base32 ULID such as `01JAQ8K3Z9X7M2N4P6Q8R0S1T3`; free-form values like `demo_click_123` do not match the SDK contract.

## Add obs setup

Create `obs_setup.py`:

```python
import os

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def init_obs(app, service_name: str, project_id: str = "default") -> None:
    resource = Resource.create(
        {
            "service.name": service_name,
            "project.id": project_id,
        }
    )
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(
        endpoint=f"{os.environ['OBS_COLLECTOR_URL']}/v1/traces",
        headers={
            "Authorization": f"Bearer {os.environ['OBS_INGEST_KEY']}",
            "X-Project-Id": project_id,
        },
    )
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    FlaskInstrumentor().instrument_app(app)
    RequestsInstrumentor().instrument()
```

Create `obs_interaction.py`:

```python
import re

from opentelemetry import trace

INTERACTION_HEADER = "x-obs-interaction"
INTERACTION_ATTR = "obs.interaction.id"
INTERACTION_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")


def stamp_interaction(headers) -> None:
    raw = headers.get(INTERACTION_HEADER) or headers.get(INTERACTION_HEADER.title())
    if not raw or not INTERACTION_RE.fullmatch(raw):
        return

    span = trace.get_current_span()
    if span and span.is_recording():
        span.set_attribute(INTERACTION_ATTR, raw)
```

## Wire Flask

```python
import os

from flask import Flask, jsonify, request
from flask_cors import CORS
from opentelemetry import trace

from obs_interaction import stamp_interaction
from obs_setup import init_obs

app = Flask(__name__)

CORS(
    app,
    origins=[os.environ.get("OBS_ALLOWED_ORIGIN", "http://localhost:5173")],
    allow_headers=[
        "Content-Type",
        "Authorization",
        "x-obs-interaction",
        "x-obs-session-id",
    ],
)

init_obs(app, service_name="flask-api")
tracer = trace.get_tracer(__name__)


@app.before_request
def before_request():
    stamp_interaction(request.headers)


@app.get("/api/hello")
def hello():
    with tracer.start_as_current_span("hello.lookup") as span:
        span.set_attribute("feature", "flask-example")
        return jsonify({"message": "hello from Flask"})


if __name__ == "__main__":
    app.run(port=5001)  # macOS AirPlay Receiver often occupies 5000
```

Run it:

```bash
python app.py
```

Then call it:

```bash
curl http://localhost:5001/api/hello
```

## Optional AI-call span

For LLM calls, add OpenInference-compatible attributes so obs-unified can
populate the AI Calls view:

```python
from opentelemetry import trace

tracer = trace.get_tracer(__name__)


def call_llm(client, messages):
    with tracer.start_as_current_span("openai.chat.completions") as span:
        span.set_attribute("openinference.span.kind", "LLM")
        span.set_attribute("gen_ai.system", "openai")
        span.set_attribute("gen_ai.request.model", "gpt-4o-mini")

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )

        if response.usage:
            span.set_attribute("gen_ai.usage.input_tokens", response.usage.prompt_tokens)
            span.set_attribute(
                "gen_ai.usage.output_tokens",
                response.usage.completion_tokens,
            )
            span.set_attribute("gen_ai.usage.total_tokens", response.usage.total_tokens)

        return response
```

## Verify

First verify the collector and browser CORS path. From a clone of the
obs-unified repo you can use `pnpm run doctor …` instead:

```bash
pnpm dlx @obsunified/cli doctor http://localhost:8790 --origin http://localhost:5173
```

Then open the dashboard and check:

- Traces include `flask-api`.
- Request spans have child spans such as `hello.lookup`.
- Requests from a browser frontend carry `obs.interaction.id` when the frontend
  sends `x-obs-interaction`.
- AI-call spans appear in the AI Calls view when you set the OpenInference
  attributes.

## Notes

- Initialize OpenTelemetry before serving requests.
- Keep `OBS_INGEST_KEY` server-side; do not expose it to browsers.
- If your Flask API is called by a browser app, the browser origin must match
  your CORS `origins` value and your collector `ALLOWED_ORIGINS` value.
