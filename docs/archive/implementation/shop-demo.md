# Shop Demo Plan

The hosted public demo lives in a **separate repository** that someone can also
clone to see exactly how an obs-unified integration looks in a real app. It is
both a hosted artifact (something visitors can click through at
`demo.obsunified.com`) and a reference example (something a prospective user can
run locally with their own collector keys).

`apps/obs-demo` remains useful inside this repo as the low-level signal
generator and smoke-test worker. The OpenTelemetry Astronomy Shop
(`pnpm demo:up`) remains useful as the local polyglot stress test. Neither is
the hosted public demo.

## Why a new demo

The OpenTelemetry Astronomy Shop is the obvious candidate but is impractical as
a hosted public demo:

- ~15 polyglot microservices running in Docker.
- Persistent compute footprint, real cost per visitor.
- Built around the OTel project's UX, not obs-unified's.

The shop demo trades signal breadth (Astronomy Shop's 6+ languages, native OTel
coverage) for hostability and clarity:

- A two-process React + Hono app that fits on Cloudflare Pages + Workers with
  effectively zero idle cost.
- Surfaces obs-unified's specific UX (interaction → trace → log → AI → replay)
  rather than generic OTel ingest.
- Doubles as the canonical integration example, so prospective users can clone
  it and see a working setup instead of reading a guide.

## Goal

Create a public demo project that:

- Visitors can open at `demo.obsunified.com`, click through, and inspect in a
  dashboard.
- Prospective users can clone, set their own `OBS_*` env vars, and have a
  working obs-unified integration on their own machine.

Canonical links:

- Storefront: `https://demo.obsunified.com`
- Dashboard: `https://demo.obsunified.com/dashboard`
- Source: `https://github.com/obs-unified/shop-demo` (final URL TBD)

Landing page copy:

> Demo: explore a React + Hono ecommerce app wired into obs-unified, with
> traces, logs, AI calls, product events, replay, alerts, and connected
> investigations. The full source is on GitHub — clone it to see exactly how the
> integration is wired.

## Repository shape

The demo is a standalone repo, not an entry under `apps/` in obs-unified. The
repo serves three distinct audiences:

| Audience                         | What they need                                                            |
| -------------------------------- | ------------------------------------------------------------------------- |
| Visitor at `demo.obsunified.com` | Clickable storefront, working dashboard, scenario buttons.                |
| Prospective user reading code    | A README walkthrough; SDK calls visible without monorepo indirection.     |
| obs-unified contributor          | The ability to point the demo at a local collector and a local SDK build. |

Implications:

- Depend on **published** `@obsunified/analytics-sdk` and
  `@obsunified/telemetry-sdk`, not `workspace:*` links. The reference value
  collapses if it pins to workspace.
- Provide an escape hatch (`OBS_SDK_PATH` env, or documented `pnpm link`
  instructions) so SDK contributors can test unreleased SDK changes against the
  demo.
- **SDK version strategy:** pin to known-good SDK versions in `package.json`.
  Upgrades arrive as Renovate PRs gated on the behavior-based Playwright suite
  (see Success Criteria). A separate **canary** workflow runs the same suite
  against `@obsunified/*@latest` on a daily schedule and alerts on failure —
  early warning without breaking the public demo. Pin-and-renovate for the
  deployed demo; float for the canary.
- License the repo permissively (MIT) — visitors are expected to copy from it.
- Enable GitHub's "Use this template" so the repo can be the literal starting
  point for a new integration.

Doc location: this plan lives at `obs-unified/docs/implementation/shop-demo.md`
during planning. Once the repo exists, the canonical instructions move to the
demo repo's README. This file remains as a pointer + architectural rationale.

## Stack

- React 19 (pin to the version `packages/dashboard` uses to avoid duplicate
  React copies in shared bundles)
- Vite
- Tailwind CSS
- Hono backend on a Cloudflare Worker
- `@obsunified/analytics-sdk` in the browser (published version)
- `@obsunified/telemetry-sdk` in the backend (published version)

