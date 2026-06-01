# RFC 0010: Agent action graph

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-05-18
- **Updated:** 2026-05-18
- **Parent:** [RFC 0003 — Unified Stack](0003-unified-stack.md)
- **Depends on:**
  [RFC 0004 — Identity propagation](0004-identity-propagation.md),
  [RFC 0006 — Connected rail](0006-connected-rail.md),
  [RFC 0008 — Storage interface refactor](0008-storage-interface.md)
- **Companion:** [docs/spec/interaction-id.md](../docs/spec/interaction-id.md),
  [docs/agent-action-graph.md](../docs/agent-action-graph.md),
  [docs/spec/action-id.md](../docs/spec/action-id.md),
  [docs/ux/agent-run-replay.md](../docs/ux/agent-run-replay.md)
- **Target:** `@obs-unified/collector`, `@obs-unified/telemetry-sdk`,
  `@obs-unified/dashboard`, docs

## Summary

Extend obs-unified from a click-to-CPU observability graph into a
human-and-agent action graph. Today, the product can follow a user click through
browser usage, replay, backend traces, logs, AI calls, profiles, and alerts.
Agentic systems need the same causality, but the initiating action may be an
agent goal, plan step, tool call, retrieval, guardrail, or autonomous write
rather than a DOM click.

This RFC defines the delta between what exists today and what is required for
agent-native observability:

- generalize `interaction_id` into an action graph without breaking the existing
  click-scoped contract;
- ingest and normalize OpenTelemetry GenAI, MCP, and OpenInference-shaped spans
  into obs-unified's internal identity model;
- add SDK helpers for agent runs, steps, tools, retrieval, memory, guardrails,
  evaluations, and artifacts;
- add dashboard surfaces for agent run replay, decision paths, tool reliability,
  cost attribution, prompt / agent version diffs, and production-to-eval
  promotion;
- keep the existing Connected rail as the primary UX, not another orphan
  "Agents" tab.

The product promise becomes:

> Follow any production action, whether human or AI agent initiated, from cause
> to decision path to side effect to trace, replay, cost, policy, and CPU.

### Same data, new shape

Agent observability does not introduce a wholly separate signal family. An agent
run is composed of primitives obs-unified already understands: LLM calls, tool /
function calls, backend spans, logs, retrieval-shaped events, eval / guardrail
results, replay, and profiles.

The delta is the envelope and edges:

- `root_action_id` groups the whole run.
- `action_id` names each meaningful step.
- `caused_by_action_id` records parent / child causality.
- existing spans, logs, AI payloads, replays, and profiles attach to those IDs.

Without this layer, users see a pile of LLM calls and spans. With it, they see
the story of one production action.

### End-user story

A support agent updated the wrong invoice. Today, the engineer can find an LLM
call, a tool call, a backend trace, and a log line, but must manually
reconstruct how they relate.

With this RFC implemented, they open the agent run and see:

1. the user prompt or webhook that triggered the run;
2. the classification step and prompt version;
3. the retrieval step and selected documents;
4. the invoice lookup tool call;
5. the backend trace and logs caused by that tool call;
6. the side-effecting update, including autonomy level;
7. the guardrail / eval result;
8. the final answer and total cost.

From there, one click saves the run as an eval case so the same failure can be
tested against the next prompt, model, or agent version.

## Motivation

Agentic applications fail differently from ordinary request / response systems.
A normal APM trace can show that `/api/resolve-ticket` was slow or returned 500.
It usually cannot answer:

- Why did the agent choose this tool?
- Which prompt version caused the regression?
- Did the agent retrieve the wrong document, skip retrieval, or ignore good
  context?
- Which tool call mutated customer data?
- Was the action autonomous, human-approved, or only suggested?
- What did this run cost by model, tool, workflow, tenant, and user?
- Which production runs should become eval cases?

The current obs-unified thesis already points in the right direction:
unification is the cost of moving from one signal to adjacent signals, not the
number of tabs in a dashboard. Agentic systems add new adjacent signals. The
user no longer needs only click -> trace -> logs -> replay; they need goal ->
plan -> model call -> tool call -> side effect -> eval / guardrail -> trace /
logs / profile.

This is not a separate product bolted onto the side. It is the same
identity-propagation problem RFC 0003 identified, now with agents as first-class
actors.

## Today

### What exists

obs-unified already has most of the lower-level plumbing:

- `interaction_id` wire spec for click-scoped correlation
  ([docs/spec/interaction-id.md](../docs/spec/interaction-id.md)).
- Browser analytics SDK that mints `interaction_id` and injects
  `x-obs-interaction` into outbound requests.
