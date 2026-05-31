# Instrumentation Guide

A walkthrough of what `@obs-unified/telemetry-sdk` provides automatically and
what your application has to wire up. The split matters: helpers live in the SDK
so the schema (OTel / OpenInference attribute names) is consistent across
consumers; call sites live in your app because only you know where they are.

## TL;DR — what you get vs. what you wire

| Concern                                            | SDK provides                                                                                                  | You wire                                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Worker bootstrap                                   | `initObservability(...)`                                                                                      | Call once with collector URL + ingest key                                                                        |
| HTTP request span                                  | `createRequestSpan` + `runWithSpan`                                                                           | Wrap your fetch handler                                                                                          |
| Custom logical units                               | `withChildSpan(name, fn)`                                                                                     | Call at boundaries you care about                                                                                |
| **D1 query spans**                                 | `wrapD1(env.DB)`                                                                                              | Wrap once at request boundary; pass `tracedEnv` to handlers                                                      |
| **R2 object spans**                                | `wrapR2(env.BUCKET, { bucketName })`                                                                          | Same — wrap at boundary; ops auto-emit `r2.*` spans                                                              |
| **Outbound HTTP spans**                            | `wrapFetch(fetch, { skip? })`                                                                                 | Use the wrapped fetch instead of the global, _or_ wrap individual sites with `withChildSpan` and OTel attributes |
| **Processor pipeline spans (collector framework)** | `CollectorRuntime.runSpanProcessors` / `runUsageEventProcessors` auto-wrap each processor in `process.<name>` | Nothing — every receiver registered with the runtime gets per-stage tracing free                                 |
| **LLM call attributes**                            | `withChildSpan` + OpenInference convention (manual)                                                           | Stamp `openinference.span.kind="LLM"`, `gen_ai.system`, `gen_ai.request.model`, post-call usage attrs            |
| **Tool call spans**                                | `withChildSpan` + OpenInference convention (manual)                                                           | Stamp `openinference.span.kind="TOOL"`, `tool.name`, `tool.args`, `tool.result_*`                                |
| Buffered logs → OTLP                               | `createLogger(name)` + `flushLogs()`                                                                          | Use the logger; flush in `finally`                                                                               |

## What every API endpoint gets for free

If you add a new endpoint that:

- Reads/writes D1 via `c.env.DB` — every query auto-emits a `d1.*` child span.
- Reads/writes R2 via `c.env.REPLAYS_BUCKET` — same for `r2.*`.
- Runs the collector framework's processor pipeline — every processor in the
  chain becomes a `process.<plugin_name>` span with input/output counts, drop
  counts, and `processor.kind`.
- Calls `runtime.withChildSpan("…", fn)` for any logical boundary you want named
  (e.g. `usage.ingest`, `ask.runAsk`).

…you don't have to write any per-endpoint tracer code. The request span is
created by the worker fetch handler; the bindings are wrapped at the entrypoint;
the processor pipeline traces itself. The only manual work is when an endpoint
does _interesting_ in-process work the framework can't see — typically LLM
calls, agent loops, or operations whose business meaning matters more than their
mechanics (which `withChildSpan` makes trivial to annotate).

## Minimal recipe

```ts
import {
  createLogger,
  createRequestSpan,
  flushAICalls,
  flushLogs,
  initObservability,
  runWithSpan,
  wrapD1,
} from "@obs-unified/telemetry-sdk";

interface Env {
  DB: D1Database;
  OBS_COLLECTOR_URL: string;
  OBS_INGEST_KEY: string;
}

const logger = createLogger("my-service");
let inited = false;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!inited) {
      initObservability({
        collectorUrl: env.OBS_COLLECTOR_URL,
        apiKey: env.OBS_INGEST_KEY,
        serviceName: "my-service",
      });
      inited = true;
    }

    // 1. Wrap bindings — D1 calls now auto-emit child spans of whatever
    //    the active span is when the call happens.
    const tracedEnv = { ...env, DB: wrapD1(env.DB) };

    // 2. Wrap the request in a root span.
    const url = new URL(request.url);
    const span = createRequestSpan(
      "my-service",
      `${request.method} ${url.pathname}`,
    );
    span.setAttribute("http.request.method", request.method);
    span.setAttribute("url.path", url.pathname);

    try {
      const response = await runWithSpan(span, () =>
        handle(request, tracedEnv),
      );
      span.setAttribute("http.response.status_code", response.status);
      span.setStatus(response.status >= 500 ? 2 : 1);
      return response;
    } catch (err) {
      span.setStatus(2, err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      span.end();
      ctx.waitUntil(
        Promise.all([exportSpan(env, span), flushLogs(), flushAICalls()]).catch(
          () => undefined,
        ),
      );
    }
  },
};
```

