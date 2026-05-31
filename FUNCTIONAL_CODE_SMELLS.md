# Functional Code Smell Review — obs-unified

> Scope: all non-test, non-generated TypeScript/JS source across `packages/obs-collector`, `packages/telemetry-sdk`, `packages/analytics-sdk`, `sdks/node`, `packages/dashboard`, `apps/*`, and `packages/cli`/`packages/pprof-decoder`.
> Focus: **functional** defects (behavioral/correctness) only — not style, naming, or formatting.
> Date: 2026-05-30
> Todo status: unchecked bullets are open; checked bullets are fixed and include the commit that closed them.

---

## Cross-cutting patterns (themes behind most findings)

1. **Truncated/aggregate SQL feeding "exact-looking" stats** — queries `LIMIT` rows then compute counts/percentiles in JS, so numbers are wrong whenever volume exceeds the cap.
2. **Off-by-one percentile math** — `floor(0.95·n)` / `CAST(0.95·n AS INT)` understates p95/p99 on small-to-medium windows, which feeds alert thresholds.
3. **Fire-and-forget telemetry with no flush-on-exit** — SDK buffers never drain on shutdown/tab-close; on network failure the batch is dropped rather than retried.
4. **Module-global mutable state under concurrency** — request contexts, install-once latches, and caches that clobber across tenants/requests or leak unbounded.
5. **React fetch effects without cancellation** — out-of-order responses overwrite newer state; several effects also leak listeners/players/intervals.
6. **Unvalidated external input** — request bodies, env vars, headers, CLI args, and protobuf lengths used without guards (NaN, 500s, path traversal, buffer overrun).

---

## HIGH severity

### Wrong data / aggregation
- [x] **`packages/obs-collector/src/lib/store.ts:1157`** — `getServiceOperations` mixes bare aggregates (`COUNT(*)`, `SUM`) with non-aggregated columns and **no `GROUP BY`**, so SQLite collapses to a single row → the operations drawer is computed from one span. *(Fixed: Removed SQLite aggregates and perform full grouping/aggregation in JS; verified by connected-routes.test.ts)*
- **`packages/obs-collector/src/lib/store.ts:457`** — `getOverview` caps spans at `traceLimit*50` then reconstructs traces in JS; boundary traces lose spans/root, corrupting `spanCount`/`errorRate`/`p95`. Same shape in `getIssueOverview`.
- [x] **`packages/obs-collector/src/lib/usage-store.ts:496`** — "slow sessions" filter reads only `$.loadTimeMs` while ingest accepts `load_time_ms`/`durationMs` too → slow sessions silently excluded. *(Fixed: Implemented dynamic COALESCE lookup on $.loadTimeMs, $.load_time_ms, and $.durationMs in the query; verified by connected-routes.test.ts)*
- **`packages/obs-collector/src/analyses/tier0.ts:283`** (and `derive.ts`, `investigations.ts`) — percentile CTE uses `CAST(0.95·n AS INT)` (floor) instead of nearest-rank ceil → **p95/p99 understated**, causing missed warn/critical alerts. On windows under 20 spans the "tail" degenerates to a single row.
- **`packages/obs-collector/src/lib/analyses-runner.ts:337`** — Narrative LLM fallback hardcodes the default Anthropic model ID as `"claude-haiku-4-5"`. This model does not exist in Anthropic's API, causing all downstream narrative generation attempts to fail with a 404 error unless explicitly overridden by the `NARRATIVE_MODEL` environment variable.

### Postgres correctness
- **`packages/obs-collector/src/lib/sql-db-postgres.ts:122`** — `SET LOCAL statement_timeout` runs with no surrounding transaction (autocommit), so it's a **no-op** — the 30s query timeout never applies on Postgres. The value is also string-interpolated, not validated.

### Auth / tenant isolation
- **`packages/obs-collector/src/auth/dashboard-auth.ts:60`** — session HMAC verified with plain `===` (non-constant-time); same for the login password check at `:183`. Timing side-channel.
- **`packages/obs-collector/src/durable-objects/tail-hub.ts:41`** — TailHub `/subscribe` trusts a client-supplied `?projectId`; `tail-routes.ts:24` forwards it verbatim → any authenticated dashboard user can bypass the selected/validated project and stream another project's live spans/logs. `/publish` body is unvalidated → 500 on malformed input.
- [x] **`packages/obs-collector/src/auth/ingest-auth.ts:58`** — `bootstrapDone = true` is set *before* `bootstrapEnvKey` runs and the error is swallowed; one transient DB error permanently disables legacy-key auth for the isolate (intermittent 401s after cold start). *(Fixed: Latched bootstrapDone to true only after successful bootstrapEnvKey completion; verified in ingest auth code paths)*

