# Profiling — sending pprof to obs-unified

obs-unified accepts gzipped pprof blobs at `/v1/profiles/pprof`. Any profiler that produces standard pprof output works — pick whichever fits your runtime.

## Wire format

```
POST /v1/profiles/pprof
Content-Type: application/octet-stream
Authorization: Bearer <ingest-key>
x-obs-profile-type: cpu | heap | wall | block | mutex | goroutine | offcpu
x-obs-service: <service-name>
x-obs-agent: <optional-agent-name>      # e.g. "datadog-pprof", "parca-agent"
x-obs-start-ts: 2026-05-04T12:00:00Z    # optional — when the sample window started
x-obs-duration-ms: 60000                # optional — how long the profile spans
x-obs-trace-ids: <id1>,<id2>,…          # optional but important — see below

<gzipped pprof bytes>
```

### `x-obs-trace-ids` — populates the trace waterfall's 🔥 badge

When your profiler tags samples with the active OTel `trace_id`, extract the distinct ids before pushing and pass them as a comma-separated list. The collector populates `profile_trace_index` so `/internal/profiles?trace_id=X` returns this profile, and the trace waterfall renders the 🔥 badge for any span belonging to that trace.

If you can't extract trace_ids (e.g. you're running an eBPF agent that doesn't tag samples), omit the header. The profile still ingests; aggregate views still work; only the per-trace 🔥 badge is missing.

## Per-language recipes

### Node.js — `@datadog/pprof`

```ts
import { time, encode } from "@datadog/pprof";
import { pushProfile } from "@obs-unified/telemetry-sdk";

async function captureAndPush() {
  const profile = await time.profile({
    durationMillis: 60_000,
    intervalMicros: 1000,
  });
  const buffer = await encode(profile);
  await pushProfile({
    collectorUrl: process.env.OBS_COLLECTOR_URL!,
    apiKey: process.env.OBS_INGEST_KEY!,
    serviceName: "my-api",
    profileType: "cpu",
    blob: buffer,
    durationMs: 60_000,
    agent: "datadog-pprof",
    // If you tag samples with trace_id labels, extract them here:
    traceIds: extractDistinctTraceIds(profile),
  });
}

setInterval(captureAndPush, 60_000);
```

To label samples with the OTel `trace_id`, use `time.profile`'s `sourceMapper` callback or set sample labels via the OTel context API.

### Go — `runtime/pprof`

Standard library — no dependency:

```go
import (
  "bytes"
  "compress/gzip"
  "io"
  "net/http"
  "runtime/pprof"
  "time"
)

func capturePush() error {
  var raw bytes.Buffer
  if err := pprof.StartCPUProfile(&raw); err != nil { return err }
  time.Sleep(60 * time.Second)
  pprof.StopCPUProfile()

  // pprof's encoded format is already gzipped on the wire.
  req, _ := http.NewRequest("POST", os.Getenv("OBS_COLLECTOR_URL")+"/v1/profiles/pprof", &raw)
  req.Header.Set("Content-Type", "application/octet-stream")
  req.Header.Set("Authorization", "Bearer "+os.Getenv("OBS_INGEST_KEY"))
  req.Header.Set("x-obs-profile-type", "cpu")
  req.Header.Set("x-obs-service", "my-go-svc")
  req.Header.Set("x-obs-agent", "go-runtime-pprof")
  _, err := http.DefaultClient.Do(req)
  return err
}
```

For trace_id labels, use `pprof.Labels(...)` around the work you want to attribute, reading the active span via `propagation.TraceContextFromContext(ctx)`.

### Python — `pyroscope-python` push mode

```python
import pyroscope

pyroscope.configure(
    application_name="my-py-svc",
    server_address="https://obs.my-app.com/v1/profiles/pprof",
    auth_token="<ingest-key>",
    enable_logging=False,
)
```

Pyroscope's Python agent emits gzipped pprof at the URL you point it at. The trace_id label flow uses `pyroscope.tag_wrapper({...})` around your handler.

### JVM — `pyroscope-java`

```yaml
# pyroscope-java agent flag
-javaagent:./pyroscope.jar
-Dpyroscope.application.name=my-jvm-svc
-Dpyroscope.server.address=https://obs.my-app.com/v1/profiles/pprof
-Dpyroscope.auth.token=<ingest-key>
```

Pyroscope-java handles JIT symbolization via async-profiler under the hood.

### eBPF — Parca-Agent / OTel-eBPF-Profiler

Both emit pprof natively. Parca-Agent has a `--remote-store-address` flag; OTel-eBPF-Profiler exports OTLP profiles which a colocated OTel collector can convert to pprof and forward to our endpoint.

Trace-id labels: only some eBPF builds tag samples with the OTel context. Without that, the 🔥 badge won't fire for individual traces, but service-level profile views work.

## Verifying ingest

After your first push:

```bash
curl -H "Authorization: Bearer <ingest-key>" \
  https://obs.my-app.com/internal/profiles?service=my-api \
  | jq '.profiles[] | {id, profileType, durationMs, blobSizeBytes}'
```

You should see the profile listed. If your push included `x-obs-trace-ids`, drill in via:

```bash
curl https://obs.my-app.com/internal/profiles/<id>
```

The response includes the `traceIds` array.

## What's not yet shipped

- **Server-side filtered blob** (`?trace_id=X` returning a re-serialized pprof with only matching samples) — accepted on the endpoint shape but not yet implemented; falls back to returning the full blob URL.
- **Flame graph viewer in the dashboard** — pprof blobs are downloadable but a built-in flame-graph component lands in a follow-up. For now, download and view in `pprof -http`, Speedscope, or any pprof viewer.
