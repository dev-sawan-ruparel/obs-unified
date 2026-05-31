# @obs-unified/collector

Plugin-based observability collector runtime. Receives OTLP traces / logs / AI
calls / usage events / replays / profiles, persists them via a pluggable `SqlDb`
interface (D1 today, Postgres in progress), and exposes both ingest and
read-side HTTP routes.

This package is the **runtime library**. To deploy a collector you either:

1. Use [`apps/collector`](../../apps/collector) (Cloudflare Worker) as a
   ready-to-deploy host, or
2. Compose `createDefaultCollectorApp` with your own Hono entrypoint and storage
   bindings.

```ts
import {
  createDefaultCollectorApp,
  createIngestAuth,
  createDashboardAuth,
  createRetentionCleanupHandler,
} from "@obs-unified/collector";

const app = createDefaultCollectorApp({
  auth: { middleware: createIngestAuth({ secret: env.INGEST_KEY }) },
  dashboardAuth: createDashboardAuth({ password: env.DASHBOARD_PASSWORD }),
  allowedOrigins: env.ALLOWED_ORIGINS,
});

export default {
  fetch: app.fetch,
  scheduled: createRetentionCleanupHandler().scheduled,
};
```

## Storage adapters

The runtime touches the database exclusively through
[`SqlDb`](./src/lib/sql-db.ts). Adapters available:

| Adapter           | Path                               | Status          |
| ----------------- | ---------------------------------- | --------------- |
| D1 (Cloudflare)   | `src/lib/sql-db-d1.ts`             | shipping        |
| In-memory (tests) | `src/lib/test-utils/mem-sql-db.ts` | shipping        |
| Postgres          | `src/lib/sql-db-postgres.ts`       | shipping (v1.1) |

Same story for blob storage (replay chunks + pprof) — the runtime uses a
`BlobStore` interface with R2 and S3 adapters.

## Subpath entries

| Entry    | Purpose                                                     |
| -------- | ----------------------------------------------------------- |
| `.`      | `createDefaultCollectorApp`, processors, storage interfaces |
| `./auth` | Ingest + dashboard auth middlewares                         |

## Self-instrumentation

The collector itself ships telemetry via `@obs-unified/telemetry-sdk`
(loop-guarded by an `X-Telemetry-Self: 1` header). See
[`apps/collector/SELF_INSTRUMENTATION.md`](../../apps/collector/SELF_INSTRUMENTATION.md).
