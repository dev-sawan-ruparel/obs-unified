# Postgres adapter migration tracker

Tracks the SQLite → Postgres translation work for the Node deployment
([`apps/collector-node`](../apps/collector-node)).

The reference (SQLite/D1) migrations live in
[`packages/obs-collector/src/migrations/`](../packages/obs-collector/src/migrations).
Their Postgres siblings live in
[`packages/obs-collector/src/migrations-postgres/`](../packages/obs-collector/src/migrations-postgres).

## Status

| # | File | SQLite | Postgres | Notes |
| --- | --- | --- | --- | --- |
| 001 | telemetry_spans | ✅ | ✅ | JSONB columns instead of TEXT; GIN index added |
| 002 | usage_events | ✅ | ✅ | JSONB for context/properties |
| 003 | usage_analytics_columns | ✅ | ✅ | `BOOLEAN` for is_bot; `ADD COLUMN IF NOT EXISTS` for idempotency |
| 004 | logs | ✅ | ✅ | JSONB for attributes |
| 005 | ai_calls | ✅ | ✅ | JSONB for input/output; BOOLEAN for is_error |
| 006 | user_profiles | ✅ | ✅ | JSONB for properties_json |
| 007 | session_replay_metadata | ✅ | ✅ | BIGINT counters |
| 008 | session_replay_storage_bytes | ✅ | ✅ | `ADD COLUMN IF NOT EXISTS` |
| 009 | projects_and_keys | ✅ | ✅ | `BYTEA` for key_hash — pairs with `ingest-auth.ts` constant-time compare |
| 010 | signal_project_id | ✅ | ✅ | `ADD COLUMN IF NOT EXISTS` × 6 |
| 011–027 | _(various)_ | ✅ | ⏳ | **Not yet translated.** Land with the first hosted-Postgres deploy (see README). Includes 019 `ai_span_payloads`, which 031 depends on. |
| 028 | profile_blobs | ✅ | ✅ | Self-contained — creates `profile_blobs` + `profile_trace_index`. `BIGINT` for `duration_ms` / `blob_size_bytes` / `sample_count`; `JSONB` (+ GIN) for `resource_attrs_json`. |
| 029–030 | _(various)_ | ✅ | ⏳ | **Not yet translated.** Land with the first hosted-Postgres deploy. |
| 031 | agent_action_graph | ✅ | ⚠️ | Action graph spine + leaf tables (RFC 0010). Landed ahead of 011–027 + 029–030. The `ai_span_payloads.action_id` column + index (a dependency on the still-untranslated 019) are **guarded behind `to_regclass('ai_span_payloads')`**, so on a fresh DB without 019 that extension is a no-op instead of aborting the run. Once 019 is translated it sorts first and the guard lets the extension apply. |

> **Out-of-order note:** 028 and 031 were translated ahead of the rest of
> 011–030. Both are safe to land out of order:
>
> - 028 is self-contained — every table it touches is created in 028 itself.
> - 031's one cross-table dependency (the `ai_span_payloads` extension) is
>   guarded with `to_regclass(...)`.
>
> Any future migration that hard-references a table from the still-pending
> 011–027 / 029–030 range must either wait for that range to be translated or
> apply the same `to_regclass(...)` / `IF EXISTS` guard pattern, or it will
> break the CI integration job.

## Translation rules

Documented at the top of
[`migrations-postgres/README.md`](../packages/obs-collector/src/migrations-postgres/README.md).

## CI parity check

`.github/workflows/ci.yml` runs the `integration` job — it spins up
Postgres, applies the `migrations-postgres/` files, and smoke-tests the
collector. A failure there usually means a migration drifted out of
parity.

## Translating a new migration

1. Copy `packages/obs-collector/src/migrations/NNN_xxx.sql` to
   `migrations-postgres/NNN_xxx.sql`.
2. Apply the rules from `migrations-postgres/README.md`:
   - `INTEGER` → `BIGINT`
   - `REAL` → `DOUBLE PRECISION`
   - JSON-bearing `TEXT` columns → `JSONB`
   - `INSERT OR REPLACE` → `INSERT ... ON CONFLICT ... DO UPDATE`
   - `BLOB` → `BYTEA`
3. Update the table above.
4. Open a PR. The CI integration job verifies the migration applies
   cleanly against a fresh Postgres.
