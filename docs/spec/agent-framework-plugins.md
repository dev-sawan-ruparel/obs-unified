# Agent Framework Plugin Contract

RFC 0010 framework wrappers are optional adapters over the native
`@obsunified/telemetry-sdk/agent` primitives. The core Agent Action Graph
contract stays stable; wrappers translate framework-specific callbacks into
`agent.run`, `agent.step`, `llm.call`, `tool.call`, retrieval, and evaluation
actions.

## Package Shape

Framework wrappers should live outside the base SDK when they require framework
dependencies:

- `@obsunified/agents-openai`
- `@obsunified/agents-langgraph`
- `@obsunified/agents-vercel-ai`

Shared types are exported from:

```ts
import type {
	AgentFrameworkAdapter,
	AgentFrameworkPluginOptions,
} from "@obsunified/telemetry-sdk/agent-plugin";
```

Wrappers may also re-export their adapter from a framework-specific package:

```ts
import { instrumentLangGraph } from "@obsunified/agents-langgraph";

instrumentLangGraph(graph, {
	defaultAgentName: "support-agent",
	defaultAgentVersion: "2026-06-01",
	capturePayloads: false,
	classifyTool: (tool) => ({
		sideEffect: tool.name.startsWith("update_"),
		approvalState: "human_approved",
	}),
});
```

## Contract

An adapter implements `AgentFrameworkAdapter<TFramework>`:

```ts
export interface AgentFrameworkAdapter<TFramework = unknown> {
	readonly name: string;
	install(
		framework: TFramework,
		options?: AgentFrameworkPluginOptions,
	): void | Promise<void> | (() => void | Promise<void>);
}
```

The return value is optional cleanup. Use it when the target framework supports
removing event listeners or monkey patches.

## Required Mapping

Wrappers should map framework events as follows:

| Framework concept            | Agent Action Graph primitive                         |
| ---------------------------- | ---------------------------------------------------- |
| run, thread, workflow, graph  | `startAgentRun` / `agent.run`                        |
| node, step, chain, middleware | `run.step` / `agent.step`                            |
| model call                   | `run.llm` or `llm` action with model/provider fields |
| tool call                    | `run.tool` / `tool.call`                             |
| retriever/vector lookup      | `recordRetrieval`                                    |
| evaluator/guardrail result   | `recordEvaluation`                                   |
| generated file/message/data  | `recordArtifact` when available                      |

Every wrapper must preserve:

- `root_action_id` for the whole run.
- `action_id` for the current framework event.
- `caused_by_action_id` from framework parent/edge information when available.
- `interaction_id` when a browser interaction triggered the agent run.
- `agent_run_id`, agent name, version, autonomy level, and actor id when known.
- W3C trace context across async boundaries.

## Privacy

Wrappers must default to metadata-only capture. They may pass prompt,
completion, arguments, and results only when payload capture is explicitly
enabled by the caller or already redacted by the framework.

Preferred default fields:

- model/provider and prompt version
- token counts and cost
- tool name, side-effect flag, approval state
- argument/result hashes or redacted summaries
- retrieval document ids, scores, source ids, and content hashes
- evaluation score, pass/fail, rubric id/version, and explanation summary

Raw prompt text, document content, completions, and tool payloads should be
withheld unless `capturePayloads: true` and `redactPayload` has been configured
or the framework guarantees redaction.

## Installation Behavior

Wrappers should avoid hard dependencies in `@obsunified/telemetry-sdk`. Put
framework packages in the wrapper package's peer dependencies. The base SDK
should remain usable without OpenAI Agents SDK, LangGraph, Vercel AI SDK, or
other agent frameworks installed.

## Acceptance

A framework wrapper is complete when a minimal app using that framework can
produce:

- one `agent.run`
- at least one child `agent.step`
- at least one LLM action
- at least one tool action, including side-effect and approval metadata when
  applicable
- connected rail pivots back to traces/logs/AI calls
- dashboard visibility in `AgentRunDashboard`

Phase 8 requires at least two wrappers to meet this bar.

---

## Implemented Framework Wrapper Packages

### 1. Vercel AI SDK Wrapper (`@obsunified/agents-vercel-ai`)

This package provides helper wrappers and an adapter for tracking Vercel AI SDK
graph steps, generation completions, and tool executions.

#### Usage Example:

```ts
import { generateText } from "ai";
import { wrapGenerateText, withVercelAIRun } from "@obsunified/agents-vercel-ai";

// Instrument generateText
const trackedGenerateText = wrapGenerateText(generateText, {
  capturePayloads: true,
  classifyTool: (tool) => {
    if (tool.toolName === "update_profile") {
      return { sideEffect: true, approvalState: "human_approved" };
    }
    return { sideEffect: false };
  }
});

// Run within an agent context
await withVercelAIRun({
  agentId: "triage-agent",
  agentName: "Billing Triage Assistant",
  goal: "Process invoice dispute",
  autonomyLevel: "human_approved_write"
}, async (run) => {
  const response = await trackedGenerateText({
    model: openai("gpt-4o"),
    prompt: "Dispute invoice INV-2026",
    tools: toolsByName,
  });
  run.setOutcome("Successfully disputed invoice");
});
```

---

### 2. LangGraph Wrapper (`@obsunified/agents-langgraph`)

This package integrates standard LangChain callbacks with the
`@obsunified/telemetry-sdk` runtime, mapping Node, Chain, Tool, and LLM
lifecycle events to decision graph primitives.

#### Usage Example:

```ts
import { CompiledStateGraph } from "@langchain/langgraph";
import { instrumentLangGraph, wrapLangGraphRunnable } from "@obsunified/agents-langgraph";

const graph: CompiledStateGraph = compiledGraph;

// Instrument the graph
instrumentLangGraph(graph, {
  defaultAgentId: "state-graph-agent",
  defaultAgentName: "LangGraph Operations Agent",
  capturePayloads: false,
  classifyTool: (toolName) => {
    if (toolName.startsWith("charge_")) {
      return { sideEffect: true, approvalState: "human_approved" };
    }
    return { sideEffect: false };
  }
});

// Invoking the graph automatically creates an agent.run segment and maps node steps
const result = await graph.invoke({
  query: "Resolve checkout error"
});
```
