# Monorepo Consolidated Issue Tracking & Backlog

This document is the single, unified source of truth for all codebase issues, code smells, architectural shortcuts, and system setup tasks across the `obs-unified` workspace. 

### Status Legend
- `[ ]` **Open** — Backlog item that needs to be addressed.
- `[x]` **Completed** — Fully implemented, verified healthy, and merged.

### Aggregation Verification
- **Verified on:** 2026-05-31.
- **Current tracker of record:** this file. The prior tracker docs were consolidated and removed in commit `fdfb77e` (`docs: aggregate and consolidate all codebase trackers into issues.md`).
- **Source documents folded into this tracker:** `FUNCTIONAL_CODE_SMELLS.md`, `NON_FUNCTIONAL_CODE_SMELLS.md`, the supplemental production-readiness shortcut list, `docs/implementation/shortcuts.md`, Phase 6 demo validation notes, and setup/CI TODO work.
- **Verification method:** checked `issues.md` against the deleted source docs via `git show HEAD^:<doc>` and spot-verified stale statuses against current code.
- **Coverage note:** the initial consolidated draft was mostly an aggregation, but a few stale open items and omitted lower-level findings remained. This pass moves verified completions to resolved sections and adds explicit source-tracker carryovers below.

---

## ── P0: SECURITY & TENANT ISOLATION ──

### Open Issues

### Resolved Security Issues
- [x] **Live-Tail Websocket Bypasses Project Verification (Tenant Isolation Leak)**
  * *Resolution:* Live-tail now resolves project scope only from dashboard auth context (`X-Project-Id` via the provider fetcher) and ignores client-supplied `?projectId`. The dashboard live-tail hook uses a credentialed fetch stream instead of `EventSource` so the project header is sent consistently, and `TailHub` now validates publish and subscribe project IDs before broadcasting.
- [x] **Non-Constant Time Verification in Session HMAC and Password Checks**
  * *Resolution:* Verified `dashboard-auth.ts` now routes both session HMAC verification and password comparison through `timingSafeEqualStr`, avoiding early-exit `===` comparisons.
- [x] **Administrative Session Cookie Lacks Secure Cookie Attribute**
  * *Resolution:* Attached conditional `; Secure` cookie headers under HTTPS connections in `dashboard-auth.ts`.
- [x] **WeakMap Ingest Token Cache Reference Identity Drift**
  * *Resolution:* Unwrapped proxy-wrapped `c.env.DB` to retrieve the stable target database reference in `ingest-auth.ts`, restoring 100% Cache hit rates.
- [x] **Ingest API Key Bootstrap State Race Condition**
  * *Resolution:* Delayed setting the `bootstrapDone = true` latch until *after* the environment bootstrap query runs successfully, preventing transient errors from permanently blocking key auth.

---

## ── P1: FUNCTIONAL CORRECTNESS & DATA INTEGRITY ──

### Open Issues
### Resolved Functional Issues
- [x] **Postgres Adapter Rewrites SQLite Queries dynamically via Regular Expressions**
  * *Resolution:* Added an explicit `SqlDialect` layer with SQLite and Postgres renderers for current-time windows and JSON text extraction, attached dialect metadata to D1/Postgres adapters, and moved production store/plugin/framework queries off dynamic adapter rewrites for `datetime('now', ...)` and `json_extract(...)`. The old Postgres translator remains as a compatibility fallback for analysis SQL while runtime store paths now render native Postgres expressions directly. Added dialect rendering tests.
- [x] **Trace Summary Reconstructs Traces in JavaScript from Capped Spans**
  * *Resolution:* `TelemetryStore` now selects candidate trace IDs with SQL `GROUP BY trace_id` and status HAVING filters, then fetches all spans for those selected trace IDs before building trace summaries and issue groupings. This removes the raw `traceLimit * 50` / `issueLimit * 100` span caps that could truncate large boundary traces, and adds a regression test verifying a one-trace overview still counts all fetched child spans.
