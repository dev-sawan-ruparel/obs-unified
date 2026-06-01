# Implementation sequencing — RFC 0010 agent action graph

This document tracks implementation of
[RFC 0010](../../rfcs/0010-agent-action-graph.md). It is intentionally more
concrete than the RFC: each item should be a small, reviewable unit that can
land independently. Check items off only after they merge to `main`.

The implementation principle is **same data, new shape**. Do not build a
parallel observability stack. Add action identity over the signals obs-unified
already collects, then expose those relationships through the existing Connected
rail and dashboard surfaces.

### Mapping to RFC 0010 phases

This doc has nine phases (0–8); the RFC has six. They map as follows:

| Impl phase               | RFC phase                        |
| ------------------------ | -------------------------------- |
| 0 Contracts and fixtures | (new — no RFC counterpart)       |
| 1 Action graph spine     | RFC 1 Action graph spine         |
| 2 Context propagation    | RFC 2 Native SDK (split)         |
| 3 Native agent SDK       | RFC 2 Native SDK (split)         |
| 4 Standards normalizers  | RFC 3 Standards ingest           |
| 5 Agent run replay UI    | RFC 4 Dashboard surfaces (split) |
| 6 Operational views      | RFC 4 Dashboard surfaces (split) |
| 7 Production-to-eval     | RFC 5 Production-to-eval         |
| 8 Framework wrappers     | RFC 6 Framework wrappers         |

Impl phase numbers are the source of truth inside this document.

---

## Phase 0 — Clarify contracts and fixtures

Lock the shape before writing migrations. This phase is documentation and
test-fixture work.

- [x] **0.1** Add `docs/spec/action-id.md` covering `root_action_id`,
      `action_id`, `caused_by_action_id`, and how the fields relate to
      `interaction_id`. Must pin: propagation header names (`x-obs-root-action`,
      `x-obs-action`); ID format and the sortability requirement (recommend ULID
      or KSUID so timeline queries can range on `id`); null semantics for
      non-browser-originated roots; the read-time projection rule
      (`action_id = root_action_id = interaction_id` for legacy rows); and the
      rule for when `obs.tool.side_effect = true`. Phase 2.2 blocks on these
      decisions.
- [x] **0.2** Add three JSON fixtures under `tests/fixtures/actions/`: a
      browser-only flow, a click-triggered agent run, and a cron-triggered agent
      run with no `interaction_id`.
- [x] **0.3** Add a synthetic "wrong invoice update" fixture matching RFC 0010's
      end-user story: prompt, classification, retrieval, tool call, backend
      trace, side effect, eval, final answer.
- [x] **0.4** Add a markdown worked example at `docs/ux/agent-run-replay.md`
      showing the screens and Connected rail jumps for the wrong-invoice flow.

**Exit criteria:** reviewers can understand the user journey without reading
schema code; fixture IDs show exactly how parent / child action edges work.

---

## Phase 1 — Action graph spine

Add the graph spine without changing the existing ingest behavior.

- [ ] **1.1** Migration `031_action_graph.sql`: create `actions`, `agent_runs`,
      `tool_calls`, `retrieval_events`, `eval_results`, and `artifacts`.
- [ ] **1.2** Migration `031_action_graph.sql`: add nullable `action_id` to
      `ai_span_payloads` and any existing signal tables that need direct joins
      in Phase 1.
- [ ] **1.3** Add `ActionStore` in
      `packages/obs-collector/src/lib/actions-store.ts`, using the existing
      `SqlDb` interface.
- [ ] **1.4** Extend `IdentityIndex` with `byAction`, `byAgentRun`, and
      `byActor`; preserve existing `bySession`, `byTrace`, `byInteraction`, and
      `byUser` methods.
- [ ] **1.5** Add read-time projection for legacy browser-originated rows:
      `action_id = root_action_id = interaction_id` when no action row exists.
- [ ] **1.6** Add internal routes: `GET /internal/actions/:id` and
      `GET /internal/agent-runs/:id`.
- [ ] **1.7** Extend `/internal/connected/:kind/:id` with `action`, `agent_run`,
      and `tool_call` kinds. Do not introduce a separate connected endpoint.
- [ ] **1.8** Add redaction processor and per-project payload-capture flags per
      RFC 0010 Privacy and governance. Default to metadata + hashes only;
      payload bytes captured only when project config opts in. Must land before
      Phase 4 — otherwise OTel GenAI / MCP / OpenInference normalizers will
      write unredacted prompts and tool arguments into `ai_span_payloads`.

