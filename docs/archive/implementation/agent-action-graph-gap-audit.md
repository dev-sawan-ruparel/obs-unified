# Gap audit — RFC 0010 agent action graph

This document audits the implementation status of [RFC 0010](../../rfcs/0010-agent-action-graph.md) against the actual codebase. As of 2026-06-01, all major P1 and P2 gaps previously flagged have been fully resolved and verified.

---

## Resolved Gaps (Reconciliation Pass 2026-06-01)

The following gaps were successfully closed and verified in the codebase:

### P1 — Cost / Latency Rollup
* **Audit Finding:** The SDK's `startAgentRun` and collector previously stored uncalculated cost (`0.0`) and non-aggregate run durations instead of child LLM/tool rollup metrics.
* **Resolution:** Fully resolved via read-time / query-time dynamically computed cost and latency rollups inside `manifestByAction` and `manifestByAgentRun` (located in [action-lookups.ts](../../packages/obs-collector/src/lib/identity-index/action-lookups.ts)). Child AI cost and step durations are dynamically summed, guaranteeing 100% correct, real-time cost attribution in all dashboard views.

### P1 — Conformance Tests & Phase 0 Fixtures
* **Audit Finding:** Phase 0 JSON fixtures (`wrong-invoice-update.json`, `browser-only-flow.json`) were previously dead fixtures unreferenced by tests.
* **Resolution:** Conformance tests inside [gen-ai-normalizer.test.ts](../../packages/obs-collector/src/plugins/gen-ai-normalizer.test.ts) now import and assert against these Phase 0 fixtures. In addition, Playwright E2E integration tests in [dashboards.spec.ts](../../apps/web/tests/dashboards.spec.ts) load-test the complete "wrong-invoice" journey directly using the `wrong-invoice-update.json` fixture.

### P2 — Profiles & Guardrails in timeline
* **Audit Finding:** Runtime profiles were entirely absent from the timeline, and guardrails were only represented as simple badges.
* **Resolution:** Fully implemented in [AgentRunDashboard.tsx](../../packages/dashboard/src/dashboards/AgentRunDashboard.tsx). The component fetches active runtime profiles via `/profiles?trace_id=...` and renders a clean, dedicated "Profiles & Guardrails" section that lists matching profiles and links to `#/profiles/:id` as well as guardrail actions and evaluations.

### P2 — Operational Views & Wire-up
* **Audit Finding:** Discrepancy between `/internal/agent-runs/:id` and `/connected/agent_run/:id` in `AgentRunDashboard.tsx`.
* **Resolution:** Dashboard UI routes are fully aligned and integrated. All four operational dashboards in [packages/dashboard/src/dashboards](../../packages/dashboard/src/dashboards) (Tool Reliability, Cost Attribution, Autonomous Review, and Agent Version Diff) are fully integrated with live backend aggregates from [action-routes.ts](../../packages/obs-collector/src/plugins/action-routes.ts).

### P2 — MCP Context Propagation
* **Audit Finding:** MCP helpers lacked flat action context keys, `tracestate`, `baggage`, and notification support.
* **Resolution:** The MCP client-side and server-side utilities in [mcp.ts](../../packages/telemetry-sdk/src/mcp.ts) successfully inject and extract W3C `traceparent` headers, flat action context keys (`obs.action.id`, `obs.action.root_id`), and cleanly propagate `tracestate` and `baggage` across boundaries, backed by thorough unit tests in [mcp.test.ts](../../packages/telemetry-sdk/src/mcp.test.ts).

### P1 — Action ID Spec Alignment
* **Audit Finding:** Browser-triggered `startAgentRun` calls inherited the browser root action instead of minting a new agent run root; agent child spans could lose `interaction_id`; native LLM spans emitted `llm` instead of canonical `llm.call`; MCP extraction and collector ingress trusted malformed explicit action IDs.
* **Resolution:** Fully resolved in [agent.ts](../../packages/telemetry-sdk/src/agent.ts), [span.ts](../../packages/telemetry-sdk/src/span.ts), [mcp.ts](../../packages/telemetry-sdk/src/mcp.ts), and [gen-ai-normalizer.ts](../../packages/obs-collector/src/plugins/gen-ai-normalizer.ts). Browser-triggered agents now create a fresh `root_action_id`, point `caused_by_action_id` at the triggering browser action, and carry `interaction_id` through child spans and serialized context. SDK LLM spans emit `llm.call`. MCP extraction validates action IDs before restoration, and collector fallback normalization replaces malformed explicit IDs with deterministic fallback IDs.

---

## Active Status & Roadmap

All core visual, operational, and data propagation requirements outlined in RFC 0010 are complete. Stale framework integration tasks (such as wrappers for OpenAI Agents SDK, LangGraph, and Vercel AI SDK) remain unchecked as pending items for Phase 8.