This combination verifies the first-party SDKs in a modern frontend/backend
split and gives a believable propagation path from browser interaction to API
span to dashboard surface.

## Repository layout

The new repo's root, not a workspace entry:

```text
shop-demo/                       # repo root
  README.md                      # integration walkthrough (the reference)
  LICENSE                        # MIT
  package.json
  vite.config.ts
  tsconfig.json
  wrangler.toml
  index.html
  vendor/                        # prebuilt obs-collector + dashboard artifacts
    obs-collector/               #   so `pnpm dev` boots the full stack locally
    obs-dashboard/               #   without cloning obs-unified
  src/
    frontend/
      main.tsx
      App.tsx
      components/
        ProductGrid.tsx
        ProductDetail.tsx
        CartDrawer.tsx
        Checkout.tsx
        AssistantPanel.tsx
        ScenarioBar.tsx
        HealthBadge.tsx
        DemoBanner.tsx
      lib/
        api.ts
        analytics.ts
        data.ts
    backend/
      server.ts
      routes/
        products.ts
        cart.ts
        checkout.ts
        assistant.ts
        support.ts
        health.ts
      telemetry/
        obs.ts
        logger.ts
        hono-middleware.ts       # see "Instrumentation"
      scenarios/
        happyCheckout.ts
        paymentFailure.ts
        slowSearch.ts
        aiAssistant.ts
        runAll.ts
      synthetic/
        runner.ts                # cron-triggered probe (see Self-monitoring)
  tests/
    e2e/                         # Playwright suite (see Success Criteria)
  .github/
    workflows/
      ci.yml                     # pin builds + Playwright gate
      canary.yml                 # daily build against latest SDK
      deploy.yml                 # Cloudflare Pages + Worker
```

## Local Runtime

Recommended local ports for a developer running the standalone repo:

| Service       | URL                     | Provided by                                                      |
| ------------- | ----------------------- | ---------------------------------------------------------------- |
| Shop frontend | `http://localhost:5174` | shop-demo repo (Vite dev)                                        |
| Hono API      | `http://localhost:8788` | shop-demo repo (wrangler dev)                                    |
| Collector     | `http://localhost:8790` | shop-demo repo (prebuilt obs-collector in `vendor/`)             |
| Dashboard     | `http://localhost:5173` | shop-demo repo (Vite preview of prebuilt dashboard in `vendor/`) |

For reference, in obs-unified itself `apps/obs-demo` uses port 8787 and the
Astronomy Shop's frontend uses port 8080. None should be running simultaneously
with the shop demo.

**Local-clone completeness — the "one command" target.** The demo repo bundles
prebuilt obs-collector and dashboard artifacts under `vendor/` so `pnpm dev`
boots all four services together via a process orchestrator (e.g.
`concurrently`). Visitors do not need to clone or build obs-unified itself —
that breaks the "experience how it will work for them" framing at the first
step.

The bundled artifacts upgrade with each Renovate PR alongside the SDK pins (see
Repository shape) so the demo's local stack and its hosted stack always match.
The `vendor/` directory ships compiled output only, not source — it's a
reproducible build target, not a fork.

Vite proxies `/api/*` to the Hono server. The frontend reads the collector URL
and ingest key from environment variables.

## Product Concept

Use a small ecommerce store. Suggested placeholder name: **Observability
Store**.

Core user flows:

- Browse products
- Search product catalog
- View product detail
- Add to cart
- Apply coupon
- Checkout
- Ask an AI shopping assistant
- Request support summary

This domain is intentionally familiar. Visitors understand what should happen
without learning a fake internal business system first.

## API Surface

