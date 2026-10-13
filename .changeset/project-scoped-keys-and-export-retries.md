---
"@obsunified/collector": patch
"@obsunified/telemetry-sdk": patch
"@obsunified/analytics-sdk": patch
"@obsunified/cli": patch
---

Scope collector storage keys by project, harden the collector, and stop SDK exporters from dropping batches.

**@obsunified/collector**

- Migrations 045–048 (SQLite/D1 and Postgres) move `user_profiles`, the six
  RFC 0010 action graph tables, `ai_span_payloads`, and `telemetry_spans` to
  primary keys that include `project_id`, so one project's ingest key can no
  longer overwrite, claim, or silently drop another project's rows that share
  a client-supplied id. The upserts and ingest paths now conflict on the
  composite keys.
- **Run migrations 045–048 before deploying this version**, and apply them in
  a quiet window: SQLite/D1 rebuilds each table by copying every row, and
  Postgres `ADD PRIMARY KEY` builds the new span index under an
  `ACCESS EXCLUSIVE` lock on `telemetry_spans` and `ai_span_payloads`. The old
  code still works against the migrated schema; the new code's upserts require it.
- `POST /auth/login` is rate limited per client on failed attempts
  (`CollectorConfig.loginRateLimit`, default 10 failures per 15 minutes,
  in-memory per isolate/process).
- Ingest and admin routes cap request bodies (`MAX_BODY_BYTES`, default 10 MiB)
  and gunzipped OTLP payloads (32 MiB) instead of buffering unbounded input.
- Alert webhook URLs must be plain http(s) to a public host; loopback,
  private, link-local, and credentialed URLs are rejected unless
  `ALERT_WEBHOOK_ALLOW_PRIVATE=true`. Webhook URLs are redacted in logs and
  span attributes.
- Retention cleanup also purges `alert_evaluations`, `ask_evidence_events`,
  orphaned `metric_series`, and expired `evidence_retrieval_refs`;
  `RetentionCleanupSummary` gains a `housekeeping` section.

**@obsunified/telemetry-sdk**

- Span, log, and AI-call exporters now inspect the collector's HTTP status.
  Transient failures (408, 429, 5xx) requeue the batch for the next flush;
  permanent rejections such as 401 are logged and dropped instead of being
  treated as success.
- The final `beforeExit` flush runs once, so a collector that is down no longer
  keeps the Node process alive by requeuing forever.

**@obsunified/analytics-sdk**

- Replay chunks only request `keepalive` when the body fits the browser's
  64 KiB keepalive limit; larger rrweb snapshots previously made `fetch` throw
  and the chunk was lost.

**@obsunified/cli**

- Scaffolded apps (`react-vite`, `vanilla-ts`, `hono-workers`, and the inline
  template) depend on `@obsunified/analytics-sdk` and
  `@obsunified/telemetry-sdk` `^2.0.0` instead of `^1.0.0`. A test now fails
  if the scaffold ranges drift behind the published major.
