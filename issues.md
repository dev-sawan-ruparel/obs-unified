# Monorepo Consolidated Issue Tracking & Backlog

This document is the single, unified source of truth for all codebase issues,
code smells, architectural shortcuts, and system setup tasks across the
`obs-unified` workspace.

### Status Legend

- `[ ]` **Open** — Backlog item that needs to be addressed.
- `[x]` **Completed** — Fully implemented, verified healthy, and merged.

### Aggregation Verification

- **Verified on:** 2026-05-31.
- **Current tracker of record:** this file. The prior tracker docs were
  consolidated and removed in commit `fdfb77e`
  (`docs: aggregate and consolidate all codebase trackers into issues.md`).
- **Source documents folded into this tracker:** `FUNCTIONAL_CODE_SMELLS.md`,
  `NON_FUNCTIONAL_CODE_SMELLS.md`, the supplemental production-readiness
  shortcut list, `docs/implementation/shortcuts.md`, Phase 6 demo validation
  notes, and setup/CI TODO work.
- **Verification method:** checked `issues.md` against the deleted source docs
  via `git show HEAD^:<doc>` and spot-verified stale statuses against current
  code.
- **Coverage note:** the initial consolidated draft was mostly an aggregation,
  but a few stale open items and omitted lower-level findings remained. This
  pass moves verified completions to resolved sections and adds explicit
  source-tracker carryovers below.

---

## ── P0: SECURITY & TENANT ISOLATION ──

### Open Issues

### Resolved Security Issues

- [x] **Live-Tail Websocket Bypasses Project Verification (Tenant Isolation
      Leak)**
  - _Resolution:_ Live-tail now resolves project scope only from dashboard auth
    context (`X-Project-Id` via the provider fetcher) and ignores
    client-supplied `?projectId`. The dashboard live-tail hook uses a
    credentialed fetch stream instead of `EventSource` so the project header is
    sent consistently, and `TailHub` now validates publish and subscribe project
    IDs before broadcasting.
- [x] **Non-Constant Time Verification in Session HMAC and Password Checks**
  - _Resolution:_ Verified `dashboard-auth.ts` now routes both session HMAC
    verification and password comparison through `timingSafeEqualStr`, avoiding
    early-exit `===` comparisons.
- [x] **Administrative Session Cookie Lacks Secure Cookie Attribute**
  - _Resolution:_ Attached conditional `; Secure` cookie headers under HTTPS
    connections in `dashboard-auth.ts`.
- [x] **WeakMap Ingest Token Cache Reference Identity Drift**
  - _Resolution:_ Unwrapped proxy-wrapped `c.env.DB` to retrieve the stable
    target database reference in `ingest-auth.ts`, restoring 100% Cache hit
    rates.
- [x] **Ingest API Key Bootstrap State Race Condition**
  - _Resolution:_ Delayed setting the `bootstrapDone = true` latch until _after_
    the environment bootstrap query runs successfully, preventing transient
    errors from permanently blocking key auth.

---

## ── P1: FUNCTIONAL CORRECTNESS & DATA INTEGRITY ──

### Open Issues

### Resolved Functional Issues

- [x] **Postgres Adapter Rewrites SQLite Queries dynamically via Regular
      Expressions**
  - _Resolution:_ Added an explicit `SqlDialect` layer with SQLite and Postgres
    renderers for current-time windows and JSON text extraction, attached
    dialect metadata to D1/Postgres adapters, and moved production
    store/plugin/framework queries off dynamic adapter rewrites for
    `datetime('now', ...)` and `json_extract(...)`. The old Postgres translator
    remains as a compatibility fallback for analysis SQL while runtime store
    paths now render native Postgres expressions directly. Added dialect
    rendering tests.
- [x] **Trace Summary Reconstructs Traces in JavaScript from Capped Spans**
  - _Resolution:_ `TelemetryStore` now selects candidate trace IDs with SQL
    `GROUP BY trace_id` and status HAVING filters, then fetches all spans for
    those selected trace IDs before building trace summaries and issue
    groupings. This removes the raw `traceLimit * 50` / `issueLimit * 100` span
    caps that could truncate large boundary traces, and adds a regression test
    verifying a one-trace overview still counts all fetched child spans.
