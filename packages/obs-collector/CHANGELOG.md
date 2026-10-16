# @obsunified/collector

## 2.3.0

### Minor Changes

- fc42238: RFC 0014: export the collector environment manifest (`COLLECTOR_OPTIONAL_STRING_ENV_KEYS`, `COLLECTOR_HOST_MANAGED_ENV_KEYS`), respond through `respondWithContract` with schema assertions, add `check:migrations` and `check:db-parity` (native SQLite + Postgres schema/query parity), and emit all dashboard links through the typed route builders.

### Patch Changes

- 78a01fb: `POST /internal/findings` now validates with `InvestigationFindingHttpInputSchema` (RFC 0014 WS5) instead of hand-parsing. The combined required-fields message and the `causalChain` messages are unchanged, and trimming and null defaults are preserved. Tightening: wrongly typed optional fields (for example a non-numeric `confidence`, an unknown `causalProofTier`, an invalid entity kind, or a non-string entry in `citedEvidenceIds`) now return 400 with `{ error: "<path>: <message>" }` instead of being silently ignored.
- Updated dependencies [fc42238]
  - @obsunified/types@2.3.0

## 2.2.3

### Patch Changes

- 4066de0: Fix finding fingerprints for `traceId:spanId` span loci (the span now resolves to its service node) and fall back to the finding summary when a span has no error signature.

## 2.2.2

### Patch Changes

- 3ba2c0a: AutoSRE lifecycle fixes: finding creation accepts an `idempotencyKey` (a retry returns the stored finding), `fingerprintInput` may be partial, and an omitted fingerprint for a span-id fault locus is derived from the span's service, operation and error signature so the circuit breaker no longer fragments per span; `GET /internal/evals/runs/:id` lets callers validate counterfactual prerequisites before persisting; the evidence bundle's `priorFindings` also match by recurrence fingerprint; a `webhookUrl`/`secret` given to `propose` is stored on a pending proposal (migration 052, both dialects) and used when the proposal is approved without a callback, with only `callbackHost` exposed by GETs; `POST /internal/findings` now persists `codeReferences`.
- 2afe6fa: Add `GET /internal/ai/calls/:callId` returning the AI call row with its `traceId` and `spanId` (404 when unknown), and point connected-manifest eval links at `#/evaluations/<id>`.
- c2cd9c8: Fix Postgres-only 500s on `GET /internal/connected/change/:id` (invalid `SELECT DISTINCT ... ORDER BY`) and `GET /internal/usage/sessions` (ungrouped correlated subqueries). Session cookies now get `Secure` behind a trusted TLS-terminating proxy (`TRUST_PROXY` plus `X-Forwarded-Proto: https`). The bootstrap ingest key's display prefix never reveals a short key in full. Connected-rail links now carry the real entity kind and point at routes the dashboard serves (incident trigger signal, finding fault locus, tool calls, retrievals, evaluations, artifacts, AI calls).
- c800403: Grant webhook delivery now retries up to 3 times (500 ms / 1500 ms backoff) on network errors, timeouts and 5xx, but not on 4xx. Approve and propose responses carry `grantDelivery: { attempted, delivered, attempts, host, error? }`, and the last outcome is persisted (migration 053 `callback_delivery`) and returned by GET as `callbackDelivery`.
- Updated dependencies [3ba2c0a]
- Updated dependencies [c800403]
  - @obsunified/types@2.2.1

## 2.2.1

### Patch Changes

- a834692: Harden AutoSRE remediation governance: the causal proof tier is now derived server-side (a client-asserted cohort verdict can no longer buy an autonomous rollback grant), grant claims, leases, incident dedup and proposal idempotency are enforced atomically in SQL (migration 051), completion/failure require the claiming runner, and the post-remediation watchdog needs two consecutive healthy checkpoints and runs on the 1-minute tick.
  Incident webhooks now use the SSRF-guarded delivery path (DNS classification, no redirects, 5s timeout) and can push a minted grant token to the runner; approver identity is derived from the dashboard session instead of client-supplied headers; `/v1/changes` accepts `source: "ci_webhook"`.
