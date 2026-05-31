# System Components

obs-unified is a collector-centered observability stack. Applications emit
telemetry through SDKs or standard OpenTelemetry exporters; the collector
authenticates, stores, and serves that data to the dashboard.

## Runtime Components

| Component                   | Path                                                    | Responsibility                                                                                                       |
| --------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Collector runtime           | [`packages/obs-collector`](../packages/obs-collector)   | Shared Hono app: ingest APIs, dashboard query APIs, auth, retention, analysis, and storage abstractions.             |
| Cloudflare Worker collector | [`apps/collector`](../apps/collector)                   | Edge deployment of the collector runtime backed by D1 and R2.                                                        |
| Node collector              | [`apps/collector-node`](../apps/collector-node)         | Long-running Node deployment of the same collector runtime backed by Postgres and S3-compatible or filesystem blobs. |
| Dashboard app               | [`apps/web`](../apps/web)                               | Standalone React dashboard shell used for local development and the local Docker image.                              |
| Dashboard package           | [`packages/dashboard`](../packages/dashboard)           | Reusable React dashboard components.                                                                                 |
| Browser SDK                 | [`packages/analytics-sdk`](../packages/analytics-sdk)   | Page views, interactions, browser errors, session replay, and click-to-trace correlation.                            |
| TypeScript backend SDK      | [`packages/telemetry-sdk`](../packages/telemetry-sdk)   | Backend traces, logs, AI calls, and Cloudflare helper wrappers.                                                      |
| Polyglot SDKs               | [`sdks`](../sdks)                                       | Thin OpenTelemetry wrappers for non-Workers runtimes such as Node, Go, and Rust.                                     |
| CLI                         | [`packages/cli`](../packages/cli)                       | Local project scaffolding and collector verification commands.                                                       |
| Seed data                   | [`scripts/seed-everything`](../scripts/seed-everything) | Synthetic telemetry used to populate dashboard tabs for first-run and demos.                                         |

## Storage Components

| Data                 | Cloudflare deployment                   | Node deployment                                  | Local first-run image                |
| -------------------- | --------------------------------------- | ------------------------------------------------ | ------------------------------------ |
| SQL data             | D1                                      | Postgres                                         | Postgres inside the container        |
| Replay/profile blobs | R2                                      | S3-compatible storage                            | Filesystem blobs under `/data/blobs` |
| Migrations           | `packages/obs-collector/src/migrations` | `packages/obs-collector/src/migrations-postgres` | Same Postgres migrations             |

The two migration trees are intentionally separate because D1/SQLite and
Postgres differ in JSON, conflict handling, generated IDs, and time functions.
Keep them in parity when changing collector storage.

## Local Entry Points

| Path                      | Command                                                 | Components started                                                       |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| One local image           | `pnpm local:image && pnpm local:run`                    | Postgres, Node collector, dashboard, filesystem blob store, seeded data. |
| Repo dev                  | `pnpm run setup && pnpm run dev && pnpm run seed`       | Worker/dev collector, demo API, Vite dashboard, seeded data.             |
| Astronomy Shop demo       | `pnpm demo:setup && pnpm dev:collector && pnpm demo:up` | Local collector plus upstream OpenTelemetry demo services.               |
| Standalone Node collector | `cd apps/collector-node && docker compose up -d`        | Postgres, MinIO, Node collector.                                         |

## Request Flow

1. Browser and backend SDKs send write-only telemetry to `/v1/*` collector
   endpoints using an ingest key.
2. The collector normalizes and stores signals in SQL tables, with replay and
   profile payloads stored as blobs.
3. Dashboard users authenticate with the dashboard password.
4. The dashboard reads correlated data from `/internal/*` query endpoints.
5. Retention jobs purge expired SQL rows and blob objects.

## First-Run Verification

The local image smoke test exercises the complete Track 0 path:

```bash
pnpm smoke:local-image
```

It builds the image, starts a fresh container, verifies all Postgres migrations
apply, confirms seed data populates the major dashboard tabs, and checks the
collector health endpoint, dashboard HTML, and dashboard login from outside the
container.