### Dead / unregistered logic
- **`packages/obs-collector/src/plugins/onboarding-routes.ts`** & **`dashboard-routes.ts`** — both plugins are exported but never added to `allPlugins`/`createDefaultCollectorApp` → `/internal/onboarding/counts` 404s, and the `/` redirect + `/dashboard/*` SPA fallback never mount (client routes 404 on refresh).

### Telemetry SDK data loss
- **`packages/telemetry-sdk/src/span.ts:278`** — spans accumulate in memory but nothing ever exports them; **no exporter/flush is wired to `end()`** → traces never reach the collector unless the host manually serializes.
- **`packages/telemetry-sdk/src/ai.ts:55`** & **`logger.ts:235`** — flush only fires on a count threshold; no timer and no `beforeExit`/SIGTERM hook → sub-threshold logs/AI calls are lost on shutdown.
- **`packages/telemetry-sdk/src/process-metrics.ts:132`** — documented as idempotent but each call starts a new `setInterval` without clearing the old → double-emitted metrics + leaked timer on re-init/HMR.

### Analytics SDK data loss / leaks
- **`packages/analytics-sdk/src/usage-tracker.ts:519`** — rrweb recorder + 10s flush interval can outlive React provider unmount because the provider never calls the tracker's `stopReplay()` cleanup, and there's no `pagehide`/`beforeunload` flush → leaked listeners/timer and replay events lost on tab close.
- **`packages/analytics-sdk/src/usage-tracker.ts:354`** — the `get sessionId` accessor has **side effects** (rotates session, restarts recorder) and is read multiple times per event → reentrancy and events tagged with inconsistent session IDs within one batch.
- **`packages/analytics-sdk/src/react/provider.tsx:50`** — `history.pushState` monkey-patch isn't guarded against nested/StrictMode double-install → duplicate `page_view` dispatches and a stale wrapper left on `history` after unmount.

### Decoder safety
- **`packages/pprof-decoder/src/index.ts:84`** — `skipField` advances `pos` by fixed/length sizes with **no bounds check**, and `len`-derived loop ends (`:138`, `:174`) aren't validated against buffer length → malformed pprof desyncs field boundaries / over-allocates instead of erroring cleanly.

### App entrypoints
- **`apps/collector-node/src/server.ts:103`** — HTTP server handle discarded; SIGTERM closes the pg pool and `process.exit(0)` without `server.close()` → in-flight requests aborted, no drain.
- **`apps/obs-demo/src/providers.ts:177`** — Google API key passed in the URL query string → leaks into logs **and into the telemetry spans wrapping the call**. Use the `x-goog-api-key` header.

### Dashboard races
- **`packages/dashboard/src/dashboards/AIDashboard.tsx:208`** & **`TelemetryDashboard.tsx:331`** — load effects `setState` with no cancellation; rapid filter changes let a stale response overwrite newer data. Errors swallowed (`catch {}` / `console.error` only), no error UI.
- **`packages/dashboard/src/dashboards/ReplayDashboard.tsx:350`** — merged timeline uses non-unique/optional `eventId` as the React key → wrong/multiple rows highlight and DOM state attaches to the wrong entry.

---

## MEDIUM severity

### Collector
- **`packages/obs-collector/src/lib/ai-store.ts:478`** — session-preview query has no `LIMIT`/window-to-selected-sessions → loads the whole table to keep one preview per session.
- **`packages/obs-collector/src/lib/analyses-runner.ts:225`** — narrative LLM call has no timeout/`AbortController`; one hung provider stalls the bounded-concurrency batch, lease expires, tick produces no rows. (No timeout anywhere in `llm.ts`/`openai.ts`/`ask.ts`.)
- **`packages/obs-collector/src/lib/openai.ts:363`** & **`ask.ts:188`** — a `max_tokens`/`length`-truncated answer is returned as a complete answer with `error: null`.
- **`packages/obs-collector/src/plugins/replay-receiver.ts:11`** — replay body unvalidated; `sessionId` flows into the R2 object key (path traversal via `/`/`..`) and into an `ON CONFLICT` upsert (corrupts on `undefined`).
- **`packages/obs-collector/src/plugins/replay-query-routes.ts:60`** — fetches all chunks serially into memory; `list()` isn't paginated → >1000 chunks silently truncated.
- **AI/logs/metrics receivers** (`ai-receiver.ts:34`, `logs-receiver.ts:51`, `metrics-receiver.ts:49`) — bare `parseInt(RETENTION_HOURS)` → NaN `expiresAt` → ingest 500 or bad expiry. Other routes use the validated `getConfiguredRetentionHours`.
- **`packages/obs-collector/src/plugins/users-query-routes.ts:27`** — unguarded `JSON.parse(properties_json)` → one corrupt row 500s the whole users page.
- **`packages/obs-collector/src/framework/collector.ts:238`** — when no allow-list is configured, CORS reflects the request `Origin` (allow-all by default) on ingest endpoints.
- **`packages/obs-collector/src/durable-objects/tail-hub.ts:73`** — heartbeat `setInterval` started before the abort listener is attached; an already-aborted subscribe leaks the timer/writer. No subscriber cap.
- **`packages/obs-collector/src/analyses/tier0.ts:516`** — CPU sparkline averages across all services per minute while the headline reports the single busiest service → chart contradicts the number.

