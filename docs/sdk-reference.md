# SDK API Reference Cheat Sheet

This document serves as a centralized, searchable cheat sheet for all standard API methods exposed across the browser client SDK (`@obs-unified/analytics-sdk`) and server-side SDKs (`@obs-unified/telemetry-sdk`, Go, and Rust packages).

---

## 1. SDK Initialization

Setup the observability pipeline at the application start sequence.

### Browser / Client-Side
Initialize the browser SDK to track page views, click interactions, frontend exceptions, and (optionally) DOM session replay.

#### React Wrapper
```tsx
import { AnalyticsProvider } from "@obs-unified/analytics-sdk/react";

function Root() {
  return (
    <AnalyticsProvider
      collectorUrl="https://obs.my-app.com"
      apiKey="your-public-ingest-key"
      trackPageViews={true}
      captureErrors={true}
      sessionReplay={true} // Enable DOM capture via rrweb
    >
      <App />
    </AnalyticsProvider>
  );
}
```

#### Vanilla / Non-React JS
```typescript
import { installAutoCorrelate, UsageTracker } from "@obs-unified/analytics-sdk";

const tracker = new UsageTracker({
  collectorUrl: "https://obs.my-app.com",
  apiKey: "your-public-ingest-key",
});

// Patches window.fetch and installs event listeners for auto-correlation (Mode A)
installAutoCorrelate({ tracker });
```

---

### Backend / Server-Side (Node.js, Bun, Deno)
Initialize the standard telemetry exporter pipeline. This registers unified trace span, structured log, and AI call tracking exporters simultaneously.

```typescript
import { initObservability } from "@obs-unified/telemetry-sdk";

initObservability({
  collectorUrl: "https://obs.my-app.com",
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "checkout-api",
  serviceVersion: "1.2.0",      // Optional
  flushIntervalMs: 5000,        // Flush batch queues every 5s (0 to disable)
});
```

---

## 2. Click-to-Trace Context & Correlation (`interaction_id`)

Closing the correlation loop joining client-side interactions to server-side spans and logs.

### Server-Side HTTP Ingress
Extract the `x-obs-interaction` transport header and bind the resulting Crockford base32 correlation key onto the active trace context:

```typescript
import { createRequestSpan, stampInteractionFromRequest, runWithSpan } from "@obs-unified/telemetry-sdk";

// Inside your HTTP middleware handler
const span = createRequestSpan("my-service", `${req.method} ${req.path}`);

// Reads x-obs-interaction and stamps obs.interaction.id as a span attribute
stampInteractionFromRequest(span, req); 

runWithSpan(span, () => {
  // All child spans and application logs created inside this scope inherit the ID
});
```

### Client-Side Async Continuity (Mode B)
If you perform asynchronous operations that escape the standard microtask queue (e.g., debounce timers, state machine ticks, or `setTimeout` delays), manually capture and restore the click interaction context:

```typescript
import { currentInteractionId, withInteractionContext } from "@obs-unified/analytics-sdk";

// 1. Capture the ID synchronously inside the user-triggered click handler
const clickId = currentInteractionId(); 

// 2. Re-enter the correlation context inside the async execution block
setTimeout(() => {
  withInteractionContext(clickId!, () => {
    // This fetch call correctly carries the x-obs-interaction transport header
    fetch("/api/long-running-task"); 
  });
}, 300);
```

---

## 3. AI & LLM Span Tracking (OpenInference Model)

Track large language model prompts, completion tokens, latency, monetary cost, and tool calls.

### High-Level Event Tracking (`trackAICall`)
Log raw LLM usage statistics without managing OpenTelemetry spans manually:

```typescript
import { trackAICall } from "@obs-unified/telemetry-sdk";

trackAICall({
  modelName: "claude-3-5-sonnet-20251022",
  provider: "anthropic",
  callType: "chat",
  promptTokens: 250,
  completionTokens: 180,
  latencyMs: 1400,
  totalCostUsd: 0.0035, // Optional cost calculations
  isError: false,
});
```

### Low-Level Span Instrumentation (OpenInference Spans)
Wrap your agent actions, vector store fetches, or model runs in semantic AI span contexts:

