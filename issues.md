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

- [ ] **Non-Constant Time Verification in Session HMAC and Password Checks**
  * **Location:** [`packages/obs-collector/src/auth/dashboard-auth.ts:60`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/auth/dashboard-auth.ts#L60) & [`:183`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/auth/dashboard-auth.ts#L183)
  * **Description:** Session HMAC signature verification and login password hashes are compared using standard `===` operators.
  * **Risk:** Medium. Exposes authentication endpoints to timing side-channel attacks that can leak the signature or password.
  * **Next Action:** Replace `===` comparisons with a constant-time comparison helper like `crypto.timingSafeEqual`.

### Resolved Security Issues
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

- [ ] **Postgres Session Timeout Statement runs in Autocommit Mode**
  * **Location:** [`packages/obs-collector/src/lib/sql-db-postgres.ts:122`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/lib/sql-db-postgres.ts#L122)
  * **Description:** `SET LOCAL statement_timeout` is executed without an active transaction block.
  * **Risk:** High. Autocommit renders the statement a no-op, leaving Postgres transactions running without statement execution timeouts.
  * **Next Action:** Wrap statement timeouts in proper transaction boundaries or set timeouts at the connection pool configuration level.

- [ ] **Google API Key Leaked in URL Query Strings**
  * **Location:** [`apps/obs-demo/src/providers.ts:177`](file:///Users/sawan/projects/obs-unified/obs-unified/apps/obs-demo/src/providers.ts#L177)
  * **Description:** The Google API Key is passed directly in the URL query string, leading to leaks in system logs and telemetry spans.
  * **Risk:** High. Exposed credentials.
  * **Next Action:** Refactor to pass the Google API Key via the standard `x-goog-api-key` HTTP header.

- [ ] **Active Trace Navigation Guard blocks Deep Linking in Telemetry Dashboard**
  * **Location:** [`packages/dashboard/src/dashboards/TelemetryDashboard.tsx:356`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/dashboard/src/dashboards/TelemetryDashboard.tsx#L356)
  * **Description:** The initial-trace fetching effect is guarded by `!traceDetail`.
  * **Risk:** Medium. Navigating to a different `initialTraceId` fails, continuing to display the old trace.
  * **Next Action:** Modify the hook dependency array to correctly trigger updates when the active trace query ID changes.

- [ ] **Dashboard Replay Timeline utilizes Non-Unique React keys**
  * **Location:** [`packages/dashboard/src/dashboards/ReplayDashboard.tsx:350`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/dashboard/src/dashboards/ReplayDashboard.tsx#L350)
  * **Description:** The merged timeline key defaults to the optional `eventId`.
  * **Risk:** Medium. React key conflicts lead to misaligned DOM rendering and state attachments in the player list.
  * **Next Action:** Map timeline rows using guaranteed unique keys (e.g. index-composite or generated IDs).

### Resolved Functional Issues
- [x] **Off-by-One Floor Math in Percentile CTE Calculations**
  * *Resolution:* Reconciled and fixed in `tier0.ts` and `derive.ts` by replacing `CAST(0.99 * n AS INTEGER)` and simplified double `MAX(1, MAX(1, ...))` wrappers with standard `(99 * n + 99) / 100` nearest-rank ceil formulas.
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

- [ ] **Telemetry SDK setInterval Memory Leak**
  * **Location:** [`packages/telemetry-sdk/src/process-metrics.ts:132`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/telemetry-sdk/src/process-metrics.ts#L132)
  * **Description:** `enableProcessMetrics()` triggers new metric intervals without clearing existing ones during re-initialization or HMR runs.
  * **Risk:** Medium. Double-emitted metrics and cumulative node timer leaks.
  * **Next Action:** Track active intervals in a module-global reference and clear them on re-initialization.

- [ ] **Analytics SDK rrweb Recorder Lifespan and Cleanup Memory Leaks**
  * **Location:** [`packages/analytics-sdk/src/usage-tracker.ts:519`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/analytics-sdk/src/usage-tracker.ts#L519)
  * **Description:** The rrweb recorder and its 10-second flush intervals outlive React provider unmounts because there is no cleanup hook calling `stopReplay()`.
  * **Risk:** Medium. Leaked DOM listeners, active intervals, and lost replay events on page exits.
  * **Next Action:** Implement a cleanup callback in the React provider to trigger `stopReplay()` and flush pending events on unmount.

- [ ] **Analytics SDK Global installed flag monkey-patch leaks**
  * **Location:** [`packages/analytics-sdk/src/auto-correlate.ts:179`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/analytics-sdk/src/auto-correlate.ts#L179)
  * **Description:** Global monkey-patches on `fetch` and `XHR` are managed via a single global `installed` flag. Multiple providers or StrictMode unmounts restore global states prematurely.
  * **Risk:** Medium. Correlation headers stop transmitting silently when concurrent providers unmount.
  * **Next Action:** Use atomic ref-counters rather than boolean latches to track monkey-patch instances safely.

- [ ] **Standalone Collector SIGTERM abrupt Process termination**
  * **Location:** [`apps/collector-node/src/server.ts:103`](file:///Users/sawan/projects/obs-unified/apps/collector-node/src/server.ts#L103)
  * **Description:** On SIGTERM, the standalone node server closes the Postgres connection pool and terminates via `process.exit(0)` without closing the HTTP server handle.
  * **Risk:** Medium. Aborts active, in-flight requests during rolling deployments.
  * **Next Action:** Capture the HTTP server handle and trigger `server.close()` to drain active requests gracefully with a deadline before database connection teardowns.

- [ ] **Telemetry SDK ESM Targets Swallowed Import Crash**
  * **Location:** [`packages/telemetry-sdk/src/otel-config.ts:72`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/telemetry-sdk/src/otel-config.ts#L72)
  * **Description:** Executing `require("@opentelemetry/api")` throws in pure ESM/Worker targets, and is silently swallowed.
  * **Risk:** Medium. Swallows errors but leaves helper actions like `annotateErrorSpan` completely broken.
  * **Next Action:** Use dynamic imports `await import(...)` or standard ES import statements for ESM compliance.

- [ ] **CLI Scaffolder Directory Traversal Vulnerability**
  * **Location:** [`packages/cli/src/cli.ts:138`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/cli/src/cli.ts#L138)
  * **Description:** `scaffoldApp` resolves output paths using user input with no directory traversal checks, and proceeds even on cancelled prompt states.
  * **Risk:** Medium. Security and filesystem corruption risks (traversals like `../../x` can overwrite system files).
  * **Next Action:** Validate and sanitize the target folder paths; enforce strict boundary checks and halt execution immediately on prompt cancellation.

---

## ── P2: PERFORMANCE & SCALE ASSUMPTIONS ──

### Open Issues
- [ ] **Dashboard Onboarding counts execute expensive Full Table Substring Scan**
  * **Location:** [`packages/obs-collector/src/plugins/onboarding-routes.ts:24-27`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/plugins/onboarding-routes.ts#L24-L27)
  * **Description:** Counting interaction-tagged spans is calculated by running a `LIKE '%obs.interaction.id%'` query against the high-volume `telemetry_spans` table.
  * **Risk:** Medium/High. On production databases, this full table scan will lock database sockets and time out.
  * **Next Action:** Refactor interaction tracking to store flags in pre-indexed columns, or query only within a very short, indexed time window (e.g. last 1 hour).

- [ ] **Coarse Date-Header Time Sync in Client-Side SDK**
  * **Location:** [`packages/analytics-sdk/src/usage-tracker.ts:248-297`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/analytics-sdk/src/usage-tracker.ts#L248-L297)
  * **Description:** Time sync calculates the client-server offset by requesting `/health` and reading the HTTP `Date` header.
  * **Risk:** Medium. HTTP `Date` headers have a coarse 1-second resolution, which is too loose for millisecond-level telemetry timestamp correlation.
  * **Next Action:** Expose a precise millisecond timestamp in the `/health` endpoint response body, and run multiple RTT samples to calculate stable network latency.

- [ ] **Analytics SDK Session rotate has Observable Side Effects**
  * **Location:** [`packages/analytics-sdk/src/usage-tracker.ts:356-372`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/analytics-sdk/src/usage-tracker.ts#L356-L372)
  * **Description:** The `get sessionId` getter rotates the session and restarts the recorder on invocation.
  * **Risk:** Medium. Violates getter idempotency; consecutive reads can stamp a single batch of events with multiple, inconsistent session IDs.
  * **Next Action:** Separate state mutation from reads. Perform session rotation checks on explicit user activity ticks, and cache the session ID once per batch dispatch.

- [ ] **CPU Sparkline averages services, contradicting headline metric**
  * **Location:** [`packages/obs-collector/src/analyses/tier0.ts:516`](file:///Users/sawan/projects/obs-unified/obs-unified/packages/obs-collector/src/analyses/tier0.ts#L516)
  * **Description:** The CPU sparkline averages fleet-wide service CPU data while the main tile headline metrics report the single busiest service.
  * **Risk:** Low/Medium. Dashboard visualization displays contradictory information.
  * **Next Action:** Align both queries to calculate averages or track peak utilization consistently.

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
