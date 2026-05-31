# Migrating from Sentry

obs-unified covers Sentry's error monitoring, performance tracing, and session
replay — plus full usage analytics and AI call tracking. Most Sentry users won't
outgrow obs-unified for the error use case, but the flow is broader.

## Concept mapping

| Sentry                 | obs-unified                                                 |
| ---------------------- | ----------------------------------------------------------- |
| Issue (grouped errors) | Issue (grouped errors, by trace fingerprint)                |
| Transaction            | Trace (root span)                                           |
| Span                   | Span (same OTel model)                                      |
| Breadcrumb             | Log record (correlated to trace)                            |
| Session replay         | Session replay (rrweb, same wire format)                    |
| Release / environment  | `service.version` + `deployment.environment` resource attrs |
| Source maps            | Server-side reverse mapping on the dashboard                |

## SDK swap — backend (Node/Hono example)

```diff
- import * as Sentry from "@sentry/node";
- Sentry.init({ dsn: "https://…@sentry.io/…" });
+ import {
+   initObservability,
+   createRequestSpan,
+   runWithSpan,
+   stampInteractionFromRequest,
+ } from "@obs-unified/telemetry-sdk";
+
+ initObservability({
+   collectorUrl: process.env.OBS_COLLECTOR_URL!,
+   apiKey: process.env.OBS_INGEST_KEY!,
+   serviceName: "my-api",
+ });

  app.use("*", async (c, next) => {
-   await Sentry.startSpan({ name: c.req.path }, () => next());
+   const span = createRequestSpan("my-api", `${c.req.method} ${c.req.path}`);
+   stampInteractionFromRequest(span, c.req.raw);
+   await runWithSpan(span, () => next());
+   span.end();
  });

- Sentry.captureException(err);
+ logger.error("operation failed", { err });
```

## SDK swap — browser

```diff
- import * as Sentry from "@sentry/react";
- Sentry.init({ dsn: "https://…@sentry.io/…", integrations: [Sentry.replayIntegration()] });
+ import { AnalyticsProvider, AnalyticsErrorBoundary } from "@obs-unified/analytics-sdk/react";
+ <AnalyticsProvider collectorUrl={…} apiKey={…} trackPageViews captureErrors>
+   <AnalyticsErrorBoundary context="App">
+     <App />
+   </AnalyticsErrorBoundary>
+ </AnalyticsProvider>
```

## What you GAIN

- **Click-to-trace pivot.** A user clicked "Submit" → see the exact trace,
  including DB queries and external API calls. Sentry has spans but doesn't tie
  them to UI events end-to-end.
- **AI call tracking** as a first-class signal type.
- **Usage events alongside errors.** Sentry has a separate session view;
  obs-unified surfaces them on a unified timeline.

## What you LOSE (today)

- **Source-map managed upload.** obs-unified does not run a sourcemap service.
  If your frontend errors include minified stack traces, you'll need to keep
  Sentry running or roll your own reverse-mapping.
- **Alerting integrations** — Sentry has rich PagerDuty / Slack / Microsoft
  Teams routing. obs-unified ships webhook alerts; channel integrations are
  roadmap.
- **Issue tracking integrations** (Jira / Linear ticket creation from an issue).
  Roadmap.

## Performance comparison

Sentry's transaction sampling is rate-based by default (10%); obs-unified
samples 100% by default with retention bounded by `RETENTION_HOURS` (default
72h). Pick the model that fits — for most self-hosted users, 100%-of-72h is what
they want.