- Server telemetry SDK helper that stamps `obs.interaction.id` onto the root
  span.
- OTLP trace / log / metric ingest.
- AI call tracking and AI span payload storage.
- Usage analytics, user profiles, session replay, and identity linking.
- pprof profile ingest and trace -> profile indexing.
- Connected rail manifest endpoint and UI surface.
- Storage seam (`SqlDb`, `IdentityIndex`) that gives this RFC a natural place to
  add cross-signal joins.

### Gaps

The current model is user-interaction centric:

| Need                         | Today                                | Gap                                                                     |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| Click -> backend correlation | `interaction_id`                     | Works for human browser actions only                                    |
| Agent run identity           | none                                 | No `agent_run_id`, `task_id`, `step_id`, or causal parent               |
| Tool call identity           | partial via spans / AI payloads      | No normalized `tool_call_id`, args hash, side-effect marker             |
| Retrieval / memory           | none                                 | No retriever, document, score, memory, or source attribution model      |
| Guardrails / evals           | analyses exist, evals absent         | No per-run quality / policy timeline                                    |
| Prompt / agent versioning    | ad hoc attributes                    | No first-class prompt, model, strategy, or agent version dimensions     |
| MCP                          | accepted as generic spans if emitted | No MCP-aware mapping or trace-context propagation guidance              |
| Production-to-eval           | absent                               | No way to promote a run / span bundle into a test case                  |
| Autonomy boundary            | absent                               | No distinction between suggested, human-approved, and autonomous writes |

The dashboard also lacks agent-native surfaces:

- no agent run timeline;
- no decision tree / branch view;
- no tool reliability dashboard;
- no prompt / agent version comparison;
- no cost waterfall for a run;
- no eval / guardrail timeline;
- no "save this production failure as eval case" workflow.

## External standards posture

As of May 2026:

- OpenTelemetry GenAI semantic conventions define model spans, agent spans, tool
  execution spans, metrics, events, exceptions, provider conventions, and MCP
  conventions. The GenAI and MCP conventions are still marked development, so
  obs-unified must treat them as an ingest compatibility layer rather than its
  only internal schema.
- OpenTelemetry MCP conventions recommend propagating trace context inside MCP
  `params._meta` because MCP is JSON-RPC over multiple possible transports and
  transport-level HTTP context is insufficient.
- OpenInference has a practical span-kind vocabulary used by current AI tracing
  systems: `AGENT`, `LLM`, `TOOL`, `RETRIEVER`, `EMBEDDING`, `RERANKER`,
  `GUARDRAIL`, `EVALUATOR`, `PROMPT`, and `CHAIN`.
- Langfuse exposes a `Trace` / `Observation` / `Score` model with
  `parent_observation_id` edges. LangSmith exposes a `Run` / `parent_run_id`
  model. Both are widely deployed in production agent stacks, and ingest paths
  from either are expected over time.

The design principle: **ingest broadly, normalize narrowly**. We accept OTLP
GenAI / MCP, OpenInference-shaped traces, and (over time) Langfuse `Observation`
/ LangSmith `Run` payloads, then normalize all of them into obs-unified's own
action graph for storage, joins, and UI. We do not adopt any one upstream model
as our internal schema: GenAI / MCP are still development status, OpenInference
is attribute-flavored not entity-flavored, and the vendor models are tightly
coupled to their respective UIs.

## Proposed design

### Relationship to `interaction_id`

`interaction_id` is not replaced by this RFC. It remains the stable
browser-to-server correlation key defined by RFC 0004: one click, submit,
keypress, or deliberate frontend action can be followed into backend spans,
logs, replay, AI calls, and profiles.

The action graph generalizes the same idea to actors and work that do not fit
cleanly inside a single browser interaction. For simple human flows, the three
IDs share a value, but the new SDK emits each field explicitly so any collapse
stays a server-side rendering choice rather than a client convention:

```
interaction_id = click_123
root_action_id = click_123
action_id      = click_123
```

For agentic or delayed flows, they diverge. The agent run is its own causal
root, linked to the click that triggered it by a `caused_by_action_id` edge:

```
click action
  action_id           = click_123
  root_action_id      = click_123
  interaction_id      = click_123

agent run (root action)
  action_id           = agent_run_456
  root_action_id      = agent_run_456
  caused_by_action_id = click_123        # edge back to the click
  interaction_id      = click_123        # carried for filter / join

  step_1 classify intent
    action_id           = step_1
    root_action_id      = agent_run_456
    caused_by_action_id = agent_run_456
  step_2 retrieve docs
    action_id           = step_2
    root_action_id      = agent_run_456
    caused_by_action_id = step_1
  step_3 call tool
    action_id           = step_3
    root_action_id      = agent_run_456
    caused_by_action_id = step_2
  step_4 generate answer
    action_id           = step_4
    root_action_id      = agent_run_456
    caused_by_action_id = step_3
```

