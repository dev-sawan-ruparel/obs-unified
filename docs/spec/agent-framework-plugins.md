# Agent Framework Plugin Contract

RFC 0010 framework wrappers are optional adapters over the native
`@obs-unified/telemetry-sdk/agent` primitives. The core Agent Action Graph
contract stays stable; wrappers translate framework-specific callbacks into
`agent.run`, `agent.step`, `llm`, `tool.call`, retrieval, and evaluation
actions.

## Package Shape

Framework wrappers should live outside the base SDK when they require framework
dependencies:

- `@obs-unified/agents-openai`
- `@obs-unified/agents-langgraph`
- `@obs-unified/agents-vercel-ai`

Shared types are exported from:

```ts
import type {
	AgentFrameworkAdapter,
	AgentFrameworkPluginOptions,
} from "@obs-unified/telemetry-sdk/agent-plugin";
```

Wrappers may also re-export their adapter from a framework-specific package:

```ts
import { instrumentLangGraph } from "@obs-unified/agents-langgraph";

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

Wrappers should avoid hard dependencies in `@obs-unified/telemetry-sdk`. Put
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
