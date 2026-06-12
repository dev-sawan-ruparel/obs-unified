# Collector self-instrumentation

> Looking for the general "how to instrument a service with this SDK" guide? See
> [`packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md`](../../packages/telemetry-sdk/INSTRUMENTATION_GUIDE.md).
> This doc is collector-specific — it covers the loop-prevention design that
> applies because the collector ingests its own telemetry.

The obs-collector worker dogfoods itself — it emits its own request traces,
error logs, and cron-job spans into a dedicated `obs-dashboard` project so that
the operator of the obs platform can use the platform to monitor it.

This document exists to **prevent a specific class of mistake**: introducing an
infinite telemetry-export loop. Read it before changing anything in
`apps/collector/src/index.ts` related to spans, logs, or the `X-Telemetry-Self`
header.

## Why a loop is the failure mode

The collector's ingest endpoints are the same endpoints the SDK posts to. If the
worker is instrumented to wrap every inbound request in a span, then the act of
exporting that span to `/v1/traces` triggers another inbound request, which the
middleware wraps in another span, which is exported to `/v1/traces`, and so on.
Each request fans out into more requests. Within seconds the worker is
saturated, D1 fills with self-spans of self-spans, and the cluster melts down.

There is no rate-limit or sample knob that fixes this — the recursion is
unbounded by construction.

## How we prevent the loop

Every byte of telemetry the collector emits to itself stamps the outbound
request with a header:

```
X-Telemetry-Self: 1
```

The worker's first action on every inbound request is to check that header. If
it's present, the request is passed straight through to the handler with **no
span, no log buffer write, no metric increment** — none of the work that would
generate further self-emissions. Two collaborating sites enforce this:

1. **Header set** — every self-emission carries the header:
   - `exportSpan()` in [`apps/collector/src/index.ts`](src/index.ts) sets it on
     the `fetch` to `/v1/traces`.
   - The telemetry-sdk's `flushLogs()` and `flushAICalls()` set it via the
     `extraHeaders` field passed to `initObservability()`. See
     [`packages/telemetry-sdk/src/logger.ts`](../../packages/telemetry-sdk/src/logger.ts)
     and
     [`packages/telemetry-sdk/src/ai.ts`](../../packages/telemetry-sdk/src/ai.ts).

2. **Header check** — `shouldInstrument(request)` in
   [`apps/collector/src/index.ts`](src/index.ts) returns `false` whenever the
   header is present. The fetch handler short-circuits to plain `app.fetch(...)`
   with no telemetry wrapping.

Together they guarantee the loop terminates after exactly one hop: the
self-emitted request reaches the receiver plugin, gets stored, and returns —
without spawning another self-emission.

## Invariants — do not break

If you change any of the following without thinking about the loop, you will
reintroduce the failure:

- **Do not remove the `extraHeaders` argument** from `initObservability(...)` in
  `apps/collector/src/index.ts`. Without it, `flushLogs()` posts to `/v1/logs`
  un-stamped, the middleware traces it as a real request, exports the resulting
  span, which goes through `flushLogs()` again — loop.

- **Do not strip the header** in any reverse proxy, CORS middleware, or
  framework layer in front of the worker. The header must reach
  `shouldInstrument()` intact. If you add a header allowlist, include
  `X-Telemetry-Self`.

- **Do not add new self-emit code paths** that don't set the header. Anything
  that calls `fetch(${SELF_URL}/v1/...)` from inside the collector must include
  `X-Telemetry-Self: 1`. If you wire up a new exporter (metrics, events,
  anything), copy the header from `exportSpan` in `apps/collector/src/index.ts`.

- **Do not change the header check to "skip if path === /v1/traces"** or any
  other path-based rule. The SDK posts logs to `/v1/logs`, AI calls to `/v1/ai`,
  and may add more endpoints over time. Path-based exclusion will silently miss
  new SDK exports the day they ship. The header is the source of truth.

- **Do not extend instrumentation to `/health` or other paths the SDK might hit
  incidentally** unless you've audited every SDK call site for the header. The
  current allowlist (`/v1/`, `/internal/`) is intentional — `/health` is
  excluded because external load balancers poll it, and flooding the
  obs-dashboard project with health-check spans is noise.