- [x] **Telemetry SDK in-Memory Spans Omit Exporter/Flush Mechanism**
  - _Resolution:_ Added an OTLP trace export queue to
    `packages/telemetry-sdk/src/span.ts`. `initObservability()` now configures
    span export alongside logs and AI calls, ended request spans enqueue
    automatically, `flushSpans()` drains to `/v1/traces`, and
    `shutdownSpanExporter()` drains/stops lifecycle hooks. Updated demo,
    collector self-instrumentation, and generated templates to flush the SDK
    span queue instead of manually posting `toOtlpExportRequest()`, with
    regression tests for queued export and single-send behavior.
- [x] **Telemetry SDK Lacks Flush Timers and Exit Hooks**
  - _Resolution:_ Added a shared flush lifecycle helper for AI calls and logs
    with a default 5s periodic drain, browser `pagehide` drain, Node
    `beforeExit` drain, cooperative SIGTERM/SIGINT drain when the host already
    owns signal handling, and explicit `shutdownAI()` / `shutdownLogger()` drain
    helpers. Added interval regression tests for sub-threshold AI and log
    buffers.
- [x] **Onboarding & SPA Fallback Dashboard Plugins are Unregistered**
  - _Resolution:_ Registered `onboardingRoutesPlugin` and
    `dashboardRoutesPlugin` in `allPlugins` within
    `packages/obs-collector/src/index.ts`, and updated the `/dashboard/*`
    wildcard route fallback to serve the client-side SPA index.html directly via
    `c.env.ASSETS` when available.
- [x] **Narrative LLM Fallback Hardcodes Non-Existent Anthropic Model ID**
  - _Resolution:_ Replaced the non-existent `"claude-haiku-4-5"` fallback
    Anthropic model identifier in
    `packages/obs-collector/src/lib/analyses-runner.ts` with
    `"claude-3-5-haiku-latest"`.
- [x] **Google API Key Leaked in URL Query Strings**
  - _Resolution:_ Refactored `apps/obs-demo/src/providers.ts` to transmit the
    Gemini/Google API key via the secure, standard `x-goog-api-key` HTTP header
    rather than a cleartext URL query parameter.
- [x] **Off-by-One Floor Math in Percentile CTE Calculations**
  - _Resolution:_ Verified `tier0.ts` and `derive.ts` now use nearest-rank ceil
    formulas such as `(95 * n + 99) / 100` and `(99 * n + 99) / 100`; no
    floor-style p95/p99 casts remain in analysis SQL.
- [x] **Dashboard Replay Timeline utilizes Non-Unique React keys**
  - _Resolution:_ Added stable composite `timelineKey` values for replay events
    and backend trace rows; active-row matching and React keys now use the
    unique timeline key instead of optional `eventId`.
- [x] **Postgres Session Timeout Statement runs in Autocommit Mode**
  - _Resolution:_ Verified `PostgresAdapter` now configures session-level
    `SET statement_timeout` once on pool `connect`, and uses `SET LOCAL` only
    inside explicit `BEGIN`/`COMMIT` batch transactions.
- [x] **Active Trace Navigation Guard blocks Deep Linking in Telemetry
      Dashboard**
  - _Resolution:_ Verified the initial-trace effect now fetches when
    `traceDetail?.trace.traceId !== initialTraceId`, so changing the URL trace
    ID refreshes the detail panel.
- [x] **Missing SQLite GROUP BY in getServiceOperations**
  - _Resolution:_ Removed SQLite aggregates and perform full grouping and
    aggregation in JavaScript.
- [x] **Slow Sessions filter understating loadTimeMs properties**
  - _Resolution:_ Implemented dynamic `COALESCE` query looking up
    `$.loadTimeMs`, `$.load_time_ms`, and `$.durationMs`.

---

## ── P1: DELIVERY GUARANTEES & RUNTIME RELIABILITY ──

### Open Issues

### Resolved Reliability Issues

