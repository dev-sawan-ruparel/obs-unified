# RFC 0009: eBPF tracing bridge via OTel collector

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-03
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Depends on:** [RFC 0007 — pprof profiling](0007-pprof-profiling.md) for off-CPU and CPU eBPF-emitted profiles. Independent of RFC 0007 for Beyla-emitted spans and OTel hostmetrics.
- **Companion:** [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) — note: neither current scenario exercises eBPF. A *Scenario C — futex contention* worked example is a follow-up deliverable for this RFC, demonstrating the case where in-app spans show an unexplained pause and an off-CPU flame graph (or a Beyla-derived edge) closes the gap. Without that scenario, this RFC's UX claims are not concretely testable.
- **Target:** documentation, demo configs; minimal code in `@obs/dashboard` (filters/tiles); none in `@obs/collector`

## Summary

Document and integrate a path for kernel-level eBPF data — syscall latency, network protocol decoding, off-CPU stalls, lock contention — to flow into obs-unified as **standard OTLP traces / metrics / logs**, plus off-CPU **pprof profiles** through the [RFC 0007](0007-pprof-profiling.md) ingest path. obs-unified does not run eBPF programs and does not introduce a new ingest format.

The recommended agents for each shape are different and worth distinguishing:

- **For eBPF-derived auto-instrumented spans** (HTTP/gRPC/SQL/Redis decoded from kernel-level network observation, with OTLP output) — [Grafana Beyla](https://grafana.com/oss/beyla/), which emits OTLP directly. This is the most consolidated path today for OTLP-shaped eBPF tracing.
- **For eBPF-based CPU and off-CPU profiling** — Parca-Agent or OTel-eBPF-Profiler (RFC 0007 path).
- **For host metrics** (CPU/memory/disk/network of Linux nodes) — OTel Collector's `hostmetricsreceiver`. Not eBPF, but completes the picture.

This RFC is **mostly documentation and integration glue, with a small amount of code** to make the pre-aggregated kernel signals legible in the dashboard (service-level CPU/memory tiles, eBPF-derived service-map edges, off-CPU flame graphs). It explicitly does not try to compete with eBPF-first platforms (Groundcover, Pixie, Coroot).

## Motivation

Per RFC 0003, the deepest layer of the unified stack is the kernel. Two questions are answered only there:

- "Why is this thread off-CPU during this span?" — futex contention, scheduling, GC stop-the-world.
- "What is the application doing at the syscall / network layer that no instrumented span captures?" — slow `read()`, dropped packets, TCP retransmits.

eBPF-first platforms (Groundcover, Pixie, Coroot) make these the *primary* signal and derive everything else from it. obs-unified takes the inverse position: SDK-first signals are primary, kernel data is the *deepest layer of correlation*. We do not duplicate the kernel-discovery work those platforms do well; we accept their output where it adds value to our existing chain.

Concretely, this is *not* "obs-unified ships an eBPF agent." It is "obs-unified knows how to render OTel data that an eBPF agent + OTel collector emit, and joins it into the rest of the chain via standard correlation IDs."

## Today

### What's missing

- No documented eBPF setup story.
- No service-level surfacing of off-CPU time, syscall latency, or kernel events as distinct from "regular" spans/metrics.
- The Resources dashboard ([platform-routes.ts](../packages/obs-collector/src/plugins/platform-routes.ts)) is **Cloudflare-only** — D1 row counts, R2 storage, Worker CPU/memory. There is no equivalent of Uptrace's `Hosts` view that shows a Linux node's CPU/memory/network/disk via OTel hostmetrics, let alone the eBPF-derived signals.
- Profiles (RFC 0007) capture on-CPU stack samples but not off-CPU. Off-CPU profiling exists (eBPF-based, separate sample type) but isn't wired into our flow.

### What does exist

- OTLP trace, log, and metrics ingest is sound (RFC 0001 work). Anything an OTel collector can emit, we already accept.
- Span links / async edges already render in the service map ([store.ts:870](../packages/obs-collector/src/lib/store.ts)). This is the natural place to also render kernel-level edges (sock-to-sock).
- RFC 0007 establishes pprof ingest. The OTel-eBPF-Profiler emits pprof; same path.

So: most of the receiver-side plumbing is in place. The gap is **understanding and documentation, plus a few targeted UI surfaces**.

## Proposed design

### Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Linux node          │     │ OTel Collector   │     │ obs-unified      │
│                     │     │ (optional, but   │     │                  │
│  Beyla              │────▶│  recommended for │────▶│  /v1/traces      │
│   (eBPF→OTLP        │     │  k8s metadata    │     │  /v1/metrics     │
│   auto-instrument)  │     │  enrichment +    │     │  /v1/logs        │
│                     │     │  batching)       │     │                  │
│  hostmetricsreceiver│────▶│                  │     │                  │
│                     │     │                  │     │                  │
│  Parca-Agent /      │─────────────────────────────▶│  /v1/profiles/   │
│  OTel-eBPF-Profiler │                              │   pprof          │
│  (pprof, RFC 0007)  │                              │                  │
└─────────────────────┘     └──────────────────┘     └──────────────────┘
```

We are the right-most box. Beyla and the OTel `hostmetricsreceiver` already speak OTLP, so the collector in the middle is optional — useful for adding k8s metadata (`k8s.pod.name`, etc.) and for batching, but not required. Profiles can flow directly to RFC 0007's pprof endpoint.

There is no monolithic "eBPF receiver" we depend on. Different signals come from different agents; the unifier is OTLP / pprof on the wire.

### What the agents produce (and how it lands in our tables)

| Stream | Source agent | Wire format | Lands in | Special UI |
|---|---|---|---|---|
| HTTP/gRPC/SQL/Redis spans decoded from kernel | Beyla | OTLP spans | `telemetry_spans` | service-map edge (eBPF-derived) |
| CPU profiles (stack sampling) | OTel-eBPF-Profiler / Parca-Agent | pprof | `profile_blobs` (RFC 0007) | flame graph |
| Off-CPU profiles (scheduler events) | OTel-eBPF-Profiler / Parca-Agent | pprof, `profile_type='offcpu'` | `profile_blobs` | flame graph (off-CPU style) |
| Host CPU/memory/disk/network metrics | OTel `hostmetricsreceiver` | OTLP metrics | `metric_point` | Resources dashboard tiles (new) |
| Lock / mutex / futex events | (less consolidated — bcc/bpftrace tools, no OTLP-native option as of May 2026) | (varies; would require a custom collector receiver) | n/a | n/a in this RFC |

The first four are well-supported today and require **rendering work in the dashboard, not ingest changes** — the existing OTLP and pprof receivers already handle them. The fifth row (lock-contention events as spans) was speculatively included in an earlier draft; we drop it because no mature agent emits OTLP for this signal yet. Off-CPU profiles cover the contention case at coarser granularity.

### Off-CPU profile rendering

Builds on RFC 0007. `profile_blobs.profile_type` already supports `'offcpu'`. The flame-graph viewer renders an off-CPU flame as a different color scheme (icicle pointing up; convention from Brendan Gregg). The Connected rail surfaces both CPU and off-CPU profiles as separate links.

### Kernel-derived service-map edges

The service map ([store.ts:870](../packages/obs-collector/src/lib/store.ts)) currently derives edges from in-app spans. Beyla produces *additional* spans for service-to-service calls observed from the kernel — e.g. an HTTP call from Service A to Service B, decoded from TLS-uprobed bytes, with no in-app instrumentation required. These spans land in `telemetry_spans` like any other, with their own resource attributes.

We add a service-map edge filter:

- **Source:** "from instrumented spans" (default), "from eBPF spans," or "both."
- Edges from eBPF carry a small icon to distinguish them.
- Distinction relies on a resource attribute we recommend Beyla be configured to emit: `obs.span.source = "ebpf"` (or detection by the well-known `telemetry.sdk.name = "beyla"` resource attribute that Beyla already sets).

This is a dashboard-side change. The collector accepts the spans regardless; the filter is applied at query/render time.

### Resources dashboard expansion

Today's [Resources dashboard](../packages/dashboard/src/dashboards/ResourcesDashboard.tsx) is hardcoded to Cloudflare platform metrics. We extend it with a second mode:

- **"Cloudflare platform"** (existing) — D1, R2, Worker.
- **"Linux hosts"** (new) — when OTel host-metrics are present in `metric_point`. Renders CPU / memory / disk / network per host, derived from standard OTel `hostmetrics` receiver semantic conventions.

The dashboard auto-detects which to show based on whether `metric_series` contains `system.cpu.*` rows. Both can be visible if both are present.

This closes the "obs-unified can't show generic Docker container CPU" gap called out in `docs/comparison/uptrace.md`.

### Documentation: the recipe

The bulk of this RFC's work is a `docs/howto/ebpf.md` that walks through three independent integrations, any subset of which a user can pick up:

1. **Beyla** (eBPF auto-instrumented OTLP spans + metrics for HTTP/gRPC/SQL/Redis).
   - Run as a sidecar or DaemonSet. Configure OTLP exporter pointing at obs-unified directly, or via an OTel collector for k8s metadata enrichment.
   - Verify: new edges appear in service map, with the eBPF-source filter toggle.

2. **OTel `hostmetricsreceiver`** (CPU/memory/disk/network of Linux nodes — not eBPF, but the infra-metrics piece).
   - Runs in the OTel collector. OTLP-native.
   - Verify: Resources dashboard's "Linux hosts" mode populates.

3. **OTel-eBPF-Profiler** or **Parca-Agent** (CPU + off-CPU profiles — RFC 0007 path).
   - DaemonSet. pprof exporter targeting `/v1/profiles/pprof`.
   - Verify: Profiles surface populates; off-CPU flame graphs render where the agent supports that sample type.

This is documentation, not code, but it's what makes the feature *real* for users.

### Trace correlation — exact vs approximate

Two flavors:

- **Exact.** When the eBPF agent reads the application's OTel context (e.g. via uprobe on the OTel SDK's context-propagation function, or via process TLS read), kernel events carry the `trace_id` and join exactly. Some agents (OTel-eBPF-Profiler with `cgo` enabled, some Parca builds) do this.
- **Approximate.** Otherwise, kernel events have `pid` and timestamp. We approximate-join in queries: "kernel events with this pid in the time window of this span." Inexact, especially under heavy concurrency, but useful.

The collector accepts both, prefers exact when the `trace_id` attribute is present, falls back to (pid, ts) windowing when not.

## What we explicitly do not build

- An eBPF agent. There are at least three good ones.
- A kernel-event-shaped storage engine. We piggyback on `telemetry_spans` and `metric_point` via OTel.
- Auto-discovery of services from kernel observation. That's eBPF-first platforms' (Pixie, Groundcover, Coroot) main feature; we don't compete.
- Privileged-container deployment helpers. Out of scope; users follow OTel collector docs.

## Acceptance criteria

1. `docs/howto/ebpf.md` exists with three independent recipes (Beyla, hostmetrics, pprof eBPF) — each end-to-end, each verifiable independently.
2. Resources dashboard renders Linux host CPU / memory / disk / network when `system.*` (OTel hostmetrics semconv) metric series are present in `metric_point`.
3. Service-map dashboard filter distinguishes SDK-derived from eBPF-derived edges via the `telemetry.sdk.name = "beyla"` resource attribute (or our `obs.span.source = "ebpf"` convention if a non-Beyla source is used).
4. Off-CPU pprof profiles render in the same flame-graph viewer as CPU profiles, distinguished visually (different color scheme; icicle orientation per Brendan Gregg convention).
5. Connected rail (RFC 0006) on a span includes "off-CPU profile" link when a matching off-CPU profile exists in `profile_blobs` (joined via RFC 0007's `profile_trace_index`).

## Non-goals

- **Beating Pixie / Groundcover at their own game.** They auto-decode dozens of protocols at the kernel layer. We accept what they (or the OTel collector with similar receivers) emit, but we don't replicate the agent.
- **Building our own hostmetrics scraper.** OTel Collector's `hostmetricsreceiver` is mature.
- **Kernel-event ingest at firehose scale.** If a user wants to push every syscall event, they should aggregate at the collector first. We accept what arrives but don't tune the collector for million-event/sec scenarios.

## Open questions

- **Sampling rate of Beyla spans.** A naive "every HTTP request is a span" generates spans at request throughput. Strongly recommend Beyla's own filtering / tail-sampling at the agent or via a downstream OTel collector tail-sampling processor. Document.
- **Resource attrs convention.** OTel hostmetrics emit `host.name`, `host.id`. k8s deployments emit `k8s.pod.name`, `k8s.node.name`. The Resources dashboard groups by which? Probably both, with a switch.
- **State of OTel-collector-contrib eBPF receivers (May 2026).** The most consolidated OTLP-native eBPF *tracing* path is Beyla, deployed as its own agent. There is ongoing work in OTel-collector-contrib for receivers that consume eBPF data inside the collector, but it's less consolidated than the agent-based path and the components are alpha. We recommend the agent path; revisit when collector-internal eBPF receivers stabilize.
- **Off-CPU profiles in `@obs/telemetry-sdk`.** Per-process libraries can produce wall-clock profiles too (`@datadog/pprof` with mode `'wall'`). Should `startProfiler({ type: 'wall' })` be a first-class SDK option? Probably yes; small follow-up to RFC 0007.
- **Beyla deployment on non-k8s.** Beyla also runs as a sidecar or systemd service. Document the non-k8s recipe alongside the k8s one.
- **Worked example.** The two scenarios in [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) do not exercise eBPF data. Before this RFC leaves draft, a *Scenario C — futex contention* should be added showing: an in-app trace with a 200 ms unexplained pause inside a span; the rail surfaces an off-CPU profile for the trace's window; the off-CPU flame graph reveals the futex; from there the rail jumps back to the contending span elsewhere in the trace. This both proves the eBPF integration works end-to-end and gives the comparison docs a concrete vignette.

## Why this is the last RFC in the series

It's intentionally last because every other RFC's work pays a dividend the moment kernel-level data starts arriving:

- **RFC 0004** (identity propagation) — kernel events join cleanly via `trace_id`.
- **RFC 0005** (CPU/self-time) — answers "is this span on-CPU?"; off-CPU profiles answer "and what was it waiting on?"
- **RFC 0006** (connected rail) — surfaces eBPF data as additional sections without redesign.
- **RFC 0007** (pprof) — same blob storage, same flame-graph viewer, two new sample types.
- **RFC 0008** (storage interface) — new high-volume kernel signals can target a different store implementation if D1 strains.

Done in this order, eBPF lands as one more layer of an already-coherent stack. Done first or in isolation, eBPF would either bloat the project (we'd build an agent) or be an orphan tab (we'd ship a "Kernel" page nobody clicks).
