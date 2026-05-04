# Implementation sequencing — RFC 0003 tree

The order to land RFCs 0004–0009. Not a project plan with dates — a dependency-aware sequence with explicit shippable units. Each unit is one PR; each phase is a coherent slice that should land before the next phase begins. **Mark units `[x]` as they ship.**

This doc is the authoritative tracker. The conversation-side TodoWrite mirrors it for in-session work.

---

## Phase 0 — Foundation (RFC 0008, minimal slice)

Land the seam early so RFCs 0004 / 0007 are written against `SqlDb` from day one, not retrofitted. **Does not migrate existing stores yet** — that's Phase 1.5.

- [ ] **0.1** Define `SqlDb` / `SqlStatement` interfaces in `packages/obs-collector/src/lib/sql-db.ts`. D1's existing shape is the model. *No store changes; no behavior changes.*
- [ ] **0.2** Implement `D1Adapter` (passthrough wrapper around `D1Database`). **Note:** `BetterSqliteAdapter` is deferred — `apps/collector` is a Cloudflare Worker; there is no Node entry today and no `better-sqlite3` dependency in the workspace. Building a Node adapter for a runtime nothing uses is speculative scope.
- [ ] **0.3** Add `sqlDb?: SqlDb` to `CollectorConfig` in `framework/collector.ts`. Default to `new D1Adapter(env.DB)`.
- [ ] **0.4** `MemSqlDb` test double in `lib/test-utils/mem-sql-db.ts`. Replace the hand-rolled `FakeDb` in `stage6.test.ts` to validate the test seam.

**Exit criteria:** all existing tests still pass; `sqlDb` is settable via `CollectorConfig`; `MemSqlDb` works in one test.

---

## Phase 1 — Identity propagation (RFC 0004)

The load-bearing change. Once this lands, every downstream RFC's UX claims become testable. Many sub-units; ship in order.

- [ ] **1.1** Migration `027_identity_propagation.sql` — `interaction_id` column on `telemetry_spans`, `logs`, `usage_events`, `ai_calls`, `ai_span_payloads`; `session_id` on `ai_calls`; partial indices.
- [ ] **1.2** `@obs/analytics-sdk` — handler stack (push on click/submit/keydown, pop on return); ULID minting; `currentInteractionId()` / `withInteractionContext()` exports.
- [ ] **1.3** `@obs/analytics-sdk` — global `fetch` and `XMLHttpRequest` patch behind `autoCorrelate` prop (default true). Inject `x-obs-interaction` header. *Greenfield work — the SDK has never patched user `fetch` before.*
- [ ] **1.4** `@obs/analytics-sdk` — React `useAnalytics().withInteraction(handler)` helper. Snapshot ID at click time; restore inside the handler.
- [ ] **1.5** `@obs/analytics-sdk` — attach `currentInteractionId()` to rrweb event meta payloads.
- [ ] **1.6** `@obs/telemetry-sdk` — middleware reads `x-obs-interaction`, attaches to root span as a top-level field (not a span attribute).
- [ ] **1.7** Collector receivers persist `interaction_id` on each of the 5 tables. Stores updated to use Phase 0's `SqlDb`.
- [ ] **1.8** `obs.interaction.propagation` metric — emitted as a standard OTel counter with `(signal, propagated)` attributes. Health surface tile shows ratio per signal.
- [ ] **1.9** `/internal/timeline/:sessionId` — add `groups` field keyed by `interaction_id`, each bundling click + caused traces + related events. Flat `events` list stays for backwards compat.
- [ ] **1.10** Replay event detail in dashboard — render "Trace caused by this click" link when `interaction_id` matches a span; otherwise informative-absence.

**Exit criteria:** Mode A and Mode B unit tests pass; synthetic click → fetch → backend span carries matching `interaction_id`; timeline returns grouped view; metric appears in `metric_point`.

---

## Phase 1.5 — Storage refactor backfill (RFC 0008, second slice)

Once Phase 0 + 1 establish the `SqlDb` pattern is real, mechanically migrate the rest. Can run in parallel with Phase 2 if a second pair of hands is available.

