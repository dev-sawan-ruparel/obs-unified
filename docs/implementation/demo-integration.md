# Demo integration — wiring @obs SDKs into the Astronomy Shop

The Astronomy Shop demo (`pnpm demo:up`) ships with native OTel SDKs. To exercise the click-to-CPU UX end-to-end you need our SDKs in addition. These instructions walk through that wiring without modifying upstream files (which would conflict with `pnpm demo:setup` updates).

## 6.1 — Frontend: replace OTel browser SDK with @obs-unified/analytics-sdk

The frontend lives in `demo/upstream/src/frontend`. We use a small overlay so resyncing the upstream demo doesn't blow away our changes.

### Overlay file

Add to `demo/overlays/frontend/src/obs-bootstrap.tsx`:

```tsx
import { AnalyticsProvider } from "@obs-unified/analytics-sdk/react";
import type { ReactNode } from "react";

export function ObsBootstrap({ children }: { children: ReactNode }) {
  return (
    <AnalyticsProvider
      collectorUrl={import.meta.env.VITE_OBS_COLLECTOR_URL ?? "http://localhost:8790"}
      apiKey={import.meta.env.VITE_OBS_INGEST_KEY ?? "obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504"}
      autoCorrelate
      trackPageViews
      captureErrors
    >
      {children}
    </AnalyticsProvider>
  );
}
```

### Mount in the demo's entry point

Edit `demo/upstream/src/frontend/src/main.tsx` (or wrap in your overlay):

```tsx
import { ObsBootstrap } from "./obs-bootstrap";

ReactDOM.createRoot(rootEl).render(
  <ObsBootstrap>
    <App />
  </ObsBootstrap>,
);
```

### What you get

- Every click/submit/keydown mints an `interaction_id` and pushes it onto outbound `fetch` as `x-obs-interaction`.
- Page views, interactions, and frontend errors flow into `usage_events` with the interaction id.
- rrweb sessions record automatically (via the existing `startReplay` flow).

## 6.2 — Backend: enableProcessMetrics() in select demo services

The demo runs ~15 microservices. You don't need all of them instrumented — the UX scenarios star **frontend-svc** (Node) and **payment-svc** (Node). Wire the helper in those two:

```ts
import { initObservability, enableProcessMetrics } from "@obs-unified/telemetry-sdk";

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "payment-svc",
});

enableProcessMetrics({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "payment-svc",
  intervalMs: 30_000,
});
```

Set `OBS_COLLECTOR_URL=http://host.docker.internal:8790` and `OBS_INGEST_KEY=...` in the service's docker-compose env.

After ~1 minute of demo traffic, the Health dashboard's "Service CPU utilization" tile (Phase 2.6) populates.

## 6.3 — Backend: optional pprof profiling

For Scenario A's flame graph step, configure `@datadog/pprof` on payment-svc:

```ts
import { time, encode } from "@datadog/pprof";
import { pushProfile } from "@obs-unified/telemetry-sdk";

setInterval(async () => {
  const profile = await time.profile({ durationMillis: 60_000 });
  const buffer = await encode(profile);
  await pushProfile({
    collectorUrl: process.env.OBS_COLLECTOR_URL!,
    apiKey: process.env.OBS_INGEST_KEY!,
    serviceName: "payment-svc",
    profileType: "cpu",
    blob: buffer,
    durationMs: 60_000,
    agent: "datadog-pprof",
  });
}, 60_000);
```

You'll want trace_id labels too — see `docs/howto/profiling.md` § Node.js for the wrapping pattern that extracts the OTel context.

## 6.4 — Run UX Scenario A

After 6.1+6.2+6.3 are wired and `pnpm demo:up` is running:

1. Open the demo frontend (`http://localhost:8080`), click around for ~3 minutes.
2. Open the obs dashboard (`http://localhost:5173`), navigate to Health → Services → wait for `service_cpu_utilization` analysis to fire.
3. Click an exemplary trace. The trace summary header should show **🔥 PROFILES <N>** — Phase 4.6 working.
4. Expand a span. The Connected rail (Phase 3) should surface user session, parent trace, related logs.
5. Click "Trace caused by this click" inside the rail of the originating session — closes the loop back to step 3.

If steps 3-5 work, RFC 0003's "≤ 2 clicks to any neighbor" promise is verified end-to-end.

## 6.5 — UX Scenario B

LLM cost spike scenario — needs `@obs-unified/telemetry-sdk`'s `trackAICall` wired into one demo service that hits an LLM. The Astronomy Shop's recommendation service is a candidate; see its existing OTel instrumentation for the integration point.

## 6.6 — Playwright matrix

`apps/web/tests/connected-rail.spec.ts` (skeleton in this repo at `tests/scaffold/connected-rail.spec.ts`) walks the any-to-any matrix from `docs/ux/click-to-cpu.md`. Run with:

```bash
DASHBOARD_PASSWORD=e2e-test-pass pnpm --filter @obs-demo/web test:e2e
```

The current scaffold marks every cell as `it.skip` — flip them to `it` as each cell is verified manually first.

## 6.7 — Comparison doc refresh

After all UX scenarios pass on the demo, update `docs/comparison/uptrace.md`:
- Move ✓-shipped rows out of the "❌ planned" column
- Add a "Verified end-to-end" badge to the rows the scenarios cover
- Replace the "🟡 in flight" markers on Phase 1-5 features with ✅
