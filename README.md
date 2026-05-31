# obs-unified

Self-hosted observability for your project. Traces, logs, usage analytics, session replay, profiles, and AI call tracking — no external telemetry services required.

The TypeScript packages publish to GitHub Packages. Configure the
`@obs-unified` scope once, then install the SDKs:

```bash
pnpm config set @obs-unified:registry https://npm.pkg.github.com
pnpm login --scope=@obs-unified --auth-type=legacy --registry=https://npm.pkg.github.com
pnpm add @obs-unified/telemetry-sdk @obs-unified/analytics-sdk
```

See [docs/github-packages.md](docs/github-packages.md) for GitHub Packages
authentication details and the Go/Rust install paths.

## Architecture

```
                       Your Infrastructure
  ┌──────────────────────────────────────────────────────┐
  │                                                      │
  │   Your Backend ──(API key)──> Collector Service      │
  │                               ├─ /v1/* ingest        │
  │   Your Frontend ──(API key)──>├─ /internal/* queries  │
  │                               ├─ /dashboard/* UI      │
  │                               └─ /health              │
  │                                    │                  │
  │                               D1/R2 or Postgres/S3    │
  └──────────────────────────────────────────────────────┘
```

**Two auth boundaries:**
- **SDK to Collector** — write-only API key (like PostHog/Sentry)
- **Dashboard** — password login (like Grafana)

## Quick Start

### Instrument an existing app

Start by choosing your language and framework, then follow the matching
example:

| App shape | Start here |
| --- | --- |
| React/Vite frontend + Hono API | [React + Hono walkthrough](docs/howto/instrument-react-hono.md) |
| Browser-only app | [Analytics SDK README](packages/analytics-sdk/README.md) |
| TypeScript backend | [Telemetry SDK README](packages/telemetry-sdk/README.md) |
| Python, JVM, .NET, Go, Rust | [Language recipes](docs/recipes/README.md) |

The common wiring is: run a collector, add the browser/backend SDK package,
set `OBS_COLLECTOR_URL` plus an ingest key, allow the `x-obs-interaction`
CORS header for browser calls, and verify the collector path with
`obs-unified doctor`.

### 1. Deploy the Collector

The collector is a standalone service that receives telemetry and serves the dashboard.

```bash
pnpm add @obs-unified/collector hono
```

```typescript
// collector/src/index.ts
import {
  createDefaultCollectorApp,
  createRetentionCleanupHandler,
  createIngestAuth,
  createDashboardAuth,
} from "@obs-unified/collector";

const app = createDefaultCollectorApp({
  auth: {
    middleware: createIngestAuth({
      secret: env.INGEST_KEY,
    }),
  },
  dashboardAuth: createDashboardAuth({
    password: env.DASHBOARD_PASSWORD,
  }),
  allowedOrigins: env.ALLOWED_ORIGINS, // your frontend origin(s)
});

export default {
  fetch: app.fetch,
  scheduled: createRetentionCleanupHandler().scheduled,
};
```

Set environment variables:
| Variable | Required | Description |
|----------|----------|-------------|
| `INGEST_KEY` | Yes (prod) | Write-only API key for SDKs |
| `DASHBOARD_PASSWORD` | Yes (prod) | Password for dashboard login |
| `ALLOWED_ORIGINS` | Recommended | Comma-separated CORS origins |
| `RETENTION_HOURS` | No | Data retention window (default: 72) |
| `ALLOW_UNAUTHENTICATED` | No | Set `"true"` for local dev |

### 2. Instrument Your Backend

```bash
pnpm add @obs-unified/telemetry-sdk
```

```typescript
import { initObservability, createLogger, trackAICall } from "@obs-unified/telemetry-sdk";

// Initialize once at startup
initObservability({
  collectorUrl: "https://obs.my-app.com",
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-api",
});

// Create loggers per module
const logger = createLogger("users");

// Use in your routes
app.get("/users", async (c) => {
  logger.info("Listing users");
  const users = await db.users.findMany();
  return c.json(users);
});

// Track AI calls
trackAICall({
  modelName: "claude-sonnet-4-20250514",
  provider: "anthropic",
  callType: "chat",
  promptTokens: 150,
  completionTokens: 80,
  latencyMs: 1200,
  totalCostUsd: 0.003,
});
```

### 3. Instrument Your Frontend

```bash
pnpm add @obs-unified/analytics-sdk
```

```tsx
import { AnalyticsProvider, useAnalytics } from "@obs-unified/analytics-sdk/react";

// Wrap your app
function App() {
  return (
    <AnalyticsProvider
      collectorUrl="https://obs.my-app.com"
      apiKey="your-public-ingest-key"
      trackPageViews
      captureErrors
    >
      <YourApp />
    </AnalyticsProvider>
  );
}

// Use in components
function CheckoutButton() {
  const { trackInteraction, identify } = useAnalytics();

  return (
    <button onClick={() => {
      trackInteraction("checkout_click", { plan: "pro" });
      identify("user-123", { email: "user@example.com" });
    }}>
      Checkout
    </button>
  );
}
```

### 4. Open the Dashboard

Visit your collector URL in a browser. Enter the dashboard password. Done.