- da6443c: Harden the AutoSRE surfaces.
  - MCP server: the three write tools (`record_investigation_finding`, `propose_remediation_action`, `claim_remediation_grant`) are now opt-in and only registered when `OBS_MCP_ENABLE_WRITES=true`. `OBS_API_TOKEN` is accepted as an alias for `OBS_DASHBOARD_TOKEN`. Tool inputs use the shared enum schemas, and the newer tools return only `data` (no duplicated top-level body).
  - Dashboard: the remediation approval card now surfaces errors, asks for confirmation before approving, takes a rejection reason, and shows the one-time grant token. Externally supplied proposals without handlers render read-only. Fixes multi-underscore badge labels.
  - Collector: AutoSRE triage enrichment runs only for `triage_incident`, respects the token budget, filters candidate changes to the fault-locus service, computes blackout suspicion, and no longer falls back to unrelated prior findings. Connected-rail change/finding/incident lookups use the shared getters and honor `environment`.
  - CLI: one token resolver shared by `changes`, `keys`, and `doctor` that names the env var or flag in auth failures; `changes record` sends the ingest key once (Bearer); warns when credentials are passed as flags.

- 970ba34: Fix runtime lineage across the SDKs and align the environment vocabulary.
  - **Cloudflare Workers lineage now reaches the exporter (telemetry-sdk).** `createResolveConfig` / the telemetry plugin set a `resource` field that `@microlabs/otel-cf-workers` ignores, so `environment`, `serviceVersion`, `commitSha` and `configDigest` were silently dropped. They are now stamped on each exported span through a `postProcessor`. Existing span attributes are never overwritten.
  - **Feature flags work on Workers (telemetry-sdk).** `recordFeatureFlag` no longer relies on `AsyncLocalStorage.enterWith`/`disable`, which Cloudflare does not implement; it falls back to a module-level store, and `clearRecordedFeatureFlags` clears it. `withFeatureFlagScope` semantics are unchanged.
  - **Environment names are normalised.** New `normalizeEnvironment` (exported from `@obsunified/types/lineage`): lowercase and trim, `production` becomes `prod`, `development` becomes `dev`, `test` is unchanged, empty becomes `default`. It is applied to the `environment` option, `OBS_ENVIRONMENT` and `NODE_ENV` in all three SDKs, and in the collector when reading span environments and when recording change events, so `NODE_ENV=production` spans join changes posted as `prod`.
  - **Less attribute inflation.** Lineage (`deployment.environment.name`, `obs.environment`, `service.version`, `obs.service.version`, `vcs.commit.id`, `obs.commit.sha`, `obs.config.digest`) is now sent once on the resource instead of on the request span and every child span (telemetry-sdk) or every span (sdk). Feature-flag attributes are still per span. In analytics-sdk the same keys appear once in event `context`; the camelCase duplicates (`environment`, `serviceVersion`, `commitSha`, `configDigest`) and the copy in `properties` are removed.
  - **Shared implementation.** The three duplicated `lineage.ts` modules now import from the new subpath `@obsunified/types/lineage` (no `process` access; safe for browser bundles). `@obsunified/sdk` gains a dependency on `@obsunified/types`. Public exports of each SDK are unchanged.
  - **`@obsunified/sdk` no longer publishes test files** in `dist`.
  - **The nested `lineage` option is deprecated** in favour of the flat `environment`, `serviceVersion`, `commitSha` and `configDigest` options. It still works.
  - **types:** `EvidenceBundle` autosre `priorFindings[].causalVerificationStatus` / `recoveryStatus` now use the existing enum schemas, and `EvidenceBundleJsonSchema.autosre` is a real JSON schema instead of an open object. New zod schemas `ChangeEventInputSchema`, `InvestigationFindingInputSchema` and `RemediationProposalInputSchema`. `normalizeErrorSignature` also scrubs undashed hex runs of 16+ characters, and canonical node-id segments percent-encode `:` and `/` (and `%`) so they cannot collide with id delimiters; node ids containing those characters (for example IPv6 hosts) change.
  - **collector:** the ontology node upsert cache is capped at 5000 entries (oldest evicted) and is only populated after the batch write succeeds.

  Runtime lineage options and env vars (see each package README): `environment` (`OBS_ENVIRONMENT`, `NODE_ENV`), `serviceVersion` (`OBS_SERVICE_VERSION`, `OTEL_SERVICE_VERSION`), `commitSha` (`OBS_COMMIT_SHA`, `GITHUB_SHA`), `configDigest` (`OBS_CONFIG_DIGEST`); record flag evaluations with `recordFeatureFlag(key, variant, { providerName, contextId })`.

- Updated dependencies [a834692]
- Updated dependencies [970ba34]
  - @obsunified/types@2.2.0

## 2.2.0

### Minor Changes

- Implement RFC 0013 AutoSRE causal ontology, change correlation (`change_events`), traffic-normalized cohort lift, noisy-neighbor contention checks, counterfactual verification (`investigation_findings`), durable incident lease coordination (`incident_investigations`), and pre-execution CAS remediation grants (`remediation_proposals`).

### Patch Changes

- Updated dependencies
  - @obsunified/types@2.1.0

## 2.1.1

### Patch Changes