- [x] **Replay Queries Serial Fetching and Memory Buffering**
  - _Resolution:_ Replay detail reads now page chunk objects with
    `chunkOffset`/`chunkLimit`, fetch selected R2 chunks through bounded
    concurrency, and return `chunks.nextChunkOffset` for range-pagination. The
    dashboard replay player follows those pages until complete instead of
    requiring one monolithic server response. Added a bounded-concurrency
    regression test.
- [x] **Alert Evaluator processes Rules Sequentially without Timeouts**
  - _Resolution:_ Refactored alert evaluation into a bounded-concurrency batch
    runner with a default concurrency of 5 and per-rule timeout guard. A stuck
    rule now logs an error and the rest of the batch continues; regression tests
    cover concurrency limiting and timeout continuation.
- [x] **Telemetry SDK setInterval Memory Leak**
  - _Resolution:_ `enableProcessMetrics()` now tracks the active sampler, stops
    any previous interval on re-initialization, and makes returned `stop()`
    handles idempotent.
- [x] **Standalone Collector SIGTERM abrupt Process termination**
  - _Resolution:_ The standalone collector now keeps the HTTP server handle,
    calls `server.close()` with a 10s deadline on SIGTERM/SIGINT, then closes
    the Postgres pool.
- [x] **Analytics SDK rrweb Recorder Lifespan and Cleanup Memory Leaks**
  - _Resolution:_ Verified `AnalyticsProvider` now calls `tracker.stopReplay()`
    on unmount, and `stopReplay()` clears the rrweb stop function, interval,
    sequence, and buffered events.
- [x] **Analytics SDK Global installed flag monkey-patch leaks**
  - _Resolution:_ Verified `auto-correlate.ts` now uses `installRefCount` plus
    `activeCleanup`, so multiple providers/StrictMode mounts do not prematurely
    restore global `fetch`/XHR patches.
- [x] **Telemetry SDK ESM Targets Swallowed Import Crash**
  - _Resolution:_ Verified `otel-config.ts` now imports `trace` from
    `@opentelemetry/api` directly and no longer uses swallowed CommonJS
    `require()`.
- [x] **CLI Scaffolder Directory Traversal Vulnerability**
  - _Resolution:_ Verified `scaffoldApp` rejects absolute paths,
    parent-directory traversal, nested path separators, empty names, and
    cancelled prompts before writing files.

---

## ── P2: PERFORMANCE & SCALE ASSUMPTIONS ──

### Open Issues

### Resolved Performance & Scale Issues

- [x] **Dashboard Onboarding counts execute expensive Full Table Substring
      Scan**
  - _Resolution:_ Onboarding now counts interaction-tagged spans through the
    denormalized indexed `interaction_id` column instead of scanning
    `attributes_json` with `LIKE '%obs.interaction.id%'`.
- [x] **Coarse Date-Header Time Sync in Client-Side SDK**
  - _Resolution:_ `/health` now returns `serverTimeMs`; the analytics SDK
    samples the health endpoint three times, uses the lowest-RTT sample, and
    falls back to the HTTP `Date` header only when the precise body timestamp is
    unavailable.
- [x] **Analytics SDK Session rotate has Observable Side Effects**
  - _Resolution:_ `sessionId` is now a pure getter. Session rotation and rrweb
    restart happen through explicit `ensureSessionCurrent()` calls at
    activity/flush boundaries, with a single session snapshot used per event
    batch.
- [x] **CPU Sparkline averages services, contradicting headline metric**
  - _Resolution:_ Verified the CPU sparkline is already scoped to the current
    top service selected by `top_service`, matching the headline max-service
    metric.

---

## ── P2: GOD OBJECTS & READABILITY REFACTOR BACKLOG ──

These files are the current large-code "god object" candidates found by a
line-count audit, excluding generated `.wrangler/tmp` files. They should be
split only along existing runtime boundaries, with focused tests after each
extraction.

- [x] **AI Dashboard combines API orchestration, filtering, charts, details, and
      evaluation UI**
  - **Location:** `packages/dashboard/src/dashboards/AIDashboard.tsx`.
  - **Resolution:** Split the dashboard into a 22-line tab coordinator plus
    `dashboards/ai/Toolbar.tsx`, `SpansView.tsx`, `SessionsView.tsx`,
    `ConversationPane.tsx`, and shared AI presentation helpers.