```typescript
import { startLLMSpan, startToolSpan } from "@obs-unified/telemetry-sdk";

// 1. Instrument the LLM call boundary
const llmSpan = startLLMSpan("user-query-completion", {
  modelName: "gpt-4o",
  provider: "openai",
  inputPrompt: "What is the capital of France?",
});

try {
  const result = await myLLMApiCall();
  llmSpan.setAttributes({
    "openinference.span.output": result.text,
    "openinference.usage.prompt_tokens": result.prompt_tokens,
    "openinference.usage.completion_tokens": result.completion_tokens,
  });
} finally {
  llmSpan.end();
}

// 2. Instrument Tool usage inside your Agent
const toolSpan = startToolSpan("database-search-tool", {
  toolName: "pg-vector-search",
  toolInput: "paris coordinates",
});
try {
  const data = await searchDb();
  toolSpan.setAttributes({ "openinference.span.output": JSON.stringify(data) });
} finally {
  toolSpan.end();
}
```

---

## 4. Cloudflare Workers Binding Wrappers

For edge computing runtimes, wrap your database bindings, asset storage, and outgoing fetch calls to automatically propagate traces and inject correlation tags. 

*Import these under the specific `@obs-unified/telemetry-sdk/cloudflare` path to avoid pulling heavy ambient type dependencies in Node.js environments.*

```typescript
import { wrapD1, wrapR2, wrapFetch } from "@obs-unified/telemetry-sdk/cloudflare";

// 1. Wrap SQL Database bindings (captures SQL query timings and parameter metadata)
const db = wrapD1(env.DATABASE);

// 2. Wrap R2 Object Storage buckets (captures read/write latency and blob sizing)
const bucket = wrapR2(env.STORAGE_BUCKET, { bucketName: "blobs" });

// 3. Wrap Client Fetch calls (injects parent traceparent and interaction headers)
const telemetryFetch = wrapFetch(globalThis.fetch);
```

---

## 5. Agent Action Graphs

Use the TypeScript agent primitives to model autonomous workflows as causal
graphs. Each run receives a `root_action_id`, each step/tool/LLM call receives
an `action_id`, and each child action points at its parent through
`caused_by_action_id`. Browser-triggered runs also carry the original
`interaction_id` so replay and user/session pivots stay connected.

```typescript
import { startAgentRun } from "@obs-unified/telemetry-sdk/agent";

await startAgentRun(
  {
    agentId: "support-agent",
    agentName: "Support Agent",
    autonomyLevel: "suggested_action",
  },
  async (run) => {
    await run.step({ name: "classify intent" }, async () => {
      await run.llm(
        { model: "gpt-4o", provider: "openai" },
        async (call) => call.setOutput({ intent: "billing_update" }),
      );
    });

    await run.tool(
      {
        name: "invoice_lookup",
        arguments: { invoiceId: "INV-2026-9912" },
        sideEffect: false,
      },
      async (toolCall) => toolCall.setResult({ found: true }),
    );
  },
);
```

For framework wrappers and MCP context propagation, see:

- [Agent Action Graph overview](agent-action-graph.md)
- [MCP terminology](mcp.md)
- [Action ID wire spec](spec/action-id.md)
- [Framework plugin contract](spec/agent-framework-plugins.md)

---

## 6. Cross-Language SDK Mapping Matrix

The same observability concepts are exported across Go and Rust SDKs, named according to standard per-language casing and paradigms:

| Concept / Action | TypeScript SDK (`@obs-unified/*`) | Go SDK (`obs`) | Rust SDK (`obs_unified`) |
| :--- | :--- | :--- | :--- |
| **Exporter Init** | `initObservability(config)` | `obs.Init(ctx, config)` | `obs_unified::init(config)` |
| **HTTP Stamp** | `stampInteractionFromRequest(span, req)` | `obs.StampInteraction(ctx, r)` | `obs_unified::stamp_interaction(span, req)` |
| **LLM Tracking Span** | `startLLMSpan(name, options)` | `obs.StartLLMSpan(ctx, name, opts)` | `obs_unified::start_llm_span(name, opts)` |
| **Tool Tracking Span** | `startToolSpan(name, options)` | `obs.StartToolSpan(ctx, name, opts)` | `obs_unified::start_tool_span(name, opts)` |
| **Set Multi-Tenant Project**| `extraHeaders: { "x-project-id": id }` | `obs.SetProjectID(ctx, id)` | `obs_unified::set_project_id(id)` |
| **Capture Error Exception**| `annotateErrorSpan(span, error)` | `obs.AnnotateError(ctx, span, err)` | `obs_unified::annotate_error(span, err)` |