```text
GET  /api/products
GET  /api/products/:id
POST /api/cart
POST /api/checkout
POST /api/assistant
POST /api/support/summary

POST /api/scenarios/happy-checkout
POST /api/scenarios/payment-failure
POST /api/scenarios/slow-search
POST /api/scenarios/ai-cost-spike
POST /api/scenarios/run-all

GET  /api/health                  # see Self-monitoring
```

Scenario routes must be deterministic and safe to run repeatedly. They generate
enough data for a dashboard visitor to see interesting traces, logs, AI calls,
usage events, replay sessions, and alerts without needing to create the data
manually.

**Scenario response shape.** Every scenario route returns the `trace_id` of its
primary span so the frontend can deep-link the visitor straight to the resulting
trace:

```ts
type ScenarioResponse = {
  status: "ok" | "error";
  scenario: string; // e.g. "happy-checkout"
  traceId: string; // primary span's trace_id
  dashboardUrl: string; // pre-built deep-link, e.g.
  // "https://demo.obsunified.com/dashboard/#/traces?trace=<id>"
  signalsExercised: string[]; // for the success-card UI tooltip
};
```

`run-all` returns
`{ runs: ScenarioResponse[], primaryTraceId: string, primaryDashboardUrl: string }`
where `primaryTraceId` points at one curated trace (typically happy-checkout) so
the single-link handoff still works.

`run-all` invariants:

- **Idempotent** — running twice produces the same dashboard shape, not double
  the data. Implementations: clear+seed, or seed-with-stable-IDs.
- **Bounded** — caps each sub-scenario to a fixed event count.
- **Ordered** — sub-scenarios run in a documented sequence so the resulting
  dashboard tells a coherent story.

## Instrumentation Requirements

### Frontend

Initialize `@obsunified/analytics-sdk` once during app bootstrap.

Capture:

- Page views
- Product viewed
- Search submitted
- Add to cart
- Coupon applied
- Checkout started
- Checkout completed
- Assistant opened
- Assistant question submitted
- Payment retry / failed checkout behavior
- Replay session events

The frontend must propagate interaction context into backend `fetch` calls so a
dashboard user can pivot from a click or replay segment to the backend trace it
caused.

**Replay privacy hardening.** rrweb captures whatever visitors type. The
analytics SDK's privacy defaults are safe out of the box —
`maskAllInputs: true`, password/email/tel masked, text input values
asterisk-padded (see `packages/analytics-sdk/src/usage-tracker.ts`
`startReplay()`). For the public demo, tighten further using the SDK's
`replayPrivacyOptions` (added so consumers can override without forking the
SDK):

```ts
<AnalyticsProvider
  collectorUrl={...}
  apiKey={...}
  replayPrivacyOptions={{
    maskInputOptions: { text: true },   // also mask plain text inputs
    blockSelector: "[data-no-record]",  // exclude marked subtrees entirely
  }}
>
```

Two additional layers:

- **Server-side PII scrubbing** at the collector receive plugin: regex scrub for
  email / phone / card patterns on usage event properties before persist.
  Belt-and-braces in case a visitor pastes PII into a field the masking config
  missed.
- **Recording banner** persistent on the storefront: "This page records
  interactions for demo purposes — synthetic data only." Required for the public
  deploy; suppressed when running locally with a private collector.

For the cloned-locally path, replay starts **off by default** so prospective
users don't ship session recording to their own backend by accident. Opt-in via
`VITE_OBS_REPLAY_ENABLED=true`.

### Backend

Initialize `@obsunified/telemetry-sdk` in the Hono server.

The SDK does not currently ship a Hono middleware (verified against
`sdks/node/src/`). The demo will hand-roll one in
`src/backend/telemetry/hono-middleware.ts`. If it generalizes cleanly, extract
it into the SDK as a follow-up — but treat the demo as the first consumer, not a
blocker on SDK work.

The middleware should:

- create one span per inbound request
- preserve propagated trace and interaction context
- attach route, method, status, user/session identifiers, and scenario name
- emit structured logs for important business events

Expected child spans:

