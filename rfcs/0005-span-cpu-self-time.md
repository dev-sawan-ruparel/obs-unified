# RFC 0005: Span self-time & process CPU metric

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-02
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Target:** `@obs/dashboard`, `@obs/telemetry-sdk`, `@obs/collector`

## Summary

Two cheap additions that turn the trace view into a coarse profiler **without** introducing per-span CPU attribution (which can't be done correctly with the runtime APIs available — see § Why no per-span `cpu_ms`):

1. **`self_ms` — wall-clock time not accounted for by child spans, derived in the dashboard** (no SDK or storage change).
2. **Process-level CPU metric — service-scoped `process.cpu.time` emitted as standard OTel metric** (existing metric ingest, surfaced in Health dashboard).

Together these answer two questions cheaply:

- "Where is instrumentation likely missing?" — high `self_ms` with few children = an uninstrumented hot path.
- "Is this service compute-bound overall?" — process CPU metric over time, joined to throughput.

The third question — *"is this specific span on-CPU or off-CPU?"* — is **deferred to RFC 0007 (pprof profiling)**, which is the only path that gives correct per-span CPU attribution under concurrent workloads. This RFC explicitly does not try to fake it.

## Motivation

Traces today decompose wall-clock time at instrumented boundaries. They cannot tell us whether a long span hides an uninstrumented hot path, and they cannot tell us whether a service is compute-bound vs I/O-bound. Both of these are addressable cheaply.

What we do *not* try to answer here is "of the 700ms this span spent, how much was on-CPU?" That answer requires per-thread or per-async-context CPU accounting. Node's only built-in API is `process.cpuUsage()` which is **process-cumulative** — diffing it across a span's lifetime gives total CPU consumed by the process between those timestamps, not by the request that span belongs to. For any concurrent server, every span would report `cpu_ms ≈ wall_ms` because the process is rarely idle. RFC 0007 (pprof profiling) is the correct tool for this; we do not approximate it here.

## Today

### What's stored

[migration 001 — telemetry_spans](../packages/obs-collector/src/migrations/001_telemetry_spans.sql) carries:

- `start_time`, `end_time`, `duration_ms` (all wall-clock)
- `parent_span_id`, `trace_id` (enough to derive self-time)
- No on-CPU annotation of any kind.

### Dashboard

[TelemetryDashboard](../packages/dashboard/src/dashboards/TelemetryDashboard.tsx) renders the trace waterfall using `start_time` and `duration_ms` only. There is no self-time bar, no derived "missing instrumentation" hint, no service-level CPU overlay.

### Process metrics

`metric_series` and `metric_point` (migrations [015](../packages/obs-collector/src/migrations/015_metrics.sql), [016](../packages/obs-collector/src/migrations/016_metrics_exp_histogram_summary.sql)) accept any OTel metric. If a user's runtime emits `process.cpu.time` (e.g. via the OTel host-metrics receiver or the Node `@opentelemetry/instrumentation-runtime-node` package), it lands here automatically. We just don't surface it anywhere.

### Gaps

| Gap | Today |
|---|---|
| Self-time (wall − sum(children)) | not derived in waterfall |
| "Likely uninstrumented" hint on dense spans | absent |
| Service-level CPU utilization overlay (Health dashboard) | absent — the metric may be in `metric_point` but no view consumes it |

## Proposed design

### Self-time derivation

Computed in the dashboard or in `/internal/traces/:traceId`:

```
self_ms(s) = duration_ms(s) - Σ duration_ms(c) for c in children(s)
```

If `self_ms < 0` (overlapping children — async fan-out where children's wall-clock doesn't sum into the parent), we clamp to 0 and surface a flag. Async parents are a known phenomenon and we don't lie about them; the UI marks them "(async parent — self-time not meaningful)" with a small icon.

We do **not** persist `self_ms`. Self-time is a cheap recursive subtraction at trace-tree level, and persisting it duplicates information already carried in `parent_span_id` and `duration_ms`, creating a consistency hazard if an out-of-order span arrives.

Tradeoff: self-time can't be used in WHERE clauses for lists like "all spans with high self-time across the last hour." Acceptable for now; if that need becomes real, persist as a denormalized column at ingest time in a follow-up.

### "Likely uninstrumented" badge

A small ⚠️ shown on spans where:

```
self_ms / duration_ms > 0.7  AND  duration_ms > 100ms  AND  children.length < 2
```

Hover: *"Most of this span's time is unaccounted for — consider adding child spans, or attaching a profile (RFC 0007)."*

The threshold is a starting heuristic; we'll calibrate against the OTel Astronomy Shop demo and adjust before this leaves draft. Spammy badges defeat the purpose.

### Process-level CPU metric

We do not invent a new metric. We rely on what OTel already emits:

- `process.cpu.time` (counter, seconds) — cumulative CPU time consumed by the process. Emitted by `@opentelemetry/instrumentation-runtime-node`, OTel collector's `hostmetricsreceiver`, and most language runtime instrumentation packages.
- `process.cpu.utilization` (gauge, 0..1) — instantaneous fraction. Same emitters.

**Collector work:** none. These are plain OTel metrics; existing ingest handles them.

**Dashboard work:** the Health dashboard renders a per-service tile showing recent `process.cpu.utilization` (or derived from `process.cpu.time` if utilization isn't emitted) alongside throughput from spans. Compute-bound services stand out.

**SDK helper (optional):** `@obs/telemetry-sdk` adds an opt-in `enableProcessMetrics()` that wraps `@opentelemetry/instrumentation-runtime-node`, so users on Node who don't want to assemble OTel metric instrumentation by hand get it with one call. Workers don't expose `process.cpu.*`; we don't lie about this.

### Dashboard rendering

Two changes:

1. **Trace waterfall — self-time visualization.** Each span row's time bar is split: a darker segment for `duration_ms − self_ms` (children's accounted-for time) and a lighter segment for `self_ms`. A glance tells you how much of a span is uninstrumented work. Async parents render the bar in a striped pattern to flag "self-time not meaningful."

2. **Per-trace summary header.** "Total wall: 1.4s — across 14 spans, 200ms is self-time on uninstrumented work." No CPU number per trace because we don't have a correct one.

3. **Health dashboard — service CPU tile.** Where `process.cpu.utilization` (or its derivation) is present for a service, render a small sparkline next to that service's row. Click → metric explorer scoped to that series.

## Acceptance criteria

1. Trace waterfall shows the split bar (accounted-for vs self-time) on every span; async-parent striping renders correctly on a synthetic test trace.
2. The "likely uninstrumented" badge appears on a synthetic trace designed to trigger it (a 500ms parent span with no children); does not appear on traces where each span has dense child instrumentation.
3. Per-trace summary header renders correct totals on the OTel Astronomy Shop demo (self-time only — uses span-tree math, no SDK changes required).
4. Health dashboard renders a per-service CPU tile when `process.cpu.utilization` (or derived from `process.cpu.time`) is present in `metric_point` for that service. Tile shows "—" with a "no process metrics" hover when absent.
5. `@obs/telemetry-sdk`'s `enableProcessMetrics()` (Node) results in `process.cpu.time` and `process.cpu.utilization` series being created in `metric_series` after one minute of runtime.

## Why no per-span `cpu_ms`

Earlier drafts of this RFC proposed a per-span `cpu_ms` field captured by diffing `process.cpuUsage()` across the span's lifetime. We pulled this for correctness:

- `process.cpuUsage()` returns **cumulative process CPU time at the moment of the call**.
- Diffing two readings across a span gives total CPU consumed by **the entire process** during that wall-clock window, not just by the work belonging to this span.
- For any Node server with concurrent in-flight requests (the normal case), every span's reported CPU would be approximately equal to its wall time, because the process is rarely idle. The signal is noise.

The runtimes that *do* support per-async-context CPU attribution — V8's experimental APIs, async-profiler with wall-clock mode on JVM, Go's built-in pprof — do so by labeling stack samples with the active context. That is **exactly** what RFC 0007 proposes. The honest path to "is this specific span CPU-bound?" is to ship pprof and let the flame graph answer it, not to invent a per-span field that's wrong under concurrency.

## Non-goals

- **Per-span on-CPU vs off-CPU attribution.** Out — see above. Solved by RFC 0007.
- **Off-CPU time decomposition** (waited on lock vs I/O vs GC). Solved by RFC 0007 / 0009.
- **Heap or memory annotation per span.** Defer.
- **Frontend / browser CPU.** No portable API.

## Open questions

- **Self-time threshold calibration.** The "likely uninstrumented" badge threshold (`self_ms/duration_ms > 0.7 AND duration_ms > 100ms`) needs validation against demo data before this RFC leaves draft. If too noisy, raise; if invisible, lower.
- **Persist self-time?** We don't, today. If lists like "show me all spans with high self-time across the last day" become important, we'd persist at ingest. Defer until asked.
- **Health-tile metric source priority.** When both `process.cpu.utilization` and a derived value from `process.cpu.time` are available, prefer the gauge (less math, more accurate). Document.

## Migration risk

Effectively none. No schema change. No SDK behavioral change unless the user opts into `enableProcessMetrics()`. The dashboard changes are additive — old traces still render normally.