That's the whole baseline. Without writing any tracer calls in your business
logic, you'll see HTTP request spans with D1 child spans nested under them.

## `wrapD1` — Cloudflare D1 binding wrapper

Drop-in for a `D1Database`. Wraps `prepare(sql).bind(...).run/all/first/raw`,
`db.batch(...)`, and `db.exec(sql)`. Every execution opens an OTel-shaped child
span on the active parent.

**Attributes set per query**

| Attribute                                                            | Source                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `db.system`                                                          | always `"d1"`                                                                           |
| `db.statement`                                                       | the SQL passed to `prepare()`, truncated to 1024 chars                                  |
| `db.operation`                                                       | first SQL keyword: `SELECT` / `INSERT` / `UPDATE` / `DELETE` / `DDL` / `EXEC` / `BATCH` |
| `db.rows_read` / `db.rows_written` / `db.duration_ms` / `db.changes` | from D1's `result.meta` when the binding reports them                                   |

**Errors** are captured: thrown errors mark the span with status code 2 and
message; the error is re-thrown so your normal error handling runs.

**Span name** is `d1.<operation>` (lowercase) — `d1.select`, `d1.insert`,
`d1.batch`, etc. Use `WrapD1Options.spanNamePrefix` to override.

**Where it sits**: the wrapper uses the SDK's `withChildSpan` internally. That
looks up the current logical parent via `AsyncLocalStorage` and falls back to
the request root span. If no active span exists (e.g., outside a `runWithSpan`
scope), it's a no-op pass-through — no error, no span emitted.

## Span nesting — how parent/child works

`runWithSpan(span, fn)` puts a `RequestSpan` as the _root_ in async storage.
`withChildSpan(name, fn)` creates a child of the current logical parent and
**pushes that child's id** as the new logical parent for the duration of `fn`.
Anything inside — including D1 queries via `wrapD1` and further `withChildSpan`
calls — becomes a _grandchild_ of `child`, not a flat sibling under the root.

Concretely, this:

```ts
await runWithSpan(rootSpan, async () => {
  await withChildSpan("ask.runAsk", async () => {
    await db.prepare("SELECT 1").first(); // d1.select
    await withChildSpan("post-process", async () => {
      await db.prepare("UPDATE foo SET ...").run(); // d1.update
    });
  });
});
```

Produces:

```
ROOT
└── ask.runAsk
    ├── d1.select
    └── post-process
        └── d1.update
```

Not:

```
ROOT
├── ask.runAsk
├── d1.select
├── post-process
└── d1.update
```

## `wrapR2` — Cloudflare R2 binding wrapper

Drop-in for an `R2Bucket`. Wraps `get`, `put`, `head`, `delete`, `list`.

```ts
const bucket = wrapR2(env.MEDIA, { bucketName: "media" });
await bucket.put(key, blob);
// ↳ child span "r2.put" with r2.bucket="media", r2.key, r2.size_bytes
```

Attributes: `r2.operation`, `r2.bucket`, `r2.key`, `r2.size_bytes`,
`r2.batch_size` (delete), `r2.result_count` (list).

## `wrapFetch` — outbound HTTP wrapper

Wraps the global `fetch` (or any compatible fn) so every outbound call becomes a
`kind=client` HTTP span with `http.method`, `http.url`,
`http.response.status_code`, `server.address`.

```ts
const tracedFetch = wrapFetch(fetch, {
  // Bypass tracing for self-emitted POSTs to avoid loops if you self-host
  // a collector that ingests the worker's own telemetry.
  skip: (url) => url.startsWith("https://obs.internal/v1/"),
});
await tracedFetch("https://api.example.com/v1/widgets");
```