- product lookup
- catalog search
- inventory check
- coupon validation
- payment authorization
- payment retry
- shipping quote
- recommendation lookup
- support summary generation

Expected AI spans:

- shopping assistant answer
- product recommendation
- support summary
- optional cost-spike scenario

## Scenario Matrix

| Scenario        | User story                                                         | Signals exercised                             |
| --------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Happy checkout  | User searches, views a product, adds it to cart, and checks out.   | traces, logs, usage, replay                   |
| Payment failure | Checkout fails once, logs a payment error, retries, then succeeds. | traces, logs, errors, alert candidate, replay |
| Slow search     | Product search is intentionally slow for one query.                | traces, latency, logs, alert candidate        |
| AI assistant    | User asks for a product recommendation.                            | AI spans, traces, logs, usage                 |
| AI cost spike   | Assistant uses an expensive model/path for a batch of requests.    | AI cost, alert candidate, analysis            |
| Replay pivot    | User rage-clicks checkout or corrects a form field.                | replay, usage, trace linkage                  |
| Run all         | Executes every scenario in a predictable order.                    | full dashboard warmup                         |

## Dashboard Story

The seeded public dashboard should make these pivots obvious:

- Product click → API trace
- Checkout trace → payment log
- Failed checkout replay → backend error span
- AI assistant request → AI call cost/latency
- Slow search alert → traces and affected sessions
- User/session detail → related usage, traces, logs, AI calls, and replay

The goal is not just to populate tabs. The goal is to show that obs-unified
keeps different signal types connected.

**Scenario → dashboard handoff.** Each scenario button on the ScenarioBar
follows this sequence:

1. Click → `POST /api/scenarios/<name>`.
2. Backend executes the scenario, generates the signals, returns the
   `ScenarioResponse` payload above.
3. Frontend renders a transient success card: "Triggered `<scenario>`. Trace
   `<abbreviated_id>` is now in the dashboard."
4. The card has a `View in dashboard →` link to `dashboardUrl`, which opens
   `/dashboard/#/traces?trace=<id>` in a new tab. (Deep-link pattern verified
   against `apps/web/src/App.tsx:40` — hash-based route, `traceId` lifted via
   the `?trace=` query param into
   `<TelemetryDashboard mode="traces" initialTraceId>`.)

The visitor never has to hunt — they see exactly the trace the scenario
generated, with the dashboard pre-pivoted to that view. Without this step a
visitor triggers a scenario and lands on a dashboard with no idea what to look
at.

## Hosting

The shop demo is its own deploy target. It does not co-tenant with the
obs-unified production dashboard.

Target shape:

- `demo.obsunified.com` — shop frontend (Cloudflare Pages, from the demo repo)
- `demo.obsunified.com/api/*` — Hono backend (Cloudflare Worker, from the demo
  repo)
- `demo.obsunified.com/dashboard` — obs-unified dashboard, deployed alongside
  the shop as part of the same demo stack
- `demo.obsunified.com/collector` (internal) — obs-collector Worker, deployed
  alongside

**Plan of record: standalone stack.** The demo repo deploys its own collector

- dashboard alongside the shop. Visitors see a complete, self-contained
  obs-unified deployment, and prospective users cloning the repo get the whole
  thing locally. The alternative (ship data to the production dashboard) is
  cheaper but breaks the reference-repo framing.

Cloudflare Workers + D1 + R2 across the board to keep idle cost near zero. Set
an explicit idle-cost target ("$0 idle, < $X/month under expected demo traffic")
and revisit if it doesn't hold.

### Data lifecycle

The obs-collector ships per-row TTL via an `expires_at` column on every signal
table, swept by a scheduled handler at the cron triggers defined in
`apps/collector/wrangler.toml` (`* * * * *` / `*/5 * * * *` / `0 * * * *`). The
hourly tick purges expired rows across telemetry, usage, logs, AI calls, AI
payloads, AI evaluations, metrics, analyses, and profile blobs (see
`packages/obs-collector/src/framework/collector.ts:343`).

