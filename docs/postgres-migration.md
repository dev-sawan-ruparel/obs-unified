# Postgres adapter migration tracker

Tracks the SQLite → Postgres translation work for the Node deployment
([`apps/collector-node`](../apps/collector-node)).

The reference (SQLite/D1) migrations live in
[`packages/obs-collector/src/migrations/`](../packages/obs-collector/src/migrations).
Their Postgres siblings live in
[`packages/obs-collector/src/migrations-postgres/`](../packages/obs-collector/src/migrations-postgres).

## Status

| #       | File                         | SQLite | Postgres | Notes                                                                                                                                                                         |
| ------- | ---------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001     | telemetry_spans              | ✅     | ✅       | JSONB columns instead of TEXT; GIN index added                                                                                                                                |
| 002     | usage_events                 | ✅     | ✅       | JSONB for context/properties                                                                                                                                                  |
| 003     | usage_analytics_columns      | ✅     | ✅       | `BOOLEAN` for is_bot (read back as 0/1 via `configurePostgresTypeParsers`); `ADD COLUMN IF NOT EXISTS` for idempotency                                                      |
| 004     | logs                         | ✅     | ✅       | JSONB for attributes                                                                                                                                                          |
| 005     | ai_calls                     | ✅     | ✅       | JSONB for input/output; BOOLEAN for is_error — shared SQL tests it as a bare boolean, never `SUM(is_error)` / `is_error = 1`                                                   |
| 006     | user_profiles                | ✅     | ✅       | JSONB for properties_json                                                                                                                                                     |
| 007     | session_replay_metadata      | ✅     | ✅       | BIGINT counters                                                                                                                                                               |
| 008     | session_replay_storage_bytes | ✅     | ✅       | `ADD COLUMN IF NOT EXISTS`                                                                                                                                                    |
| 009     | projects_and_keys            | ✅     | ✅       | `TEXT` for key_hash (SHA-256 hex, same as D1). Earlier releases used `BYTEA`; see 041                                                                                          |
| 010     | signal_project_id            | ✅     | ✅       | `ADD COLUMN IF NOT EXISTS` × 6                                                                                                                                                |
| 011–027 | _(various)_                  | ✅     | ✅       | Alerts, metrics, analysis, AI payloads/evaluations, session correlation, default project seeds, and identity propagation translated.                                          |
| 028     | profile_blobs                | ✅     | ✅       | Self-contained — creates `profile_blobs` + `profile_trace_index`. `BIGINT` for `duration_ms` / `blob_size_bytes` / `sample_count`; `JSONB` (+ GIN) for `resource_attrs_json`. |
| 029–030 | _(various)_                  | ✅     | ✅       | Telemetry SDK denormalization and analysis claim columns translated.                                                                                                          |
| 031     | agent_action_graph           | ✅     | ✅       | Action graph spine + leaf tables (RFC 0010), including `ai_span_payloads.action_id` extension.                                                                                |
| 032–040 | _(various)_                  | ✅     | ✅       | Payload capture flags, eval cases/runs, metric exemplars, tool-call evidence, evidence retrieval refs.                                                                        |
| 041     | ingest_key_hash_text         | ✅ (no-op) | ✅   | Postgres-only remediation: converts `ingest_keys.key_hash` from `BYTEA` to `TEXT` in place (32-byte seed digests → hex, hex-as-ASCII rows → decoded). D1 file is a no-op kept for numbering parity. |

## Translation rules

Documented at the top of
[`migrations-postgres/README.md`](../packages/obs-collector/src/migrations-postgres/README.md).

## Verifying migrations and the Postgres read/write paths

Run the live-Postgres integration test against an empty scratch database. It
applies every `migrations-postgres/` file, converts a legacy `BYTEA`
`key_hash` column through `041`, and drives ingest-key auth, AI/usage ingest,
retention purge and every built-in analysis through `PostgresAdapter`:

```bash
OBS_PG_TEST_URL=postgres://obs:obs@127.0.0.1:5432/obs_scratch \
  pnpm --filter @obsunified/collector exec vitest run src/lib/sql-db-postgres.integration.test.ts
```

The local first-run image also exercises the Postgres path:

```bash
pnpm smoke:local-image
```

## Rolling out 041 to an existing Postgres database

`041_ingest_key_hash_text.sql` rewrites `ingest_keys.key_hash` in place inside
the migration's transaction (`ALTER COLUMN … TYPE TEXT USING …`), which takes
an exclusive lock on the small `ingest_keys` table for the duration. Keys the
collector created keep working; the `obs-dashboard` seed key becomes usable
for the first time. If the same plaintext key had been stored in both shapes
the unique index rebuild fails and the migration rolls back — delete the
duplicate row and re-run `node scripts/migrate-pg.mjs`.

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
4. Open a PR. The CI integration job verifies the migration applies cleanly
   against a fresh Postgres.
