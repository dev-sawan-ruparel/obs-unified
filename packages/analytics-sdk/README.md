# @obs-unified/analytics-sdk

Browser analytics SDK for
[obs-unified](https://github.com/obs-unified/obs-unified). Captures usage
events, mints click-scoped `interaction_id` correlation keys, injects them on
outbound `fetch`/XHR, and (optionally) records rrweb session replay chunks.

```bash
pnpm config set @obs-unified:registry https://npm.pkg.github.com
pnpm login --scope=@obs-unified --auth-type=legacy --registry=https://npm.pkg.github.com
pnpm add @obs-unified/analytics-sdk
```

## React

```tsx
import {
  AnalyticsProvider,
  AnalyticsErrorBoundary,
} from "@obs-unified/analytics-sdk/react";

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
import { installAutoCorrelate, UsageTracker } from "@obs-unified/analytics-sdk";

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
} from "@obs-unified/analytics-sdk";

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

[https://obs-unified-docs.dev](https://obs-unified-docs.dev) (or the
`obs-unified-docs` repo for self-hosting).