Demo config:

- `RETENTION_HOURS=6` on the public demo deploy. Tight enough that the
  dashboard's "last 1h" view always has data; long enough that a visitor
  exploring for 20 minutes doesn't see seeded entities vanish mid-session.
- `RETENTION_HOURS=72` (the default) when cloned locally — contributors may want
  longer windows for debugging.
- A cron-triggered `run-all` runs every 30 minutes against the public deploy so
  the dashboard's "last 1h" view is populated even when organic traffic is low.
  Disabled on the cloned-locally case.
- D1-full runbook: emergency drop to `RETENTION_HOURS=2`, force a sweep tick,
  monitor. Document in the demo repo's README.

Note: retention is global-per-env, not per-project. Fine for the single- project
demo; flag explicitly if the demo ever grows multi-project surface.

## Self-monitoring

The demo IS observability software. Silent breakage is fatal — a visitor landing
on a stale or empty dashboard concludes the product doesn't work. Required from
day one.

**Synthetic check.** A Cloudflare Cron trigger on the shop Worker runs every 5
minutes:

1. `POST /api/scenarios/happy-checkout`.
2. Capture the returned `traceId`.
3. Wait 30 seconds (allow propagation through SDK → collector → D1).
4. Query `${COLLECTOR_URL}/internal/telemetry/traces/<traceId>` — confirmed
   present at `packages/obs-collector/src/plugins/query-routes.ts:107`.
5. Assert the response contains the expected primary span + child spans for the
   happy-checkout flow.
6. Persist result to KV
   (`{ ok, lastRunAt, lastTraceId, propagationMs, error? }`).

**Health endpoint.** `GET /api/health` returns:

```ts
{
  status: "healthy" | "degraded" | "unknown",
  syntheticLastRunAt: string,         // ISO timestamp
  syntheticLastTraceVisibleMs: number,
  collectorReachable: boolean,
  dashboardReachable: boolean,
}
```

**Health badge.** The storefront's `<HealthBadge />` polls `/api/health` every
60 seconds and renders a small status dot in the header: green (healthy), yellow
(degraded, with last-known-good timestamp on hover), grey (unknown). The same
fetch surfaces a thin badge on the dashboard chrome via the demo's deployment
shell (no dashboard package change needed — the demo bundles its own dashboard
build and can wrap it).

**Alerting.** Synthetic failure for ≥ 2 consecutive runs sends a webhook to a
Slack/Discord channel tracked separately from product alerts so demo flakes
don't drown out real signals.

## Graceful degradation

Each dependency has a designed failure mode. The storefront never returns a raw
500 when an upstream is misbehaving.

| Dependency   | What can fail                       | Designed response                                                                                                                                                                                                                                                                                     |
| ------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collector    | Worker 5xx / unreachable            | SDKs drop oldest events (confirmed bounded buffers: `telemetry-sdk/src/logger.ts` MAX_BUFFER_SIZE=500, `telemetry-sdk/src/ai.ts` MAX_BUFFER_SIZE=200, `analytics-sdk/src/usage-tracker.ts` MAX_REPLAY_BUFFER=500). Storefront + Hono keep working. `/api/health` reports `collectorReachable: false`. |
| LLM provider | 5xx, rate limit, or monthly cap hit | Assistant returns a designed canned response keyed off question type: "The demo's AI budget for this period is exhausted. Here's an example of what the assistant would have returned: …" Never a 500. The AI cost ceiling enforces this at the provider's billing layer.                             |
| Dashboard    | 5xx or stack down                   | "View in dashboard" link on the success card degrades to a banner: "Dashboard is being updated; check back in a few minutes." `/api/health` reports `dashboardReachable: false`.                                                                                                                      |
| D1           | Database query failures             | Hono catches at the route boundary, returns a designed "Service temporarily unavailable; this is the demo's database, not your code" page. The error is logged via telemetry-sdk so the next synthetic run flags it.                                                                                  |

