# Agent Action Graph

The Agent Action Graph is obs-unified's product surface for understanding what
an AI agent did, why it did it, what systems it touched, and whether the result
should become a regression test.

Traditional traces show execution order. The Agent Action Graph adds semantic
causality: a user click, scheduled job, model call, retrieval, tool call,
guardrail, backend trace, log line, profile, and eval result can all be linked
as one explainable run.

This is implemented as "same data, new shape." obs-unified does not create a
separate observability silo for agents. It adds action identity and causal edges
over existing traces, logs, AI payloads, profiles, browser interactions, and
Connected Rail pivots.

## What It Answers

Use the Agent Action Graph when you need to answer:

- Which user action, cron job, webhook, or queue message started this agent run?
- Which LLM step selected the tool that changed production state?
- Did a tool call mutate external state, and was that mutation approved?
- Which backend trace, log lines, profiles, and database calls belong to the
  agent decision?
- Did a guardrail or evaluator catch the failure?
- Is this failure isolated, or is it tied to a tool, prompt version, model,
  agent version, user, tenant, or workflow?
- Can this production incident be saved as an eval case so future agent versions
  do not repeat it?

## Core Model

Every graph is built from three action identifiers:

| Field | Meaning |
| --- | --- |
| `root_action_id` | The full causal unit: one agent run, browser action, cron execution, webhook, or queue job. |
| `action_id` | One concrete action inside the graph: step, LLM call, retrieval, tool call, eval, artifact, or user action. |
| `caused_by_action_id` | The direct parent action that caused this action. This is the edge used to draw the decision graph. |

`interaction_id` still exists for browser-originated telemetry. In a simple
browser-only flow, `interaction_id`, `root_action_id`, and `action_id` coalesce.
When a browser action triggers an agent, `interaction_id` is carried forward for
user correlation while the agent run receives a new `root_action_id`. Background
runs such as crons and queue workers can have no `interaction_id`; their graph
is still complete because action IDs are the primary causal keys.

The wire-level contract is documented in
[docs/spec/action-id.md](spec/action-id.md).

## What Gets Recorded

The graph persists first-class records for:

- actions and causal parent edges
- agent runs
- tool calls
- retrieval events
- eval and guardrail results
- generated artifacts
- linked AI payload rows
- linked traces, spans, logs, profiles, browser replays, and users through the
  Connected Rail manifest

Agent runs include agent ID, name, version, goal, autonomy level, actor, outcome,
aggregate latency, and cost. Tool calls include tool name, side-effect marker,
approval state, arguments or argument hashes, result or result hashes, and error
metadata.

The most important governance fields are:

- `autonomyLevel`: `read_only`, `suggested_action`,
  `human_approved_write`, `autonomous_write`, or `blocked_by_policy`
- `sideEffect`: whether a tool can mutate external state
- `approvalState`: `suggested`, `human_approved`, `bypassed`, or `blocked`

Together, these make it possible to find high-risk writes such as:

```text
side_effect = true AND autonomy_level = autonomous_write
```

## Instrumentation Paths

There are four implemented ways to get data into the Agent Action Graph.

### 1. Native TypeScript Agent SDK

Use `@obs-unified/telemetry-sdk/agent` when you control the agent code and want
precise action boundaries.

```ts
import { startAgentRun } from "@obs-unified/telemetry-sdk/agent";

await startAgentRun(
  {
    agentId: "billing-agent",
    agentName: "Billing Operations Assistant",
    agentVersion: "v3",
    goal: "Resolve invoice update request",
    autonomyLevel: "human_approved_write",
    actorId: "usr_772183",
  },
  async (run) => {
    await run.step({ name: "classify intent" }, async () => {
      await run.llm(
        {
          model: "gpt-4o",
          provider: "openai",
          promptVersion: "billing-intent-v4",
        },
        async (call) => {
          call.setTokens({ prompt: 480, completion: 96, total: 576 });
        },
      );
    });

    await run.tool(
      {
        name: "db.invoice_update",
        arguments: { invoiceId: "INV-2026-9912" },
        sideEffect: true,
        approvalState: "human_approved",
      },
      async (toolCall) => {
        toolCall.setResult({ updated: true });
      },
    );

    await run.recordEvaluation({
      evaluatorName: "tenant_boundary_check",
      passed: true,
      score: 1,
    });

    run.setOutcome("Invoice update completed");
  },
);
```

