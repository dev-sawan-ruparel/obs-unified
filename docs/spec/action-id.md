# `action_id` Graph Wire Spec

Status: implemented  
Owner: obs-unified core  
Depends on: [`docs/spec/interaction-id.md`](interaction-id.md)  
Parent RFC: [RFC 0010 — Agent Action Graph](../../rfcs/0010-agent-action-graph.md)

This document is the **single source of truth** for the action graph correlation and identity specification. Any agent, SDK, framework wrapper, MCP host, or collector normalizer that wants to participate in the obs-unified Agent Action Graph MUST adhere to this specification.

---

## TL;DR

```mermaid
graph TD
    subgraph Browser["Browser Interaction (Human Context)"]
        Click["DOM Click Event<br/>interaction_id = click_123<br/>root_action_id = click_123<br/>action_id = click_123"]
    end

    subgraph AgentRun["Agent Workflow (Agent Context)"]
        RunRoot["Agent Run (Root Action)<br/>root_action_id = agent_run_456<br/>action_id = agent_run_456<br/>caused_by_action_id = click_123<br/>interaction_id = click_123"]
        
        Step1["Step 1: Intent Triage<br/>root_action_id = agent_run_456<br/>action_id = step_789<br/>caused_by_action_id = agent_run_456"]
        
        ToolCall["Step 2: Database Write (Tool Call)<br/>root_action_id = agent_run_456<br/>action_id = tool_012<br/>caused_by_action_id = step_789<br/>obs.tool.side_effect = true"]
    end

    Click -->|causes (x-obs-root-action / x-obs-action)| RunRoot
    RunRoot -->|parent| Step1
    Step1 -->|parent| ToolCall
```

---

## Core Fields

To trace complex workflows—including multi-step agent runs, asynchronous tasks, cron schedules, and webhooks—the simple client-scoped `interaction_id` is extended into a causal action graph using three correlation keys:

| Field | Meaning | OTel Span Attribute | HTTP Header |
| :--- | :--- | :--- | :--- |
| **`root_action_id`** | Top-level causal unit: the entire agent task, a user browser session transaction, cron schedule invocation, or queue job. | `obs.action.root_id` | `x-obs-root-action` |
| **`action_id`** | Unique identifier for the specific step, LLM call, retrieval operation, tool call, evaluation, or user interaction. | `obs.action.id` | `x-obs-action` |
| **`caused_by_action_id`** | Direct parent `action_id` that triggered this current action (provides the causal edge in the graph). | `obs.action.caused_by_id` | *(Context propagation only)* |

---

## Relationship to `interaction_id`

`interaction_id` (defined in [`docs/spec/interaction-id.md`](interaction-id.md)) remains the stable browser-to-server correlation key. The action graph keys generalize identity to non-browser workloads.

### 1. When They Coalesce (Human-only Flow)
For simple browser-originated interactions (e.g., a click that fires a request to `/api/get-profile`), all three IDs share the same Crockford base32 value. This keeps simple click-to-span telemetry perfectly aligned:
* `interaction_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4`
* `root_action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4`
* `action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4`
* `caused_by_action_id` = `null`

### 2. When They Diverge (Agent / Asynchronous Flow)
When a browser interaction triggers an autonomous agent execution, the keys branch to preserve causality:
1. **User Action (Browser)**:
   * `interaction_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH`
   * `root_action_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH`
   * `action_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH`
2. **Agent Run (Root Action)**:
   * `interaction_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH` *(Carried along to maintain the correlation back to the triggering user)*
   * `root_action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4` *(A newly minted ID representing the agent run)*
   * `action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4` *(For the root action of the run, action_id matches root_action_id)*
   * `caused_by_action_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH` *(Pointed directly back to the click)*
3. **Step 1 of Agent (Child Action)**:
   * `interaction_id` = `01HZQ5W3K8M4P2X7N9B0CDEFGH`
   * `root_action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4`
   * `action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3K5`
   * `caused_by_action_id` = `01J3Y4Z5A6B7C8D9E0F1G2H3J4` *(Pointed to the agent run root)*

### Null Semantics for Non-Browser Roots
For runs triggered by background crons, webhooks, or messaging queues, **`interaction_id` is `null`**. Dashboard components, query builders, and Connected Rail providers MUST support a null value for `interaction_id`. Tracing and correlation in these contexts rely purely on `root_action_id`, `action_id`, and `caused_by_action_id`.

### Legacy Projection Rule
To ensure backward compatibility with telemetry recorded prior to Phase 1, obs-unified projects legacy rows into the action graph at read-time:
> [!NOTE]
> If a record contains only an `interaction_id` (and lacks explicit action graph fields), consumers and storage projection layers MUST treat the fields as:  
> `action_id = root_action_id = interaction_id`  
> This allows legacy click-to-trace UI features to remain functional through the schema transition.

---

## Protocol & Transport

### HTTP Headers
SDKs and client wrappers MUST inject these headers on all outgoing HTTP boundaries:

- **`x-obs-interaction`**: The browser-originated interaction ID (carry-forward).
- **`x-obs-root-action`**: The active `root_action_id`.
- **`x-obs-action`**: The currently active `action_id`.

All header values are Crockford base32 strings, unquoted, and case-insensitive (though lowercase is preferred for outbound formatting).

### ID Format
To facilitate fast range scans and timeline queries, all explicit action IDs MUST be sortable, Crockford base32 strings of exactly 26 characters (ULID or KSUID structure):
- **Alphabet**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (no `I`, `L`, `O`, `U` to prevent reading confusion).
- **Layout**: 10 characters representing a millisecond Unix timestamp + 16 characters of cryptographic randomness.
- **Regex Validation**: `^[0-9A-HJKMNP-TV-Z]{26}$`

---

## Action-Specific Semantics

### Side-Effect Semantics
Mutating external state (e.g., database writes, emails, Slack alerts, transactional API calls) is a high-gravity event in an agent's execution graph.

1. **`obs.tool.side_effect`**: When a tool is capable of modifying external state, its OTel wrapping span or SDK record MUST set the boolean attribute:
   ```json
   "obs.tool.side_effect": true
   ```
2. **Approval States**: Actions representing tool invocations or plan execution states carry an approval marker in the `approval_state` column. SDKs MUST support the following discrete states:
   * `suggested`: The agent proposed the side-effect, but it has not been executed (requires approval).
   * `human_approved`: A human reviewed and explicitly approved the mutation before execution.
   * `bypassed`: The write bypassed approval rules (e.g., automated execution under strict thresholds).
   * `blocked`: A human or security policy explicitly rejected and halted the action.

These markers compose: a dashboard or compliance query filters on `(side_effect = true, autonomy_level = autonomous_write)` to target unapproved writes.

### Privacy Guidance
Agent telemetry commonly handles raw prompts, tool arguments, retrieved context chunks, and user data. To ensure enterprise compliance:
- **Default Posture (Metadata-Only)**: Collect only telemetry metadata, latency, cost parameters, and cryptographic hashes of inputs/outputs (e.g., `args_hash`, `result_hash`).
- **Opt-in Payload Capture**: Raw strings (prompts, completions, document snippets, arguments) MUST ONLY be captured and written to the database if the project's payload capture configuration is explicitly enabled.
- **Redaction Processors**: Before writing to `ai_span_payloads`, a sanitization layer must run locally or in the collector to scrub sensitive matching patterns (PII, API keys).

### Confidence Levels
Not all action graph links are equal. Dashboards and replays MUST visually distinguish between the two confidence grades:
1. **High Confidence (`explicit`)**: Native SDK or framework-wrapped calls where `action_id` and `root_action_id` were explicitly minted, passed across headers, and logged.
2. **Fallback Confidence (`fallback`)**: Derived by the collector from generic OpenTelemetry GenAI or OpenInference spans. When explicit action attributes are absent or malformed, the collector calculates a deterministic fallback ID:
   ```ts
   action_id = sha256(project_id + trace_id + span_id).toCrockfordBase32().substring(0, 26)
   ```
   Derived records are helpful for graph navigation but carry an attribute `obs.action.confidence = "fallback"`.

SDKs and collector normalizers MUST validate explicit action IDs against the RFC
0010 regex before restoring or persisting them as trusted identity. Malformed
explicit IDs are rejected at SDK boundaries and treated as absent by collector
fallback normalization.

---

## Code & Data Examples

### 1. Browser-Only Click
No agent is active. Telemetry is simple and flat.

**HTTP Headers**:
```http
x-obs-interaction: 01HZQ5W3K8M4P2X7N9B0CDEFGH
x-obs-root-action: 01HZQ5W3K8M4P2X7N9B0CDEFGH
x-obs-action: 01HZQ5W3K8M4P2X7N9B0CDEFGH
```

**Span Attributes**:
```json
{
  "obs.interaction.id": "01HZQ5W3K8M4P2X7N9B0CDEFGH",
  "obs.action.root_id": "01HZQ5W3K8M4P2X7N9B0CDEFGH",
  "obs.action.id": "01HZQ5W3K8M4P2X7N9B0CDEFGH"
}
```

---

### 2. Click-Triggered Agent Run
A user clicks "Process Billing", spawning a multi-step agent flow.

**Initial Client Request (Click)**:
```http
x-obs-interaction: 01HZQ5W3K8M4P2X7N9B0CDEFGH
x-obs-root-action: 01HZQ5W3K8M4P2X7N9B0CDEFGH
x-obs-action: 01HZQ5W3K8M4P2X7N9B0CDEFGH
```

**Agent Root Invocation (Minting new `root_action_id`)**:
```json
{
  "obs.interaction.id": "01HZQ5W3K8M4P2X7N9B0CDEFGH",
  "obs.action.root_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
  "obs.action.id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
  "obs.action.caused_by_id": "01HZQ5W3K8M4P2X7N9B0CDEFGH",
  "obs.actor.type": "agent",
  "obs.actor.id": "billing_resolver_v2",
  "obs.agent.run_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4"
}
```