These are deliverables of the first deploy, not follow-ups.

## Public-demo concerns

A public scenario-trigger API plus public AI routes has real abuse surface. The
first deployable version must enforce all of the limits below — they are not
follow-ups, and the numbers are part of the contract:

- **Rate limiting** (per IP, enforced at the Worker via Cloudflare's Rate
  Limiting API or a KV-backed token bucket):
  - `/api/scenarios/<single>`: 60 req/min/IP
  - `/api/scenarios/run-all`: 2 req/min/IP (heaviest scenario)
  - `/api/assistant`: 5 req/min/IP
  - All other `/api/*`: 300 req/min/IP
- **Global daily caps**:
  - All `/api/scenarios/*` combined: 10,000 req/day
  - All `/api/assistant`: 2,000 req/day
- **AI cost ceiling**: hard monthly cap on the LLM provider key set at the
  billing layer (not just in app code). Starting point: **$50/month**. Per-run
  cap on the `ai-cost-spike` scenario: **$0.50**.
- **Provider key scope**: project-scoped key with the cap above. Never a
  personal account key.
- **Prompt-injection containment**: the assistant route has no tool access, no
  DB writes from LLM output, no ability to call other `/api/*` routes.
- **Replay scope**: recorded sessions are public-demo traffic only. The
  cloned-locally path defaults to off (set `VITE_OBS_REPLAY_ENABLED=true` to
  enable).

The specific numbers are starting points — adjust after observing real traffic.
The point is to have specific numbers, not adjectives.

## Demo labeling

A visitor seeing a 500 trace or a failed checkout should not conclude the
product is buggy. Required labeling on the public deploy:

- **Persistent storefront banner** at the top of every page: "DEMO ENVIRONMENT —
  synthetic data, public traffic." Sticky, dismissible (24h cookie), visible by
  default.
- **Scenario button copy** names the deliberate action: "Trigger a deliberate
  payment failure," "Run a slow search scenario," "Generate an AI cost spike."
  Not "Payment failure" or "Slow search" — visitors should see the failure is
  opt-in.
- **Dashboard badge** rendered by the demo's deployment shell as a thin wrapper
  around the dashboard iframe/host. No upstream dashboard change required.
- **Seeded entity markers**: every scenario-generated entity carries a marker
  field (`is_demo: true`, `service.name: "demo-shop-payment"`, customer emails
  at `@demo.example`) so they're trivially distinguishable from any real data
  that might end up in the same store.

The labeling is also the privacy story for replay — visitors are told recording
is happening before they interact.

## Read-Only Demo Mode

The dashboard side of the demo eventually needs:

- bypass login for public demo traffic
- hide destructive/admin controls
- block project/key mutation
- clearly label data as seeded/demo data

This is real work in `packages/dashboard`, not in this repo, and is its own
workstream with its own owner. The shop demo does **not** block on it: ship a
password-protected demo first and document the shared password on the landing
page. Treat read-only mode as a separate deliverable.

## Relationship to other demos

Three demos, three roles:

- **`apps/obs-demo` (this repo)** — low-level signal-generator and smoke-test
  Worker. Exercises SDK + collector primitives directly. Internal-facing.
- **OpenTelemetry Astronomy Shop (`pnpm demo:up`, this repo)** — local polyglot
  stress test. ~15 services in 6+ languages exercising native OTel ingest. Not
  hosted; runs on a developer laptop. The integration walkthrough for it lives
  in [docs/implementation/demo-integration.md](demo-integration.md).
- **shop-demo repo (new)** — hosted public demo and clone-and-run reference
  example. The canonical integration walkthrough lives in _its_ README, which is
  running code rather than a snippet doc.

Good candidates to adapt from `apps/obs-demo` into shop-demo:

- AI scenario generation
- `run-all` endpoint shape
- provider/key detection
- deterministic failure and latency paths