- [x] **Telemetry SDK in-Memory Spans Omit Exporter/Flush Mechanism**
  * *Resolution:* Added an OTLP trace export queue to `packages/telemetry-sdk/src/span.ts`. `initObservability()` now configures span export alongside logs and AI calls, ended request spans enqueue automatically, `flushSpans()` drains to `/v1/traces`, and `shutdownSpanExporter()` drains/stops lifecycle hooks. Updated demo, collector self-instrumentation, and generated templates to flush the SDK span queue instead of manually posting `toOtlpExportRequest()`, with regression tests for queued export and single-send behavior.
- [x] **Telemetry SDK Lacks Flush Timers and Exit Hooks**
  * *Resolution:* Added a shared flush lifecycle helper for AI calls and logs with a default 5s periodic drain, browser `pagehide` drain, Node `beforeExit` drain, cooperative SIGTERM/SIGINT drain when the host already owns signal handling, and explicit `shutdownAI()` / `shutdownLogger()` drain helpers. Added interval regression tests for sub-threshold AI and log buffers.
- [x] **Onboarding & SPA Fallback Dashboard Plugins are Unregistered**
  * *Resolution:* Registered `onboardingRoutesPlugin` and `dashboardRoutesPlugin` in `allPlugins` within `packages/obs-collector/src/index.ts`, and updated the `/dashboard/*` wildcard route fallback to serve the client-side SPA index.html directly via `c.env.ASSETS` when available.
- [x] **Narrative LLM Fallback Hardcodes Non-Existent Anthropic Model ID**
  * *Resolution:* Replaced the non-existent `"claude-haiku-4-5"` fallback Anthropic model identifier in `packages/obs-collector/src/lib/analyses-runner.ts` with `"claude-3-5-haiku-latest"`.
- [x] **Google API Key Leaked in URL Query Strings**
  * *Resolution:* Refactored `apps/obs-demo/src/providers.ts` to transmit the Gemini/Google API key via the secure, standard `x-goog-api-key` HTTP header rather than a cleartext URL query parameter.
- [x] **Off-by-One Floor Math in Percentile CTE Calculations**
  * *Resolution:* Verified `tier0.ts` and `derive.ts` now use nearest-rank ceil formulas such as `(95 * n + 99) / 100` and `(99 * n + 99) / 100`; no floor-style p95/p99 casts remain in analysis SQL.
- [x] **Dashboard Replay Timeline utilizes Non-Unique React keys**
  * *Resolution:* Added stable composite `timelineKey` values for replay events and backend trace rows; active-row matching and React keys now use the unique timeline key instead of optional `eventId`.
- [x] **Postgres Session Timeout Statement runs in Autocommit Mode**
  * *Resolution:* Verified `PostgresAdapter` now configures session-level `SET statement_timeout` once on pool `connect`, and uses `SET LOCAL` only inside explicit `BEGIN`/`COMMIT` batch transactions.
- [x] **Active Trace Navigation Guard blocks Deep Linking in Telemetry Dashboard**
  * *Resolution:* Verified the initial-trace effect now fetches when `traceDetail?.trace.traceId !== initialTraceId`, so changing the URL trace ID refreshes the detail panel.
- [x] **Missing SQLite GROUP BY in getServiceOperations**
  * *Resolution:* Removed SQLite aggregates and perform full grouping and aggregation in JavaScript.
- [x] **Slow Sessions filter understating loadTimeMs properties**
  * *Resolution:* Implemented dynamic `COALESCE` query looking up `$.loadTimeMs`, `$.load_time_ms`, and `$.durationMs`.

---

## ── P1: DELIVERY GUARANTEES & RUNTIME RELIABILITY ──

### Open Issues
### Resolved Reliability Issues
- [x] **Replay Queries Serial Fetching and Memory Buffering**
  * *Resolution:* Replay detail reads now page chunk objects with `chunkOffset`/`chunkLimit`, fetch selected R2 chunks through bounded concurrency, and return `chunks.nextChunkOffset` for range-pagination. The dashboard replay player follows those pages until complete instead of requiring one monolithic server response. Added a bounded-concurrency regression test.
- [x] **Alert Evaluator processes Rules Sequentially without Timeouts**
  * *Resolution:* Refactored alert evaluation into a bounded-concurrency batch runner with a default concurrency of 5 and per-rule timeout guard. A stuck rule now logs an error and the rest of the batch continues; regression tests cover concurrency limiting and timeout continuation.
