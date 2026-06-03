# RFC Implementation Status

This is the living implementation checklist for the RFC set. Keep RFCs as design
records; update this file when implementation status changes.

For the prioritized next work queue focused on helping AI agents debug faster,
see [AI debugging impact backlog](ai-debugging-impact-backlog.md).

Status legend:

- [x] Implemented and merged.
- [~] Partially implemented, or implemented but missing validation/coverage.
- [ ] Not implemented.

## Current Focus

For the current development status, prioritized execution queue, and active milestones, refer to the [AI debugging impact backlog](ai-debugging-impact-backlog.md) as the single source of truth.

## RFC 0001 — OTLP Parity

- [x] OTLP traces ingest.
- [x] OTLP logs ingest.
- [x] OTLP metrics ingest for gauge, sum, histogram, exponential histogram, and
      summary families.
- [x] Metric exemplar ingestion into `metric_exemplars`.
- [x] Metric exemplar lookup by trace and Connected Rail surfacing.
- [~] Full stock-SDK conformance remains broader than current focused fixture
      and live-loop coverage.

## RFC 0002 — Application-Aware Analyses

- [x] `analysis_results` storage and result APIs.
- [x] Health and Investigation dashboard surfaces render analysis output.
- [x] Narrative-aware investigation pages.
- [x] AskBox analysis citations and auto-pinned health panels.
- [x] Alerts can bind to analyses and use analysis narrative/result context.
- [x] Analysis, Ask, alert, AI evaluation, and eval-case responses expose
      machine-readable `EvidenceReference` pivots with routes, confidence,
      source, citations, and suggested next steps.
- [~] Rich sidecar-style analysis runtime, advanced cohort comparisons, and
      notebook-shaped investigations remain future/deeper intelligence work.

## RFC 0003 — Unified Stack

- [x] Unified trace, log, usage, replay, AI, profile, metric, and action graph
      surfaces exist in one collector/dashboard stack.
- [x] Core click-to-trace-to-profile and AI-cost-spike graph contracts have
      deterministic tests.
- [~] Live scenario proof and the full any-to-any matrix are not yet complete.

## RFC 0004 — Identity Propagation

- [x] Browser interaction IDs are minted and propagated.
- [x] Collector denormalizes `interaction_id` onto spans, logs, AI calls, and
      usage events.
- [x] IdentityIndex supports session, trace, interaction, user, action,
      agent-run, and actor lookups.
- [x] Legacy browser-originated records project into the action graph where
      possible.

## RFC 0005 — Span Self-Time & Process CPU

- [x] Trace waterfall derives and visualizes self-time.
- [x] Async-parent striping and advisory missing-instrumentation badge.
- [x] Per-trace self-time summary.
- [x] `enableProcessMetrics()` Node helper.
- [x] Health dashboard CPU sparkline/tile from process metrics.
- [x] Missing-instrumentation thresholds share one calibrated rule across
      collector/dashboard and expose a live calibration report endpoint.

## RFC 0006 — Connected Rail

- [x] `/internal/connected/:kind/:id` manifest endpoint.
- [x] Shared dashboard `ConnectedRail` component.
- [x] Informative empty states and count-link pattern.
- [x] Wired into span, log, usage/replay, AI, alert, analysis, user, action,
      agent-run, and tool-call details.
- [x] Span and AI trace rails include profile and metric exemplar evidence.
- [x] Profile is a first-class connected source: backend manifest, dashboard
      route, sampled trace/span/action pivots, and focused Playwright proof.
- [~] Live any-to-any Playwright matrix remains mostly scaffolded/skipped.

## RFC 0007 — pprof Profiling Receiver

- [x] `profile_blobs` and `profile_trace_index` migrations.
- [x] `/v1/profiles/pprof` receiver with auth, blob storage, and trace-index
      extraction.
- [x] `/internal/profiles/:id` blob read and `?trace_id=` server-side filtering.
- [x] Browser flame graph viewer.
- [x] `pushProfile()` and `startProfiler()` SDK helpers.
- [x] Retention sweep handles profile blobs and indexed rows.
- [x] Profile detail can start a connected graph from the dashboard and pivot
      through sampled traces/spans/action context.

## RFC 0008 — Storage Interface

- [x] `SqlDb` adapter pattern exists for D1 and Postgres.
- [x] Major runtime stores/plugins route through `SqlDb`, stores, or
      IdentityIndex rather than raw `c.env.DB` access.
- [x] D1/Postgres migrations exist for profile, action graph, and metric
      exemplar tables.
- [~] Additional storage engines and larger-scale analytical stores remain
      future work.

## RFC 0009 — eBPF Tracing Bridge

- [x] eBPF/hostmetrics documentation recipes.
- [x] Resources dashboard Linux hosts mode.
- [x] Service map distinguishes SDK-derived and eBPF-derived edges.
- [x] CPU and off-CPU profiles render as distinct rail sections.
- [~] Scenario C end-to-end validation is still a live-demo follow-up.

## RFC 0010 — Agent Action Graph

- [x] Action graph schema: actions, agent runs, tool calls, retrieval events,
      eval results, and artifacts.
- [x] Native TypeScript agent SDK and action context propagation.
- [x] Vercel AI and LangGraph wrappers.
- [x] MCP context inject/extract helpers.
- [x] GenAI, MCP, and OpenInference-style normalizer with deterministic fallback
      action IDs.
- [x] Action, agent-run, and tool-call details plus Connected Rail support.
- [x] Agent run replay, decision graph, profiles/guardrails section.
- [x] Tool reliability, cost attribution, autonomous review, and version diff
      aggregate routes and dashboards.
- [x] Production-to-eval storage, durable eval run records, and dashboard loop.
- [x] Raw span, log, AI-call, and profile signals link back to exact or
      trace-derived action, tool-call, eval, and agent-run context.
- [x] Action graph ingestion rejects malformed explicit action IDs, persists
      deterministic fallback IDs with fallback confidence, and preserves
      queue/async continuation parent links.
- [~] OpenAI Agents SDK wrapper remains a likely pending framework integration.