- [x] **Identity Index owns indexing, scoring, merge logic, and persistence**
  - **Location:** `packages/obs-collector/src/lib/identity-index.ts`.
  - **Resolution:** Reduced `IdentityIndex` to a 53-line public facade and moved
    session/trace/interaction lookups, user expansion, action graph expansion,
    and shared constants into focused modules under
    `packages/obs-collector/src/lib/identity-index/`.

- [x] **Action Graph Renderer mixes layout, rendering, interaction, and tooltip
      state**
  - **Location:** `packages/dashboard/src/components/ActionGraphRenderer.tsx`.
  - **Resolution:** Split the renderer into a 145-line state/data coordinator
    plus `action-graph/ActionGraphTabHeader.tsx`, `TreeTab.tsx`,
    `GovernanceTab.tsx`, and `DiffTab.tsx`, keeping tab-specific layout and
    inspectors out of the top-level component.

- [x] **Shared types file is a cross-domain catch-all**
  - **Location:** `packages/obs-types/src/types.ts`.
  - **Resolution:** Split the 1292-line declaration file into domain modules
    under `packages/obs-types/src/types/` for primitives, OTLP, telemetry,
    usage, logs, AI, identity, replay, projects, alerts, and analyses, while
    keeping `types.ts` as a compatibility re-export barrel.

- [x] **Collector store is a monolithic repository**
  - **Location:** `packages/obs-collector/src/lib/store.ts`.
  - **Resolution:** Reduced `TelemetryStore` to a 77-line public facade and
    moved ingest, trace overview/detail, issue grouping, export,
    service-map/operations, retention, and shared trace-candidate queries into
    focused modules under `packages/obs-collector/src/lib/store/`.

- [x] **Connected routes plugin owns graph traversal, enrichment, and HTTP
      responses**
  - **Location:** `packages/obs-collector/src/plugins/connected-routes.ts`.
  - **Resolution:** Moved manifest types, link builders, profile-link
    enrichment, and section shaping into
    `packages/obs-collector/src/plugins/connected-routes/manifest.ts`; the route
    file now focuses on HTTP dispatch and identity lookup orchestration.

- [x] **Dashboard primitives file is an oversized component kitchen sink**
  - **Location:** `packages/dashboard/src/components/primitives.tsx`.
  - **Resolution:** Split primitives by family under
    `packages/dashboard/src/components/primitives/*` (`layout`, `spark`,
    `time-series`, `lists`, `status`, `math`, `Chip`, `JsonBlock`, `Waterfall`,
    `ChatBubble`) and kept `primitives.tsx` as a 10-line compatibility facade.

- [x] **OTLP decoder mixes protobuf traversal and domain normalization**
  - **Location:** `packages/obs-collector/src/otlp/decode.ts`.
  - **Resolution:** Reduced the public decoder file to an 11-line barrel and
    split request body parsing, shared OTLP value adapters, trace adaptation,
    log normalization, and metric point shaping into focused modules under
    `packages/obs-collector/src/otlp/decode/`.

- [x] **Action graph processor mixes ingestion, graph derivation, and
      persistence updates**
  - **Location:**
    `packages/obs-collector/src/plugins/action-graph-processor.ts`.
  - **Resolution:** Extracted redaction plugin registry/default redactor into
    `plugins/action-graph-processor/redaction.ts` and action enricher registry
    into `plugins/action-graph-processor/enrichers.ts`, leaving the processor
    focused on span transformation and persistence.

- [x] **Replay Dashboard owns filters, timelines, tables, detail panes, and
      fetch state**
  - **Location:** `packages/dashboard/src/dashboards/ReplayDashboard.tsx`.
  - **Resolution:** Extracted replay-specific types/utilities, the rrweb player,
    replay list, and event timeline into
    `packages/dashboard/src/dashboards/replay/*`, reducing the dashboard to
    session orchestration and top-level layout.