`agent_run_456` here is both the `agent_run_id` (the durable run identifier kept
in the `agent_runs` detail table) and the `action_id` of the run's root action
row in `actions`. For any root action, `action_id == root_action_id`, which
makes the agent run row addressable through either field.

The distinction:

| Concept               | Scope                                           | Answers                                                                        |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `interaction_id`      | One browser-originated interaction              | Which user click / submit / keypress caused this?                              |
| `root_action_id`      | One complete causal run                         | Which human, agent, workflow, webhook, cron, or queue job does this belong to? |
| `action_id`           | One meaningful step inside that run             | Which specific decision, tool call, retrieval, eval, or side effect is this?   |
| `caused_by_action_id` | Pointer from a child action to its direct cause | What directly caused this step?                                                |

So `interaction_id` becomes one possible entry point into the graph, alongside
`agent_run_id`, queue job id, webhook delivery id, and cron schedule id. It is
enough for click-to-trace. It is not enough for agent runs with multiple steps,
retries, tool calls, async continuations, cron starts, webhook starts, queue
resumes, or autonomous writes. Those need action identity and parent edges.

For root actions that do not originate in a browser — agent runs triggered by
cron, webhooks, queues, or other agents — `interaction_id` is null. Consumers
(dashboards, Connected rail, alerts) MUST NOT require its presence; the action
graph keys (`root_action_id`, `action_id`, `caused_by_action_id`) are the
canonical correlation, and empty-state copy (see the Connected rail section) is
load-bearing.

Records written before this RFC are projected into the action graph by deriving
`action_id = root_action_id = interaction_id` for browser-originated rows.
Dashboards and queries that key off `interaction_id` keep working through the
cutover; see Phase 1 for the migration.

### Instrumentation responsibility

The action graph is only useful if each boundary knows which part of the causal
chain it is responsible for. The collector can derive weak action records from
spans, but high-quality causality requires the code that knows the user's or
agent's intent to emit the action context.

| Who instruments                  | Responsibility                                                                                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser analytics SDK            | Mint `interaction_id` for user-originated events; start a root action for simple human flows; inject `x-obs-interaction`, `x-obs-root-action`, and `x-obs-action` on outbound requests.               |
| Frontend app code                | Add semantic names for important user actions when automatic click names are insufficient, e.g. `checkout.submit`, `agent.prompt.send`.                                                               |
| Agent runtime / agent SDK        | Mint `root_action_id` for each agent run; mint `action_id` for each step, LLM call, retrieval, tool call, guardrail, eval, and artifact; set `caused_by_action_id` from the currently active action.  |
| LLM provider wrapper             | Attach model, provider, prompt, token, cost, latency, and response metadata to the active action; it SHOULD NOT create a new root unless the LLM call itself starts a new autonomous run.             |
| Tool / function wrapper          | Create a `tool.call` action; record tool name, args hash, result hash, side-effect marker, approval state, and errors; propagate the active action into any HTTP / queue / database work it triggers. |
| Retrieval / memory wrapper       | Create `retrieval` or `memory.read` actions; record retriever, query hash, document IDs, source IDs, scores, and redacted snippets when payload capture is enabled.                                   |
| Backend telemetry SDK            | Read inbound action headers; stamp `obs.action.*` attributes onto the root span; ensure child spans, logs, AI calls, and profiles inherit the active action context.                                  |
| Queue / workflow instrumentation | Persist `root_action_id` and current `action_id` in job metadata; restore them when the job runs; create a child action for the resumed step.                                                         |
| MCP client / server wrappers     | Propagate trace and action context through MCP `params._meta`; map `tools/call`, `resources/read`, and `prompts/get` to action kinds.                                                                 |
| Collector                        | Normalize native, OTel GenAI / MCP, and OpenInference spans into action rows; derive fallback action IDs from `(trace_id, span_id)` only when explicit action IDs are absent.                         |

Rule of thumb:

- The **caller** mints the action when it knows intent.
- The **callee** stamps and propagates the action when it receives context.
- The **collector** repairs missing structure only as a fallback; derived IDs
  are useful for navigation but are not as trustworthy as explicit
  instrumentation.

Example:

```
Browser click
  Browser SDK mints interaction_id + root action
  -> frontend sends prompt to agent API
     Backend SDK stamps action context on request span
     Agent SDK starts agent_run action
       LLM wrapper records llm.call action
       Tool wrapper records tool.call action
         fetch("/invoices") propagates active action headers
           Backend SDK on invoice service stamps span/logs
       Eval wrapper records eval action
```

### Product model

obs-unified becomes a causal action graph.

```
Human path
──────────
user click
  -> browser usage event
  -> fetch / XHR
  -> backend root span
  -> child spans / logs / AI calls
  -> replay chunk
  -> profile

Agent path
──────────
user prompt / webhook / cron / queue
  -> agent run
  -> plan step
  -> LLM call
  -> retrieval / memory read
  -> tool call
  -> side effect
  -> guardrail / eval
  -> backend spans / logs / profiles
```

The important move is that both paths share a graph vocabulary:

- an **actor** caused an action;
- an action may have a parent action;
- an action emits spans, logs, AI calls, tool calls, artifacts, evals, and side
  effects;
- every detail page can ask the Connected rail for neighboring entities.

### Identity model

Keep `interaction_id` stable. It remains the click-scoped browser -> server key
defined in RFC 0004 and the wire spec.

Add a more general action identity layer:

| Field                 | Meaning                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root_action_id`      | Top-level causal unit: user request, agent task, cron run, webhook                                                                                                   |
| `action_id`           | One human or agent action inside the root                                                                                                                            |
| `caused_by_action_id` | Direct causal parent action                                                                                                                                          |
| `actor_type`          | `human`, `agent`, `service`, `workflow`, `system`                                                                                                                    |
| `actor_id`            | User ID, agent ID, service ID, workflow ID, or system actor ID                                                                                                       |
| `agent_run_id`        | One execution of an agent                                                                                                                                            |
| `agent_id`            | Stable agent identifier                                                                                                                                              |
| `agent_name`          | Human-readable agent name                                                                                                                                            |
| `agent_version`       | Version of agent configuration / code / strategy                                                                                                                     |
| `task_id`             | Optional durable task / workflow ID                                                                                                                                  |
| `step_id`             | Denormalized pointer: when set, this action belongs to that step's subtree (parallels `agent_run_id`). Step-to-step parentage is expressed by `caused_by_action_id`. |
| `tool_call_id`        | One tool invocation                                                                                                                                                  |
| `conversation_id`     | Multi-turn conversation or thread                                                                                                                                    |
| `prompt_id`           | Prompt template identifier                                                                                                                                           |
| `prompt_version`      | Prompt template version                                                                                                                                              |
| `memory_id`           | Memory record identifier                                                                                                                                             |
| `retrieval_id`        | Retrieval operation identifier                                                                                                                                       |
| `artifact_id`         | Output artifact identifier                                                                                                                                           |
| `eval_id`             | Evaluation / grader result identifier                                                                                                                                |
| `policy_id`           | Guardrail or policy identifier                                                                                                                                       |

Mapping:

- Browser click: the new SDK emits `interaction_id`, `action_id`, and
  `root_action_id` as separate fields. They MAY share a value for simple
  click-only flows; whether they do is opaque to consumers, which always read
  the explicit fields.
- Agent run: `root_action_id` is the run's causal root; each step, model call,
  retrieval, tool call, and eval has its own `action_id`. For the run's root
  action row, `action_id == root_action_id == agent_run_id`.
- Hybrid flow: a user click can cause an agent run. The agent run's root action
  carries a `caused_by_action_id` pointing at the click's `action_id`. The agent
  run keeps its own `root_action_id`; the click is its parent, not its root.

### Storage

Add a compact action table and per-entity indices rather than stuffing
everything into spans.

```sql
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  root_action_id TEXT NOT NULL,
  caused_by_action_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action_kind TEXT NOT NULL,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_ms INTEGER,
  trace_id TEXT,
  span_id TEXT,
  session_id TEXT,
  interaction_id TEXT,
  user_id TEXT,
  agent_run_id TEXT,
  step_id TEXT,
  tool_call_id TEXT,
  prompt_version TEXT,
  model_name TEXT,
  provider TEXT,
  total_cost_usd REAL,
  attrs_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_actions_project_root
  ON actions (project_id, root_action_id, started_at);