- Updated dependencies [c2c3f66]
  - @obsunified/types@2.0.2
  - @obsunified/pprof-decoder@2.0.2

## 2.1.0

### Minor Changes

- 674f630: Scope collector storage keys by project, harden the collector, and stop SDK exporters from dropping batches.

  **@obsunified/collector**
  - Migrations 045–048 (SQLite/D1 and Postgres) move `user_profiles`, the six
    RFC 0010 action graph tables, `ai_span_payloads`, and `telemetry_spans` to
    primary keys that include `project_id`, so one project's ingest key can no
    longer overwrite, claim, or silently drop another project's rows that share
    a client-supplied id. The upserts and ingest paths now conflict on the
    composite keys. Migration 049 adds `alert_state.notified` (existing rows
    backfill as delivered).
  - **Run migrations 045–049 before deploying this version** (the collector
    2.1 line; see `src/migrations-postgres/README.md`), and apply them in a
    quiet window: SQLite/D1 rebuilds each table by copying every row, and
    Postgres `ADD PRIMARY KEY` builds the new span index under an
    `ACCESS EXCLUSIVE` lock on `telemetry_spans` and `ai_span_payloads`. The old
    code still works against the migrated schema; the new code's upserts require it.
  - `POST /auth/login` is rate limited per client on failed attempts
    (`CollectorConfig.loginRateLimit`, default 10 failures per 15 minutes,
    in-memory per isolate/process). The limiter keys on a host-supplied peer
    address, trusted proxy headers, or `CF-Connecting-IP` on Workers. When
    none is available it stays inactive and logs one warning rather than
    sharing a single bucket that would let anyone lock every operator out;
    Node embedders should pass `loginRateLimit.clientAddress`.
  - Ingest and admin routes cap request bodies (`MAX_BODY_BYTES`, default 10 MiB)
    and gunzipped OTLP payloads (32 MiB) instead of buffering unbounded input.
    The unauthenticated `/auth/*` routes have their own 16 KiB cap
    (`CollectorConfig.maxAuthBodyBytes`), independent of `MAX_BODY_BYTES`.
  - Alert webhook URLs must be plain http(s) to a public host; loopback,
    private, link-local, and credentialed URLs are rejected unless
    `ALERT_WEBHOOK_ALLOW_PRIVATE=true`. Webhook URLs are redacted in logs and
    span attributes.
  - Alert state follows the signal, not the webhook: a breached rule is recorded
    (and shown) as `firing` even when delivery fails or the target is refused.
    Whether the transition has been delivered is persisted on the state row
    (`alert_state.notified`, migration 049), so an undelivered transition is
    retried on each evaluation tick until a channel accepts it, without
    re-transitioning, and a long-lived state is never re-notified after its
    evaluation history is purged; `evaluateRuleBatch` reports retries as
    `redelivered`. Until 049 is applied the collector keeps evaluating with the
    old statement but cannot retry undelivered notifications.
  - Retention cleanup also purges `alert_evaluations`, `ask_evidence_events`,
    orphaned `metric_series`, and expired `evidence_retrieval_refs`;
    `RetentionCleanupSummary` gains a `housekeeping` section.

  **@obsunified/telemetry-sdk**
  - Span, log, and AI-call exporters now inspect the collector's HTTP status.
    Transient failures (408, 429, 5xx) requeue the batch for the next flush;
    permanent rejections such as 401 are logged and dropped instead of being
    treated as success.
  - The final `beforeExit` flush no longer loops against a collector that is
    down: a drain only flushes when new telemetry was enqueued since the
    previous final attempt started (a per-buffer enqueue revision that requeues
    do not advance), so a requeued batch lets the process exit while telemetry
    produced after an earlier drain, into a full buffer, or while that attempt
    was in flight is still exported.

  **@obsunified/analytics-sdk**
  - Replay chunks only request `keepalive` when the body fits the browser's
    64 KiB keepalive limit; larger rrweb snapshots previously made `fetch` throw
    and the chunk was lost.

  **@obsunified/cli**
  - Scaffolded apps (`react-vite`, `vanilla-ts`, `hono-workers`, and the inline
    template) depend on `@obsunified/analytics-sdk` and
    `@obsunified/telemetry-sdk` `^2.0.0` instead of `^1.0.0`. A test now fails
    if the scaffold ranges drift behind the published major.

### Patch Changes