- [x] **Web app root handles routing, shell state, and dashboard composition**
  - **Location:** `apps/web/src/App.tsx`.
  - **Resolution:** Split hash routing, navigation config, persisted UI
    preferences, lazy dashboard module registry, and Playground into
    `apps/web/src/app/*`, reducing `App.tsx` to the shell and route rendering.

- [x] **AI store combines AI session, trace, evaluation, and analytics queries**
  - **Location:** `packages/obs-collector/src/lib/ai-store.ts`.
  - **Resolution:** Reduced `AIStore` to a 77-line facade and moved AI calls,
    span overviews, sessions, evaluations, and retention cleanup into focused
    modules under `packages/obs-collector/src/lib/ai-store/`.

- [x] **Analytics usage tracker owns event capture, batching, replay lifecycle,
      and session state**
  - **Location:** `packages/analytics-sdk/src/usage-tracker.ts`.
  - **Resolution:** Extracted public tracker config, internal payload types, and
    browser/storage/metadata helpers into
    `packages/analytics-sdk/src/usage-tracker/*`; the main tracker class now
    owns lifecycle behavior and dispatch.

- [x] **Telemetry Dashboard trace detail and waterfall were embedded in the
      top-level dashboard**
  - **Location:** `packages/dashboard/src/dashboards/TelemetryDashboard.tsx`.
  - **Resolution:** Extracted trace detail UI, span tree/self-time derivation,
    shared telemetry types, and table/badge helpers into
    `packages/dashboard/src/dashboards/telemetry/*`, reducing the top-level
    dashboard from ~1517 to ~807 lines.

---

## ── ADDITIONAL VERIFIED COMPLETIONS FROM SOURCE TRACKERS ──

These were present in the old trackers but were either omitted from the first
aggregate or already fixed before this verification pass.

- [x] **Replay receiver body/session validation**
  - _Resolution:_ Verified `/v1/replays` rejects invalid JSON, unsafe
    `sessionId`/`visitorId`, negative or non-integer sequence numbers, and
    non-array events before writing object keys.
- [x] **Retention-hour parsing in AI/logs/metrics receivers**
  - _Resolution:_ Verified receivers now call
    `getConfiguredRetentionHours(c.env.RETENTION_HOURS)` instead of bare
    `parseInt`.
- [x] **Users query corrupt JSON handling**
  - _Resolution:_ Verified user property parsing catches JSON errors and returns
    `{}` instead of 500ing the users page.
- [x] **Ingest CORS allow-all default**
  - _Resolution:_ Verified ingest CORS only reflects origins from
    `allowedOrigins`/`ALLOWED_ORIGINS`; no allow-list means no reflected origin.
- [x] **TailHub heartbeat leak and subscriber cap**
  - _Resolution:_ Verified subscribe checks already-aborted requests before
    creating a timer and enforces `MAX_SUBSCRIBERS`.
- [x] **AI/log flush failure drops batches**
  - _Resolution:_ Verified failed AI/log flushes requeue the spliced batch,
    bounded by `MAX_BUFFER_SIZE`.
- [x] **Telemetry SDK integer span attributes**
  - _Resolution:_ Verified integer span attributes now emit proto-JSON
    `intValue` strings.
- [x] **Profiler final upload loss**
  - _Resolution:_ Verified `startProfiler().stop()` awaits the in-flight push
    before returning.
- [x] **Analytics identify/replay endpoint and authorization shape**
  - _Resolution:_ Verified endpoint derivation handles `/events` and `/usage`,
    and shared headers include `Authorization` when an API key is configured.
- [x] **Analytics session rotation resets page/once-per-session state**
  - _Resolution:_ Verified session rotation clears `lastPagePath` and
    `onceKeys`.
- [x] **Analytics tracker rebuilds on transport config changes**
  - _Resolution:_ Verified `AnalyticsProvider` rebuilds the tracker when
    endpoint/auth/storage primitives change.
- [x] **Telemetry empty-spans trace bar math**
  - _Resolution:_ Verified waterfall math guards empty span arrays before
    `Math.min`/`Math.max`.
