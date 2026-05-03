# @obs-unified/sdk (Node)

Thin OpenTelemetry SDK wrapper for obs-unified. One-line init, OpenInference
LLM/tool helpers, and project propagation. The OTel ecosystem provides
HTTP/DB/RPC auto-instrumentation; this package only adds what OTel doesn't
ship out of the box.

## Install

```sh
npm install @obs-unified/sdk \
  @opentelemetry/api \
  @opentelemetry/auto-instrumentations-node
```

## Quickstart

Create an `instrumentation.ts` that runs **before** any other module imports
HTTP/DB clients — Node's auto-instrumentation only catches imports made
after init.

```ts
// instrumentation.ts
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { init } from "@obs-unified/sdk";

const shutdown = init({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  ingestKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-service",
  serviceVersion: "1.4.2",
  environment: "production",
  projectId: "default",
  instrumentations: [getNodeAutoInstrumentations()],
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});
```

Load it before your app:

```sh
node --import ./instrumentation.js dist/server.js
```

You now get HTTP server + client spans, DB client spans (pg / mysql / mongo /
redis / etc.), and the request lifecycle for free.

## LLM call instrumentation

OTel doesn't ship LLM-specific spans. Wrap your fetch calls so the dashboard's
AI tab can render them:

```ts
import { withLLMSpan } from "@obs-unified/sdk";

const json = await withLLMSpan(
  { provider: "openai", model: "gpt-4o-mini", maxTokens: 1024, turnIndex: i },
  async (span) => {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, tools }),
    });
    const json = await response.json();
    span.setUsage({
      inputTokens: json.usage?.prompt_tokens,
      outputTokens: json.usage?.completion_tokens,
      totalTokens: json.usage?.total_tokens,
    });
    span.setFinishReason(json.choices?.[0]?.finish_reason);
    return json;
  },
);
```

The wrap stamps `openinference.span.kind=LLM`, `gen_ai.system`,
`gen_ai.request.model`, and post-call `gen_ai.usage.*` attributes. The
underlying OTel HTTP client instrumentation also creates a child span for
the actual `fetch` — you'll see the LLM span as the parent and the HTTP
span underneath, with both timings.

## Agent tool dispatch

```ts
import { withToolSpan } from "@obs-unified/sdk";

const result = await withToolSpan(
  { name: "list_widgets", args: parsedArgs },
  async (span) => {
    const out = await dispatch(parsedArgs);
    span.setOutcome(out.error ? "error" : "ok");
    span.setResultCount(out.items?.length ?? 0);
    return out;
  },
);
```

## Project-id propagation

Multi-tenant deployments tag every span with `project.id`. Two options:

```ts
// Static default — applied to every span/log/metric.
init({ ..., projectId: "tenant-acme" });

// Per-request, after auth resolves the project from the request:
import { setProjectId } from "@obs-unified/sdk";
app.use((req, res, next) => {
  const projectId = resolveProjectFromAuth(req);
  setProjectId(projectId);
  next();
});
```

## Custom logical boundaries

For business operations worth naming in the trace, use the standard OTel
tracer directly:

```ts
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");

await tracer.startActiveSpan("orders.fulfill", async (span) => {
  span.setAttribute("order.id", orderId);
  span.setAttribute("order.region", region);
  try {
    return await fulfillOrder(orderId);
  } finally {
    span.end();
  }
});
```

## Self-monitoring (rare)

If your service ingests its own telemetry through the same collector, set
`selfTelemetry: true` in `init`. Every export will carry
`X-Telemetry-Self: 1` so the collector's request middleware short-circuits
and avoids an export loop. See
[`apps/collector/SELF_INSTRUMENTATION.md`](../../apps/collector/SELF_INSTRUMENTATION.md)
for the full design.

## Caveats

- **Cloudflare Workers**: this SDK targets Node. For Workers, use
  [`packages/telemetry-sdk`](../../packages/telemetry-sdk) instead — it ships
  D1/R2/fetch wrappers tailored to the Workers runtime.
- **Auto-instrumentation timing**: `@opentelemetry/auto-instrumentations-node`
  patches modules on first import. Init *must* run before your app code,
  hence the `--import ./instrumentation.js` Node flag.
- **Span limits**: every span is billable storage. Don't wrap inner-loop
  helpers; only wrap boundaries that matter for blame attribution.