**Exit criteria:** the fixture action graph can be inserted and queried;
existing `interaction_id` timeline / Connected rail paths still work; payload
capture is off by default and toggling it on is the only path to storing raw
prompts.

---

## Phase 2 — Context propagation

Make action identity flow through existing app boundaries.

- [x] **2.1** Browser analytics SDK emits explicit `root_action_id` and
      `action_id` for user-originated events alongside existing
      `interaction_id`.
- [x] **2.2** Browser analytics SDK injects `x-obs-root-action` and
      `x-obs-action` on patched `fetch` / XHR requests, in addition to
      `x-obs-interaction`.
- [x] **2.3** Telemetry SDK reads inbound action headers and stamps
      `obs.action.root_id`, `obs.action.id`, and `obs.action.caused_by_id` onto
      the root span.
- [x] **2.4** Logger, AI call tracking, and profile helpers inherit the active
      action context from the active span / async context.
- [ ] **2.5** Add queue / workflow helpers to serialize and restore action
      context in job metadata.

**Exit criteria:** click -> fetch -> backend span -> log -> AI call all share
explicit action fields, while old `interaction_id` behavior is unchanged.

---

## Phase 3 — Native agent SDK

Give application authors a small manual API before framework wrappers.

- [x] **3.1** Add `@obs-unified/telemetry-sdk/agent` subpath.
- [x] **3.2** Implement `startAgentRun`, including `agent_run_id`, root action
      creation, actor fields, goal, autonomy level, and aggregate cost / latency
      rollup.
- [x] **3.3** Implement `run.step(name, fn)` and `withAction(action, fn)` using
      async context to set `caused_by_action_id`.
- [x] **3.4** Implement `run.llm` or `step.llm` helper that wraps the existing
      AI call tracking instead of duplicating AI payload storage.
- [x] **3.5** Implement `run.tool` / `recordToolCall`, recording tool name, args
      hash, result hash, error type, side-effect marker, and approval state.
- [x] **3.6** Implement `recordRetrieval` and `recordEvaluation`.
- [x] **3.7** Define and emit the full obs-unified attribute set per RFC 0010
      Attribute conventions in one shared module: `obs.action.id`,
      `obs.action.root_id`, `obs.action.caused_by_id`, `obs.actor.type`,
      `obs.actor.id`, `obs.agent.run_id`, `obs.agent.step_id`,
      `obs.agent.autonomy_level`, `obs.tool.call_id`, `obs.tool.side_effect`,
      `obs.eval.id`, `obs.policy.id`. SDK emit paths and Phase 4 normalizers
      both consume this module — no duplicate string constants.
- [x] **3.8** Add examples for a manual TypeScript agent and a click-triggered
      agent flow.

**Exit criteria:** the wrong-invoice fixture can be produced by the native SDK
without hand-writing action rows.

---

## Phase 4 — Standards normalizers

Map existing ecosystem traces into the same graph.

- [ ] **4.1** Add OTel GenAI normalizer processor that derives action rows from
      `gen_ai.*` spans in the existing `/v1/traces` pipeline.
- [ ] **4.2** Add OTel MCP normalizer for `mcp.method.name`,
      `jsonrpc.request.id`, and MCP tool / resource / prompt operations.
- [ ] **4.3** Add OpenInference normalizer for all ten span kinds: `AGENT`,
      `LLM`, `TOOL`, `RETRIEVER`, `EMBEDDING`, `RERANKER`, `GUARDRAIL`,
      `EVALUATOR`, `PROMPT`, `CHAIN`. (`EMBEDDING`, `RERANKER`, and `CHAIN` may
      map to a generic `action.step` kind in the first pass; document the
      mapping in `docs/spec/action-id.md`.)
- [ ] **4.4** Update `ai-span-payloads-processor.ts` to stamp `action_id` on
      each payload row from the same span's derived or inherited action context.
      Without this, `ai_span_payloads.action_id` added in 1.2 stays null for new
      ingest.
- [ ] **4.5** Add conformance tests for all three normalizers using the fixtures
      from Phase 0.
- [ ] **4.6** Document quality levels: explicit native action IDs are
      high-confidence; collector-derived `(trace_id, span_id)` action IDs are
      navigation fallback.

**Exit criteria:** an app emitting OTel GenAI or OpenInference spans gets useful
action graph records without installing the native agent SDK.

