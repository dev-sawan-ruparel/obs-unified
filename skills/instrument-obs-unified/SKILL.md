---
name: instrument-obs-unified
description: Add obs-unified observability instrumentation to a TypeScript project end-to-end — frontend (`@obsunified/analytics-sdk`), backend (`@obsunified/telemetry-sdk`), and any AI/LLM calls (OpenInference span helpers) — then verify telemetry is actually flowing by querying the collector. Use this skill whenever the user asks to instrument an app with obs-unified, wire up obs-unified observability, set up obs-unified tracing or replay, or types `/instrument-obs-unified`. Also use when the user mentions adding click-to-trace, interaction-id propagation, or session replay to a TypeScript app and obs-unified is the target stack — even if they don't name the SDKs explicitly.
---

The canonical reference is **[`docs/howto/instrument-react-hono.md`](references/instrument-react-hono.md)** in the obs-unified repo. Every code change this skill makes should match the patterns in that doc — this file is the *workflow*; the doc is the *spec*. Read it once before starting if the project is non-trivial.

The well-tested stack is React (Vite) + Hono on Cloudflare Workers. Adjacent stacks (Express, Fastify, Next.js, Node.js plain) share the same SDK API and ~90% of the wire-up; deviate only where the framework's middleware shape requires it.

## When this is the wrong skill

Stop and point elsewhere if:

