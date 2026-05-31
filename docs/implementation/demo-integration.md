# Demo integration — wiring @obs SDKs into the Astronomy Shop

The Astronomy Shop demo (`pnpm demo:up`) ships with native OTel SDKs. To exercise the click-to-CPU UX end-to-end you need our SDKs in addition. These instructions walk through that wiring without modifying upstream files (which would conflict with `pnpm demo:setup` updates).

## 6.1 — Frontend: replace OTel browser SDK with @obs-unified/analytics-sdk

The frontend lives in `demo/upstream/src/frontend`. `pnpm demo:setup` now applies a small overlay so resyncing the upstream demo doesn't blow away our changes.

### What setup applies

`demo/setup.sh` packs local SDK tarballs into `demo/upstream/.obs-unified`, patches the upstream frontend package manifest, copies `demo/overlays/frontend/obs-bootstrap.tsx`, disables the upstream browser `FrontendTracer()` call, and wraps the Next.js `pages/_app.tsx` tree in `ObsBootstrap`.

### What you get

- Every click/submit/keydown mints an `interaction_id` and pushes it onto outbound `fetch` as `x-obs-interaction`.
- Page views, interactions, and frontend errors flow into `usage_events` with the interaction id.
- rrweb sessions record automatically (via the existing `startReplay` flow).

## 6.2 — Backend: enableProcessMetrics() in select demo services

The demo runs ~15 microservices. You don't need all of them instrumented — the UX scenarios star **frontend** (Node/Next.js) and **payment** (Node). `pnpm demo:setup` now copies `demo/overlays/node/obs-unified.js` into both services, requires it from their existing OTel bootstrap files, and injects `OBS_COLLECTOR_URL=http://host.docker.internal:8790` plus `OBS_INGEST_KEY=...` into `demo/upstream/compose.yaml`.

After ~1 minute of demo traffic, the Health dashboard's "Service CPU utilization" tile (Phase 2.6) populates.

## 6.3 — Backend: optional pprof profiling

For Scenario A's flame graph step, `pnpm demo:setup` now adds `@datadog/pprof` to `payment`, starts the SDK profiler loop from `demo/overlays/node/obs-unified.js`, and records active payment trace IDs from the gRPC handler so profile uploads can populate the trace/profile index.

## 6.4 — Run UX Scenario A

First run:

```bash
pnpm demo:preflight
```

Scenario A needs Docker memory at or above the Astronomy Shop requirement before the compose workload can be trusted.

After 6.1+6.2+6.3 are wired and `pnpm demo:up` is running:

1. Open the demo frontend (`http://localhost:8080`), click around for ~3 minutes.
2. Open the obs dashboard (`http://localhost:5173`), navigate to Health → Services → wait for `service_cpu_utilization` analysis to fire.
3. Click an exemplary trace. The trace summary header should show **🔥 PROFILES <N>** — Phase 4.6 working.
4. Expand a span. The Connected rail (Phase 3) should surface user session, parent trace, related logs.
5. Click "Trace caused by this click" inside the rail of the originating session — closes the loop back to step 3.

If steps 3-5 work, RFC 0003's "≤ 2 clicks to any neighbor" promise is verified end-to-end.

## 6.5 — UX Scenario B

LLM cost spike scenario — needs `@obs-unified/telemetry-sdk`'s `trackAICall` wired into one demo service that hits an LLM. The Astronomy Shop's recommendation service is a candidate; see its existing OTel instrumentation for the integration point.

`pnpm demo:preflight` also checks for a provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, or `GEMINI_API_KEY`) so this scenario does not start with a known-empty LLM environment.

## 6.6 — Playwright matrix

`apps/web/tests/connected-rail.spec.ts` walks the any-to-any matrix from `docs/ux/click-to-cpu.md`. The suite is gated behind `E2E_LIVE_STACK=1` so ordinary Playwright runs skip before dashboard login/setup. Run the live matrix with:

```bash
E2E_LIVE_STACK=1 DASHBOARD_PASSWORD=e2e-test-pass pnpm --filter @obs-demo/web test:e2e:all -- connected-rail
```

Collector-side deterministic coverage for Scenario A and Scenario B lives in `packages/obs-collector/src/plugins/connected-routes.test.ts`; it verifies the graph pivots while full live validation is blocked by local Docker/provider prerequisites.

## 6.7 — Comparison doc refresh

After all UX scenarios pass on the demo, update `docs/comparison/uptrace.md`:
- Move ✓-shipped rows out of the "❌ planned" column
- Add a "Verified end-to-end" badge to the rows the scenarios cover
- Replace the "🟡 in flight" markers on Phase 1-5 features with ✅
