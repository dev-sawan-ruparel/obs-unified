# @obsunified/telemetry-sdk

Server-side telemetry SDK for
[obs-unified](https://github.com/dev-sawan-ruparel/obs-unified). OTLP spans,
structured logger, AI/LLM helpers, `interaction_id` stamping, and Agent Action
Graph primitives. Targets Cloudflare Workers, Node.js, Bun, and Deno; the
Workers binding wrappers live under the `./cloudflare` subpath.

```bash
pnpm add @obsunified/telemetry-sdk
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
} from "@obsunified/telemetry-sdk";

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
} from "@obsunified/telemetry-sdk/cloudflare";

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

Use `@obsunified/telemetry-sdk/agent` when your backend runs agents,
tool-calling workflows, background jobs, or MCP hosts. The SDK creates RFC 0010
action IDs, preserves browser `interaction_id` when a user action triggered the
agent, and links each step through `caused_by_action_id`.

```ts
import { startAgentRun } from "@obsunified/telemetry-sdk/agent";

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
import { injectMcpContext, extractMcpContext } from "@obsunified/telemetry-sdk/mcp";
import { withAction } from "@obsunified/telemetry-sdk/agent";

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

## Runtime lineage

Lineage is sent once as resource attributes, not repeated on every span. On Cloudflare Workers (`createResolveConfig` / the plugin) there is no resource hook in `@microlabs/otel-cf-workers`, so the same attributes are stamped on each exported span through a `postProcessor`. Env vars are read from the Worker `env` bindings on Workers and from `process.env` elsewhere.

Every option is optional. Pass them flat on the init config (the nested `lineage` option still works but is deprecated):

| Option | Env vars read automatically (first match wins) | Wire attributes |
| --- | --- | --- |
| `environment` | `OBS_ENVIRONMENT`, `NODE_ENV` | `deployment.environment.name`, `obs.environment` |
| `serviceVersion` | `OBS_SERVICE_VERSION`, `OTEL_SERVICE_VERSION` | `service.version`, `obs.service.version` |
| `commitSha` | `OBS_COMMIT_SHA`, `GITHUB_SHA` | `vcs.commit.id`, `obs.commit.sha` |
| `configDigest` | `OBS_CONFIG_DIGEST` | `obs.config.digest` |

Explicit options win over env vars. `environment` is normalised so spans and change events join: lowercased and trimmed, `production` becomes `prod`, `development` becomes `dev`, `test` is unchanged, and an empty value becomes `default`. So `NODE_ENV=production` and a change posted as `prod` land in the same environment.

Call `recordFeatureFlag(key, variant, { providerName, contextId })` when you evaluate a flag. The evaluation is attached to the active span as `feature_flag.*` and `obs.feature_flags.<key>` attributes, so AutoSRE can compute flag cohorts.