- [x] **Telemetry SDK setInterval Memory Leak**
  * *Resolution:* `enableProcessMetrics()` now tracks the active sampler, stops any previous interval on re-initialization, and makes returned `stop()` handles idempotent.
- [x] **Standalone Collector SIGTERM abrupt Process termination**
  * *Resolution:* The standalone collector now keeps the HTTP server handle, calls `server.close()` with a 10s deadline on SIGTERM/SIGINT, then closes the Postgres pool.
- [x] **Analytics SDK rrweb Recorder Lifespan and Cleanup Memory Leaks**
  * *Resolution:* Verified `AnalyticsProvider` now calls `tracker.stopReplay()` on unmount, and `stopReplay()` clears the rrweb stop function, interval, sequence, and buffered events.
- [x] **Analytics SDK Global installed flag monkey-patch leaks**
  * *Resolution:* Verified `auto-correlate.ts` now uses `installRefCount` plus `activeCleanup`, so multiple providers/StrictMode mounts do not prematurely restore global `fetch`/XHR patches.
- [x] **Telemetry SDK ESM Targets Swallowed Import Crash**
  * *Resolution:* Verified `otel-config.ts` now imports `trace` from `@opentelemetry/api` directly and no longer uses swallowed CommonJS `require()`.
- [x] **CLI Scaffolder Directory Traversal Vulnerability**
  * *Resolution:* Verified `scaffoldApp` rejects absolute paths, parent-directory traversal, nested path separators, empty names, and cancelled prompts before writing files.

---

## ── P2: PERFORMANCE & SCALE ASSUMPTIONS ──

### Open Issues
### Resolved Performance & Scale Issues
- [x] **Dashboard Onboarding counts execute expensive Full Table Substring Scan**
  * *Resolution:* Onboarding now counts interaction-tagged spans through the denormalized indexed `interaction_id` column instead of scanning `attributes_json` with `LIKE '%obs.interaction.id%'`.
- [x] **Coarse Date-Header Time Sync in Client-Side SDK**
  * *Resolution:* `/health` now returns `serverTimeMs`; the analytics SDK samples the health endpoint three times, uses the lowest-RTT sample, and falls back to the HTTP `Date` header only when the precise body timestamp is unavailable.
- [x] **Analytics SDK Session rotate has Observable Side Effects**
  * *Resolution:* `sessionId` is now a pure getter. Session rotation and rrweb restart happen through explicit `ensureSessionCurrent()` calls at activity/flush boundaries, with a single session snapshot used per event batch.
- [x] **CPU Sparkline averages services, contradicting headline metric**
  * *Resolution:* Verified the CPU sparkline is already scoped to the current top service selected by `top_service`, matching the headline max-service metric.

---

## ── P2: GOD OBJECTS & READABILITY REFACTOR BACKLOG ──

These files are the current large-code "god object" candidates found by a line-count audit, excluding generated `.wrangler/tmp` files. They should be split only along existing runtime boundaries, with focused tests after each extraction.

- [x] **AI Dashboard combines API orchestration, filtering, charts, details, and evaluation UI**
  * **Location:** `packages/dashboard/src/dashboards/AIDashboard.tsx`.
  * **Resolution:** Split the dashboard into a 22-line tab coordinator plus `dashboards/ai/Toolbar.tsx`, `SpansView.tsx`, `SessionsView.tsx`, `ConversationPane.tsx`, and shared AI presentation helpers.

- [ ] **Identity Index owns indexing, scoring, merge logic, and persistence**
  * **Location:** `packages/obs-collector/src/lib/identity-index.ts` (~1027 lines after extracting reference types and row mappers).
  * **Risk:** Medium. Identity correctness is hard to review because matching rules, DB access, and result shaping live together.
  * **Next Action:** Split into repository/query helpers, scoring/ranking, merge-policy logic, and public orchestration.

- [x] **Action Graph Renderer mixes layout, rendering, interaction, and tooltip state**
  * **Location:** `packages/dashboard/src/components/ActionGraphRenderer.tsx`.
  * **Resolution:** Split the renderer into a 145-line state/data coordinator plus `action-graph/ActionGraphTabHeader.tsx`, `TreeTab.tsx`, `GovernanceTab.tsx`, and `DiffTab.tsx`, keeping tab-specific layout and inspectors out of the top-level component.