The SDK automatically creates action IDs, stores the active context in async
local storage, and sets `caused_by_action_id` for nested steps, LLM calls, tool
calls, retrievals, evals, and artifacts. If the active request came from a
browser interaction, `startAgentRun` mints a new agent `root_action_id` and
points `caused_by_action_id` back to the triggering browser action while
carrying the original `interaction_id` forward. This keeps the agent workflow as
its own root graph without losing the click, replay, user, or session join.

Explicit contexts restored with `withAction` must use RFC 0010 action IDs. The
SDK rejects malformed `actionId`, `rootActionId`, `causedByActionId`, and
`agentRunId` values instead of letting invalid graph keys propagate.

### 2. Vercel AI SDK Wrapper

Use `@obs-unified/agents-vercel-ai` to wrap `generateText` or `streamText`
without hand-instrumenting every call site.

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import {
  withVercelAIRun,
  wrapGenerateText,
} from "@obs-unified/agents-vercel-ai";

const trackedGenerateText = wrapGenerateText(generateText, {
  capturePayloads: false,
  classifyTool: (tool) => {
    if (String(tool.toolName) === "update_profile") {
      return { sideEffect: true, approvalState: "human_approved" };
    }
    return { sideEffect: false };
  },
});

await withVercelAIRun(
  {
    agentId: "support-triage",
    agentName: "Support Triage Assistant",
    autonomyLevel: "suggested_action",
  },
  async () => {
    await trackedGenerateText({
      model: openai("gpt-4o"),
      prompt: "Summarize this billing ticket",
      tools: toolsByName,
    });
  },
);
```

The wrapper maps generation and streaming lifecycle events to agent steps, LLM
actions, token counts, tool calls, side-effect flags, and approval metadata.
LLM actions emit the canonical action kind `llm.call`.

### 3. LangGraph Wrapper

Use `@obs-unified/agents-langgraph` for LangGraph or LangChain runnable flows.

```ts
import { instrumentLangGraph } from "@obs-unified/agents-langgraph";

instrumentLangGraph(graph, {
  defaultAgentId: "state-graph-agent",
  defaultAgentName: "LangGraph Operations Agent",
  defaultAgentVersion: "2026-06-01",
  capturePayloads: false,
  classifyTool: (toolName) => {
    if (String(toolName).startsWith("charge_")) {
      return { sideEffect: true, approvalState: "human_approved" };
    }
    return { sideEffect: false };
  },
});

await graph.invoke({ query: "Resolve checkout error" });
```

The wrapper installs a LangChain-compatible callback handler and maps graph
invocation, chain/node completion, LLM completion, and tool execution into
Agent Action Graph records.

### 4. Standards-Based Ingest

The collector normalizes compatible ecosystem telemetry even when an app has not
installed the native agent SDK:

- OpenTelemetry GenAI spans
- OpenInference spans for agent, LLM, tool, retriever, guardrail, evaluator,
  prompt, chain, embedding, and reranker operations
- OTel MCP tool, resource, and prompt call spans

When explicit action IDs are present, the graph is high confidence. When they
are absent, the collector derives deterministic fallback IDs from trace/span
identity so the dashboard can still render useful navigation.

Malformed explicit action IDs are treated as absent at collector ingress. The
normalizer replaces them with deterministic fallback IDs and marks the action
confidence as `fallback`, preserving graph navigability without trusting invalid
identity data.

## MCP Context Propagation

See [MCP in obs-unified](mcp.md) for the distinction between the read-only
investigation MCP server, SDK context propagation helpers, and collector
normalization of OTel MCP spans.

MCP calls do not always have per-request HTTP headers, so obs-unified propagates
trace and action context through JSON-RPC `params._meta`.

Client helpers in `@obs-unified/telemetry-sdk/mcp` inject:

- `traceparent`
- optional `tracestate`
- `baggage`, including `obs.interaction.id` when an active browser-triggered
  action context exists
- `obs.action.root_id`
- `obs.action.id`
- nested `obs.root_action_id` and `obs.action_id` compatibility keys

Server helpers extract those fields and restore action context before the MCP
server performs nested tool, database, HTTP, or model work. Extracted action IDs
are validated against the RFC 0010 Crockford base32 format; malformed IDs are
ignored rather than restored into async-local action context.

```ts
import {
  extractMcpContext,
  injectMcpContext,
} from "@obs-unified/telemetry-sdk/mcp";
import { withAction } from "@obs-unified/telemetry-sdk/agent";

injectMcpContext(params, { tracestate: "obs=high" });

