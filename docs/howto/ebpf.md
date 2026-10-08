# eBPF — kernel-level observability into obs-unified

obs-unified doesn't run eBPF programs itself. Per
[RFC 0009](../../rfcs/0009-ebpf-tracing-bridge.md), it accepts whatever an eBPF
agent + OTel collector forwards as standard OTLP traces / metrics / logs, plus
pprof profiles via the [profiling endpoint](profiling.md).

There are three independent integrations. Pick any subset — they don't depend on
each other.

## 1. Beyla — auto-instrumented OTLP spans from kernel-decoded traffic

[Grafana Beyla](https://grafana.com/oss/beyla/) reads HTTP/gRPC/SQL/Redis
traffic at the kernel level and emits OTLP spans. No code changes to your
services.

### Run as a sidecar (Docker)

```yaml
services:
  beyla:
    image: grafana/beyla:latest
    pid: "service:my-app" # share PID namespace with target
    privileged: true # eBPF needs CAP_SYS_ADMIN
    environment:
      BEYLA_OPEN_PORT: 8080 # the port your service listens on
      OTEL_EXPORTER_OTLP_ENDPOINT: https://obs.my-app.com
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer <ingest-key>"
      OTEL_SERVICE_NAME: my-app-beyla
      BEYLA_BPF_TRACK_REQUEST_HEADERS: true
```

### Run as a DaemonSet (k8s)

Beyla's [Helm chart](https://github.com/grafana/beyla/tree/main/charts/beyla)
handles the privileged-pod boilerplate. Point its `otlp.endpoint` at
`https://obs.my-app.com`.

### Verifying

After Beyla starts, hit a request path on your service. New traces should appear
in the dashboard's Traces tab. The service map should show edges whose source
has `telemetry.sdk.name = "beyla"` as a resource attribute.

## 2. OTel `hostmetricsreceiver` — Linux host CPU/memory/disk/network

Not eBPF, but completes the picture: standard `/proc` scraping for the user's
services' host metrics. Without this, the Resources dashboard's "Linux hosts"
mode renders empty.

### otel-collector-config.yaml

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      network:
      filesystem:

exporters:
  otlphttp:
    endpoint: https://obs.my-app.com
    headers:
      Authorization: Bearer <ingest-key>

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      exporters: [otlphttp]
```

### Verifying

```bash
curl -H "Authorization: Bearer <ingest-key>" \
  https://obs.my-app.com/internal/metrics?name=system.cpu.utilization
```

Returns gauge points keyed by `host.name`. The Resources dashboard auto-detects
the presence of `system.*` series and switches to "Linux hosts" mode.

## 3. OTel-eBPF-Profiler / Parca-Agent — pprof profiles

Both produce gzipped pprof. Wire them at obs-unified's
[`/v1/profiles/pprof`](profiling.md) endpoint.

### OTel-eBPF-Profiler (DaemonSet)

```yaml
otelopscol:
  image: open-telemetry/opentelemetry-ebpf-profiler:latest
  privileged: true
  hostPID: true
  args:
    - --collection-agent=https://obs.my-app.com
    - --secret-token=<ingest-key>
```

### Parca-Agent

```bash
parca-agent \
  --remote-store-address=https://obs.my-app.com/v1/profiles/pprof \
  --remote-store-bearer-token=<ingest-key> \
  --node=$HOSTNAME
```

### Off-CPU profiles

Both agents emit off-CPU profiles when configured (Parca: `--off-cpu-threshold`;
OTel-eBPF-Profiler: built-in). They land in `profile_blobs` with
`profile_type='offcpu'`. Rendering off-CPU flame graphs side-by-side with on-CPU
profiles arrives with the dashboard's flame-graph viewer (deferred — see Phase
4.7 status).

## What this gets you

After all three recipes are wired:

- **Service map**: edges sourced from kernel observation alongside the
  SDK-derived edges (`obs.span.source = "ebpf"` filter on the dashboard).
- **Resources dashboard**: per-host CPU/memory/disk/network panels in "Linux
  hosts" mode.
- **Trace waterfall**: 🔥 badge fires when any profile (including off-CPU)
  covers the trace's window.
- **Connected rail**: profile entities appear under "Down" on span detail pages.

## What's not built (yet)

- **Single-line eBPF tracing receiver in OTel-collector-contrib**: as of May
  2026 the collector-internal eBPF tracing receivers are alpha. We recommend the
  agent-based path (Beyla) for now.
- **Off-CPU flame graph rendering** in the dashboard — pprof viewer arrives in a
  follow-up; for now download the blob and view with `pprof -http :6060 <file>`.
- **Scenario C (futex contention) UX walkthrough**: see
  [docs/ux/click-to-cpu.md § Scenario C](../ux/click-to-cpu.md) for the planned
  flow.
