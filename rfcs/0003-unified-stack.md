# RFC 0003: Unified Stack — Click to CPU Cycle

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-02
- **Updated:** 2026-05-03
- **Target:** `@obs-unified/collector`, `@obs-unified/dashboard`,
  `@obs-unified/telemetry-sdk`, `@obs-unified/analytics-sdk`
- **Children:** RFC 0004 — RFC 0009 (see [§ Child RFCs](#child-rfcs)); RFC 0010
  extends the same graph to agentic systems
- **Companion:** [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) — the
  worked example this RFC tree must satisfy, with the _any-to-any matrix_ that
  operationalizes the "≤ 2 clicks" contract

## Summary

obs-unified's name carries a thesis: a single tool that follows a user action —
a click — through every layer below it, ending at the CPU cycle that executed
because of it. Today the project ships most of the _signals_ needed to make that
real (traces, logs, replay, usage, AI calls, metrics) but does not ship the
_connective tissue_ that makes them a single chain.

This RFC is the umbrella for the work that turns the existing pile of signals
into one navigable graph from a click in `rrweb` down to a stack frame in
`pprof` (and later, a kernel event in eBPF). It does not propose new features in
isolation — it proposes the **architectural shape** that subsequent RFCs (0004
– 0009) implement piecewise.

The thesis: **the value of "unified" is not the dashboard count, it's the cost
of getting from any one signal to the signals adjacent to it.** If a user can
click a slow span and reach a flame graph in one click, the product is unified.
If they have to copy a trace ID into another tool, it isn't, no matter how many
tabs share a login.

## Motivation

Three observations from the current product:

1. **Signals exist; connections don't.** We have spans, logs, usage events, AI
   calls, metrics, replay chunks, and (per RFC 0002) Analyses. They each have
   their own dashboard. From a slow span there is no link to the replay of the
   user who triggered it; from a high-cost LLM call there is no link to the user
   session that issued it; from an alert there is no link to the spans that
   exemplify the problem. Each tab is a leaf with no edges.
2. **Profiling is the missing layer, not a missing tab.** Treating "add
   profiling" as "ship a Profiles tab" repeats the mistake. The point of
   profiling is to be the _deepest layer of an already-coherent chain_ — clicked
   from a slow span, scoped by trace ID, joined to the user's session. Building
   it as another orphan tab adds a signal but not unification.
3. **The hard part is identity, not capture.** Adding a `pprof` receiver, an
   eBPF bridge, or even a new storage engine is well-trodden ground. The thing
   nobody ships well is the consistent set of correlation keys that lets every
   signal hang on the same skeleton. Get that wrong and nothing else matters.

Existing platforms have lived through this. Datadog's "Code Hotspots,"
Honeycomb's "Bubble Up," and New Relic's "Distributed Tracing" are all the same
shape: identity propagation done well, presented as one-click navigation. The
platforms that retrofitted these onto separate tools never quite catch up. We
should not build the retrofit version.

## Non-goals

Explicitly out of scope for this RFC (some are revisited in children):

- **Picking a final storage engine.** D1 / SQLite is sufficient for the indices
  proposed here. Migration to ClickHouse/DuckDB is the subject of RFC 0008 and
  stays deferred until concrete scale pain.
- **Replacing Analyses (RFC 0002).** The narrative layer remains the synthesis
  surface. This RFC sits _under_ RFC 0002 — Analyses get better when the
  underlying chain is fully connected, but Analyses are not redesigned here.
- **Killing the per-signal tabs.** Traces / Logs / Replay / AI / Metrics remain.
  They become _entry points_ into a connected graph, not endpoints.
- **Building our own eBPF agent.** RFC 0009 documents the OTel collector front
  and pprof-emitting eBPF agents (Parca, OTel-eBPF-Profiler). We do not write
  kernel programs.
- **Multi-user / RBAC / SSO.** Out of scope; tracked separately.
- **A query language (UQL / PromQL equivalent).** Out of scope; deferred.

## Proposed shape

The architecture has three orthogonal concerns. RFCs 0004 – 0009 each take one
slice.

### The vertical: layers a click traverses

```
                    SIGNAL                    NATURAL FORMAT
┌────────────────────────────────────────────────────────────┐
│  Intent              │ inferred              │ replay+LLM  │
│  Click event         │ DOM mutation          │ rrweb       │
│  Frontend handler    │ JS function call      │ usage event │
│  XHR / fetch         │ network timing        │ usage event │
│  ─── network ───     │                       │             │
│  Backend handler     │ root span             │ span        │
│  Business logic      │ child spans           │ span tree   │
│  DB / cache / RPC    │ child spans           │ span        │
│  External (LLM, API) │ call record           │ span + AI   │
│  ─── runtime ───     │                       │             │
│  CPU execution       │ stack samples         │ pprof       │
│  Off-CPU / blocked   │ scheduler events      │ pprof off-cpu│
│  Kernel              │ syscall / network obs │ eBPF→OTLP   │
└────────────────────────────────────────────────────────────┘
```

(Edge / CDN access logs are not in scope for this RFC tree — they would be a
separate ingest path. The chain still holds without them; the trace's root span
is the entry point on our side.)

The product test: from any row, can a user reach any other row in ≤ 2 clicks
without re-entering identifiers by hand?

### The horizontal: identity propagation is the entire game

What makes the vertical traversable is that every record at every layer carries
a consistent set of correlation keys. Today we have most of them; we are missing
the bridge from a browser click to a backend trace.

| Key                              | Ties together                                        | Today                                                  | Gap                                       |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `user_id`                        | A human across sessions                              | ✅ user_profiles                                       | none                                      |
| `session_id`                     | A session across pages and traces                    | ✅ on usage / replay / spans / logs / ai_span_payloads | missing on `ai_calls` (added by RFC 0004) |
| `interaction_id`                 | One click → its rrweb chunk + the spans it triggered | ❌ does not exist                                      | **RFC 0004**                              |
| `trace_id`                       | One distributed request across services              | ✅ on spans / logs / ai_calls                          | none                                      |
| `span_id`                        | One code unit and its children                       | ✅                                                     | none                                      |
| pprof sample label `trace_id`    | A stack sample to its span                           | n/a (no profiles yet)                                  | **RFC 0007**                              |
| Beyla / eBPF span resource attrs | A kernel-observed call to its services               | n/a                                                    | **RFC 0009**                              |

`metric_point` deliberately does **not** carry `session_id` or `interaction_id`
— metrics aggregate, and tying a metric point to one click defeats the purpose.
The standard correlation primitive for metrics is **exemplars** (already
supported via `exemplars_json` per-point). Indexing exemplars for reverse lookup
is a follow-up flagged in RFC 0004.

`interaction_id` is the load-bearing piece this RFC introduces. Without it, the
chain breaks at the browser→server boundary: we know the session a span belongs
to, but not the specific click that caused it. RFC 0004 specifies it.

### The capability layers

```
┌──────────────────────────────────────────────────────────┐
│  7. Action      │ alerts → analyses → suggested fixes    │  future Analyses RFCs
├──────────────────────────────────────────────────────────┤
│  6. Present     │ navigation graph, not tabs             │  RFC 0006
├──────────────────────────────────────────────────────────┤
│  5. Synthesize  │ narrative answers (Analyses, AskBox)   │  RFC 0002
├──────────────────────────────────────────────────────────┤
│  4. Correlate   │ given any ID, materialize the chain    │  RFC 0004 + 0006
├──────────────────────────────────────────────────────────┤
│  3. Store       │ time-series + blob + correlated index  │  RFC 0008
├──────────────────────────────────────────────────────────┤
│  2. Ingest      │ one collector, many receivers, IDs     │  RFC 0007 + 0009
├──────────────────────────────────────────────────────────┤
│  1. Capture     │ SDKs + agents that propagate IDs       │  RFC 0004 + 0007
└──────────────────────────────────────────────────────────┘
```

Layers 1, 2, 5 are mostly done. **The work this RFC tree drives is concentrated
at layer 4 (correlate) and layer 6 (present)** — turning storage that already
holds the right data into a navigable graph.

## Child RFCs

Each child takes a slice. They are independently mergeable but together produce
the unified stack. Order of dependency:

| RFC                                  | Title                                   | Layer   | Depends on                                                                           |
| ------------------------------------ | --------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| [0004](0004-identity-propagation.md) | Identity propagation & `interaction_id` | 1, 2, 4 | —                                                                                    |
| [0005](0005-span-cpu-self-time.md)   | Span self-time + process CPU metric     | 1, 2, 6 | —                                                                                    |
| [0006](0006-connected-rail.md)       | Connected rail / navigation graph       | 4, 6    | 0004                                                                                 |
| [0007](0007-pprof-profiling.md)      | pprof profiling receiver                | 1, 2, 3 | — (benefits from 0004 for richer rail surfacing, but ships independently)            |
| [0008](0008-storage-interface.md)    | Storage interface refactor              | 3       | —                                                                                    |
| [0009](0009-ebpf-tracing-bridge.md)  | eBPF tracing bridge                     | 1, 2    | 0007 _only for off-CPU pprof rendering_; Beyla and hostmetrics paths are independent |

Follow-on:

| RFC                                | Title              | Layer      | Depends on       |
| ---------------------------------- | ------------------ | ---------- | ---------------- |
| [0010](0010-agent-action-graph.md) | Agent action graph | 1, 2, 4, 6 | 0004, 0006, 0008 |

## Recommended phasing

Ordered by leverage on the click-to-CPU thesis, not by code size:

1. **RFC 0004 — Identity propagation & `interaction_id`.** Small SDK change,
   large UX impact. Unlocks everything downstream.
2. **RFC 0005 — Span self-time + process CPU metric.** The cheap "where am I
   missing instrumentation?" indicator and a service-level CPU surface. Days of
   work. Note: this version no longer claims per-span CPU attribution — that's
   RFC 0007's job.
3. **RFC 0006 — Connected rail.** UI-only; no new signals. Probably the highest
   user-visible delight per week of work, _because_ the data already exists
   post-0004.
4. **RFC 0007 — pprof profiling receiver.** Function-level depth. Lands as the
   deepest layer of an already-coherent chain, never as an orphan tab.
5. **RFC 0008 — Storage interface refactor.** Defer the engine swap. But land
   the `SqlDb` adapter and `IdentityIndex` early so 0004 and 0007 are written
   against them from day one.
6. **RFC 0009 — eBPF tracing bridge.** Last, primarily as documentation +
   integration glue (Beyla, hostmetrics, OTel-eBPF-Profiler). We do not write
   kernel programs; we accept what those agents emit as OTLP / pprof.

### Demo prerequisites

Several RFCs (0004 acceptance, 0005 acceptance, the headline replay→trace UX
in 0006) reference the OTel Astronomy Shop demo. The demo currently uses
**native OTel SDKs**, not `@obs-unified/analytics-sdk` or
`@obs-unified/telemetry-sdk`. End-to-end demo verification of SDK-bound features
therefore depends on a separate prerequisite task:

- Replace the demo frontend's tracing setup with `@obs-unified/analytics-sdk`
  (gives `interaction_id`, RUM events, replay).
- Optionally add `@obs-unified/telemetry-sdk`'s `enableProcessMetrics()` to one
  or two demo backend services (gives `process.cpu.*` metrics).

This is one shared PR, separate from any of the RFCs in this tree. It does not
block ingest-side work or storage work — those can be acceptance-tested with
synthetic traffic. It does block the click-to-CPU end-to-end demo.

## Acceptance — for the umbrella

This RFC is satisfied when:

1. The complete worked journey in
   [docs/ux/click-to-cpu.md](../docs/ux/click-to-cpu.md) (Scenario A — alert →
   trace → flame graph → cohort → session → replay → trace) executes end-to-end
   on a fresh install loaded with the OTel Astronomy Shop demo, with the
   demo-SDK-integration prerequisite satisfied. Every step's Connected rail
   contents match the spec; every documented click leads exactly where the spec
   says.
2. The Scenario B walkthrough (LLM cost spike → user → replay → trace) likewise
   executes end-to-end.
3. The **any-to-any matrix** in the UX doc is realized as a Playwright test
   suite. Each `(from, to)` cell marked `≤1` in the matrix is asserted: opening
   the from-entity's detail page surfaces the to-entity in the rail, and one
   click navigates to it. Cells marked `≤2` are asserted as two-click paths.
   Cells marked `n/a` are not tested. Any cell that regresses is a release
   blocker.
4. The "informative absence" pattern (RFC 0006) is enforced: the suite includes
   synthetic cases where each rail section is empty, and asserts the section
   header and explanatory tooltip render rather than the section disappearing.

These four together make "unified" testable, not just claimed.

## Open questions resolved by children

- **Header for `interaction_id` propagation** — RFC 0004 picks bespoke
  `x-obs-interaction`. Browser propagation is two modes: automatic for sync +
  microtask within the handler frame; explicit `withInteractionContext()` for
  longer chains.
- **Per-span CPU attribution** — RFC 0005 explicitly does _not_ attempt this;
  defers to RFC 0007.
- **Trace→profile join shape** — RFC 0007 picks a `profile_trace_index` join
  table from the start (rejecting earlier "JSON array" approach for correctness
  and storage-portability).
- **Profile retention** — RFC 0007 picks: defaults to global `RETENTION_HOURS`,
  configurable via `PROFILE_RETENTION_HOURS`.
- **Storage abstraction granularity** — RFC 0008 picks: thin `SqlDb` adapter
  now, per-signal `Store` interfaces added incrementally, `IdentityIndex` for
  cross-signal joins.
- **eBPF tracing path** — RFC 0009 picks Beyla (OTLP-emitting eBPF agent) for
  spans, OTel hostmetrics for infra metrics, OTel-eBPF-Profiler / Parca-Agent
  for profiles. No monolithic "eBPF receiver" dependency.

## Why this shape, not another

Two alternatives we explicitly reject:

- **"Just adopt OpenTelemetry end-to-end and let the collector be unified for
  us."** OTel is the right wire format and we already accept it. But OTel is not
  opinionated about correlation across replay / RUM / LLM observability — those
  signals are non-standard or proprietary in the OTel world. A pure
  OTel-collector-fronted product cedes the cross-signal join story, which is the
  differentiator. We use OTel as ingest, not as the architecture.
- **"Build a single unified table (`events`) with everything in it."** Tempting,
  blows up cardinality, makes per-signal optimization impossible, and removes
  type safety from receivers. We instead keep per-signal tables + a shared
  `(project_id, session_id)` / `(project_id, trace_id)` index discipline. RFC
  0008 formalizes this.

The shape proposed here matches what mature platforms (Datadog, Honeycomb)
converged on after years. The novelty in obs-unified is the _combination_ —
APM-shape correlation extended to RUM, replay, and LLM observability in one
process.
