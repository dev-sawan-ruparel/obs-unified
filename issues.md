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
- [ ] **Live-Tail Websocket Bypasses Project Verification (Tenant Isolation Leak)**
  * **Location:** [`packages/obs-collector/src/durable-objects/tail-hub.ts:41`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/durable-objects/tail-hub.ts#L41) & [`tail-routes.ts:24`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/tail-routes.ts#L24)
  * **Description:** The tail websocket subscription accepts and trusts a client-supplied `?projectId` query parameter without verifying if the authenticated session has rights to that project.
  * **Risk:** High. Any authenticated dashboard user can subscribe to other projects' real-time span and log streams by changing the URL parameter.
  * **Next Action:** Resolve project ID authorization server-side from session keys; validate `/publish` bodies, reject unauthorized subscriptions, and write multi-tenant isolation unit tests.

### Resolved Security Issues
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
- [ ] **Trace Summary Reconstructs Traces in JavaScript from Capped Spans**
  * **Location:** [`packages/obs-collector/src/lib/store.ts:457`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/lib/store.ts#L457)
  * **Description:** The `getOverview` and `getIssueOverview` queries cap spans at `traceLimit * 50` and then aggregate parent-child traces in memory.
  * **Risk:** High. Boundary traces that exceed the arbitrary span limit lose spans, causing wrong root span identification, wrong span/error counts, and broken p95 latency aggregations.
  * **Next Action:** Re-architect trace listing to aggregate traces at the database layer (via trace headers or SQL group by), then paginate traces rather than raw spans.

- [ ] **Postgres Adapter Rewrites SQLite Queries dynamically via Regular Expressions**
  * **Location:** [`packages/obs-collector/src/lib/sql-db-postgres.ts`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/lib/sql-db-postgres.ts)
  * **Description:** SQLite query syntax is translated on-the-fly to Postgres syntax by executing string regex replacements (translating `json_extract`, `strftime`, `datetime('now', ...)`).
  * **Risk:** High. Highly brittle. Query formatting changes or complex sub-queries can break the translations at runtime, and prevents writing native optimized SQL for Postgres.
  * **Next Action:** Refactor SQL compilation to use dedicated dialect files or a lightweight query builder. Maintain regex rewrites only as a secondary backward-compatibility layer.

- [ ] **Onboarding & SPA Fallback Dashboard Plugins are Unregistered**
  * **Location:** [`packages/obs-collector/src/plugins/onboarding-routes.ts`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/onboarding-routes.ts) & [`dashboard-routes.ts`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/dashboard-routes.ts)
  * **Description:** Both plugins are implemented and exported, but omitted from `allPlugins` in `index.ts`.
  * **Risk:** High. Onboarding count queries (`/internal/onboarding/counts`) return 404, and refreshing the browser on any nested SPA route under `/dashboard/*` returns 404.
  * **Next Action:** Add the plugins to `allPlugins` in `index.ts` and modify the dashboard routes fallback to serve the SPA index file directly without a hard 302 redirect.

- [ ] **Telemetry SDK in-Memory Spans Omit Exporter/Flush Mechanism**
  * **Location:** [`packages/telemetry-sdk/src/span.ts:278`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/telemetry-sdk/src/span.ts#L278)
  * **Description:** Spans accumulate in memory, but when `end()` is called, no export operation or flush is wired.
  * **Risk:** High. Captured telemetry is silently lost by default.
  * **Next Action:** Implement a background export queue, configure standard HTTP/OTLP span exporters, and verify span transmission via tests.

- [ ] **Telemetry SDK Lacks Flush Timers and Exit Hooks**
  * **Location:** [`packages/telemetry-sdk/src/ai.ts:55`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/telemetry-sdk/src/ai.ts#L55) & [`logger.ts:235`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/telemetry-sdk/src/logger.ts#L235)
  * **Description:** AI telemetry and logger SDKs only flush once a count threshold is hit. There are no flush timers or process exit/shutdown hooks.
  * **Risk:** High. Sub-threshold traces, logs, and events are permanently lost when a process exits, a container redeploys, or a short-lived script terminates.
  * **Next Action:** Add periodic flush intervals (e.g., 5 seconds) and listen to `process.on('beforeExit' / 'SIGTERM')` and browser `pagehide` events to drain queues.

- [ ] **Narrative LLM Fallback Hardcodes Non-Existent Anthropic Model ID**
  * **Location:** [`packages/obs-collector/src/lib/analyses-runner.ts:337`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/lib/analyses-runner.ts#L337)
  * **Description:** The Anthropic model config defaults to `"claude-haiku-4-5"`. This model does not exist in the Anthropic API.
  * **Risk:** High. Causes all Anthropic-backed narrative runs to crash with 404 HTTP errors.
  * **Next Action:** Update the default Anthropic fallback model ID to a valid model (such as `"claude-3-5-haiku-latest"` or `"claude-3-haiku-20240307"`).

- [ ] **Google API Key Leaked in URL Query Strings**
  * **Location:** [`apps/obs-demo/src/providers.ts:177`](file:///Users/sawan/projects/obs-unified/obs-unified/apps/obs-demo/src/providers.ts#L177)
  * **Description:** The Google API Key is passed directly in the URL query string, leading to leaks in system logs and telemetry spans.
  * **Risk:** High. Exposed credentials.
  * **Next Action:** Refactor to pass the Google API Key via the standard `x-goog-api-key` HTTP header.

### Resolved Functional Issues
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
- [ ] **Replay Queries Serial Fetching and Memory Buffering**
  * **Location:** [`packages/obs-collector/src/plugins/replay-query-routes.ts:60`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/replay-query-routes.ts#L60)
  * **Description:** Replay chunks are fetched sequentially using `await` inside a synchronous loop, fully parsed, flattened, and returned as a single JSON response.
  * **Risk:** High. Heavy network latency. Large replays consume extreme memory, triggering OOM evictions and script execution timeouts.
  * **Next Action:** Fetch R2/S3 chunks in parallel using bounded concurrency, and implement streaming or range-pagination for large replay sessions.

- [ ] **Alert Evaluator processes Rules Sequentially without Timeouts**
  * **Location:** [`packages/obs-collector/src/plugins/alerts-evaluator.ts:109-112`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/alerts-evaluator.ts#L109-L112)
  * **Description:** The rule evaluator cron awaits rules one-by-one sequentially in a single execution loop.
  * **Risk:** High. Evaluating hundreds of rules across tenant projects will exceed the execution bounds of cron handlers. A single hung query blocks the entire alert pipeline.
  * **Next Action:** Process rule evaluation concurrently with safe concurrency limits, and attach per-rule database statement timeouts and `AbortController` guards.

### Resolved Reliability Issues
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

## ── P2: ADDITIONAL OPEN BACKLOG FROM SOURCE TRACKERS ──

These lower-priority items were present in the deleted source trackers but were not represented as standalone rows in the first consolidated `issues.md` draft.

- [ ] **Dashboard fetch effects still lack consistent cancellation and error UI**
  * **Location:** `packages/dashboard/src/dashboards/AIDashboard.tsx`, `packages/dashboard/src/dashboards/TelemetryDashboard.tsx`
  * **Source:** `FUNCTIONAL_CODE_SMELLS.md` HIGH Dashboard races.
  * **Risk:** Rapid filter changes can still allow stale responses or swallowed errors in user-facing dashboards.
  * **Next Action:** Standardize abortable dashboard loaders and visible error/empty states.

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
- [ ] **Replay Viewer overlaps Custom Interactions List with ConnectedRail**
  * *Drift:* The replay session details page renders both a bespoke "Interactions" panel and a generic `ConnectedRail`, duplicating information.
  * *Next Action:* Fold the visual click-bundle interactions UX directly into `<ConnectedRail />` and deprecate the standalone panel.
- [ ] **Platform Resources Dashboard lacks UI Toggles for Linux Hosts**
  * *Drift:* Renders both Cloudflare metrics and Linux eBPF host grids together when both are present, rather than showing a dashboard selector.
  * *Next Action:* Introduce an explicit source toggle in the dashboard UI.
- [ ] **Active eBPF edge/SDK toggles in Service Map**
  * *Drift:* Filter queries by `telemetry_sdk_name` are operational but UI visual edge contrasts can be improved.
  * *Next Action:* Verify and refine eBPF edge visuals when a full composable docker-compose eBPF Beyla stack is active.
- [ ] **eBPF-derived Propagation Metric aggregates Hourly instead of Real-Time**
  * *Drift:* Aggregations run hourly inside the retention cron rather than real-time to avoid high write amplification.
  * *Next Action:* Relax the RFC wording to reflect this trade-off, or expose an on-demand `/internal/admin/run-propagation-aggregate` endpoint for immediate feedback.
- [ ] **Uninstrumented-Badge Threshold lacks real calibration**
  * *Drift:* Badges rely on starting heuristics and have not been calibrated against live traffic data to reduce noise.
  * *Next Action:* Calibrate thresholds (e.g. duration checks and child span count constraints) once live demo workloads are running.
- [ ] **Mode A click -> fetch integration test lacks dynamic coverage**
  * *Drift:* Correlation monkey-patches are verified via unit tests, but click-to-header propagation is not covered by integration tests.
  * *Next Action:* Set up `happy-dom` or JSDOM in `vitest.config.ts` to simulate clicks and fetch interceptions.
- [ ] **Storage Interface lacks Bun/Node BetterSqliteAdapter implementation**
  * *Drift:* The storage seam exists, but `BetterSqliteAdapter` has not been implemented.
  * *Next Action:* Build the adapter if a local standalone Node/Bun deployment with embedded SQLite is planned.

### Resolved Spec Drift Items
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
