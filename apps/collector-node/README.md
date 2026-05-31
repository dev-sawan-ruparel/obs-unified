# `@obs-demo/collector-node` — standalone Node.js collector

The obs-unified collector packaged as a long-running Node.js service.
Use this when you can't (or don't want to) deploy to Cloudflare Workers
— the storage layer talks Postgres + S3 instead of D1 + R2.

## Quick start (local)

```bash
cd apps/collector-node
docker compose up -d
docker compose logs -f collector
```

Brings up Postgres + MinIO (S3-compatible) + the collector on
`http://localhost:8790`. Dashboard password is `e2e-test-pass`; ingest
key is `dev-ingest-key`.

Open `http://localhost:5173` (run `pnpm dev:web` from the repo root) to
see populated dashboards once you seed data via `pnpm seed`. You can
verify the collector before opening the dashboard with:

```bash
pnpm --filter @obs-unified/cli exec obs-unified doctor --origin http://localhost:5173
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

| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Postgres connection string |
| `PG_POOL_MAX` | no | 10 | Connection pool size |
| `S3_ENDPOINT` | no | — | S3-compatible endpoint URL (omit for AWS S3) |
| `S3_REGION` | no | `us-east-1` | AWS region |
| `S3_BUCKET` | yes | — | Bucket name for replay + pprof blobs |
| `S3_FORCE_PATH_STYLE` | no | `true` | Set to `false` for AWS S3 |
| `S3_ACCESS_KEY_ID` | yes | — | Access key |
| `S3_SECRET_ACCESS_KEY` | yes | — | Secret key |
| `INGEST_KEY` | yes | — | Write-only API key for SDK clients |
| `DASHBOARD_PASSWORD` | yes | — | Dashboard login password |
| `ALLOWED_ORIGINS` | no | — | Comma-separated CORS origins |
| `PORT` | no | 8790 | HTTP listen port |

## Migrations

`node scripts/migrate-pg.mjs` applies every file under
`packages/obs-collector/src/migrations-postgres/` not yet recorded in
the `schema_migrations` tracking table. Safe to re-run.

The Docker stack runs the migrator automatically before starting the
collector via a Compose dependency.

## How this differs from `apps/collector` (Cloudflare Worker)

| Concern | Worker version | Node version |
| --- | --- | --- |
| SQL storage | D1 (SQLite-on-edge) | Postgres |
| Blob storage | R2 | S3 (or compatible) |
| Runtime | workerd | Node 22+ |
| Scheduled retention | Cron Triggers | OS `cron` or Kubernetes `CronJob` (call `POST /internal/retention/run`) |
| Cold-start | <50ms | ~1s on first request after restart |

Both deployments compose the same `@obs-unified/collector` runtime —
plugin code is identical. The only difference is the storage adapter
chosen at startup and the host fetch handler.