- [ ] **Shared types file is a cross-domain catch-all**
  * **Location:** `packages/obs-types/src/types.ts` (~1292 lines).
  * **Risk:** Low. Type ownership is unclear and domain-specific changes create broad review surfaces.
  * **Next Action:** Split into domain modules such as traces, logs, metrics, replay, AI, profiles, and alerts, then re-export from the package barrel.

- [ ] **Collector store is a monolithic repository**
  * **Location:** `packages/obs-collector/src/lib/store.ts` (~997 lines after extracting trace/issue helper functions).
  * **Risk:** Medium. Trace overview, issue, log, metric, and replay query behavior is coupled in one file.
  * **Next Action:** Extract focused stores/repositories for trace overview, issues, logs, metrics, and replay reads while preserving the public `Store` facade.

- [x] **Connected routes plugin owns graph traversal, enrichment, and HTTP responses**
  * **Location:** `packages/obs-collector/src/plugins/connected-routes.ts`.
  * **Resolution:** Moved manifest types, link builders, profile-link enrichment, and section shaping into `packages/obs-collector/src/plugins/connected-routes/manifest.ts`; the route file now focuses on HTTP dispatch and identity lookup orchestration.

- [x] **Dashboard primitives file is an oversized component kitchen sink**
  * **Location:** `packages/dashboard/src/components/primitives.tsx`.
  * **Resolution:** Split primitives by family under `packages/dashboard/src/components/primitives/*` (`layout`, `spark`, `time-series`, `lists`, `status`, `math`, `Chip`, `JsonBlock`, `Waterfall`, `ChatBubble`) and kept `primitives.tsx` as a 10-line compatibility facade.

- [ ] **OTLP decoder mixes protobuf traversal and domain normalization**
  * **Location:** `packages/obs-collector/src/otlp/decode.ts` (~855 lines).
  * **Risk:** Medium. Protocol decoding bugs are hard to isolate from app-specific normalization behavior.
  * **Next Action:** Separate raw OTLP extraction helpers from app-domain mapping for spans, logs, metrics, resources, and attributes.

- [x] **Action graph processor mixes ingestion, graph derivation, and persistence updates**
  * **Location:** `packages/obs-collector/src/plugins/action-graph-processor.ts`.
  * **Resolution:** Extracted redaction plugin registry/default redactor into `plugins/action-graph-processor/redaction.ts` and action enricher registry into `plugins/action-graph-processor/enrichers.ts`, leaving the processor focused on span transformation and persistence.

- [x] **Replay Dashboard owns filters, timelines, tables, detail panes, and fetch state**
  * **Location:** `packages/dashboard/src/dashboards/ReplayDashboard.tsx`.
  * **Resolution:** Extracted replay-specific types/utilities, the rrweb player, replay list, and event timeline into `packages/dashboard/src/dashboards/replay/*`, reducing the dashboard to session orchestration and top-level layout.

- [x] **Web app root handles routing, shell state, and dashboard composition**
  * **Location:** `apps/web/src/App.tsx`.
  * **Resolution:** Split hash routing, navigation config, persisted UI preferences, lazy dashboard module registry, and Playground into `apps/web/src/app/*`, reducing `App.tsx` to the shell and route rendering.

- [ ] **AI store combines AI session, trace, evaluation, and analytics queries**
  * **Location:** `packages/obs-collector/src/lib/ai-store.ts` (~634 lines after extracting row types and shared cost/attribute helpers).
  * **Risk:** Medium. AI query correctness is hard to review because several data products share one repository.
  * **Next Action:** Split AI sessions, spans/traces, evaluations, and derived analytics into focused query modules.

- [x] **Analytics usage tracker owns event capture, batching, replay lifecycle, and session state**
  * **Location:** `packages/analytics-sdk/src/usage-tracker.ts`.
  * **Resolution:** Extracted public tracker config, internal payload types, and browser/storage/metadata helpers into `packages/analytics-sdk/src/usage-tracker/*`; the main tracker class now owns lifecycle behavior and dispatch.

