# `@obs-demo/collector-node` — standalone Node.js collector

The obs-unified collector packaged as a long-running Node.js service. Use this
when you can't (or don't want to) deploy to Cloudflare Workers — the storage
layer talks Postgres + S3 instead of D1 + R2.

## Quick start (local)

```bash
cd apps/collector-node
docker compose up -d
docker compose logs -f collector
```

Brings up Postgres + MinIO (S3-compatible) + the collector on
`http://localhost:8790`. Dashboard password is `e2e-test-pass`; ingest key is
`dev-ingest-key`.

Open `http://localhost:5173` (run `pnpm dev:web` from the repo root) to see
populated dashboards once you seed data via `pnpm seed`. You can verify the
collector before opening the dashboard with:

```bash
pnpm --filter @obsunified/cli exec obs-unified doctor --origin http://localhost:5173
```

## Quick start (host install)

```bash
pnpm --filter @obs-demo/collector-node run build
DATABASE_URL=postgres://user:pass@host:5432/obs_unified \
S3_BUCKET=obs-replays S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... \
INGEST_KEY=$(openssl rand -hex 32) \
DASHBOARD_PASSWORD=$(openssl rand -hex 16) \
pnpm --filter @obs-demo/collector-node run start
```

## Environment

| Var                    | Required      | Default                  | Purpose                                                     |
| ---------------------- | ------------- | ------------------------ | ----------------------------------------------------------- |
| `DATABASE_URL`         | yes           | —                        | Postgres connection string                                  |
| `PG_POOL_MAX`          | no            | 10                       | Connection pool size                                        |
| `BLOB_STORE`           | no            | `file`                   | The blob storage type: `file` or `s3`                       |
| `BLOB_DIR`             | no            | `/tmp/obs-unified-blobs` | File system path to store blobs when `BLOB_STORE` is `file` |
| `S3_ENDPOINT`          | no            | —                        | S3-compatible endpoint URL (omit for AWS S3)                |
| `S3_REGION`            | no            | `us-east-1`              | AWS region                                                  |
| `S3_BUCKET`            | yes (if `s3`) | —                        | Bucket name for replay + pprof blobs                        |
| `S3_FORCE_PATH_STYLE`  | no            | `true`                   | Set to `false` for AWS S3                                   |
| `S3_ACCESS_KEY_ID`     | yes (if `s3`) | —                        | Access key                                                  |
| `S3_SECRET_ACCESS_KEY` | yes (if `s3`) | —                        | Secret key                                                  |
| `INGEST_KEY`           | yes           | —                        | Write-only API key for SDK clients                          |
| `DASHBOARD_PASSWORD`   | yes           | —                        | Dashboard login password                                    |
| `DASHBOARD_TOKEN`      | no            | —                        | Programmatic read/admin bearer token for /internal/* (MCP)  |
| `ALLOWED_ORIGINS`      | no            | —                        | Comma-separated CORS origins                                |
| `PORT`                 | no            | 8790                     | HTTP listen port                                            |
| `RETENTION_HOURS`      | no            | 72                       | Retention window for rows and blobs (1–720); also bounds dashboard query ranges |
| `ANTHROPIC_API_KEY`    | no            | —                        | Enables the analyses narrate pass and `/internal/ask` via Anthropic |
| `OPENAI_API_KEY`       | no            | —                        | Same via OpenAI-compatible chat completions (wins if both keys are set) |
| `OPENAI_BASE_URL`      | no            | —                        | Endpoint override for OpenAI-compatible servers (OpenRouter, vLLM, Ollama…) |
| `NARRATIVE_MODEL`      | no            | provider default         | Narrative model id (defaults: `claude-3-5-haiku-latest` / `gpt-4o-mini`) |
| `NARRATIVE_BUDGET_PER_HOUR` | no       | 50                       | Max narrative writes per project per hour                   |
| `MAINTENANCE_ENABLED`  | no            | `true`                   | Set to `false` to disable the in-process maintenance scheduler |
| `MAINTENANCE_ANALYSES_INTERVAL_SECONDS`  | no | 60                  | Cadence of the due-analyses run                             |
| `MAINTENANCE_ALERTS_INTERVAL_SECONDS`    | no | 300                 | Cadence of alert rule evaluation                            |
| `MAINTENANCE_RETENTION_INTERVAL_SECONDS` | no | 3600                | Cadence of retention cleanup                                |

## Background maintenance

The Cloudflare Worker relies on Cron Triggers for three recurring jobs. The
Node collector runs the same jobs from an in-process scheduler
(`src/maintenance.ts` + `src/scheduler.ts`) using the same Postgres adapter
and blob store as HTTP traffic:

| Task                | Default cadence | Worker cron    | What it does                                            |
| ------------------- | --------------- | -------------- | ------------------------------------------------------- |
| `analyses_run`      | every 1 min     | `* * * * *`    | Runs analyses whose refresh window has elapsed          |
| `alerts_evaluate`   | every 5 min     | `*/5 * * * *`  | Evaluates enabled alert rules, fires/resolves incidents |
| `retention_cleanup` | every 60 min    | `0 * * * *`    | Purges expired rows and profile blobs                   |

First runs are staggered shortly after startup (15 s / 30 s / 60 s) so a
restarted collector repopulates dashboards quickly. A tick that fires while
the previous run of the same task is still in flight is skipped and logged
(`[maintenance] skipped tick`), never run concurrently. A failing run is
logged (`[maintenance] task failed`) and the next tick proceeds. On `SIGINT`
or `SIGTERM` the scheduler stops arming new ticks, waits up to 10 s for
in-flight runs, and only then is the Postgres pool closed.

The optional `RETENTION_HOURS` and narrative LLM variables above are forwarded
into the collector env, so a scheduled analyses run narrates and expires
results exactly as the Worker does; blank values are treated as unset.

Run more than one collector replica? Set `MAINTENANCE_ENABLED=false` on the
serving replicas and run exactly one maintenance process with it enabled. See
the Kubernetes example in
[`docs/ops/production.md`](../../docs/ops/production.md#4-kubernetes-orchestration-manifests).
Or disable it everywhere and drive the jobs from an external scheduler of
your own.

## Migrations

`node scripts/migrate-pg.mjs` applies every file under
`packages/obs-collector/src/migrations-postgres/` not yet recorded in the
`schema_migrations` tracking table. Safe to re-run.

The Docker stack runs the migrator automatically before starting the collector
via a Compose dependency.

Upgrading an existing database picks up `041_ingest_key_hash_text.sql`, which
converts `ingest_keys.key_hash` from `BYTEA` to `TEXT` in place so hex-digest
lookups match on Postgres (see `docs/postgres-migration.md` for rollout notes).

`server.ts` calls `configurePostgresTypeParsers(pg.types)` before the first
query so BOOLEAN, BIGINT, NUMERIC and JSON/JSONB values come back in the same
shape the D1-backed Worker sees (0/1 flags, numbers, JSON text). Any other
host that constructs `PostgresAdapter` must do the same.

To verify a Postgres server end to end, point the collector's integration test
at an empty scratch database:

```bash
OBS_PG_TEST_URL=postgres://obs:obs@127.0.0.1:5432/obs_scratch \
  pnpm --filter @obsunified/collector exec vitest run src/lib/sql-db-postgres.integration.test.ts
```

## How this differs from `apps/collector` (Cloudflare Worker)

| Concern             | Worker version      | Node version                                                            |
| ------------------- | ------------------- | ----------------------------------------------------------------------- |
| SQL storage         | D1 (SQLite-on-edge) | Postgres                                                                |
| Blob storage        | R2                  | S3 (or compatible)                                                      |
| Runtime             | workerd             | Node 22+                                                                |
| Scheduled jobs      | Cron Triggers       | In-process scheduler (see "Background maintenance")                      |
| Cold-start          | <50ms               | ~1s on first request after restart                                      |

Both deployments compose the same `@obsunified/collector` runtime — plugin code
is identical. The only difference is the storage adapter chosen at startup and
the host fetch handler.