- [ ] **1.5.1** Refactor each `*-store.ts` constructor to take `SqlDb` instead of `D1Database`. One PR per store is fine (8 stores). No SQL changes.
- [ ] **1.5.2** Migrate the ~45 direct `c.env.DB.prepare(...)` call sites in plugins to go through their respective stores or through `IdentityIndex`.
- [ ] **1.5.3** Implement `IdentityIndex` (`bySession`, `byTrace`, `byInteraction`, `byUser`) — the cross-signal helper. Refactor `/internal/timeline/:sessionId` to use it.

**Exit criteria:** `c.env.DB` is referenced only inside framework adapter wiring; `grep -rn 'c.env.DB' src/plugins` returns nothing.

---

## Phase 2 — Span self-time + process CPU (RFC 0005)

UI-only work plus optional SDK helper. Independent of Phase 1; can start in parallel after Phase 0.

- [ ] **2.1** Trace waterfall in `TelemetryDashboard.tsx` — split bar visualization (accounted-for vs self-time) per span.
- [ ] **2.2** Async-parent striping for spans where `self_ms < 0` after clamp.
- [ ] **2.3** Per-trace summary header — "Total wall: 1.4s — across 14 spans, 200ms self-time."
- [ ] **2.4** "Likely uninstrumented" badge with calibrated threshold. *Calibrate against Astronomy Shop demo before merge — adjust if spammy.*
- [ ] **2.5** `@obs/telemetry-sdk` — `enableProcessMetrics()` Node helper wrapping `@opentelemetry/instrumentation-runtime-node`.
- [ ] **2.6** Health dashboard — per-service CPU sparkline tile when `process.cpu.utilization` is in `metric_point`.

**Exit criteria:** waterfall visually distinguishes self-time on synthetic traces; badge fires on synthetic uninstrumented test case and not on dense ones; one demo service emits `process.cpu.*`.

---

## Phase 3 — Connected rail (RFC 0006)

The UX shape. Depends on Phase 1 (interaction_id) for full power; can ship Phase-0-only sections earlier if desired. Per-surface PRs.

- [ ] **3.1** Manifest endpoint `/internal/connected/:kind/:id` for `span`, `log`, `usage`, `ai_call`, `replay`, `alert`, `analysis`. Built on `IdentityIndex` from Phase 1.5.3.
- [ ] **3.2** `<ConnectedRail />` component in `@obs/dashboard` with the four-section structure (Up / Across / Down / Related).
- [ ] **3.3** Empty-state copy + tooltips per section per entity kind. *Load-bearing — see RFC 0006.*
- [ ] **3.4** Count-link pattern for sections with ≥ 5 neighbors. Hover preview of first 3.
- [ ] **3.5** Wire into `TelemetryDashboard`'s span drawer (highest-traffic surface first).
- [ ] **3.6** Wire into `LogsDashboard` log drawer.
- [ ] **3.7** Wire into `ReplayDashboard` event detail (closes the click→trace loop).
- [ ] **3.8** Wire into `AIDashboard` AI-call detail.
- [ ] **3.9** Wire into `AlertsDashboard` alert detail.
- [ ] **3.10** Wire into `InvestigationsDashboard` analysis detail.
- [ ] **3.11** Add "no orphan detail pages" rule to `CONTRIBUTING.md` / `CLAUDE.md`.

**Exit criteria:** all 7 detail surfaces have the rail; no surface is a dead end; empty sections render explanations.

---

## Phase 4 — pprof profiling receiver (RFC 0007)

Function-level depth. Depends on Phase 0 (`SqlDb`) and benefits from Phase 1 (richer rail surfacing). Phase 4 PRs are large; split conservatively.

- [ ] **4.1** Migration `028_profile_blobs.sql` — `profile_blobs` + `profile_trace_index` tables and indices.
- [ ] **4.2** Add `PROFILES_BUCKET?: R2Bucket` to `framework/env.ts` (next to existing `REPLAYS_BUCKET`).
- [ ] **4.3** `POST /v1/profiles/pprof` receiver — auth, decode, write blob to R2/fs, parse pprof, populate `profile_trace_index` per distinct `trace_id` label.
- [ ] **4.4** `GET /internal/profiles/:id` — proxy R2/fs read, return the full blob.
- [ ] **4.5** `GET /internal/profiles/:id?trace_id=…` — server-side pre-filter for blobs > 500 KB. Re-serializes pprof with only matching samples.
- [ ] **4.6** Trace → profile join query; 🔥 badge on spans whose `trace_id` is in `profile_trace_index`.
- [ ] **4.7** Flame graph viewer (client-side, ~200 LOC SVG or small OSS lib). Filter by `trace_id` when scoped from a span.
- [ ] **4.8** `@obs/telemetry-sdk` — `startProfiler({ type: 'cpu' })` helper wrapping `@datadog/pprof`. Our wrapper labels each sample with the active OTel `trace_id`.
- [ ] **4.9** Profile entity in `<ConnectedRail />` (Phase 3).
- [ ] **4.10** Retention sweep extends to profile blobs + cascades `profile_trace_index` rows.
- [ ] **4.11** Per-language docs — `runtime/pprof` (Go), `pyroscope-python` (Python), `pyroscope-java` (JVM). Single `/v1/profiles/pprof` endpoint for all.