- [x] **Logs live-mode selected row mismatch**
  - _Resolution:_ Verified toggling live mode clears `selectedLog`.
- [x] **Live-tail client ordering**
  - _Resolution:_ Verified `useLiveTail` sorts matched events by timestamp
    rather than relying on server order.
- [x] **AskBox Cmd+/ toggle contract**
  - _Resolution:_ Verified Cmd+/ now toggles the AskBox instead of only opening
    it.
- [x] **Demo item-route and observability init footguns**
  - _Resolution:_ Verified demo item IDs reject `NaN`, zero, negative, and
    out-of-range values; observability initialization is guarded by a once flag.
- [x] **Demo AI evaluation empty-trace/empty-answer handling**
  - _Resolution:_ Verified AI evaluations only post when a trace ID exists and
    labels fail when answers are empty.
- [x] **Non-functional parser/build/type-safety fixes**
  - _Resolution:_ Verified the previous non-functional tracker's completed
    parser allocation, `ByteBuilder`, pool error handler, and unsafe Hono cast
    fixes were already merged before consolidation.
- [x] **AI session context has a module-global fallback**
  - _Resolution:_ AI span context now uses `AsyncLocalStorage` without a
    module-global ambient fallback, preventing cross-request context bleed while
    preserving `setAISessionContext()` reset semantics.
- [x] **Standalone collector S3 defaults need production validation**
  - _Resolution:_ Verified the standalone collector requires an explicit
    non-default `S3_REGION`, defaults `S3_FORCE_PATH_STYLE` to `false`, and
    fails startup when required S3 credentials/bucket config are missing.
- [x] **Dashboard fetch effects still lack consistent cancellation and error
      UI**
  - _Resolution:_ `AIDashboard` and `TelemetryDashboard` now use
    `AbortController`-backed loaders for overview, detail, session, trace,
    issue, and action-graph fetches. Aborted requests no longer race stale state
    into the UI, and failed dashboard loads now render visible error states with
    retry affordances instead of only logging or swallowing errors.

---

## ── PHASE 6: DEMO INTEGRATION & VALIDATION ──

### Open Issues (Active Reconciliation Backlog)