const context = extractMcpContext(params);
if (context?.actionContext) {
  await withAction(context.actionContext, async () => {
    await callTool();
  });
}
```

## Dashboard Surfaces

The product experience is organized around an agent run detail page plus
operational aggregate views.

### Agent Run Replay

Open an agent run from the dashboard route:

```text
#/agent-runs/:agentRunId
```

The detail view shows:

- run metadata: agent name, version, autonomy level, goal, outcome, duration,
  and cost
- a semantic timeline of LLM calls, retrievals, tool calls, evals, guardrails,
  and artifacts
- a decision graph built from `caused_by_action_id`
- profiles and guardrails linked to the run's trace
- a Connected Rail for moving to related traces, logs, AI calls, actions, users,
  sessions, profiles, and tool calls
- a "Save as eval case" action

The backend route is:

```text
GET /internal/agent-runs/:id
```

### Action and Tool Details

Individual actions and tool calls are addressable:

```text
GET /internal/actions/:id
GET /internal/tool-calls/:id
```

Each detail response includes the entity plus its Connected Rail manifest so the
UI can pivot across the graph without losing context.

### Operational Views

The aggregate dashboards answer whether a failure is isolated or systemic.

| Dashboard | Backend route | Use it for |
| --- | --- | --- |
| Tool Reliability | `/internal/actions/aggregates/tool-reliability` | Tool call volume, latency, error rate, timeout rate, retry count, malformed arguments, side-effect count, and top causing agents. |
| Cost Attribution | `/internal/actions/aggregates/cost-attribution` | Cost by agent, run, model, provider, prompt version, tool, user, tenant, and workflow. |
| Agent Version Diff | `/internal/actions/aggregates/version-diff` | Comparing success rate, eval score, latency, cost, tool errors, user-visible failures, and downstream service errors between versions. |
| Autonomous Review | `/internal/actions/aggregates/autonomous-review` | Reviewing side-effecting writes performed under autonomous or high-risk autonomy levels. |

## Production-to-Eval Loop

The Agent Action Graph closes the debugging loop by turning production failures
into eval cases.

Supported flows include saving from:

- agent run detail
- action detail
- tool call detail
- AI-call and failed-trace surfaces where source metadata is available

Eval cases preserve source links back to the production run, action, tool call,
trace, span, and payload hashes or redacted payloads. Eval results can then be
ingested and compared in the dashboard.

The backend routes are:

```text
POST /internal/eval-cases
GET /internal/eval-cases
GET /internal/eval-cases/:id
POST /internal/eval-cases/:id/results
GET /internal/eval-cases/:id/results
```

This lets a team investigate a bad production run, save the failure as a test
case, and compare future agent or prompt versions against the original incident.

## Privacy and Payloads

Agent telemetry frequently includes prompts, completions, retrieved documents,
tool arguments, and tool results. obs-unified defaults to metadata-first
capture.

By default, wrappers and normalizers should record:

- model and provider
- prompt version
- token counts and cost
- tool name
- side-effect and approval metadata
- retrieval document IDs, scores, source IDs, and content hashes
- eval score, pass/fail, evaluator name, rubric version, and reasoning summary
- argument and result hashes or redacted summaries

Raw prompts, completions, document segments, tool arguments, and tool results
should only be stored when project payload capture is explicitly enabled and a
redaction processor is configured.

## Example Investigation

A support agent updates the wrong invoice address in production.

With the Agent Action Graph, the engineer can:

1. Open the agent run by invoice ID, user ID, trace ID, or run ID.
2. Read the semantic timeline: trigger, intent triage, retrieval, lookup tool,
   mutation tool, guardrail, final response.
3. Open the decision graph to see that the write tool was caused by the lookup
   step, which was caused by an LLM classification.
4. Click the mutating tool call and confirm `sideEffect = true`,
   `approvalState = bypassed`, and `autonomyLevel = autonomous_write`.
5. Use the Connected Rail to pivot to the database trace and logs.
6. Inspect the guardrail eval that caught the tenant mismatch.
7. Save the production incident as an eval case so future prompt or model
   versions must prove they block the same failure.

The result is not only a better incident timeline. It is a reusable product loop:
observe the run, explain the cause, assess blast radius, and convert the failure
into an evaluation.

## Related References

- [Action ID wire spec](spec/action-id.md)
- [Framework plugin contract](spec/agent-framework-plugins.md)
- [Agent run replay worked example](ux/agent-run-replay.md)
- [RFC 0010](../rfcs/0010-agent-action-graph.md)