You can also wrap individual call sites manually with `withChildSpan` — the
wrapper is just sugar that does the same thing for every fetch.

## LLM and tool spans (manual, OpenInference)

The SDK doesn't ship a one-shot `traceLLMCall` yet because every LLM provider's
response shape is different (where `usage` lives, what the finish reason is
called, whether streaming requires aggregation). The `withChildSpan` API is rich
enough to do it correctly per-provider.

OpenAI-style call:

```ts
await withChildSpan("llm.openai.chat", async (span) => {
  span.setAttribute("openinference.span.kind", "LLM");
  span.setAttribute("gen_ai.system", "openai");
  span.setAttribute("gen_ai.request.model", model);
  span.setAttribute("gen_ai.request.max_tokens", maxTokens);
  span.setAttribute("http.url", url);

  const response = await fetch(url, { ... });
  span.setAttribute("http.response.status_code", response.status);

  const json = await response.json();
  if (json.usage) {
    span.setAttribute("gen_ai.usage.input_tokens", json.usage.prompt_tokens);
    span.setAttribute("gen_ai.usage.output_tokens", json.usage.completion_tokens);
    span.setAttribute("gen_ai.usage.total_tokens", json.usage.total_tokens);
  }
  return json;
});
```

Tool dispatch inside an agent loop:

```ts
await withChildSpan(`tool.${toolName}`, async (span) => {
  span.setAttribute("openinference.span.kind", "TOOL");
  span.setAttribute("tool.name", toolName);
  span.setAttribute("tool.args", JSON.stringify(args).slice(0, 512));
  const result = await dispatch(toolName, args);
  span.setAttribute("tool.outcome", result.error ? "error" : "ok");
  return result;
});
```

The `genAiNormalizerPlugin` on the collector side normalizes `gen_ai.*`
attributes into OpenInference shape on ingest, so the dashboard's AI tab picks
them up automatically.

## Wiring inside `@obs-unified/collector` (the framework)

If your worker uses `@obs-unified/collector` to register plugins, the framework
exposes `runtime.withChildSpan` to plugin handlers and accepts a `withChildSpan`
field on `CollectorConfig`. Plug the SDK's helper in once at the worker
entrypoint:

```ts
import { withChildSpan } from "@obs-unified/telemetry-sdk";
import { createDefaultCollectorApp } from "@obs-unified/collector";

const app = createDefaultCollectorApp({
  // ...other config...
  withChildSpan: (name, fn, attributes) =>
    withChildSpan(name, async (child) => {
      if (attributes) {
        for (const [k, v] of Object.entries(attributes))
          child.setAttribute(k, v);
      }
      return fn(child); // pass child so call sites can stamp post-hoc attrs
    }),
});
```

Plugin handlers and library functions accept `LlmConfig.tracer` /
`AskRunDeps.tracer` of the same shape — the framework's `ChildSpanRunner` type.
They use it to wrap LLM HTTP calls and tool dispatch with the OpenInference
attributes shown above.

## Disabling instrumentation

The SDK is opt-in by configuration. If you don't call `initObservability`,
nothing posts to a collector. If `apiKey` is empty or the collector is
unreachable, posts fail silently and the app keeps running.

For the obs-collector worker specifically, leave `OBS_DASHBOARD_INGEST_KEY` and
`OBS_COLLECTOR_SELF_URL` unset to skip self-instrumentation entirely.

## Reference: when D1 queries are _not_ traced

- The wrapper hasn't been applied (you're using raw `env.DB` instead of
  `tracedEnv.DB`).
- The query happens outside any `runWithSpan` scope and there's no active parent
  span — the `withChildSpan` inside the wrapper falls through to the underlying
  call without creating a span.
- `OBS_DASHBOARD_INGEST_KEY` / your equivalent ingest key isn't set, so nothing
  is being exported anywhere even if spans are being created.

## Reference: avoiding the self-instrumentation loop

If you build a service that _receives_ its own telemetry (like our collector),
every self-emitted POST must carry the `X-Telemetry-Self: 1` header, and your
fetch handler must check that header _before_ creating a span for the request.
See `apps/collector/SELF_INSTRUMENTATION.md` for the full design.
