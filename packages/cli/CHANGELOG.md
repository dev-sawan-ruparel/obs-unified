# @obsunified/cli

## 1.0.4

### Patch Changes

- e02b1e7: Fix `keys` and `doctor` to call the routes the collector actually serves.
  - `keys mint` now `POST`s `/internal/projects/<id>/keys` with a JSON `{ name }`
    body (was `POST /internal/keys/mint`, which does not exist) and prints the
    returned plaintext key, id, and one-time warning. `--name <label>` sets the
    key label (default `cli`); `--json` prints the raw response.
  - `keys list` now `GET`s `/internal/projects/<id>/keys` (was `GET /internal/keys`)
    and prints id, name, key prefix, creation time, and active/revoked status.
  - Project selection: `--project <id>`, then `OBS_PROJECT_ID`, then discovery via
    `GET /internal/projects` (the collector's `default` project, or its only
    project). With several non-default projects the CLI lists them and asks for
    `--project` instead of guessing.
  - Errors now distinguish a rejected `OBS_ADMIN_TOKEN` (HTTP 401/403) from an
    unknown project (`Project not found`) and from an unknown route (HTTP 404 on
    a non-collector URL or an older collector).
  - `doctor`'s dashboard read-API check probes `GET /internal/projects` instead of
    the nonexistent `/internal/spans`. If `OBS_ADMIN_TOKEN` is set it is sent and
    must be accepted. Without it a 401 is healthy, and a 200 is now a failed
    check: the collector is exposing its internal API unauthenticated.

  Authorization is unchanged: `Authorization: Bearer $OBS_ADMIN_TOKEN`, where
  `OBS_ADMIN_TOKEN` must match the collector's `DASHBOARD_TOKEN`.

- e0e222f: Point CLI first-run guidance to the source build commands for the personal monorepo.
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

## 1.0.3

### Patch Changes

- d664b30: `doctor --origin` now replaces the default origin list instead of adding to it, and the default shrinks to `http://localhost:5173`. Previously the hardcoded `http://localhost:8080` default stayed in the checked set even when `--origin` was passed, so the documented verify command failed its browser-ingest CORS check (exit 1) against a perfectly healthy all-in-one container. Pass `--origin` repeatedly — or set `OBS_DOCTOR_ORIGINS` — to check several origins, e.g. `--origin http://localhost:8080` for the Astronomy Shop demo.

## 1.0.2

### Patch Changes

- 77c781a: Publish public packages to npmjs so installs no longer require GitHub Packages authentication.

## 1.0.1

### Patch Changes

- 0140450: Release agent action graph telemetry, cross-signal identity propagation, and the
  interactive dashboard graph view.

  The release also includes SDK/template updates for interaction-id propagation,
  collector store/query support for action graph data, dashboard refinements
  across telemetry views, and pprof decoder maintenance fixes.