- 7fcdbde: Retention cleanup now expires the RFC 0010 action graph.

  `createRetentionCleanupHandler()` purges `actions` and their `agent_runs`,
  `tool_calls`, `retrieval_events`, `eval_results` and `artifacts` rows once a
  whole causal tree (`project_id`, `root_action_id`) is older than
  `RETENTION_HOURS`, judged by `actions.started_at`. Trees are deleted whole in
  bounded batches, each inside one `SqlDb.batch`, with leaves removed before the
  spine. A tree is kept while any action in it is fresh or unfinished, its agent
  run is still `running`, or an `eval_cases` row in the same project references
  it. `RetentionCleanupSummary` gains `actions` and `action_leaves`;
  `purgeExpiredActionGraph` and `actionRetentionCutoff` are exported for hosts
  that schedule retention themselves.

  Migration `044_actions_started_at_index.sql` (SQLite/D1 and Postgres) adds
  `idx_actions_started_at`; run your migration step before deploying.

  Known limits: expired trees with more actions than the per-batch cap (500 by
  default) are retained intact and logged as `oversized_trees` rather than
  deleted in pieces; artifact blobs behind `storage_ref` are not deleted; and on
  Postgres (READ COMMITTED) an ingest into an already-expired tree that commits
  between that tree's leaf deletes and its spine delete can leave the spine
  without its leaves. D1 batches run as one serialized SQLite transaction and do
  not have that window.

- 3b7533b: Scheduled maintenance handlers expose a runtime-neutral `run(env)`.

  `createRetentionCleanupHandler()` and `createAnalysesRunHandler()` now return a
  `ScheduledTaskHandler`: `run(env)` performs the work and resolves to a summary
  (`RetentionCleanupSummary`, or the analyses run summary / `undefined` on a
  logged failure), while the existing Cloudflare `scheduled(event, env, ctx)`
  method is a thin adapter that delegates to `run`. Non-Workers hosts such as the
  standalone Node collector can drive the jobs without fabricating
  `ScheduledEvent` / `ExecutionContext` objects. Existing `scheduled` callers are
  unaffected.

- 82c6d9d: Implement programmatic DASHBOARD_TOKEN / OBS_DASHBOARD_TOKEN Bearer authentication contract on collector /internal/\* routes and enforce strict rejection of ingest keys on read and admin endpoints.
- fa69bd8: Fix PostgreSQL compatibility for the standalone Node collector: `PostgresAdapter.bind()` now returns a new statement (batched AI ingest previously stored only the last row), SQLite time windows and analysis built-ins (`datetime`, `strftime`, `julianday`, `json_object`, scalar `MAX`/`MIN`, `ROUND`) are translated for TEXT timestamp columns, camelCase aliases are restored on result rows, BOOLEAN flags are queried portably (`SUM(CASE WHEN is_error …)`), and `configurePostgresTypeParsers()` returns D1-shaped values (0/1 flags, numbers, JSON text). Migration 041 converts `ingest_keys.key_hash` from BYTEA to TEXT so hex-digest lookups match.
- 657a949: Fix PostgreSQL retention for metric exemplars: `MetricsStore.purgeExpired()` failed with `operator does not exist: timestamp with time zone < text` because migration 035 declared `metric_exemplars.received_at`/`expires_at` as `TIMESTAMPTZ` while every other retention table (and `postgresDialect.now()`) uses ISO `TEXT`. Fresh installs now create both columns as `TEXT`, and migration 043 converts existing Postgres databases in place, preserving rows as UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` text. A numbered SQLite/D1 no-op keeps migration parity.
- f94babc: Fix cross-project session replay metadata collisions by scoping the primary key to (project_id, session_id), updating the replay receiver upsert conflict target to (project_id, session_id), scoping identity-index replay queries by project_id, and adding forward migration 042 for SQLite/D1 and PostgreSQL.

## 2.0.1

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.
- Updated dependencies [77c781a]
  - @obsunified/pprof-decoder@2.0.1
  - @obsunified/types@2.0.1

## 2.0.0

### Major Changes

- 4ac9a67: Initial publishable release.
  - Scope renamed from `@obs/*` to `@obsunified/*` (no longer reserves the
    shorter `@obs` scope on npm — see `docs/migrate/from-obs-scope.md`).
  - All five packages now ship compiled `dist/` artifacts via `tsup` (was: raw
    `./src/*.ts` exports that only resolved inside the monorepo).
  - `@obsunified/telemetry-sdk` splits Cloudflare-specific surfaces into the
    `./cloudflare` subpath so Node consumers don't pull
    `@cloudflare/workers-types`.
  - Workers-only peer-dependencies (`@hono/otel`, `@microlabs/otel-cf-workers`)
    are now marked optional.

### Minor Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.

### Patch Changes

- Updated dependencies [4ac9a67]
- Updated dependencies [0140450]
  - @obsunified/types@2.0.0
  - @obsunified/pprof-decoder@2.0.0
