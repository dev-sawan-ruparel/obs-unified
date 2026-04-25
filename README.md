# obs-unified

Self-hosted observability for your project. Traces, logs, usage analytics, session replay, and AI call tracking — no external telemetry services required.

```
npm install @obs/telemetry-sdk @obs/analytics-sdk
```

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
  │                               D1 / SQLite             │
  └──────────────────────────────────────────────────────┘
```

**Two auth boundaries:**
- **SDK to Collector** — write-only API key (like PostHog/Sentry)
- **Dashboard** — password login (like Grafana)

## Quick Start

### 1. Deploy the Collector

The collector is a standalone service that receives telemetry and serves the dashboard.

```bash
npm install @obs/collector hono
```

```typescript
// collector/src/index.ts
import {
  createDefaultCollectorApp,
  createRetentionCleanupHandler,
  createIngestAuth,
  createDashboardAuth,
} from "@obs/collector";

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
npm install @obs/telemetry-sdk
```

```typescript
import { initObservability, createLogger, trackAICall } from "@obs/telemetry-sdk";

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
npm install @obs/analytics-sdk
```

```tsx
import { AnalyticsProvider, useAnalytics } from "@obs/analytics-sdk/react";

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

### Seed sample data (local dev)

To populate every dashboard tab with synthetic data while developing the
UI — without manually clicking through the Playground or waiting on
real traffic — run the seeder. It writes traces, logs, AI calls, usage
events, and alert rules straight to your local collector:

```bash
pnpm run dev      # start collector + demo + dashboard (in separate panes works too)
pnpm run seed     # writes ~70 spans, 20 logs, 12 AI calls, 49 usage events, 3 alert rules
```

After the seed finishes, every tab (Traces / Service Map / Issues /
Logs / AI Calls / Usage / Timeline / Alerts / Resources / Projects)
has data. The only tab that still needs a real browser is **Replays**
— rrweb chunks are captured client-side, so visit the Playground tab
and click "Start replay" once.

The seeder reads `DASHBOARD_PASSWORD` and `OBS_INGEST_KEY` from env
(falling back to the dev defaults), and accepts overrides:

```bash
node scripts/seed-everything/run.mjs \
  --collector http://localhost:8790 \
  --rounds 10
```

## Packages

| Package | Purpose |
|---------|---------|
| `@obs/collector` | Collector service — receives telemetry, stores in D1/SQLite, serves dashboard |
| `@obs/telemetry-sdk` | Backend SDK — structured logging, request spans, AI call tracking |
| `@obs/analytics-sdk` | Frontend SDK — page views, interactions, errors, session replay |
| `@obs/dashboard` | Dashboard UI — React components (also serves as standalone SPA) |
| `@obs/types` | Shared TypeScript types and constants |

## Framework Examples

### Hono (Cloudflare Workers, Node.js, Deno, Bun)

```typescript
import { Hono } from "hono";
import { initObservability, createLogger } from "@obs/telemetry-sdk";

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
import { initObservability } from "@obs/telemetry-sdk";

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-nextjs-app",
});
```

### Express

```typescript
import express from "express";
import { initObservability, createLogger } from "@obs/telemetry-sdk";

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
import { ObsDashboardProvider, TelemetryDashboard } from "@obs/dashboard";

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
