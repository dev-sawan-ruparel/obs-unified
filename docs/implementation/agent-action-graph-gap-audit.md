# Gap audit — RFC 0010 agent action graph

Validation of the `[x]` items in
[agent-action-graph.md](./agent-action-graph.md) against the actual code, as of
2026-05-31. Each finding below is an item marked **done** in the implementation
doc whose code does **not** fully match the claim. Items not listed here were
verified as genuinely complete.

Method: every claim was checked against source and tests; the relevant suites
were run (~88 tests, all passing). "Passing tests" does not mean "claim met" —
in several cases the tests assert a narrower behavior than the checklist text.

Severity legend: **P1** = false-positive that affects correctness or a stated
guarantee; **P2** = real divergence from the contract; **P3** = wording /
cosmetic.

---

## P1 — claimed done, materially missing

### 3.2 — Aggregate cost / latency rollup does not exist

**Claim:** "Implement `startAgentRun`, including … aggregate cost / latency
rollup."

**Reality:** No code sums child LLM/tool costs or latencies into the run.

- `startAgentRun` never accumulates anything
  ([agent.ts:302](../../packages/telemetry-sdk/src/agent.ts#L302)).
- The collector stores `totalCostUsd: totalCostUsd ?? 0.0` (read from the run
  span's *own* single attribute, which nothing sets) and
  `totalDurationMs: span.durationMs` (the run span's own duration, not a sum)
  ([action-graph-processor.ts:315](../../packages/obs-collector/src/plugins/action-graph-processor.ts#L315)).
- The only `SUM(total_cost_usd)` in the repo is the unrelated global hourly
  cost-spike analysis over `ai_calls`
  ([analyses/derive.ts:513](../../packages/obs-collector/src/analyses/derive.ts#L513)).
- No test asserts any rollup value — consistent with the feature not existing.

**Impact:** A run's stored cost is effectively `0` and its duration is not an
aggregate. This is also a hard prerequisite for **6.2 cost attribution**, which
will silently render zeros until this is fixed.

### 4.5 — Conformance tests do not use the Phase 0 fixtures

**Claim:** "Add conformance tests for all three normalizers using the fixtures
from Phase 0."

**Reality:** A normalizer test exists
([gen-ai-normalizer.test.ts](../../packages/obs-collector/src/plugins/gen-ai-normalizer.test.ts))
covering GenAI-LLM and MCP TOOL/RETRIEVER/PROMPT, but:

- It does **not** reference the Phase 0 fixtures. `tests/fixtures/actions/*.json`
  (`browser-only-flow`, `click-triggered-agent-run`,
  `cron-triggered-agent-run`, `wrong-invoice-update`) are unreferenced anywhere
  in the codebase.
- No OpenInference-specific assertions: the EMBEDDING, RERANKER, GUARDRAIL,
  EVALUATOR, AGENT, and CHAIN kinds are never tested.
- There is no `ai-span-payloads-processor` test at all (so 4.4's stamping path
  is unverified by tests).

**Impact:** The fixtures built specifically to be the conformance contract
(Phase 0 exit criteria) are dead. "Conformance for all three normalizers" is not
true.

---

## P2 — real divergence from the contract

### 1.8 — Status is right, rationale is wrong (privacy guarantee at risk)

**Claim:** Item is correctly left **unchecked**, with stated posture "default to
metadata + hashes only; payload bytes captured only when project config opts in."

**Reality:** The code does the opposite of the stated default, and the actual
gap is different from what the doc implies:

- Redaction **is** implemented and runs by default — a key-scrubber plus a
  plugin hook, wired into tool args/result, retrieval query/docs, and artifact
  content
  ([action-graph-processor/redaction.ts:29](../../packages/obs-collector/src/plugins/action-graph-processor/redaction.ts#L29),
  consumed at
  [action-graph-processor.ts:363](../../packages/obs-collector/src/plugins/action-graph-processor.ts#L363)).
- The system therefore stores **redacted payloads unconditionally** — not
  "metadata + hashes only."
- The genuinely missing piece is the **per-project capture flag**: there is no
  `project_settings` / `payload_capture` / `capture_mode` column or table and no
  `captureMode` code. Redaction granularity is global only
  (`TELEMETRY_REDACT_FIELDS` env,
  [framework/env.ts:33](../../packages/obs-collector/src/framework/env.ts#L33)).

**Impact:** Anyone relying on the doc's "metadata + hashes only by default"
sentence as a privacy guarantee would be wrong. Fix the doc, and treat
per-project capture opt-in as the real remaining work.

Minor adjacent bug: the retrieval branch computes a `_redactedQuery` and then
discards it (underscore-prefixed, unused) while only `redactedDocs` is persisted
([action-graph-processor.ts:459](../../packages/obs-collector/src/plugins/action-graph-processor.ts#L459))
— the redacted query may have been intended for storage.

### 3.5 — Stores raw args / results, not hashes; symbol name differs

**Claim:** "Implement `run.tool` / `recordToolCall`, recording tool name, args
hash, result hash, error type, side-effect marker, and approval state."

**Reality:**

- Records full **raw** args and results as JSON, not hashes
  ([agent.ts:582](../../packages/telemetry-sdk/src/agent.ts#L582),
  [agent.ts:601](../../packages/telemetry-sdk/src/agent.ts#L601)). This
  contradicts the 0.1 contract ("metadata + hashes only").
- The exported symbol is `tool`; there is no `recordToolCall`.
- Name, error type, side-effect marker, and approval state **are** recorded
  correctly.

### 3.4 — `step.llm` absent; reimplements instead of wrapping AI tracking

**Claim:** "Implement `run.llm` or `step.llm` helper that wraps the existing AI
call tracking instead of duplicating AI payload storage."

**Reality:**

- `run.llm` exists ([agent.ts:474](../../packages/telemetry-sdk/src/agent.ts#L474));
  `step.llm` does not — `AgentStep` only exposes `setAttribute`.
- It does **not** wrap the existing AI tracking. `agent.ts` does not import
  `ai-spans.ts`; it re-implements all `gen_ai.*` / `llm.*` / OpenInference
  attribute setting inline — the duplication the item explicitly said to avoid.
  (It does not double-*store* payloads, so the storage half of the goal holds.)

### 5.1 — View is not backed by `/internal/agent-runs/:id`

**Claim:** "Add an agent run detail route / view in `packages/dashboard`, backed
by `/internal/agent-runs/:id`."

**Reality:** The route/view and the backend endpoint both exist, but they are
disconnected. `AgentRunDashboard` fetches `/connected/agent_run/:id`
([AgentRunDashboard.tsx:31](../../packages/dashboard/src/components/AgentRunDashboard.tsx#L31)),
not `/internal/agent-runs/:id`
([action-routes.ts:24](../../packages/obs-collector/src/plugins/action-routes.ts#L24)).
The latter is effectively dead from the UI's perspective. Functionally the view
works; the documented wiring is inaccurate.

### 5.2 — Profiles entirely absent; guardrails badge-only

**Claim:** "Render the run timeline: trigger, goal, autonomy level, steps, LLM
calls, retrievals, tool calls, guardrails, evals, artifacts, linked traces,
logs, profiles, replay, and users."

**Reality:** ~13 of 15 elements are genuinely rendered. Two gaps:

- **Profiles** are not referenced anywhere in the agent-run surface.
- **Guardrails** surface only as a colored timeline badge for
  `actionKind === "GUARDRAIL"`
  ([AgentRunDashboard.tsx:453](../../packages/dashboard/src/components/AgentRunDashboard.tsx#L453))
  — there is no dedicated guardrail section.

This matters more than a normal checklist miss because cross-signal linking
(traces/logs/replay/**profiles**) is the feature's main differentiator (see the
usefulness note).

### 8.4 — MCP helpers missing tracestate, baggage, flat keys, notifications

**Claim:** Client injects `traceparent`, `tracestate`, `baggage`,
`obs.action.id`, `obs.action.root_id` into `params._meta` on requests **and
notifications**; server extracts all of these.

**Reality** (all in
[mcp.ts](../../packages/telemetry-sdk/src/mcp.ts)):

- `traceparent` and action context: **done**, but action context is written
  under a **nested** shape `_meta.obs.{root_action_id, action_id}`
  ([mcp.ts:30](../../packages/telemetry-sdk/src/mcp.ts#L30)), not the flat
  `obs.action.id` / `obs.action.root_id` keys specified.
- `tracestate`: **not injected and not extracted** — note the server test
  fixture even includes `tracestate: "obs=high"`
  ([mcp.test.ts:55](../../packages/telemetry-sdk/src/mcp.test.ts#L55)) and it is
  silently dropped.
- `baggage`: **not handled anywhere** in the SDK.
- **Notifications:** no distinct injection path or coverage — one generic
  injector, request-only test.
- Method→action-kind mapping **is** done, but server-side in the collector
  ([gen-ai-normalizer.ts:154](../../packages/obs-collector/src/plugins/gen-ai-normalizer.ts#L154)),
  not in the SDK helper.

---

## P3 — wording / cosmetic

### 1.2 — "and any existing signal tables"

Only `ai_span_payloads` received the nullable `action_id`
([031_agent_action_graph.sql:150](../../packages/obs-collector/src/migrations/031_agent_action_graph.sql#L150)).
No other signal table did. Likely fine by design (legacy join is via
`trace_id` / `session_id`), but the wording overstates scope.

### 3.7 — Duplicate string literals; two declared attrs never emitted

The shared constants module is complete and correct
([constants.ts](../../packages/obs-types/src/constants.ts)). But:

- `agent.ts` hardcodes ~17 alias string literals (e.g.
  `"obs.agent_run.goal"`, `"obs.tool_call.tool_name"`) that already exist in
  `ACTION_ATTRIBUTE_ALIASES` — `agent.ts` never imports it, so the "no
  duplicate string constants" requirement is violated.
- `EVAL_ID_KEY` (`obs.eval.id`) and `POLICY_ID_KEY` (`obs.policy.id`) are
  declared but **never emitted** by any producer.

### 4.3 / 4.6 — Naming mismatches vs the enum

- 4.3 says EMBEDDING/RERANKER/CHAIN map to a generic `action.step`; the actual
  enum value is `ActionKind.AgentStep = "agent.step"`
  ([constants.ts:106](../../packages/obs-types/src/constants.ts#L106)). All ten
  kinds are handled; the name in the doc is wrong.
- 4.6 quality-level prose labels the fallback grade `"derived"`
  ([action-id.md:132](../spec/action-id.md#L132)) while the stamped attribute
  value is `"fallback"`
  ([constants.ts:116](../../packages/obs-types/src/constants.ts#L116)).

---

## Suggested checklist corrections

In [agent-action-graph.md](./agent-action-graph.md):

- **Un-check 3.2** (rollup) and **4.5** (fixture conformance) — not done.
- **Re-word 3.4, 3.5, 5.1, 5.2, 8.4** to "partial," with the specific gap noted,
  or split each into a done sub-item and a remaining sub-item.
- **Fix the 1.8 rationale**: redaction is implemented and on by default; the open
  work is the per-project capture flag, not redaction itself.
- **Fix wording** in 1.2, 3.7, 4.3, 4.6 per P3 above.

## Genuinely complete (verified, no caveats)

1.1, 1.3, 1.4, **1.5** (read-time legacy projection — real and tested), 1.6,
1.7, all of **Phase 2** (real `AsyncLocalStorage` propagation, 46 tests), 3.3,
3.6, 3.8, 4.1, 4.2, 4.4, **5.3** (decision graph genuinely walks
`caused_by_action_id` edges), 5.4, 5.5, **5.6** (wrong-invoice Playwright
journey with ~25 real assertions).
