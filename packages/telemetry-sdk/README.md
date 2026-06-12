# @obs-unified/telemetry-sdk

Server-side telemetry SDK for
[obs-unified](https://github.com/obs-unified/obs-unified). OTLP spans,
structured logger, AI/LLM helpers, `interaction_id` stamping, and Agent Action
Graph primitives. Targets Cloudflare Workers, Node.js, Bun, and Deno; the
Workers binding wrappers live under the `./cloudflare` subpath.

```bash
pnpm add @obs-unified/telemetry-sdk
```

## Quick start

```ts
import {
  createRequestSpan,
  initObservability,
  runWithSpan,
  stampInteractionFromRequest,
  flushLogs,
  flushAICalls,
} from "@obs-unified/telemetry-sdk";

app.use("*", async (c, next) => {
  initObservability({
    collectorUrl: c.env.OBS_COLLECTOR_URL,
    apiKey: c.env.OBS_INGEST_KEY,
    serviceName: "checkout-api",
  });
  await next();
});

app.use("*", async (c, next) => {
  const span = createRequestSpan(
    "checkout-api",
    `${c.req.method} ${c.req.path}`,
  );
  // Closes the click-to-trace loop. No-op if header is missing.
  stampInteractionFromRequest(span, c.req.raw);
  try {
    await runWithSpan(span, () => next());
    span.setStatus(c.res.status >= 400 ? 2 : 1);
  } finally {
    span.end();
    await Promise.all([flushLogs(), flushAICalls()]);
  }
});
```

## Cloudflare binding wrappers

`wrapD1` / `wrapR2` / `wrapFetch` live under `./cloudflare` so that Node
consumers don't pull `@cloudflare/workers-types`:

```ts
import {
  wrapD1,
  wrapR2,
  wrapFetch,
} from "@obs-unified/telemetry-sdk/cloudflare";

const db = wrapD1(env.DB);
const bucket = wrapR2(env.REPLAYS, { bucketName: "replays" });
const fetch = wrapFetch(globalThis.fetch);
```

## What you get vs. what you wire

See [INSTRUMENTATION_GUIDE.md](./INSTRUMENTATION_GUIDE.md) for the full table.
TL;DR: the SDK provides span/log/AI primitives and the OpenInference
conventions; your application wires call sites and choice of LLM-call
boundaries.

## Identity propagation

The interaction key flows browser → server through the `x-obs-interaction`
header. Call `stampInteractionFromRequest(span, req)` once on the root span;
child spans and logs inherit automatically. See
[`docs/spec/interaction-id.md`](../../docs/spec/interaction-id.md).

## Agent Action Graphs

Use `@obs-unified/telemetry-sdk/agent` when your backend runs agents,
tool-calling workflows, background jobs, or MCP hosts. The SDK creates RFC 0010
action IDs, preserves browser `interaction_id` when a user action triggered the
agent, and links each step through `caused_by_action_id`.

```ts
import { startAgentRun } from "@obs-unified/telemetry-sdk/agent";

await startAgentRun(
  {
    agentId: "billing-agent",
    agentName: "Billing Agent",
    autonomyLevel: "human_approved_write",
  },
  async (run) => {
    await run.llm(
      { model: "gpt-4o", provider: "openai" },
      async (call) => call.setTokens({ prompt: 320, completion: 84 }),
    );

    await run.tool(
      {
        name: "db.invoice_update",
        arguments: { invoiceId: "INV-2026-9912" },
        sideEffect: true,
        approvalState: "human_approved",
      },
      async (toolCall) => toolCall.setResult({ updated: true }),
    );
  },
);
```

MCP context propagation helpers let MCP hosts carry the same graph context
through JSON-RPC `params._meta`. These helpers are separate from the
`@obsunified/mcp-server` investigation server:

```ts
import { injectMcpContext, extractMcpContext } from "@obs-unified/telemetry-sdk/mcp";
import { withAction } from "@obs-unified/telemetry-sdk/agent";

injectMcpContext(params);

const context = extractMcpContext(params);
if (context?.actionContext) {
  await withAction(context.actionContext, async () => {
    await callTool();
  });
}
```

See [Agent Action Graph](../../docs/agent-action-graph.md) and the
[action ID wire spec](../../docs/spec/action-id.md).