## Rollout Plan

0. Create the `shop-demo` GitHub repo. Decide org/name. Set license (MIT),
   enable "Use this template", set up the Cloudflare Pages + Workers project,
   reserve `demo.obsunified.com`. Configure Renovate for SDK pins and add the
   separate daily canary workflow.
1. Scaffold the repo with React 19, Vite, Tailwind, and Hono. Pin React to the
   dashboard's version.
2. Bundle prebuilt obs-collector and dashboard artifacts under `vendor/` so
   `pnpm dev` boots the whole stack locally.
3. Add frontend product catalog, cart, checkout, and assistant UI.
4. Add Hono API routes, deterministic in-memory data, and the `ScenarioResponse`
   shape (returning `traceId` + `dashboardUrl`).
5. Wire browser analytics with `replayPrivacyOptions` for demo-grade masking and
   add the recording banner.
6. Wire backend request spans (hand-rolled Hono middleware), child spans, logs,
   and AI spans.
7. Add scenario endpoints and the ScenarioBar with the dashboard handoff
   (success card + deep-link).
8. Implement the public-demo concerns: rate limits with the specified numbers,
   AI cost ceiling, prompt-injection scope, replay default.
9. Implement self-monitoring: `/api/health`, the cron-triggered synthetic, the
   storefront health badge, the alerting webhook.
10. Implement graceful degradation for each dependency listed in the matrix.
11. Implement demo labeling: storefront banner, scenario button copy, dashboard
    badge, seeded entity markers.
12. Run locally against the bundled stack until every pivot listed in "Dashboard
    Story" works against seeded data — checklist, not vibe.
13. Build the Playwright suite that asserts each scenario produces the expected
    dashboard state within 30s. Wire it into Renovate's SDK PRs as a merge gate.
14. Deploy: frontend → Pages, Hono → Worker, dashboard + collector → Workers.
    Set `RETENTION_HOURS=6`. Schedule the cron-triggered `run-all` (every 30
    min) and the synthetic (every 5 min).
15. Confirm the idle-cost target against 24h of live traffic.
16. Add `DEMO_URL` to the landing page config in `obs-unified-docs`.
17. Link the demo from the header, hero/preview, and footer.
18. Write the demo repo's README as an integration walkthrough — this is the
    user-facing artifact and the reference replacement for snippet-style
    integration docs.
19. Cross-link from `obs-unified` docs back to the demo repo for "see this in
    action."

## Success Criteria

State checks (what the first visitor sees):

- A visitor can open the storefront, trigger a scenario, and see the result in
  the dashboard via the deep-link — not by hunting.
- The public dashboard is populated continuously by the cron-triggered
  `run-all`; no private local state required.
- Every major signal has at least one relatable example.
- At least one flow demonstrates a frontend interaction connected to backend
  traces, logs, and replay.
- Footer/header demo links resolve **and** the dashboard shows ≥ 1 trace, ≥ 1 AI
  call, ≥ 1 replay session, and ≥ 1 alert from seeded data — not just an
  HTTP 200.
- A prospective user can `git clone` the demo repo, run
  `pnpm install && pnpm dev`, and have the full obs-unified stack running
  locally without cloning obs-unified itself.

Continuous checks (what keeps the demo trustworthy):

- The Playwright suite asserts, per scenario:
  - `POST /api/scenarios/<name>` returns the expected `ScenarioResponse`.
  - The deep-link navigates to a dashboard view with the expected spans.
  - The trace appears in the dashboard within 30 seconds of the scenario firing.
- The synthetic suite (`/api/health` + cron probe) has been green for the last
  24 hours at any point you check.
- Idle hosting cost is $0 and steady-state cost stays below the agreed
  threshold.
- The canary workflow (latest SDK) has been green for the last 7 days, or there
  is an open issue tracking the regression.
- Renovate SDK PRs cannot merge while the Playwright suite is red.