- [x] **6.1 - Replace OTel Browser SDK in Astronomy Shop Frontend**
  - **Location:** [`demo/upstream/src/frontend`](demo/upstream/src/frontend) &
    [`docs/implementation/demo-integration.md:5-51`](docs/implementation/demo-integration.md#L5-L51)
  - **Resolution:** `pnpm demo:setup` now packs the local SDK tarballs, patches
    the upstream Next.js frontend package manifest, copies
    `demo/overlays/frontend/obs-bootstrap.tsx`, disables the upstream browser
    `FrontendTracer()` call, wraps `pages/_app.tsx` in `ObsBootstrap`, and
    injects browser-safe `NEXT_PUBLIC_OBS_*` env vars into `compose.yaml`.

- [x] **6.2 - Add enableProcessMetrics() to Star backend services**
  - **Location:** [`apps/obs-demo`](apps/obs-demo) &
    [`docs/implementation/demo-integration.md:52-76`](docs/implementation/demo-integration.md#L52-L76)
  - **Resolution:** `pnpm demo:setup` now copies
    `demo/overlays/node/obs-unified.js` into the upstream `frontend` and
    `payment` services, requires it from their existing OTel bootstrap files,
    calls `enableProcessMetrics()` with `intervalMs: 30000`, and injects
    `OBS_COLLECTOR_URL=http://host.docker.internal:8790` plus the ingest key
    into `compose.yaml`.

- [x] **6.3 - Wire dd-pprof Profiling in payment-svc**
  - **Location:** [`apps/obs-demo`](apps/obs-demo) &
    [`docs/implementation/demo-integration.md:77-101`](docs/implementation/demo-integration.md#L77-L101)
  - **Resolution:** `pnpm demo:setup` now adds `@datadog/pprof` to the upstream
    payment package, starts the SDK profiler loop from
    `demo/overlays/node/obs-unified.js`, and records active payment trace IDs
    from the gRPC handler so profile uploads can feed the trace/profile index.

- [x] **6.4 - Run and Verify UX Scenario A (Alert to Root Cause) End-to-End**
  - **Location:**
    [`docs/implementation/demo-integration.md:102-113`](docs/implementation/demo-integration.md#L102-L113)
  - **Description:** Exercise the full click-to-CPU path: click around the demo
    shop, trigger an alert on the health page, open the trace, drill into the
    `PROFILES` badge, expand the span, and trace back to the click session via
    the Connected rail.
  - **Local verification added:**
    `packages/obs-collector/src/plugins/connected-routes.test.ts` now has a
    deterministic Scenario A contract test for
    `session -> hot span -> CPU profile -> originating click`, and
    `apps/web/tests/connected-rail.spec.ts` now gates the live matrix at the
    describe level so non-live Playwright runs skip cleanly before login/setup.
  - **Verified:**
    `pnpm --filter @obs-unified/collector test -- connected-routes.test.ts`,
    `pnpm --filter @obs-demo/web test:e2e:all -- connected-rail.spec.ts`,
    `pnpm run lint`, and a live Astronomy Shop checkout against the Docker stack
    after starting Colima with 7 GiB memory.
  - **Live resolution:** `pnpm demo:setup` now makes the public demo path
    reproducible: it injects the local ingest key, keeps the upstream collector
    overlay scoped to configured exporters, copies local SDK tarballs into the
    frontend/payment Docker build contexts, raises the LLM container cap to 150
    MB, stores profiles via `PROFILES_BUCKET`, allows the local shop origin for
    browser ingest CORS, and adds a small frontend bridge so deferred React
    Query checkout calls retain the click interaction id.
  - **Live proof:** a real browser checkout at `http://localhost:8080/` produced
    trace `22042ad537b4b069567727bd5b50036b`;
    `/internal/connected/span/22042ad537b4b069567727bd5b50036b:c381c50d53d8b492`
    returned both `Click that caused this trace` with
    `click:checkout-place-order` and `🔥 Cpu profiles` linking to the payment
    CPU profile.

- [x] **6.5 - Run and Verify UX Scenario B (LLM Cost Spike) End-to-End**
  - **Location:**
    [`docs/implementation/demo-integration.md:114-117`](docs/implementation/demo-integration.md#L114-L117)
  - **Description:** Wire `@obs-unified/telemetry-sdk`'s `trackAICall` helper
    into the Astronomy Shop's Recommendation Service (or AI agent helper) to
    verify LLM cost aggregates and parent-child span associations.
  - **Local verification added:**
    `packages/obs-collector/src/plugins/connected-routes.test.ts` now has a
    deterministic Scenario B contract test for
    `heavy-spender user -> latest session -> AI trace -> originating click`,
    covering the same identity-graph pivots the live dashboard flow depends on.
  - **Verified:**
    `pnpm --filter @obs-unified/collector test -- connected-routes.test.ts`,
    `pnpm --filter @obs-demo/web test:e2e:all -- connected-rail.spec.ts`,
    `pnpm run lint`, and
    `DASHBOARD_PASSWORD=eval-password E2E_LIVE_STACK=1 pnpm --filter @obs-demo/web test:e2e:all -- scenario-b`.
  - **Live resolution:** after Colima was restarted with enough memory for the
    demo stack, Scenario B passed against the live dashboard and collector. The
    setup path now detects the local LLM provider key from env files, keeps the
    LLM service from OOM-restarting, and preserves the current ingest key across
    generated overlays.

---

## ── P2: ARCHITECTURAL SPEC DRIFT ──

### Open Issues (🟡 Active / Drift)

### Resolved Spec Drift Items

- [x] **Replay Viewer overlaps Custom Interactions List with ConnectedRail**
  - _Resolution:_ Removed the standalone replay interactions panel. Replay now
    injects click→trace bundles as extra `ConnectedRail` related sections,
    keeping one relationship surface for session-scoped neighbors.
- [x] **Platform Resources Dashboard lacks UI Toggles for Linux Hosts**
  - _Resolution:_ Added an explicit Cloudflare/Linux resource selector. Linux
    host cards render only in the Linux view, while D1/R2/Worker cards remain in
    the Cloudflare view.
- [x] **Active eBPF edge/SDK toggles in Service Map**
  - _Resolution:_ Kept the existing `telemetry_sdk_name` source query filter and
    added source-aware edge presentation: eBPF edges render dashed/animated, SDK
    edges render solid, and health colors still override for warning/error
    rates.
- [x] **eBPF-derived Propagation Metric aggregates Hourly instead of Real-Time**
  - _Resolution:_ Updated RFC 0004 to describe the propagation metric as a
    periodic retention-cron aggregate rather than a real-time per-click write,
    documenting the write-amplification trade-off.
- [x] **Uninstrumented-Badge Threshold lacks real calibration**
  - _Resolution:_ Updated RFC 0005 and sequencing docs to mark the badge
    threshold as an advisory heuristic, with live-workload calibration tracked
    in Phase 6 validation instead of claimed as already calibrated.
- [x] **Mode A click -> fetch integration test lacks dynamic coverage**
  - _Resolution:_ Added an integration test that installs Mode A
    auto-correlation, dispatches a trusted click, calls the patched global
    `fetch`, and asserts `x-obs-interaction` reaches the intercepted request
    headers.
- [x] **Storage Interface lacks Bun/Node BetterSqliteAdapter implementation**
  - _Resolution:_ Clarified RFC 0008 that `BetterSqliteAdapter` is deliberately
    deferred until a Node/Bun embedded-SQLite deployment exists; the current
    public runtime is Cloudflare Worker/D1 and has no `better-sqlite3`
    dependency to exercise.
- [x] **eBPF profile ingest parsed from headers instead of blobs**
  - _Resolution:_ Moved the `parse-pprof.ts` decoder into a Worker-safe path to
    extract trace IDs directly from sample labels at ingest.
- [x] ** startProfiler() SDK wrapper lacking auto-loop ergonomics**
  - _Resolution:_ Wrapped dd-pprof sampling loops in a thin, library-agnostic
    `startProfiler()` helper.
- [x] **Flamegraph Server-Side Filtering by trace_id**
  - _Resolution:_ Implemented server-side pprof re-serialization in
    `profiles/:id?trace_id=X` to return pre-filtered, smaller blobs.

---

## ── PR PIPELINE & CI SETUP TASKS ──

### Resolved CI Tasks (SETUP_TODO.md)

- [x] **Register self-hosted GitHub Actions runners**
  - _Resolution:_ Registered `obs-unified`, `obs-unified-docs`, and `presence`
    runners, starting local runner background services successfully.
- [x] **Install full CI toolchain on runner host**
  - _Resolution:_ Installed Go, Rust/Cargo, Docker CLI, Colima daemon, and
    ShellCheck. Verified docker compose runs.
- [x] **Implement prereq validation script check-prereqs.sh**
  - _Resolution:_ Added robust validations for Node, pnpm, Go, Rust, Docker,
    ShellCheck, and runner status.
- [x] **Expose Docs Linting support via Biome**
  - _Resolution:_ Added `@biomejs/biome` to docs dependencies, created `lint`
    scripts, and integrated it into the docs CI pipeline.
- [x] **Normalize pnpm ignored-build-script warnings**
  - _Resolution:_ Committed frozen dependency approvals via
    `pnpm.onlyBuiltDependencies` for `esbuild` in both docs and presence.
- [x] **Add shell lints for CI and Skill scripts**
  - _Resolution:_ Added ShellCheck checks and PR validation workflows covering
    `/ci` and `/obs-unified-skills` scripts.
- [x] **Create interaction fixture parity conformance test**
  - _Resolution:_ Added
    `packages/telemetry-sdk/src/interaction-fixture-parity.test.ts` to assert
    inline fixtures match the conformance JSON.
- [x] **Prune unused type-import warnings from dashboard builds**
  - _Resolution:_ Removed stale `IngestKey` type imports, eliminating build
    warnings.
- [x] **Inspect and reduce large demo web bundles**
  - _Resolution:_ Lazy-loaded dashboard routes and prunes bundle sizes down
    below the 500kB warning threshold.