```
https://obs.my-app.com/dashboard
```

### Populate dashboards with realistic data

Two paths, depending on whether you have Docker.

#### Recommended — point the OpenTelemetry Astronomy Shop at the collector

The canonical OSS observability demo (~15 microservices in Go / Java /
.NET / Node / Python / Rust, all emitting OTLP natively) becomes our
data source. It includes a Locust load generator that drives the React
frontend continuously, and built-in feature flags for failure injection
that exercise Service Map + Issues realistically.

```bash
pnpm dev:collector   # in one terminal
pnpm demo:setup      # one-time: clones the demo into demo/upstream/
pnpm demo:up         # docker compose up; ~30 s to first traffic
```

Open `http://localhost:5173` — Traces, Service Map, Issues, Logs, and
Metrics all populate from real microservice traffic. Tear down with
`pnpm demo:down`. Full details: [demo/README.md](demo/README.md).

> Requires Docker + docker-compose v2. ~6 GB RAM. First run pulls ~3 GB
> of images.

#### Fallback — synthetic seeder (no Docker)

Faster but less realistic — writes ~70 spans, 20 logs, 12 AI calls, 49
usage events, and 3 alert rules straight to the collector:

```bash
pnpm run dev      # start collector + demo + dashboard (in separate panes works too)
pnpm run seed
```

The synthetic seeder doesn't generate Service Map edges or sustained
load; use it when you want to iterate on UI without booting Docker.

```bash
# overrides
node scripts/seed-everything/run.mjs \
  --collector http://localhost:8790 \
  --rounds 10
```

The only tab that needs a real browser regardless is **Replays** —
rrweb chunks are captured client-side, so visit the Playground tab and
click "Start replay" once.

## Packages

| Package | Purpose |
|---------|---------|
| `@obs-unified/collector` | Collector service — receives telemetry, stores in D1/SQLite, serves dashboard |
| `@obs-unified/telemetry-sdk` | Backend SDK (Cloudflare Workers) — structured logging, request spans, D1/R2/fetch wrappers, AI call tracking |
| `@obs-unified/analytics-sdk` | Frontend SDK — page views, interactions, errors, session replay |
| `@obs-unified/dashboard` | Dashboard UI — React components (also serves as standalone SPA) |
| `@obs-unified/types` | Shared TypeScript types and constants |

## Polyglot SDKs ([`sdks/`](./sdks))

Thin OpenTelemetry SDK wrappers for non-Workers languages. They configure
the standard OTel SDK to point at this collector and add OpenInference
helpers for LLM/tool spans and project propagation. HTTP / DB / RPC
auto-instrumentation comes from the OTel ecosystem of each language.

| Language | Path | Package |
|---|---|---|
| Node.js / TypeScript | [`sdks/node`](./sdks/node) | `@obs-unified/sdk` |
| Go | [`sdks/go`](./sdks/go) | `github.com/obs-unified/obs-unified/sdks/go` |
| Rust | [`sdks/rust`](./sdks/rust) | `obs-unified` |

Each SDK exposes the same surface — see [`sdks/README.md`](./sdks/README.md)
for the cross-language API map. The instrumentation philosophy (what's
auto vs. manual, when to annotate, how span nesting works) is documented
once in [`packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md`](./packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md).

## Framework Examples

### Hono (Cloudflare Workers, Node.js, Deno, Bun)

```typescript
import { Hono } from "hono";
import { initObservability, createLogger } from "@obs-unified/telemetry-sdk";

const app = new Hono();

app.use("*", async (c, next) => {
  initObservability({
    collectorUrl: c.env.OBS_COLLECTOR_URL,
    apiKey: c.env.OBS_INGEST_KEY,
    serviceName: "my-api",
  });
  await next();
});
```

### Next.js

```typescript
// lib/observability.ts
import { initObservability } from "@obs-unified/telemetry-sdk";

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-nextjs-app",
});
```

### Express

```typescript
import express from "express";
import { initObservability, createLogger } from "@obs-unified/telemetry-sdk";

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-express-app",
});

const logger = createLogger("server");
const app = express();

app.get("/health", (req, res) => {
  logger.info("Health check");
  res.json({ status: "ok" });
});
```

## Embedding the Dashboard

For teams that want to embed observability views in their own admin panel:

```tsx
import { ObsDashboardProvider, TelemetryDashboard } from "@obs-unified/dashboard";

function AdminObservability() {
  return (
    <ObsDashboardProvider basePath="/api/obs">
      <TelemetryDashboard mode="traces" onNavigate={() => {}} />
    </ObsDashboardProvider>
  );
}
```

## Local Development

```bash
pnpm install
pnpm run setup     # Initialize database
pnpm run dev       # Start collector (:8790), API (:8787), web (:5173)
```

## What Gets Collected

- **Traces** — Request spans with timing, status, and attributes (OTLP format)
- **Logs** — Structured logs with severity, trace correlation, and attributes
- **Usage** — Page views, interactions, frontend errors, UTM parameters
- **Session Replay** — DOM recording via rrweb for visual session playback
- **AI Calls** — Model name, provider, tokens, cost, latency, errors
- **User Profiles** — Identity linking (visitor ID to user ID)