**Exit criteria:** Node service running `startProfiler` produces blobs; trace waterfall shows 🔥 on covered spans; click renders flame graph in < 500 ms for ≤ 500 KB profiles.

---

## Phase 5 — eBPF tracing bridge (RFC 0009)

Documentation-heavy. Mostly unblocks itself once Phase 4 ships off-CPU profile rendering.

- [ ] **5.1** `docs/howto/ebpf.md` — three independent recipes (Beyla, OTel `hostmetricsreceiver`, OTel-eBPF-Profiler / Parca-Agent).
- [ ] **5.2** `ResourcesDashboard` — "Linux hosts" mode, auto-detected from presence of `system.cpu.*` metrics in `metric_point`.
- [ ] **5.3** Service map filter — toggle SDK-derived vs eBPF-derived edges via `telemetry.sdk.name = "beyla"` resource attribute.
- [ ] **5.4** Off-CPU pprof rendering — different color scheme; rail surfaces both CPU and off-CPU profiles separately.
- [ ] **5.5** `Scenario C — futex contention` worked example added to `docs/ux/click-to-cpu.md`. Validates eBPF integration end-to-end.

**Exit criteria:** demo with Beyla + hostmetrics + OTel-eBPF-Profiler running shows generic Linux host metrics, eBPF-derived edges, off-CPU profiles. Scenario C runs end-to-end.

---

## Phase 6 — Demo prerequisites + final validation

The demo currently uses native OTel SDKs. Several RFC acceptance criteria need our SDKs running in the demo. Land last so we validate against the assembled stack, not against synthetic harnesses.

- [ ] **6.1** Replace OTel browser SDK in Astronomy Shop frontend (`demo/upstream/...`) with `@obs/analytics-sdk`. Wires up `interaction_id`, RUM events, replay.
- [ ] **6.2** Add `enableProcessMetrics()` to one or two demo backend services (frontend-svc, payment-svc — the ones the UX scenarios star).
- [ ] **6.3** Optional: configure `@datadog/pprof` via `startProfiler` on those two services so the demo has profiles to drill into.
- [ ] **6.4** Run UX Scenario A (alert → root cause) end-to-end. Capture a screencast.
- [ ] **6.5** Run UX Scenario B (LLM cost spike) end-to-end. Capture a screencast.
- [ ] **6.6** Wire the any-to-any matrix into a Playwright suite (RFC 0003 acceptance criterion 3).
- [ ] **6.7** Update `docs/comparison/uptrace.md` with the now-shipped capabilities — remove the "❌ planned" markers that became "✅."

**Exit criteria:** Both UX scenarios reproducible from a fresh install. Playwright matrix green. Comparison doc reflects reality.

---

## Branching strategy

This is too big for one branch. Suggested approach:

- **Long-lived integration branch:** `feat/unified-stack`. Each phase merges into it.
- **Phase-level feature branches:** `feat/unified/phase-0-sqldb`, `feat/unified/phase-1-interaction-id`, etc. Each phase merges to the integration branch.
- **Unit-level PRs:** the `[ ]` items above. Each PR is small and reviewable; they merge into their phase branch.

Integration branch merges to `main` after each phase passes its exit criteria. We don't wait until everything is done — Phase 0's `SqlDb` plus a few stores migrated is genuinely shippable on its own, as is Phase 2 (UI-only self-time work).

## How to use this doc

- Check off `[x]` as items merge to `main` (not when they merge to phase branch).
- Add follow-ups in-line as discovered. Don't grow the scope per phase silently — if something material comes up, open a new RFC or extend an existing one before adding to the plan.
- The TodoWrite list in the active conversation mirrors the *current* phase's items. The document is the master.