- [x] **Telemetry Dashboard trace detail and waterfall were embedded in the top-level dashboard**
  * **Location:** `packages/dashboard/src/dashboards/TelemetryDashboard.tsx`.
  * **Resolution:** Extracted trace detail UI, span tree/self-time derivation, shared telemetry types, and table/badge helpers into `packages/dashboard/src/dashboards/telemetry/*`, reducing the top-level dashboard from ~1517 to ~807 lines.

---

## ── ADDITIONAL VERIFIED COMPLETIONS FROM SOURCE TRACKERS ──

These were present in the old trackers but were either omitted from the first aggregate or already fixed before this verification pass.

- [x] **Replay receiver body/session validation**
  * *Resolution:* Verified `/v1/replays` rejects invalid JSON, unsafe `sessionId`/`visitorId`, negative or non-integer sequence numbers, and non-array events before writing object keys.
- [x] **Retention-hour parsing in AI/logs/metrics receivers**
  * *Resolution:* Verified receivers now call `getConfiguredRetentionHours(c.env.RETENTION_HOURS)` instead of bare `parseInt`.
- [x] **Users query corrupt JSON handling**
  * *Resolution:* Verified user property parsing catches JSON errors and returns `{}` instead of 500ing the users page.
- [x] **Ingest CORS allow-all default**
  * *Resolution:* Verified ingest CORS only reflects origins from `allowedOrigins`/`ALLOWED_ORIGINS`; no allow-list means no reflected origin.
- [x] **TailHub heartbeat leak and subscriber cap**
  * *Resolution:* Verified subscribe checks already-aborted requests before creating a timer and enforces `MAX_SUBSCRIBERS`.
- [x] **AI/log flush failure drops batches**
  * *Resolution:* Verified failed AI/log flushes requeue the spliced batch, bounded by `MAX_BUFFER_SIZE`.
- [x] **Telemetry SDK integer span attributes**
  * *Resolution:* Verified integer span attributes now emit proto-JSON `intValue` strings.
- [x] **Profiler final upload loss**
  * *Resolution:* Verified `startProfiler().stop()` awaits the in-flight push before returning.
- [x] **Analytics identify/replay endpoint and authorization shape**
  * *Resolution:* Verified endpoint derivation handles `/events` and `/usage`, and shared headers include `Authorization` when an API key is configured.
- [x] **Analytics session rotation resets page/once-per-session state**
  * *Resolution:* Verified session rotation clears `lastPagePath` and `onceKeys`.
- [x] **Analytics tracker rebuilds on transport config changes**
  * *Resolution:* Verified `AnalyticsProvider` rebuilds the tracker when endpoint/auth/storage primitives change.
- [x] **Telemetry empty-spans trace bar math**
  * *Resolution:* Verified waterfall math guards empty span arrays before `Math.min`/`Math.max`.
- [x] **Logs live-mode selected row mismatch**
  * *Resolution:* Verified toggling live mode clears `selectedLog`.
- [x] **Live-tail client ordering**
  * *Resolution:* Verified `useLiveTail` sorts matched events by timestamp rather than relying on server order.
- [x] **AskBox Cmd+/ toggle contract**
  * *Resolution:* Verified Cmd+/ now toggles the AskBox instead of only opening it.
- [x] **Demo item-route and observability init footguns**
  * *Resolution:* Verified demo item IDs reject `NaN`, zero, negative, and out-of-range values; observability initialization is guarded by a once flag.
- [x] **Demo AI evaluation empty-trace/empty-answer handling**
  * *Resolution:* Verified AI evaluations only post when a trace ID exists and labels fail when answers are empty.
- [x] **Non-functional parser/build/type-safety fixes**
  * *Resolution:* Verified the previous non-functional tracker's completed parser allocation, `ByteBuilder`, pool error handler, and unsafe Hono cast fixes were already merged before consolidation.
- [x] **AI session context has a module-global fallback**
  * *Resolution:* AI span context now uses `AsyncLocalStorage` without a module-global ambient fallback, preventing cross-request context bleed while preserving `setAISessionContext()` reset semantics.
- [x] **Standalone collector S3 defaults need production validation**
  * *Resolution:* Verified the standalone collector requires an explicit non-default `S3_REGION`, defaults `S3_FORCE_PATH_STYLE` to `false`, and fails startup when required S3 credentials/bucket config are missing.