## What the collector reports

When `OBS_DASHBOARD_INGEST_KEY` and `OBS_COLLECTOR_SELF_URL` are set:

- **Request spans** for every `/v1/*` and `/internal/*` request — method, path,
  response status, duration. Status `>= 500` marks the span as errored.
- **Cron spans** for `analyses_run`, `alerts_evaluate`, `retention_cleanup` with
  success/failure status and the failure message attached when applicable.
- **Cron error logs** via `createLogger("obs-collector.cron")` when a cron
  iteration throws.
- **Framework logs** via `createLogger("obs-collector")` — receiver storage
  failures (`/v1/traces`, `/v1/logs`, `/v1/metrics`), alerts evaluator failures,
  ask-route failures, analyses runner failures. The framework package exposes a
  `Logger` interface (`packages/obs-collector/src/framework/logger.ts`) and
  accepts an injected logger via `CollectorConfig.logger`. The default is a
  console-backed implementation, so framework consumers that don't wire the SDK
  still get readable output.
- **LLM child spans** for `/internal/ask` — the LLM hop is wrapped in a child
  span named `ask.runAsk` with `llm.provider`, `llm.model`, and
  `openinference.span.kind="LLM"` attributes, plus structured info logs
  bracketing the call (request size, latency, token-related metadata). The child
  span is wired through the framework's `CollectorConfig.withChildSpan` field,
  which the worker entrypoint backs with the SDK's `withChildSpan` helper. The
  framework package itself does not import `@obsunified/telemetry-sdk` to keep
  the dependency graph one-way.

When either env var is absent, self-instrumentation is a no-op and the collector
runs unchanged. This makes the feature opt-in per deployment.

## Dev mode: `ctx.waitUntil` vs. `await`

Production Cloudflare Workers honor `ctx.waitUntil(...)` — the export fetches
and the buffered log flush run after the response is sent, on the worker's own
time. **Miniflare local dev does not** — once the response resolves, the request
context is torn down and any in-flight `waitUntil` promise is silently dropped.
For requests that emit logs _after_ an inner async hop (the post-LLM logs in
`/internal/ask`, for example), this means those logs never reach `/v1/logs`.

The fetch handler reads `env.OBS_SELF_AWAIT_EXPORTS`. When set to `"true"` (as
it is in `.dev.vars`), the drain is `await`ed inline — adds the export RTT
(~5–25ms) to each instrumented request but guarantees no telemetry is lost. When
unset (production), `ctx.waitUntil` runs the drain in the background. **Do not
set `OBS_SELF_AWAIT_EXPORTS=true` in production** — it serializes the export and
adds latency to every request for a problem production CF Workers don't have.

## Project routing

The `obs-dashboard` project is seeded by migration
`026_obs_dashboard_project_seed.sql` along with a deterministic ingest key. The
plaintext key is committed to `.dev.vars` for local dev (it has no production
value). In production, mint a fresh key via the dashboard's keys UI and store it
as a secret:

```sh
wrangler secret put OBS_DASHBOARD_INGEST_KEY
```

Routing happens via the standard ingest-auth middleware: the key hash maps to
`ingest_keys.project_id = 'obs-dashboard'`, and every storage write the receiver
plugins do tags rows with that project_id. There is no collector-side
hard-coding of the destination project — it falls out of the auth lookup.

## When the loop guard fires (expected behavior)

You should expect to see the loop guard suppress instrumentation in two normal
cases:

- The collector's own `flushLogs` POST to `/v1/logs` arrives — header present,
  span suppressed. The `/v1/logs` receiver still stores the payload (the loop
  guard only skips the wrapping span, not the receiver).
- A failed self-export retries on the next flush — header present, no recursive
  trace.

If you see request spans stop appearing for inbound `/v1/*` traffic from real
SDK clients, the loop guard is firing on traffic it shouldn't be. The diagnostic
is: are real clients sending `X-Telemetry-Self: 1`? If yes, an upstream proxy is
forwarding it accidentally — strip it at the ingress.