### Telemetry / analytics SDK
- **`packages/telemetry-sdk/src/ai-spans.ts:36`** — session/user context is a module global; concurrent requests stamp AI spans with the wrong `user.id`/`session.id` (the agent path correctly uses `AsyncLocalStorage`).
- **`packages/telemetry-sdk/src/ai.ts:60`** & **`logger.ts:60`** — on flush failure the spliced batch is dropped, not re-queued.
- **`packages/telemetry-sdk/src/span.ts:23`** — integer span attributes emitted as JSON numbers; proto-JSON int64 must be a string (logger.ts does this correctly) → collector may drop/misread.
- **`packages/telemetry-sdk/src/profile.ts:185`** — `stop()` discards the in-flight push it claims callers may want to await (`void inFlight`), so shutdown can lose the final pprof upload.
- **`packages/telemetry-sdk/src/otel-config.ts:72`** — `require("@opentelemetry/api")` in an ESM/Workers target throws and is swallowed → `annotateErrorSpan` is a silent no-op exactly where it's meant to run.
- **`packages/analytics-sdk/src/usage-tracker.ts:432`** — `endpoint.replace("/events","")` no longer matches the new `/v1/usage` shape → identify/replay POST to wrong URLs, and they omit the `Authorization` header (only `dispatch` adds it).
- **`packages/analytics-sdk/src/auto-correlate.ts:179`** — module-global `installed` flag: with two providers/StrictMode the first unmount restores global `fetch`/XHR while the second still expects patching → correlation headers silently stop. Interaction stack pop-by-top (`:97`) can pop the wrong id when interactions overlap.
- **`packages/analytics-sdk/src/usage-tracker.ts:311`** — session rotation doesn't reset `lastPagePath`/`onceKeys` → new session's first page view / once-per-session events suppressed.
- **`packages/analytics-sdk/src/react/provider.tsx:32`** — tracker built from first-render config and never updated → runtime `apiKey`/`collectorUrl` changes ignored.

### Dashboard
- **`packages/dashboard/src/dashboards/TelemetryDashboard.tsx:356`** — initial-trace effect guarded on `!traceDetail`, so navigating to a different `initialTraceId` keeps showing the old trace.
- **`packages/dashboard/src/dashboards/TelemetryDashboard.tsx:817`** — `Math.min(...[])`/`Math.max(...[])` on an empty-spans trace → `Infinity`/`NaN%` bar math.
- **`packages/dashboard/src/dashboards/ReplayDashboard.tsx:171`** — rrweb player effect never removes its `ui-update-current-time` listener / never `.destroy()`s the player; rebuilds on dep churn. Session fetches (`:281`) lack cancellation; `catch {}`.
- **`packages/dashboard/src/dashboards/LogsDashboard.tsx:404`** — `selectedLog` persists across `liveMode` toggle while the list swaps sources → highlight/drawer point at the wrong record.
- **`packages/dashboard/src/hooks/useLiveTail.ts:77`** — relies on `matched.reverse()` + server ordering instead of sorting by timestamp → out-of-order rows around pause/resume.
- **`apps/web/src/App.tsx:406`** — `#/users` (no id) and any unknown hash render a blank `<main>` (no fallback).
- **`packages/dashboard/src/components/AskBox.tsx:31`** — Cmd+/ always opens, never toggles (diverges from its documented contract).