**Agent Step 1 (Tool Call)**:
```json
{
  "obs.interaction.id": "01HZQ5W3K8M4P2X7N9B0CDEFGH",
  "obs.action.root_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
  "obs.action.id": "01J3Y4Z5A6B7C8D9E0F1G2H3K5",
  "obs.action.caused_by_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
  "obs.tool.call_id": "tool_invoice_lookup",
  "obs.tool.side_effect": false
}
```

---

### 3. Cron-Triggered Agent Run
Autonomous hourly triage. No browser. `x-obs-interaction` is absent.

**Cron Root Invocation**:
```json
{
  "obs.interaction.id": null,
  "obs.action.root_id": "01K4X5Y6B7C8D9E0F1G2H3J4K6",
  "obs.action.id": "01K4X5Y6B7C8D9E0F1G2H3J4K6",
  "obs.actor.type": "system",
  "obs.actor.id": "cron_triage_hourly",
  "obs.agent.run_id": "01K4X5Y6B7C8D9E0F1G2H3J4K6"
}
```

---

### 4. MCP Context Propagation via `params._meta`
Model Context Protocol (MCP) clients call tools over persistent JSON-RPC pipes. Traditional HTTP headers are not present on a per-tool-call basis. Clients and hosts MUST propagate context inside the JSON-RPC `params._meta` block:

**MCP Request (`tools/call`)**:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "update_invoice_status",
    "arguments": {
      "invoice_id": "INV-2026-9912",
      "status": "paid"
    },
    "_meta": {
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "tracestate": "obs=high",
      "baggage": "obs.interaction.id=01HZQ5W3K8M4P2X7N9B0CDEFGH",
      "obs": {
        "root_action_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
        "action_id": "01J3Y4Z5A6B7C8D9E0F1G2H3K5"
      }
    }
  },
  "id": 42
}
```
The MCP server extracts these values, mounts them to its local trace/span context, and ensures child database or downstream calls retain the exact graph causality keys.

---

## Collector Normalizers (Ingress)

To bring third-party and ecosystem telemetry into the canonical Agent Action Graph, the obs-collector automatically normalizes raw spans during ingest using the `gen-ai-normalizer` plugin.

### 1. OpenTelemetry GenAI Normalization
Spans carrying standard `gen_ai.*` attributes (e.g., from vendor auto-instrumentation like Vercel AI SDK or OpenAI SDK) are mapped as follows:
* **OpenInference Kind Conversion**: Maps `gen_ai.operation.name` (like chat, completion, embed, or tool) to `openinference.span.kind`.
* **Token Usage**: Denormalizes prompt/completion token count attributes to standard `llm.token_count.*`.
* **Action Graph Schema**:
  * If explicit action attributes are absent, derives `obs.action.id`, `obs.action.root_id`, and `obs.action.caused_by_id` using the deterministic fallback hashing algorithm. Sets `obs.action.confidence = "fallback"`.
  * If parent span context exists, maps `obs.action.caused_by_id` to the derived action ID of the parent span.

### 2. Model Context Protocol (MCP) Normalization
Spans containing `mcp.method.name` or starting with `mcp.*` attributes represent Model Context Protocol JSON-RPC operations and are normalized accordingly:
* **`tools/call`**:
  * Set `openinference.span.kind = "TOOL"` and `obs.action.kind = "tool.call"`.
  * Map `mcp.tool.name` to `obs.tool.name`.
  * Map `mcp.tool.arguments` to `obs.tool.args` (and serialize as string).
  * Auto-detect `obs.tool.side_effect` based on write/mutate naming patterns or explicit side-effect markers.
* **`resources/read`**:
  * Set `openinference.span.kind = "RETRIEVER"` and `obs.action.kind = "retrieval"`.
* **`prompts/get`**:
  * Set `openinference.span.kind = "PROMPT"` and `obs.action.kind = "agent.step"`.

### 3. OpenInference Span Kind Normalization
Incoming spans containing `openinference.span.kind` are enriched with action graph schema fields:
* **Span Kinds Mapping**:
  * `AGENT` -> `ActionKind.AgentStep` (`agent.step`)
  * `LLM` -> `ActionKind.LlmCall` (`llm.call`)
  * `TOOL` -> `ActionKind.ToolCall` (`tool.call`)
  * `RETRIEVER` -> `ActionKind.Retrieval` (`retrieval`)
  * `EVALUATOR` -> `ActionKind.Eval` (`eval`)
  * `EMBEDDING`, `RERANKER`, `GUARDRAIL`, `PROMPT`, `CHAIN` -> `ActionKind.AgentStep` (`agent.step`)
* **Context Fallback**: Enables complete decision graph traversal for native AI ecosystems without manual SDK wrapping.
