# @obsunified/collector

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