- [x] **Dashboard fetch effects still lack consistent cancellation and error UI**
  * *Resolution:* `AIDashboard` and `TelemetryDashboard` now use `AbortController`-backed loaders for overview, detail, session, trace, issue, and action-graph fetches. Aborted requests no longer race stale state into the UI, and failed dashboard loads now render visible error states with retry affordances instead of only logging or swallowing errors.

---

## ── PHASE 6: DEMO INTEGRATION & VALIDATION ──

### Open Issues (Active Reconciliation Backlog)
- [ ] **6.1 - Replace OTel Browser SDK in Astronomy Shop Frontend**
  * **Location:** [`demo/upstream/src/frontend`](file:///Users/sawan/projects/obs-unified/obs-unified/demo/upstream/src/frontend) & [`docs/implementation/demo-integration.md:5-51`](file:///Users/sawan/projects/obs-unified/obs-unified/docs/implementation/demo-integration.md#L5-L51)
  * **Description:** Mount `@obs-unified/analytics-sdk` via a client wrapper (`ObsBootstrap`) inside `demo/upstream/src/frontend/src/main.tsx` using `VITE_OBS_COLLECTOR_URL` and `VITE_OBS_INGEST_KEY` to collect page views, interactions, and replay logs.
  * **Why it's pending:** Needs execution of the SDK overlay recipe on the running docker-compose stack.

- [ ] **6.2 - Add enableProcessMetrics() to Star backend services**
  * **Location:** [`apps/obs-demo`](file:///Users/sawan/projects/obs-unified/obs-unified/apps/obs-demo) & [`docs/implementation/demo-integration.md:52-76`](file:///Users/sawan/projects/obs-unified/obs-unified/docs/implementation/demo-integration.md#L52-L76)
  * **Description:** Wire the process metrics collector inside `frontend-svc` and `payment-svc` Node applications with `intervalMs: 30000` to feed the health dashboard's CPU sparklines.
  * **Why it's pending:** Needs compose-env container restarts with `OBS_COLLECTOR_URL=http://host.docker.internal:8790`.

- [ ] **6.3 - Wire dd-pprof Profiling in payment-svc**
  * **Location:** [`apps/obs-demo`](file:///Users/sawan/projects/obs-unified/obs-unified/apps/obs-demo) & [`docs/implementation/demo-integration.md:77-101`](file:///Users/sawan/projects/obs-unified/obs-unified/docs/implementation/demo-integration.md#L77-L101)
  * **Description:** Implement `setInterval` and `@datadog/pprof` in `payment-svc` to run time profiles, gzip pprof binaries, and invoke `pushProfile()` over 60s intervals with proper OTel trace_id labels.
  * **Why it's pending:** Required for Scenario A's flame graph drill-down step to resolve real container bottlenecks.

- [ ] **6.4 - Run and Verify UX Scenario A (Alert to Root Cause) End-to-End**
  * **Location:** [`docs/implementation/demo-integration.md:102-113`](file:///Users/sawan/projects/obs-unified/obs-unified/docs/implementation/demo-integration.md#L102-L113)
  * **Description:** Exercise the full click-to-CPU path: click around the demo shop, trigger an alert on the health page, open the trace, drill into the `PROFILES` badge, expand the span, and trace back to the click session via the Connected rail.
  * **Why it's pending:** Blocked on completing steps 6.1 through 6.3 on the docker-compose stack.

- [ ] **6.5 - Run and Verify UX Scenario B (LLM Cost Spike) End-to-End**
  * **Location:** [`docs/implementation/demo-integration.md:114-117`](file:///Users/sawan/projects/obs-unified/obs-unified/docs/implementation/demo-integration.md#L114-L117)
  * **Description:** Wire `@obs-unified/telemetry-sdk`'s `trackAICall` helper into the Astronomy Shop's Recommendation Service (or AI agent helper) to verify LLM cost aggregates and parent-child span associations.
  * **Why it's pending:** Needs LLM provider key mapping and endpoint integration testing.

---

## ── P2: ARCHITECTURAL SPEC DRIFT ──

### Open Issues (🟡 Active / Drift)

### Resolved Spec Drift Items
- [x] **Replay Viewer overlaps Custom Interactions List with ConnectedRail**
  * *Resolution:* Removed the standalone replay interactions panel. Replay now injects click→trace bundles as extra `ConnectedRail` related sections, keeping one relationship surface for session-scoped neighbors.
- [x] **Platform Resources Dashboard lacks UI Toggles for Linux Hosts**
  * *Resolution:* Added an explicit Cloudflare/Linux resource selector. Linux host cards render only in the Linux view, while D1/R2/Worker cards remain in the Cloudflare view.
- [x] **Active eBPF edge/SDK toggles in Service Map**
  * *Resolution:* Kept the existing `telemetry_sdk_name` source query filter and added source-aware edge presentation: eBPF edges render dashed/animated, SDK edges render solid, and health colors still override for warning/error rates.
- [x] **eBPF-derived Propagation Metric aggregates Hourly instead of Real-Time**
  * *Resolution:* Updated RFC 0004 to describe the propagation metric as a periodic retention-cron aggregate rather than a real-time per-click write, documenting the write-amplification trade-off.
- [x] **Uninstrumented-Badge Threshold lacks real calibration**
  * *Resolution:* Updated RFC 0005 and sequencing docs to mark the badge threshold as an advisory heuristic, with live-workload calibration tracked in Phase 6 validation instead of claimed as already calibrated.
- [x] **Mode A click -> fetch integration test lacks dynamic coverage**
  * *Resolution:* Added an integration test that installs Mode A auto-correlation, dispatches a trusted click, calls the patched global `fetch`, and asserts `x-obs-interaction` reaches the intercepted request headers.
- [x] **Storage Interface lacks Bun/Node BetterSqliteAdapter implementation**
  * *Resolution:* Clarified RFC 0008 that `BetterSqliteAdapter` is deliberately deferred until a Node/Bun embedded-SQLite deployment exists; the current public runtime is Cloudflare Worker/D1 and has no `better-sqlite3` dependency to exercise.
- [x] **eBPF profile ingest parsed from headers instead of blobs**
  * *Resolution:* Moved the `parse-pprof.ts` decoder into a Worker-safe path to extract trace IDs directly from sample labels at ingest.
- [x] ** startProfiler() SDK wrapper lacking auto-loop ergonomics**
  * *Resolution:* Wrapped dd-pprof sampling loops in a thin, library-agnostic `startProfiler()` helper.
- [x] **Flamegraph Server-Side Filtering by trace_id**
  * *Resolution:* Implemented server-side pprof re-serialization in `profiles/:id?trace_id=X` to return pre-filtered, smaller blobs.

---

## ── PR PIPELINE & CI SETUP TASKS ──

### Resolved CI Tasks (SETUP_TODO.md)
- [x] **Register self-hosted GitHub Actions runners**
  * *Resolution:* Registered `obs-unified`, `obs-unified-docs`, and `presence` runners, starting local runner background services successfully.
- [x] **Install full CI toolchain on runner host**
  * *Resolution:* Installed Go, Rust/Cargo, Docker CLI, Colima daemon, and ShellCheck. Verified docker compose runs.
- [x] **Implement prereq validation script check-prereqs.sh**
  * *Resolution:* Added robust validations for Node, pnpm, Go, Rust, Docker, ShellCheck, and runner status.
- [x] **Expose Docs Linting support via Biome**
  * *Resolution:* Added `@biomejs/biome` to docs dependencies, created `lint` scripts, and integrated it into the docs CI pipeline.
- [x] **Normalize pnpm ignored-build-script warnings**
  * *Resolution:* Committed frozen dependency approvals via `pnpm.onlyBuiltDependencies` for `esbuild` in both docs and presence.
- [x] **Add shell lints for CI and Skill scripts**
  * *Resolution:* Added ShellCheck checks and PR validation workflows covering `/ci` and `/obs-unified-skills` scripts.
- [x] **Create interaction fixture parity conformance test**
  * *Resolution:* Added `packages/telemetry-sdk/src/interaction-fixture-parity.test.ts` to assert inline fixtures match the conformance JSON.
- [x] **Prune unused type-import warnings from dashboard builds**
  * *Resolution:* Removed stale `IngestKey` type imports, eliminating build warnings.
- [x] **Inspect and reduce large demo web bundles**
  * *Resolution:* Lazy-loaded dashboard routes and prunes bundle sizes down below the 500kB warning threshold.
