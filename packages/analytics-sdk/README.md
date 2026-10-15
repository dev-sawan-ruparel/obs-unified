# @obsunified/analytics-sdk

Browser analytics SDK for
[obs-unified](https://github.com/dev-sawan-ruparel/obs-unified). Captures usage
events, mints click-scoped `interaction_id` correlation keys, injects them on
outbound `fetch`/XHR, and (optionally) records rrweb session replay chunks.

```bash
pnpm add @obsunified/analytics-sdk
```

## React

```tsx
import {
  AnalyticsProvider,
  AnalyticsErrorBoundary,
} from "@obsunified/analytics-sdk/react";

createRoot(document.getElementById("root")!).render(
  <AnalyticsProvider
    collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL}
    apiKey={import.meta.env.VITE_OBS_INGEST_KEY}
    trackPageViews
    captureErrors
  >
    <AnalyticsErrorBoundary context="App">
      <App />
    </AnalyticsErrorBoundary>
  </AnalyticsProvider>,
);
```

The provider installs **Mode A auto-correlation**: every click / submit /
keydown mints an `interaction_id` and `window.fetch` is patched to add the
`x-obs-interaction` header on outbound requests. No per-button wiring needed for
the happy path.

## Vanilla / non-React

```ts
import { installAutoCorrelate, UsageTracker } from "@obsunified/analytics-sdk";

const tracker = new UsageTracker({
  collectorUrl: "https://obs.my-app.com",
  apiKey: "...",
});

installAutoCorrelate({ tracker });
```

## Mode B — manual interaction context

For async work that escapes the microtask cascade (debounce, setTimeout, state
machines), capture and re-enter explicitly:

```ts
import {
  currentInteractionId,
  withInteractionContext,
} from "@obsunified/analytics-sdk";

const id = currentInteractionId();
setTimeout(() => {
  withInteractionContext(id!, () => {
    fetch("/api/long-running"); // carries the click's interaction_id
  });
}, 500);
```

## Identity propagation

The interaction key flows: browser click → `x-obs-interaction` header → server
stamps it onto the root span → every child span / log / AI call in that request
inherits it. See
[`docs/spec/interaction-id.md`](../../docs/spec/interaction-id.md) for the wire
spec.

## Full docs

[https://docs.obsunified.com](https://docs.obsunified.com) (source in
`apps/docs` of the monorepo for self-hosting).

## Runtime lineage

Lineage is attached once per event under `context`, using the wire attribute names below. It is not duplicated into `properties`. Env vars are read only where `process.env` exists (for example SSR); in the browser pass the options explicitly.

Every option is optional. Pass them flat on the init config (the nested `lineage` option still works but is deprecated):

| Option | Env vars read automatically (first match wins) | Wire attributes |
| --- | --- | --- |
| `environment` | `OBS_ENVIRONMENT`, `NODE_ENV` | `deployment.environment.name`, `obs.environment` |
| `serviceVersion` | `OBS_SERVICE_VERSION`, `OTEL_SERVICE_VERSION` | `service.version`, `obs.service.version` |
| `commitSha` | `OBS_COMMIT_SHA`, `GITHUB_SHA` | `vcs.commit.id`, `obs.commit.sha` |
| `configDigest` | `OBS_CONFIG_DIGEST` | `obs.config.digest` |

Explicit options win over env vars. `environment` is normalised so spans and change events join: lowercased and trimmed, `production` becomes `prod`, `development` becomes `dev`, `test` is unchanged, and an empty value becomes `default`. So `NODE_ENV=production` and a change posted as `prod` land in the same environment.

Call `recordFeatureFlag(key, variant, { providerName, contextId })` when you evaluate a flag. The evaluation is attached to the active span as `feature_flag.*` and `obs.feature_flags.<key>` attributes, so AutoSRE can compute flag cohorts.