---

## Phase 5 — Agent run replay UI

Land the first user-visible "aha" surface.

- [ ] **5.1** Add an agent run detail route / view in `packages/dashboard`,
      backed by `/internal/agent-runs/:id`.
- [ ] **5.2** Render the run timeline: trigger, goal, autonomy level, steps, LLM
      calls, retrievals, tool calls, guardrails, evals, artifacts, linked
      traces, logs, profiles, replay, and users.
- [ ] **5.3** Render a decision graph by walking `caused_by_action_id` edges
      within a `root_action_id`.
- [ ] **5.4** Wire Connected rail into agent run, action, and tool-call detail
      surfaces.
- [ ] **5.5** Add empty-state copy for no `interaction_id`, no tools, no evals,
      no backend trace, and no payload capture.
- [ ] **5.6** Add Playwright coverage for the wrong-invoice journey.

**Exit criteria:** a user can open one agent run and understand what happened
without searching separate trace, AI, log, and replay pages.

---

## Phase 6 — Operational views

Add aggregate views after the run-level experience proves the graph.

- [ ] **6.1** Tool reliability dashboard: call count, p50 / p95 latency, error
      rate, timeout rate, retry count, malformed argument count, side-effect
      count, and top causing agents / workflows.
- [ ] **6.2** Cost attribution: agent, run, model, provider, prompt version,
      tool, user / tenant, and workflow.
- [ ] **6.3** Prompt / agent version diff: success rate, eval score, latency,
      cost, tool error rate, user-visible failure rate, downstream service
      errors. Initially populated from production eval results (3.6 + 4.3
      `EVALUATOR`); the comparison-against-eval-cases dimension fills in after
      Phase 7 lands and is allowed to render as empty before then.
- [ ] **6.4** Autonomous-write review surface: rows where `side_effect = true`
      and `autonomy_level = autonomous_write`.

**Exit criteria:** users can move from one bad run to aggregate answers: "is
this a one-off, a bad tool, a bad prompt version, or a bad agent version?"

---

## Phase 7 — Production-to-eval

Close the improvement loop.

- [ ] **7.1** Add eval case storage with links back to source production
      entities.
- [ ] **7.2** Add "save as eval case" from agent run, action, AI call, tool
      call, and failed trace surfaces.
- [ ] **7.3** Include redacted prompt, retrieved document refs, tool outputs /
      hashes, expected outcome, eval rubric, and linked spans.
- [ ] **7.4** Add eval result ingest and comparison views.

**Exit criteria:** the wrong-invoice run can become an eval case and remain
linked to its original production telemetry.

---

## Phase 8 — Framework wrappers

Reduce user instrumentation burden after the manual API is stable.

- [ ] **8.1** OpenAI Agents SDK wrapper.
- [ ] **8.2** LangGraph wrapper.
- [ ] **8.3** Vercel AI SDK wrapper.
- [ ] **8.4** MCP client / server helpers. Client side: inject `traceparent`,
      `tracestate`, `baggage`, `obs.action.id`, and `obs.action.root_id` into
      MCP `params._meta` on outgoing requests and notifications. Server side:
      extract those values on inbound MCP spans, set as parent action, and map
      `tools/call`, `resources/read`, `prompts/get` to the corresponding action
      kinds. Phase 4.2 covers the ingest-only path when neither helper is in
      use; 8.4 closes the cross-process causality gap that ingest cannot.
- [ ] **8.5** Demand-driven follow-ups: LlamaIndex, Mastra, AutoGen.

**Exit criteria:** at least two common agent stacks can emit high-quality action
graphs with minimal manual instrumentation.

---

## Branching strategy

Use a phase branch for the full RFC and small PRs per numbered item:

- Integration branch: `feat/agent-action-graph`.
- Phase branches: `feat/agent-action/phase-1-spine`,
  `feat/agent-action/phase-2-propagation`, etc.
- Merge phase branches to `main` only after their exit criteria pass.

## Notes

- Do not duplicate prompt / completion storage. `ai_span_payloads` remains the
  payload store; action tables hold graph identity and aggregate metadata.
- Do not block standards ingest on native SDK work. OTel GenAI, OpenInference,
  and MCP normalizers should improve data from existing users even when explicit
  action IDs are absent.
- Do not make agent run replay depend on production-to-eval. The first user
  value is understanding the run; saving it as a test case follows.