- The project is in a non-TypeScript language → point at [`docs/recipes/`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/recipes/) (Python, JVM, .NET) or [`sdks/go`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/sdks/go), [`sdks/rust`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/sdks/rust).
- The user wants to instrument the obs-unified collector or dashboard themselves (self-instrumentation has its own conventions — see `apps/collector/SELF_INSTRUMENTATION.md`).
- The project is already fully instrumented (run the idempotency check below first; if nothing's missing, say so and stop).

## Workflow

Use TodoWrite to track progress when the project touches more than ~3 files.

### 1. Detect the stack & check compatibility tier

Read `package.json` (or `pyproject.toml` / `go.mod` / `Cargo.toml`). Classify the signals against the 3-Tier Compatibility Matrix:

- **Tier 1 (Full First-Party Unified Stack):**
  - **Frontend**: `react`, `vite`, `next`, `solid-js`, `vue`, `svelte`, `@remix-run/*` (`@obsunified/analytics-sdk` — page views, clicks, `x-obs-interaction`, `rrweb` DOM replay)
  - **Backend**: `hono`, `express`, `fastify`, `koa`, `elysia`, Cloudflare Workers (`@obsunified/telemetry-sdk` or `@obsunified/sdk`), or Go/Rust (`sdks/go`, `sdks/rust`)
  - **AI/LLM**: `openai`, `@anthropic-ai/sdk`, `@google/genai`, `langchain`, `@vercel/ai`, `ai`
- **Tier 2 (Standard OpenTelemetry Backends):** Python, Java/Kotlin, .NET, Ruby, PHP, C++ via OTLP HTTP (`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` or `http/protobuf`) + `obs.interaction.id` span attribute from `x-obs-interaction`.
- **Tier 3 (Partial or Constrained Shapes — report to user before editing):**
  - **Native mobile (`react-native`, `expo`, Swift, Kotlin, Flutter):** Backend traces/logs/AI calls work; `rrweb` DOM session replay is **not supported**.
  - **CLI / Cron / Headless workers:** Backend traces/logs/AI calls/Action Graph (`triggerKind: "cron" | "queue"`) work; browser replay is N/A.
  - **Async queues (Kafka, SQS, BullMQ, RabbitMQ):** Require explicit propagation of `traceparent` / `x-obs-interaction` / `x-obs-action-id` in message metadata.

The primary path (React+Vite + Hono on Workers) is the doc's running example. If the stack is adjacent, tell the user up front: "I'll adapt the patterns from `docs/howto/instrument-react-hono.md` — the SDK API is the same, the middleware shape differs slightly for `<framework>`."

For monorepos, treat each workspace package independently. If one package has both frontend and backend imports, instrument both sides there.

If only one side has signals (a Workers-only backend with no UI, or a static SPA hitting third-party APIs), skip the absent side's workflow step entirely. Note the skip in the final report so the user knows you didn't forget — they may add the other side later and want to re-invoke the skill.

### 2. Provision or verify collector prerequisites (Autonomous vs. Human boundaries)

Don't install anything until you have a reachable collector, a write-only ingest key (`OBS_INGEST_KEY` for `/v1/*`), and a read bearer token (`OBS_DASHBOARD_TOKEN` for `/internal/*` verification and MCP).

**Required values:**

- `OBS_COLLECTOR_URL` — where signals are sent (default local: `http://localhost:8790`).
- `OBS_INGEST_KEY` — write-only key for `/v1/*` telemetry ingestion (for the locally built image `pnpm local:run` only the default is `dev-ingest-key`; with the GHCR image use the value you chose).
- `OBS_DASHBOARD_TOKEN` — read bearer token for `/internal/*` verification and `@obsunified/mcp-server` (local image only default: `e2e-dashboard-token`; with GHCR use the value you chose for `DASHBOARD_TOKEN`).
- `OBS_DASHBOARD_URL` — where the user opens the UI (default local: `http://localhost:5173`).

**Where does obs-unified itself run?**

| Option | Autonomous vs. Human | What to do |
| --- | --- | --- |
| **Local dev — Prebuilt GHCR Docker image (Recommended default)** | **100% Autonomous if Docker is running** (ask human only if `docker info` fails). | Pick your own secrets (the release image refuses `dev-ingest-key` / `e2e-test-pass`, which only work for the locally built image via `pnpm local:run`), then run `export INGEST_KEY="pick-a-long-random-ingest-key" DASHBOARD_PASSWORD="pick-a-dashboard-password" DASHBOARD_TOKEN="pick-a-read-token-for-mcp-and-cli"` and `docker run -d --name obs-unified -p 5173:5173 -p 8790:8790 -e INGEST_KEY -e DASHBOARD_PASSWORD -e DASHBOARD_TOKEN ghcr.io/dev-sawan-ruparel/obs-unified:latest`. |
| **Local dev — sibling repo** | **100% Autonomous** if repo is cloned locally. | `pnpm dev:collector` (collector → `http://localhost:8790`) and `pnpm dev:web` (dashboard → `http://localhost:5173`) in the obs-unified repo. |
| **Self-hosted — production cloud** | **Requires Human Intervention** for cloud OAuth (`wrangler login`), DNS, and production secrets (`wrangler secret put`). | Point at [README → "Deploy the Collector"](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/README.md#1-deploy-the-collector) or [Production operations](https://docs.obsunified.com/docs/ops/production). |

If the user hasn't specified a collector URL and `http://localhost:8790/health` is not already running, check `docker info` and boot the `ghcr.io/dev-sawan-ruparel/obs-unified:latest` container automatically so the developer gets a working setup without manual steps.

**Pre-flight probe — do this before installing anything:**

```bash
# 1. Run CLI doctor (checks /health, CORS for app origin, OTLP ingest, and /internal read auth)
OBS_ADMIN_TOKEN="$OBS_DASHBOARD_TOKEN" pnpm dlx @obsunified/cli doctor "$OBS_COLLECTOR_URL" --origin "${APP_ORIGIN:-http://localhost:3000}"

# 2. Verify read token against /internal/telemetry/overview (Note: /internal/* requires Bearer $OBS_DASHBOARD_TOKEN, NOT X-Obs-Ingest-Key)
curl -sf -H "Authorization: Bearer $OBS_DASHBOARD_TOKEN" \
  "$OBS_COLLECTOR_URL/internal/telemetry/overview?hours=1&limit=1" \
  > /dev/null && echo "OK: read token valid" || echo "FAIL: read token invalid"

# 3. Dashboard is reachable (optional but cheap)
curl -sf -I "$OBS_DASHBOARD_URL" > /dev/null && echo "OK: dashboard reachable"
```

If any of these fail, fix local Docker or walk the user through the credential fix before proceeding.

### 3. Install SDK packages

Follow §0 of the doc — install the public npm packages:

```bash
pnpm add @obsunified/analytics-sdk     # wherever browser code runs
pnpm add @obsunified/telemetry-sdk     # wherever server code runs
```

In a monorepo, install per package, not at the root. (If scaffolding a brand-new project from scratch, always pass `--yes` and `--template` so the CLI never blocks on interactive TTY prompts: `pnpm dlx @obsunified/cli create my-app --template react-vite --collector-url http://localhost:8790 --yes`; these flags require `@obsunified/cli` 1.1.2 or newer, on 1.1.1 scaffold interactively.)

### 4. Frontend wire-up

Find the React entry. Common locations:

- Vite/CRA: `src/main.tsx`, `src/index.tsx`
- Next.js app router: `app/layout.tsx` (use a Client Component wrapper)
- Remix: `app/root.tsx`

Wrap the root with `<AnalyticsProvider>` per §1 of the doc, including:

- `autoCorrelate` — enables the click → interaction-id → outbound-fetch chain that makes click-to-trace possible. Don't disable unless another instrumentation library already patches `fetch`.
- `trackPageViews`, `captureErrors` — standard.
- `replayPrivacyOptions={{ maskInputOptions: { text: true } }}` — text inputs masked by default for safety. Tighten further if the app has unusually sensitive forms.

Read env vars with the framework's convention: `import.meta.env.VITE_*` for Vite/Remix, `process.env.NEXT_PUBLIC_*` for Next.js, `process.env.REACT_APP_*` for CRA legacy.

Then walk the existing event call sites (button clicks, form submits) and either:

- Replace bare `fetch(...)` with the provider's `fetch` from `useAnalytics()` so the session id stamps.
- Add `trackInteraction("name", { props })` for events the user will want to slice by in the dashboard.

Replay is **off by default** — only call `startReplay()` if the user explicitly wants session recording (and if so, surface the privacy implications: rrweb captures DOM).

### 5. Backend wire-up

Find the server entry. Add the two middlewares from §3 of the doc:

- **A**: `initObservability({ collectorUrl, apiKey, serviceName, environment, serviceVersion, commitSha })` per request. Idempotent — safe to call on every request.
- **B**: per-request span via `createRequestSpan` → `stampInteractionFromRequest(span, c.req.raw)` → `runWithSpan(span, () => next())` → `flushSpans() + flushLogs() + flushAICalls()` in `finally` (or `c.executionCtx.waitUntil(Promise.all([flushSpans(), flushLogs(), flushAICalls()]))` on Cloudflare Workers).

**Add a `x-obs-trace-id` response header from middleware B**, even though the doc doesn't require it. The doc is the canonical SDK pattern; this header is an instrumentation-time convenience that makes the verification step in §8 deterministic instead of fishing through logs. One line after creating the span:

```ts
c.res.headers.set("x-obs-trace-id", span.traceId);
```

Equivalent for other frameworks: set the header before the response is sent.

For non-Hono frameworks: the shape is "wrap the request handler in `runWithSpan`; end the span when the response is sent; flush before the runtime tears down the request context."

- Express: middleware function, end on `res.on('finish', ...)`.
- Fastify: `onRequest`/`onResponse` hooks.
- Workers without a framework: do it inline in the `fetch(request, env)` handler.

After middlewares, scan route handlers for downstream operations worth their own span and wrap with `withChildSpan("name", fn)` per §4:

- DB queries that aren't already wrapped by `wrapD1`
- Outbound `fetch(...)` calls not wrapped by `wrapFetch`
- Heavy CPU paths the user would want to see broken out

Don't wrap everything — spans are not free. Wrap operations that take measurable time (≥10ms typical) or that a debugger would care to see as a distinct span.

**For Cloudflare Workers projects**, add the binding wrappers from §6:

```ts
import { wrapD1, wrapR2, wrapFetch } from "@obsunified/telemetry-sdk/cloudflare";
const db = wrapD1(env.DB);
```

Zero call-site changes downstream — `db.prepare(...)` etc. continues to work. Every query becomes a child span automatically.

### 6. AI call wrapping

**Skip this step if no AI/LLM signals were detected in step 1** (no `openai` / `@anthropic-ai/sdk` / `@google/genai` / `langchain` / `ai` / `@vercel/ai` in `package.json`). Note in the final report that AI instrumentation was skipped because no AI usage was detected; if the user adds LLM calls later, they should re-invoke this skill.

If AI signals are present, search the codebase for outbound LLM call sites. Patterns to look for:

| Pattern | Helper |
| --- | --- |
| `fetch("https://api.openai.com/...")` or `openai.chat.completions.create(...)` | `startLLMSpan` |
| `anthropic.messages.create(...)` | `startLLMSpan` |
| `genai.generateContent(...)` | `startLLMSpan` |
| Tool / function call execution | `startToolSpan` |
| RAG retrieval (vector search, document fetch) | `startRetrieverSpan` |
| Orchestration node (LangChain chain, agent step) | `startChainSpan` |
| Embedding generation | `startEmbeddingSpan` |
| Agent loop entry point | `startAgentSpan` |

If the app has an agent loop, tool-calling framework, or MCP host, prefer the
Agent Action Graph helpers/wrappers where available. The goal is not only to
record an LLM span, but to emit explicit causal fields so future investigations
do not rely on fallback IDs:

- root action/run ID
- action ID for each agent step, LLM call, retrieval, tool call, eval, or guardrail
- `caused_by_action_id` or parent action context
- tool name, args/result hashes or redacted summaries, side-effect flag, and approval state
- model/provider, prompt version, token/cost/latency fields
- eval name/version/score/pass-fail for guardrails or quality checks

When a framework wrapper exists, use it before hand-rolling action attributes:

- Vercel AI SDK: `@obsunified/agents-vercel-ai`
- LangGraph/LangChain runnable flows: `@obsunified/agents-langgraph`
- Native TypeScript agents: `@obsunified/telemetry-sdk/agent`

For each LLM call site, wrap with the matching helper per §5 of the doc. After the call:

- `span.setOutput(result)` — captured as `ai.payload.output`
- `span.setTokens({ prompt, completion, total })` — populates the AI tab token column
- `span.setCost(usd)` — populates the AI tab cost column
- `span.end()` in `finally`

If the app has multi-turn conversations, call `setAISessionContext({ sessionId, userId })` at the start of each request so subsequent AI spans group into a session view.

**Do not use `trackAICall`** — it's `@deprecated` in [`packages/telemetry-sdk/src/ai.ts`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/packages/telemetry-sdk/src/ai.ts) and predates the OpenInference helpers.

### 7. Runtime lineage, feature flags, and change plane (RFC 0013)

To enable cohort attribution (`service.version` / `vcs.commit.id`) and change blast-radius correlation:

- Pass `environment`, `serviceVersion`, `commitSha`, and `configDigest` (or `lineage: { environment, serviceVersion, commitSha, configDigest }`) to `initObservability(...)` and `<AnalyticsProvider>` so spans and usage events carry `deployment.environment.name`, `service.version`, `vcs.commit.id`, and `obs.config.digest`.
- Where feature flags are evaluated, call `recordFeatureFlag(flagKey, variant, { providerName })` from `@obsunified/telemetry-sdk` or `@obsunified/analytics-sdk` so active spans carry `feature_flag.key`, `feature_flag.variant`, and `obs.feature_flags.<key>`.
- In deploy scripts or release hooks, record change events with the CLI:
  ```bash
  obs-unified changes record --environment prod --kind deploy --service <service-name> --version "$VERSION" --commit-sha "$COMMIT_SHA" --summary "Deploy $VERSION"
  ```

Add to `.env.example` (or `.dev.vars` for Workers projects using wrangler):

```
# obs-unified collector — server-side
OBS_COLLECTOR_URL=
OBS_INGEST_KEY=
OBS_ENVIRONMENT=
OBS_SERVICE_VERSION=
OBS_COMMIT_SHA=
OBS_CONFIG_DIGEST=

# obs-unified dashboard — used by the app to build deep-links into the UI
OBS_DASHBOARD_URL=

# Browser-side reads (Vite). Use a separate write-only key if your collector supports it.
VITE_OBS_COLLECTOR_URL=
VITE_OBS_INGEST_KEY=
VITE_OBS_DASHBOARD_URL=
```

Don't write actual credentials. If the project already has obs-unified env vars from a previous setup attempt, leave them — just add anything missing.

### 8. Verify end-to-end

This is the test half of the task — don't claim success without doing it.

1. **Typecheck / build**: `pnpm typecheck` (or `pnpm build`). Fix any errors before continuing.

2. **Start the dev server**:
   - Vite frontends → `preview_start` (browser-previewable).
   - Workers / Node backends → Bash with `run_in_background: true`, save the PID.

3. **Fire a sample request** that exercises the new middleware. Prefer an endpoint with downstream work (DB / outbound fetch / LLM) so the verification asserts child spans too. If the project only has stub routes, hitting any route is still a valid check of the root span — note in the report that child-span verification was skipped because no downstream work was wired yet.

4. **Capture the `trace_id`** from the response header `x-obs-trace-id` (added in step 5's middleware):

   ```bash
   curl -sD - "$BASE_URL/api/health" -o /dev/null | grep -i x-obs-trace-id
   ```

   Fallback paths if for some reason the header isn't set: tail backend logs with `initObservability({ debug: true })` temporarily, or query `GET /internal/telemetry/overview` and pick the most recent trace.

5. **Query the collector** (using the read bearer token `OBS_DASHBOARD_TOKEN`, since `OBS_INGEST_KEY` is write-only):

   ```bash
   curl -sf -H "Authorization: Bearer $OBS_DASHBOARD_TOKEN" \
     "$OBS_COLLECTOR_URL/internal/telemetry/traces/<traceId>" | jq
   ```

   The endpoint lives at [`packages/obs-collector/src/plugins/query-routes.ts:107`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/packages/obs-collector/src/plugins/query-routes.ts). Assert the response contains:

   - The root span with `service.name` matching what was passed to `initObservability`.
   - Any child spans the route should have produced.
   - Any AI spans if an LLM was called.
   - The `obs.interaction.id` attribute on the root span if the frontend fired the request (proves auto-correlation worked).

6. **Report pass/fail** using the format below.

## Idempotency

Before adding code, grep the project for existing instrumentation. Search broadly — code might live under `src/`, `app/`, `lib/`, `pages/`, or the package root depending on framework:

```bash
grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" \
  -e "AnalyticsProvider" -e "initObservability" -e "createRequestSpan" .
```

If hits exist:

- **Don't re-add init code.** Audit what's missing (AI spans? `replayPrivacyOptions`? Child spans on visible downstream calls?) and add only the gaps.
- **Don't wrap existing `AnalyticsProvider`** — modify its props.
- **Don't add a second `initObservability` call site.**

The skill must be safe to invoke a second time on the same project. A re-invocation on a fully-instrumented project should be a no-op with a "nothing to add" report.

## Common pitfalls

| Pitfall | What to do |
| --- | --- |
| Pre-flight: user has no collector URL at all | Walk through the self-host vs hosted decision in step 2. Don't proceed with placeholder values. |
| Pre-flight: collector reachable but ingest key returns 401/403 | The key is wrong, missing, or pasted with whitespace. Have them re-copy from the dashboard's project settings page. |
| Pre-flight: collector reachable but `/internal/telemetry/overview` returns "no project" | The collector has no projects seeded. Have them run the project-seed migration in obs-unified or create a project in the dashboard, then retry. |
| Pre-flight: dashboard URL unreachable | Non-blocking — instrumentation still works, but the final deep-link won't open. Confirm with the user before proceeding without it. |
| Worker project uses `vite-plugin-cloudflare` or `miniflare` instead of `wrangler dev` | Detect from `package.json` scripts and start the matching dev command. SDK code is unchanged. |
| Non-Worker backend (Node/Bun/Deno) | Skip the `@obsunified/telemetry-sdk/cloudflare` subpath imports — they're Worker-only. Everything else is identical. |
| Verification: trace not found | SDK buffers flush every ~10s; the middleware's explicit flush should make traces visible immediately. Retry after 5s. If still missing, check the backend logs for `flushLogs` / `flushAICalls` errors. |
| Verification: interaction header absent | Frontend isn't using the provider's `fetch`, or `autoCorrelate` is disabled. Re-check §1 and §2 of the doc. |
| Verification: AI spans show but aren't under the request span | `startLLMSpan()` is being called outside the request's `runWithSpan` scope. Move it inside the route handler. |
| User asks to instrument a language other than TypeScript | Wrong skill — point at [`docs/recipes/`](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/recipes/) and stop. |
| User asks the skill to deploy obs-unified itself | Wrong skill — this one wires apps **into** an obs-unified deployment. Point at the obs-unified [README → "Deploy the Collector"](https://github.com/dev-sawan-ruparel/obs-unified/blob/main/README.md#1-deploy-the-collector). |

For anything not covered above, the troubleshooting table in §Troubleshooting of [`docs/howto/instrument-react-hono.md`](references/instrument-react-hono.md) is authoritative.

## Reporting back

Final summary to the user should be a structured handoff, not prose:

```
What was changed:
  ✓ src/main.tsx — added <AnalyticsProvider> at the root
  ✓ src/backend/server.ts — added init + per-request span middleware
  ✓ src/backend/routes/assistant.ts — wrapped 1 LLM call with startLLMSpan
  ✓ .env.example — added OBS_* / VITE_OBS_* stubs

What was verified:
  ✓ Build clean (pnpm typecheck)
  ✓ Sample request /api/health produced trace abc123…
  ✓ Trace contains: 1 root span + 2 child spans + 1 AI span
  ✓ obs.interaction.id present on root (frontend → backend propagation works)

What's left for you:
  • Set OBS_COLLECTOR_URL and OBS_INGEST_KEY in your real .env (not just .env.example)
  • Consider startReplay() in src/main.tsx if you want session recording
  • src/lib/db.ts has 3 queries not wrapped with withChildSpan — wrap if you want them as separate spans

See it now: <dashboardUrl>/#/traces?trace=abc123…
```

The "What's left for you" section is the difference between "I changed some files" and "I instrumented your app and here's what you should know."

## See also

After instrumentation lands and the user starts running the app, the read-side companion skill — **`investigate-obs-unified`** — is the right next step. Use it (or suggest the user invoke it) to:

- Verify telemetry is flowing correctly after a deploy (the explicit handoff playbook).
- Query traces, logs, AI calls, and replays to debug specific problems.
- Pivot across signals via the `connected` endpoint.

Different triggers, different mental model: this skill *edits code* once; investigate-obs-unified *calls collector APIs* repeatedly.