### Apps / CLI
- **`apps/obs-demo/src/index.ts:188`** — `/api/items/:id` only 404s when `id > 3`; `NaN`/`0`/negative ids return bogus `{id:NaN,...}`.
- **`apps/obs-demo/src/index.ts:70`** — `initObservability` re-runs every request with unvalidated `OBS_COLLECTOR_URL`/`OBS_INGEST_KEY` (collector app guards with a once-flag).
- **`apps/obs-demo/src/index.ts:262`** — evaluation posted with possibly-empty `traceId` (can't join); score requires non-empty but label doesn't → empty answer labeled "pass".
- **`packages/cli/src/cli.ts:138`** — `scaffoldApp` resolves the raw app name with no traversal guard (`../../x` writes outside cwd) and no fs error handling; also proceeds on cancelled prompts (`:173`) writing a half-broken scaffold.
- **`apps/collector-node/src/server.ts:140`** — insecure S3 defaults (`FORCE_PATH_STYLE=true`, region `us-east-1`) with no startup validation.

---

## LOW severity

- [x] **OTLP**: empty/wrong-length trace/span IDs not guarded in `adaptResourceSpans` (`packages/obs-collector/src/otlp/decode.ts:743`); a garbage `timeUnixNano` throws and rejects the whole log batch (`decode.ts:245`). Fixed in `635885f`.
- [x] **Env `0`→default footgun**: `NARRATIVE_BUDGET_PER_HOUR=0` becomes `50` via `|| 50` (`analyses-runner.ts:341`); same on `apps/collector-node/src/server.ts:34`. Fixed in `066f790`.
- [x] **Unbounded module caches**: `shapeCache` (`derive.ts:30`), `projectCache`/`keyCache` (`dashboard-auth.ts:15`) — leak per distinct project, and the auth caches aren't keyed by DB/env. Fixed in `635885f`.
- [x] **AI pricing prefix match** can mis-price short prefixes like `o1` (`ai-pricing.ts:55`); **UA bot detection** over-matches substrings and overrides device type (`ua-parser.ts:48`). Fixed in `066f790`.
- [x] **`parseJsonValue`** returns `{}` for both parse-error and empty (`json.ts:20`) — swallows corruption. Fixed in `066f790`.
- [x] **AI-span attributes** still mutable after `setError` ends the span (`ai-spans.ts:124`); **`fetch.ts`** stamps `NaN` content-length and only flags ≥500 as error (`fetch.ts:67`); **node-SDK getters** read span attributes via SDK internals that are often empty (`sdks/node/src/interaction.ts:108`). Fixed in `066f790`.
- [x] **Dashboard**: `AIDashboard` tab class template literals miss a space so the active-tab style never applies (`AIDashboard.tsx:175`, `:934`); log→trace deep link uses `?traceId=` but the router reads `?trace=` (`LogsDashboard.tsx:541`); error-rate footer mixes filtered list with unfiltered totals (`AIDashboard.tsx:374`). Fixed in `066f790`.
- [x] **`apps/obs-demo`**: span export awaited on the response critical path (`index.ts:107`); Anthropic `usage` accessed without optional-chaining unlike the other providers (`providers.ts:130`). Fixed in `066f790`.

---

## Clean (no functional defects found on dimensions reviewed)

`blob-store*`, `identity-index.ts`, `metrics-store.ts`, `logs-store.ts`, `sql-db.ts`, the pprof varint reader/encoder math, `parse-pprof.ts`/`FlameGraph.tsx` (proper cancellation), `AuthGate`/`Login`, `ServiceMapDashboard`/`UsageDashboard` effects.

## Retracted during review (investigated, not real)

- `projects-store.ts` bootstrap-key bind count (verified correct).
- D1 exec-wrapper concern (sound).
- `derive.ts:284` empty-set handling (sound).
- `profile.ts:205` `toArrayBuffer` pooled-Buffer slice concern (current code copies the exact `Uint8Array` view, preserving `byteOffset`/`byteLength`; only the `stop()` in-flight push concern remains).

---

## Suggested triage order

1. **Tenant isolation + auth** — `tail-hub.ts` projectId trust, constant-time HMAC, ingest bootstrap latch.
2. **Wrong numbers** — `getServiceOperations` GROUP BY, percentile ceil, `getOverview` truncation, slow-session filter.
3. **Silent telemetry loss** — span exporter wiring, SDK flush-on-exit + retry, analytics replay flush/teardown.
4. **Postgres timeout no-op** — `SET LOCAL` outside a transaction.
5. **Unregistered plugins** — onboarding/dashboard routes.
6. Remaining MEDIUM/LOW as capacity allows.