CREATE INDEX IF NOT EXISTS idx_actions_project_actor
  ON actions (project_id, actor_type, actor_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_actions_project_trace
  ON actions (project_id, trace_id);

CREATE INDEX IF NOT EXISTS idx_actions_project_interaction
  ON actions (project_id, interaction_id);

CREATE INDEX IF NOT EXISTS idx_actions_project_agent_run
  ON actions (project_id, agent_run_id, started_at);
```

Add narrower detail tables only where they reduce query pain:

- `agent_runs` — durable run summary, goal, outcome, autonomy level, aggregate
  cost / latency / eval status. **Invariant:** `agent_runs.id == actions.id` for
  the run's root action row; the detail table holds run-level aggregates while
  the action row carries graph identity.
- `tool_calls` — tool name, args hash, result hash, error type, side-effect
  marker, approval state.
- `retrieval_events` — retriever name, query hash, document refs, scores, source
  IDs.
- `eval_results` — evaluator name, score, pass/fail, rubric/version.
- `artifacts` — generated files, messages, patches, emails, tickets, DB
  mutations, or other outputs.

The existing `ai_span_payloads` table (migration 019) keeps its role as the AI
input/output store and gains an `action_id` column referencing `actions.id`. AI
payload storage is therefore not duplicated: `actions` holds graph identity and
aggregate metadata; `ai_span_payloads` holds the prompt / completion bytes. New
ingest paths populate both.

The `actions` table remains the graph spine. Detail tables are append-only
leaves.

### Attribute conventions

For spans, emit both standard and obs-unified attributes where useful.

Preferred standard attributes:

- OTel GenAI: `gen_ai.operation.name`, `gen_ai.provider.name`,
  `gen_ai.request.model`, `gen_ai.agent.id`, `gen_ai.agent.name`,
  `gen_ai.agent.version`, tool execution attributes, token usage, and
  cost-related metadata when present.
- OTel MCP: `mcp.method.name`, `mcp.protocol.version`, `jsonrpc.request.id`,
  `mcp.resource.uri`, `gen_ai.tool.name`, `gen_ai.prompt.name`.
- OpenInference: `openinference.span.kind` and related flattened prompt / tool /
  document attributes.

obs-unified-specific attributes:

- `obs.action.id`
- `obs.action.root_id`
- `obs.action.caused_by_id`
- `obs.actor.type`
- `obs.actor.id`
- `obs.agent.run_id`
- `obs.agent.step_id`
- `obs.agent.autonomy_level`
- `obs.tool.call_id`
- `obs.tool.side_effect`
- `obs.eval.id`
- `obs.policy.id`

These attributes are stable even if upstream GenAI semantic conventions move
during their development phase.

### Ingest paths

Support three paths:

1. **Native SDK path.** `@obs-unified/telemetry-sdk/agent` emits actions and
   spans with obs-unified attributes from day one.
2. **OTLP GenAI / MCP path.** The collector reads standard OTel GenAI and MCP
   spans, derives actions, and writes them into the action graph.
3. **OpenInference path.** The collector maps OpenInference span kinds into
   action kinds.

Mapping examples:

| Incoming shape                              | Action kind                 |
| ------------------------------------------- | --------------------------- |
| OTel `gen_ai.operation.name = invoke_agent` | `agent.step` or `agent.run` |
| OTel `gen_ai.operation.name = execute_tool` | `tool.call`                 |
| OTel MCP `mcp.method.name = tools/call`     | `tool.call`                 |
| OpenInference `AGENT`                       | `agent.run` or `agent.step` |
| OpenInference `LLM`                         | `llm.call`                  |
| OpenInference `TOOL`                        | `tool.call`                 |
| OpenInference `RETRIEVER`                   | `retrieval`                 |
| OpenInference `GUARDRAIL`                   | `guardrail`                 |
| OpenInference `EVALUATOR`                   | `eval`                      |
| OpenInference `PROMPT`                      | `prompt.render`             |

When incoming spans lack action IDs, the collector derives deterministic action
IDs from `(project_id, trace_id, span_id)`. Native SDKs SHOULD emit explicit IDs
to preserve causality across queues, MCP, and tool boundaries where span
parentage is not enough.

### SDK API

Add an agent-oriented SDK surface:

```ts
import {
  startAgentRun,
  withAction,
  recordToolCall,
  recordRetrieval,
  recordEvaluation,
} from "@obs-unified/telemetry-sdk/agent";

const run = startAgentRun({
  agentName: "support-triage",
  agentVersion: "2026-05-18",
  goal: "Resolve customer billing issue",
  userId,
  sessionId,
  autonomyLevel: "human_approved_write",
});

await run.step("classify intent", async (step) => {
  await step.llm({
    provider: "openai",
    model: "gpt-4.1",
    promptId: "support-classifier",
    promptVersion: "v3",
  });
});

await run.tool("lookup_invoice", async (tool) => {
  return await recordToolCall(tool, async () => {
    return await db.invoices.findMany({ where: { userId } });
  });
});

await run.evaluate("groundedness", {
  score: 0.92,
  passed: true,
  evaluatorVersion: "v1",
});
```

Minimum SDK requirements:

- create a root agent run;
- create nested action / step spans;
- stamp `obs.action.*` attributes on active spans;
- preserve context across promises, queues, and explicit callbacks;
- record tool calls with argument / result hashes and optional redacted
  payloads;
- record retrieval events with document IDs, source IDs, and scores;
- record eval / guardrail results;
- flush action records alongside spans, logs, and AI calls.

Framework wrappers are follow-up packages or subpath entries:

- OpenAI Agents SDK;
- LangChain / LangGraph;
- Vercel AI SDK;
- MCP client and server wrappers;
- LlamaIndex / Mastra / AutoGen as demand appears.

### MCP support

MCP needs special handling because one transport connection can carry multiple
JSON-RPC messages, and HTTP trace context does not identify each logical tool
call.

The SDK SHOULD:

- inject `traceparent`, `tracestate`, and `baggage` into MCP `params._meta` for
  requests and notifications;
- inject `obs.action.id` and `obs.action.root_id` into the same `_meta` bag
  where allowed;
- extract those values on MCP server spans;
- map `tools/call`, `resources/read`, `prompts/get`, and related MCP methods
  into action kinds.

If an MCP server is not obs-unified-aware but emits OTel MCP spans, the
collector still maps the span into an action using trace / span identity.

### Dashboard

Add agent-native surfaces while keeping Connected rail as the main navigation
pattern.

#### Agent run replay

A timeline for one `agent_run_id`:

- goal / trigger;
- autonomy level;
- plan / steps;
- LLM calls;
- retrievals;
- tool calls;
- guardrails;
- evals;
- artifacts / side effects;
- linked traces, logs, replays, profiles, and users.

This is a semantic replay, not rrweb. It answers "what did the agent think and
do?"

#### Decision graph

Render branches, retries, fallbacks, and recursive sub-agent calls by walking
`caused_by_action_id` edges within a `root_action_id`.

#### Tool reliability

Dashboard by tool name:

- call count;
- p50 / p95 latency;
- error rate;
- timeout rate;
- retry count;
- malformed argument count;
- autonomous side-effect count;
- top causing agents and workflows.

#### Cost attribution

Break down token and external tool cost by:

- agent;
- run;
- model;
- provider;
- prompt version;
- tool;
- user / tenant;
- workflow.

#### Prompt / agent version diff

Compare prompt versions, model versions, and agent versions by:

- success rate;
- eval score;
- latency;
- cost;
- tool error rate;
- user-visible failure rate;
- downstream service errors.

#### Production-to-eval

From any agent run, LLM call, tool call, or failed trace:

- save as eval case;
- include prompt, redacted inputs, retrieved docs, tool outputs, expected
  outcome, and linked spans;
- store source production entity IDs for replay and auditing.

This becomes the bridge between observability and improvement.

### Connected rail integration

Every detail surface gets agent neighbors:

- Span -> causing action, agent run, tool call, prompt version, evals.
- Log -> action / step active when the log was emitted.
- AI call -> agent run, prompt render, tool calls before / after, evals.
- Replay -> user click, agent run caused by that click, backend traces.
- Profile -> action / agent run whose trace was sampled.
- Alert -> exemplary agent run, affected prompt / tool / agent version.
- Eval -> production traces and replays that generated the case.

Rail sections remain:

- **Up** — root action, actor, user, session, agent run.
- **Across** — peer steps, traces, logs, tool calls, evals.
- **Down** — child actions, tool calls, artifacts, profiles.
- **Related** — prompt versions, cohorts, similar failed runs.

Informative empty states are required:

- "No agent context: this request was not caused by an agent run."
- "No tool calls: this agent step completed without external tools."
- "No evals: this run has not been evaluated."

The Connected rail server endpoint is unchanged in shape:
`/internal/connected/:kind/:id` continues to be the single route. New kinds
`action`, `agent_run`, `tool_call` (and follow-up `retrieval`, `eval`,
`artifact`) are added to the existing `:kind` parameter alongside the current
`span`, `log`, `ai_call`, `replay`, `profile`, and `interaction` values — no new
endpoints.

## Privacy and governance

Agent telemetry can contain prompts, customer data, tool arguments, retrieved
documents, and generated artifacts. This RFC requires privacy controls from the
first implementation:

- payload capture is opt-in;
- argument / result hashes are captured by default;
- redaction processor runs before storage;
- per-project controls decide whether prompts, completions, retrieved chunks,
  and tool outputs are stored;
- sensitive tool outputs can be represented by metadata only;
- side-effecting tool calls carry an approval / autonomy level.

Autonomy levels:

| Value                  | Meaning                                              |
| ---------------------- | ---------------------------------------------------- |
| `read_only`            | Agent only read data or generated text               |
| `suggested_action`     | Agent proposed an action; no write occurred          |
| `human_approved_write` | Human approved a side effect                         |
| `autonomous_write`     | Agent performed a side effect without human approval |
| `blocked_by_policy`    | Policy / guardrail prevented action                  |

The tool-level marker and the action-level autonomy level compose: a tool call
row in `tool_calls` carries `side_effect = true` when the tool mutated external
state, and the parent action's `attrs_json` carries `autonomy_level`. The pair
`(side_effect = true, autonomy_level = autonomous_write)` is the trigger
condition for the autonomous-write review surface — dashboards filter on this
combination rather than on either field alone.

## Phasing

### Phase 1 — Action graph spine

- Add action graph schema. Migrations start at 031 (current head is 030); new
  tables: `actions`, `agent_runs`, `tool_calls`, `retrieval_events`,
  `eval_results`, `artifacts`. `ai_span_payloads` gets an `action_id` column
  added in the same batch.
- Extend `IdentityIndex` with `byAction`, `byAgentRun`, and `byActor` alongside
  the existing `bySession` / `byTrace` / `byInteraction` / `byUser` methods —
  same interface shape, no new index class.
- Project existing browser-originated rows into the action graph by deriving
  `action_id = root_action_id = interaction_id`. No row migration; the
  projection is a read-time view so legacy dashboards and queries that key off
  `interaction_id` keep working.
- Add `/internal/actions/:id` and `/internal/agent-runs/:id`.
- Extend `/internal/connected/:kind/:id` with new `:kind` values (`action`,
  `agent_run`, `tool_call`) so Connected rail shows action context for spans and
  AI calls without a new endpoint.

### Phase 2 — Native SDK

- Add `@obs-unified/telemetry-sdk/agent`.
- Implement `startAgentRun`, `run.step`, `run.tool`, `recordRetrieval`,
  `recordEvaluation`, and action context propagation.
- Add docs and examples for manual instrumentation.

### Phase 3 — Standards ingest

- Normalize OTel GenAI spans into actions.
- Normalize OTel MCP spans into actions.
- Normalize OpenInference span kinds into actions.
- Add conformance fixtures for common traces.

Implementation pattern: each normalizer is a collector processor in the same
shape as `ai-span-payloads-processor.ts` — it reads OTLP spans from the existing
`/v1/traces` pipeline and writes derived rows into `actions` (and detail
tables). No new ingest endpoint; no new transport. Processors compose, so OTel
GenAI, MCP, and OpenInference can run in parallel on the same span stream.

### Phase 4 — Dashboard surfaces

- Agent run replay.
- Decision graph.
- Tool reliability dashboard.
- Cost attribution.
- Prompt / agent version diff.

### Phase 5 — Production-to-eval

- Add eval case storage.
- Add "save as eval case" from run / span / AI call / tool call.
- Add eval result ingest and comparison views.

### Phase 6 — Framework wrappers

- OpenAI Agents SDK wrapper.
- LangGraph wrapper.
- Vercel AI SDK wrapper.
- MCP client / server helpers.

## Acceptance criteria

1. A synthetic agent run with two LLM calls, one retrieval, two tool calls, one
   guardrail, one eval, and one backend trace renders as a single connected
   action graph.
2. From the backend trace detail page, the Connected rail links back to the
   causing agent run and the specific tool call that triggered the request.
3. From the agent run page, a user can reach every related span, log, AI call,
   retrieval, tool call, eval, artifact, and profile in at most two clicks.
4. OTel GenAI spans with `gen_ai.operation.name` values for agent invoke, model
   call, and tool execution ingest without native obs-unified SDK code and
   produce action graph records.
5. MCP `tools/call` spans ingest and show as tool calls, preserving trace
   context when `_meta.traceparent` is present.
6. OpenInference `AGENT`, `LLM`, `TOOL`, `RETRIEVER`, `GUARDRAIL`, `EVALUATOR`,
   and `PROMPT` spans map into the expected action kinds.
7. Payload capture can be disabled while hashes, metadata, cost, latency, and
   relationships still render.
8. Tool reliability dashboard reports call count, latency, error rate, timeout
   rate, retry count, and side-effect count by tool name.
9. Production-to-eval can save a failed agent run as an eval case with links
   back to the source production entities.
10. Existing click-to-CPU tests still pass; `interaction_id` behavior is
    unchanged for current browser SDK users.
11. Existing `ai_span_payloads` records remain queryable through their current
    surfaces and, for new ingest, also resolve to an `action_id` for joins
    against the action graph.

## Non-goals

- **Replace Langfuse / Phoenix / Braintrust completely in the first pass.** The
  first goal is causal observability inside obs-unified's graph, not a full
  experiment-management suite.
- **Invent a competing trace standard.** We ingest OTel GenAI / MCP and
  OpenInference, then normalize internally for product UX.
- **Store all prompts and completions by default.** Metadata-first, payloads
  opt-in.
- **Build a workflow engine.** Agent runs are observed, not orchestrated.
- **Guarantee deterministic replay.** Agent run replay is semantic
  reconstruction from recorded telemetry, not re-execution.
- **Solve offline evaluation in full.** Production-to-eval creates the dataset
  bridge; large-scale eval runners can come later.
- **Ship a prompt registry, prompt playground, or experimentation tooling.**
  Users coming from Langfuse, LangSmith, or Braintrust will expect these. They
  are downstream of observability and out of scope here. The action graph
  already carries `prompt_id` and `prompt_version` as first-class dimensions, so
  a follow-up RFC can layer a registry on without schema change.

## Risks and open questions

- **Upstream semantic conventions are moving.** OTel GenAI and MCP are still
  development status. Mitigation: keep `obs.action.*` as stable internal
  attributes and treat standards as ingest adapters.
- **Schema sprawl.** Agents can emit huge, nested state. Mitigation: `actions`
  is the spine; detail tables are narrow; arbitrary state goes into `attrs_json`
  only when explicitly useful.
- **Privacy risk.** Tool arguments and retrieved docs can be sensitive.
  Mitigation: hashes and metadata by default, payload opt-in, redaction before
  storage.
- **High cardinality.** `prompt_version`, `agent_version`, `tool_name`, and
  `model_name` are useful dimensions; raw prompt text and tool args are not. The
  collector should reject or redact high-cardinality attributes from indexed
  columns.
- **Derived IDs for non-native ingest.** Mapping `(trace_id, span_id)` to
  `action_id` is serviceable but loses cross-queue causality. Native SDKs should
  emit explicit action IDs; docs must be clear about the quality difference.
- **Human vs agent causality.** A user prompt may trigger a multi-agent workflow
  hours later. We need retention and UI language that make delayed causality
  understandable.
- **Eval case format.** Do eval cases live in `@obs-unified/collector` or a new
  package? Start in collector; split only if users need an external runner.

## Positioning change

This RFC also changes the recommended product language:

From:

> Self-hosted observability for your project. Traces, logs, usage analytics,
> session replay, profiles, and AI call tracking.

To:

> Open observability for every production action, human or agent. Follow a
> click, prompt, agent decision, tool call, trace, replay, cost, policy, and CPU
> profile in one connected graph.

The wedge is not "another LLM observability dashboard." The wedge is that
obs-unified already connects application telemetry, replay, AI calls, profiles,
and identity propagation. Agent observability becomes the next layer of the same
graph.

The closest _philosophical_ match in the market is Datadog LLM Observability and
New Relic AI Monitoring — both layer agent telemetry inside an existing APM
trace model rather than running a separate stack. The differentiator:
obs-unified also unifies session replay, profiles, and browser identity in the
same graph, so a single `caused_by_action_id` walk gets from a click to a tool
call to a CPU flame graph without crossing product boundaries.

Stand-alone agent-observability stacks (Langfuse, Arize Phoenix, LangSmith,
Braintrust, W&B Weave) remain stronger on prompt management, dataset curation,
and experiment ergonomics — see the non-goal above. obs-unified competes on
unification, not on prompt tooling.

## Why this belongs after RFC 0009

RFC 0003 through RFC 0009 make the system technically unified for human
application interactions. RFC 0010 makes the same architecture relevant to the
next class of production actors: AI agents.

The dependency order matters:

- RFC 0004 gives us causality across browser and server.
- RFC 0006 gives us the navigation surface.
- RFC 0008 gives us the storage seam and `IdentityIndex`.
- RFC 0007 / RFC 0009 give us depth down to profiles and kernel-derived signals.

With those in place, agent observability is not a new stack. It is more entity
kinds and correlation keys in the same graph.
