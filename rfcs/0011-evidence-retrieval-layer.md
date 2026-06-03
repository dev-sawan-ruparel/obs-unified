# RFC 0011: Evidence retrieval layer

- **Status:** Draft
- **Author:** @sawanruparel
- **Created:** 2026-06-03
- **Updated:** 2026-06-03
- **Parent:** [RFC 0010 — Agent action graph](0010-agent-action-graph.md)
- **Depends on:**
  [RFC 0006 — Connected rail](0006-connected-rail.md),
  [RFC 0008 — Storage interface refactor](0008-storage-interface.md),
  [RFC 0010 — Agent action graph](0010-agent-action-graph.md)
- **Companion:**
  [EvidenceReference contract](../docs/spec/evidence-reference.md),
  [MCP terminology](../docs/mcp.md),
  [Agent Action Graph](../docs/agent-action-graph.md)
- **Target:** `@obs-unified/collector`, `@obsunified/mcp-server`,
  `@obs-unified/types`, `@obs-unified/dashboard`, docs

## Summary

Introduce an evidence retrieval layer for agent-facing debugging workflows.
obs-unified already stores the raw telemetry firehose and exposes structured
`EvidenceReference` objects with routes, confidence, citations, and suggested
pivots. This RFC adds the missing middle layer between those two extremes:
budgeted, compact evidence slices with explicit handles for retrieving the raw
source when an agent needs more detail.

The design is inspired by compress-cache-retrieve systems:

1. **Compress:** summarize or cluster large observability payloads into a small
   agent-readable view.
2. **Cache:** keep the original raw payload or query definition available in
   collector storage.
3. **Retrieve:** let the agent expand the evidence by handle, optionally with a
   query, time range, or entity filter.

For obs-unified, "cache" usually does not mean copying raw data into a new
cache. The collector already stores logs, traces, profiles, replay chunks, AI
payloads, actions, tool calls, evals, and analyses. The retrieval layer records
a stable reference to the raw slice and the query needed to reconstruct it.

The product promise becomes:

> Agents get compact, cited debugging evidence first, and can retrieve the raw
> telemetry behind any claim without receiving the whole firehose up front.

## Motivation

Agentic debugging has a context-management problem. The data an agent needs is
not a single span or log line; it is the linked story around a symptom: trace
shape, relevant logs, user action, replay markers, AI call, tool result,
approval state, eval outcome, and sometimes profile evidence.

Dumping all of that into an LLM context is expensive and often worse than
unhelpful. It makes the agent sort through low-value detail before it has a
hypothesis. But ordinary summarization is risky because it can remove exactly
the one raw line, stack frame, tool result, or replay event that proves the root
cause.

obs-unified is in a better position than a generic context compressor because it
generates and stores structured debugging evidence. It knows trace IDs, span
IDs, action IDs, log IDs, profile IDs, eval IDs, confidence grades, and
Connected rail pivots. The retrieval layer should use that structure to expose
small, inspectable evidence views while preserving a path back to raw data.

## Today

### What exists

obs-unified already has most of the primitives:

- `EvidenceReference` is a stable agent-facing contract with `evidenceId`,
  `entityKind`, `entityId`, `route`, `source`, `confidence`, `reason`,
  `citations`, and `suggestedNextPivots`.
- Analyses, AskBox, alerts, AI evaluations, eval cases, and source-link flows
  emit compatible evidence references.
- The investigation MCP server exposes read-only tools for recent traces,
  trace detail, logs, AI sessions, users, replays, profiles, evals, connected
  signals, agent runs, actions, and tool calls.
- Connected rail can pivot from one anchor to adjacent signals.
- Agent Action Graph records give causal edges across user actions, agent runs,
  LLM calls, retrievals, tool calls, evals, traces, logs, profiles, and replay
  evidence.
- Dashboard routes give humans a way to inspect the same entities agents cite.

### Gaps

| Need | Today | Gap |
| --- | --- | --- |
| Budgeted evidence response | Endpoints return fixed shapes | No `tokenBudget`, `detailLevel`, or intent-aware selection |
| Raw retrieval handle | Entity IDs and dashboard routes | No explicit "this compact slice can be expanded by this retrieval ref" |
| Large log handling | Logs list/detail endpoints | No cluster/exemplar view tied to a raw log window ref |
| Trace summarization | Full trace tree or overview rows | No compact critical-path view with expandable span windows |
| Replay summarization | Replay chunks | No event timeline/exemplar view with retrievable raw chunks |
| Payload provenance | Evidence references cite entities | No metadata about compression, omitted counts, or reconstruction query |
| Agent-driven expansion | MCP tools fetch entities | No generic `retrieve_evidence` / `search_evidence_ref` flow |
| Feedback loop | None | No record that agents frequently expand certain evidence types |

## Definitions

### EvidenceReference

The existing contract that points to a concrete evidence entity and explains why
it matters. This RFC does not replace `EvidenceReference`.

### Evidence slice

A compact, generated view over one or more raw observability records. Examples:

- log clusters and exemplars for a trace/time window;
- trace critical path plus failed span context;
- action subgraph around a risky tool call;
- replay event timeline around an interaction;
- profile hot frames linked to sampled traces;
- AI call cost/eval/tool summary for an agent run.

### Retrieval reference

A stable handle that lets an agent request more raw detail behind an evidence
slice. It may point to a materialized row, a blob, or a signed/replayable query
definition. It should be scoped by project and authorization.

### Evidence bundle

An agent-facing response that contains a compact summary, evidence references,
retrieval references, suggested pivots, dashboard links, and contract metadata.
This is the "small first answer" for a debugging request.

## Proposed design

### Contract additions

Add sibling types beside `EvidenceReference`, not a breaking replacement:

```ts
export interface EvidenceRetrievalRef {
  refId: string;
  kind:
    | "logs"
    | "trace"
    | "span"
    | "replay"
    | "profile"
    | "ai_call"
    | "action"
    | "agent_run"
    | "tool_call"
    | "eval"
    | "analysis";
  projectId?: string;
  anchor: {
    entityKind: EvidenceEntityKind;
    entityId: string;
  };
  source: string;
  query?: Record<string, unknown>;
  compressedFrom?: {
    recordCount?: number;
    tokenEstimate?: number;
    byteEstimate?: number;
  };
  returned?: {
    recordCount?: number;
    tokenEstimate?: number;
    byteEstimate?: number;
  };
  expiresAt?: string;
}

export interface EvidenceBundle {
  schemaVersion: "obs-unified.evidence-bundle.v1";
  intent:
    | "debug_failure"
    | "explain_latency"
    | "explain_cost"
    | "inspect_agent_run"
    | "inspect_tool_call"
    | "find_instrumentation_gap"
    | "general";
  anchor?: {
    entityKind: EvidenceEntityKind;
    entityId: string;
  };
  budget?: {
    targetTokens?: number;
    estimatedTokens?: number;
    detailLevel: "brief" | "standard" | "deep";
  };
  summary: string;
  findings: Array<{
    title: string;
    reason: string;
    confidence: number;
    evidenceIds: string[];
  }>;
  evidenceReferences: EvidenceReference[];
  retrievalRefs: EvidenceRetrievalRef[];
  suggestedNextPivots: EvidenceNextPivot[];
  dashboardUrl?: string;
}
```

Open question: whether `EvidenceRetrievalRef` should be allowed inside
`EvidenceReference.suggestedNextPivots`, or kept only at the bundle level for
schema clarity. The first implementation should prefer bundle-level refs to
avoid changing the v1 evidence reference schema.

### Collector endpoints

Add internal HTTP endpoints with MCP parity:

```text
POST /internal/evidence/bundle
GET  /internal/evidence/refs/:refId
POST /internal/evidence/refs/:refId/search
```

`POST /internal/evidence/bundle` accepts:

```json
{
  "anchor": { "entityKind": "trace", "entityId": "tr_123" },
  "intent": "debug_failure",
  "budget": { "targetTokens": 4000, "detailLevel": "standard" },
  "include": ["trace", "logs", "actions", "ai_calls", "profiles"],
  "hours": 2
}
```

It returns an `EvidenceBundle`.

`GET /internal/evidence/refs/:refId` expands a reference, with optional query
parameters such as `limit`, `offset`, `before`, `after`, `spanId`, or `severity`.

`POST /internal/evidence/refs/:refId/search` searches inside the raw evidence
slice:

```json
{
  "query": "stripe timeout",
  "limit": 20
}
```

Search may start with simple SQL/text matching and later move to BM25 or vector
search where the storage adapter supports it.

### MCP tools

Add read-only MCP tools:

| Tool | Purpose |
| --- | --- |
| `get_evidence_bundle` | Return compact evidence for an anchor, intent, and budget. |
| `retrieve_evidence_ref` | Expand a retrieval ref into raw or less-compressed records. |
| `search_evidence_ref` | Search within a retrieval ref without expanding everything. |

The existing entity-specific MCP tools remain useful. The new tools provide a
progressive-disclosure workflow: compact bundle first, raw expansion only when
needed.

### Compression strategies by signal

This layer should be domain-aware, not generic text compression.

| Signal | Compact view | Retrieval behavior |
| --- | --- | --- |
| Logs | severity counts, clusters, exemplars, error transitions, correlated span/action IDs | full log window, search within window, surrounding lines |
| Trace | critical path, failed spans, high-latency spans, fanout summary | full trace tree or span neighborhood |
| Action graph | shortest causal path, risky side effects, approval/eval status | full action subgraph |
| AI calls | model/cost/tokens, prompt version, tool choice, eval failures | payload expansion if capture policy allows |
| Tool calls | args/result hashes, side-effect and approval metadata, error | full args/result if captured and allowed |
| Replay | event timeline, console/network errors, interaction markers | raw rrweb chunks or event window |
| Profile | top frames, trace-linked samples, self-time | profile blob/frame subtree |
| Analyses/evals | ranked findings, failed assertions, source links | full analysis/eval payload |

### Budgeting

The first version should use approximate token estimates rather than provider
tokenizers. A rough character-based estimator is sufficient for response
planning, especially because the goal is ranking and bounding, not billing.

Selection order for `debug_failure` should be:

1. explicit high-confidence evidence references;
2. failed/error spans and their direct logs;
3. action/tool/eval records causally connected to the failure;
4. AI call metadata and cost if present;
5. replay/profile evidence if directly linked;
6. suggested pivots and retrieval refs.

Other intents can tune the order. For `explain_cost`, AI calls and model/tool
attribution move earlier. For `explain_latency`, critical path and profile
evidence move earlier.

### Storage model

There are two viable storage modes:

1. **Query-backed refs:** store a compact, authorized query definition that can
   reconstruct the slice from existing tables.
2. **Materialized refs:** store a snapshot in a table/blob when the raw slice is
   expensive to reconstruct or time-sensitive.

Initial implementation should use query-backed refs wherever possible.
Materialization should be reserved for:

- replay chunks;
- large profile blobs;
- expensive multi-signal bundles;
- evidence created from data that may expire under retention.

Proposed table:

```sql
CREATE TABLE evidence_retrieval_refs (
  project_id TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  anchor_kind TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  query_json TEXT NOT NULL,
  compressed_from_json TEXT,
  returned_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (project_id, ref_id)
);
```

If refs are deterministic hashes of `(project_id, kind, anchor, source, query)`,
the collector can deduplicate repeat bundle generation.

### Dashboard

The dashboard should surface retrieval refs in places humans already inspect
evidence:

- Investigation pages show "compact view" and "expand raw evidence" affordances.
- Connected rail cards can indicate when a compact slice has hidden raw records.
- Log drawers can open from an evidence ref and preserve the bundle context.
- Action/tool/eval pages can show whether an agent saw compact or expanded
  evidence during a debugging session.

The dashboard is secondary to the MCP contract for this RFC, but keeping the
human view aligned prevents agent-only mystery behavior.

## Risks and mitigations

### Risk: summarization hides the root cause

Mitigation: every compact slice includes retrieval refs, omitted counts where
known, citations, and dashboard routes. Error logs, failed spans, side-effecting
tool calls, failed evals, and high-confidence evidence references should be
preserved before low-value records are dropped.

### Risk: retrieval refs expose sensitive data

Mitigation: refs are project-scoped, require the same read authorization as the
underlying endpoint, and must honor existing payload capture/redaction policy.
Refs should not become bearer tokens. They are identifiers, not permissions.

### Risk: prompt/output payloads leak through expansion

Mitigation: retrieval tools must apply the same `capturePayloads`, redaction,
and allow-list rules as normal AI/tool-call endpoints. If raw payload capture is
disabled, retrieval returns metadata and hashes only.

### Risk: stale refs after retention

Mitigation: refs include `expiresAt` when the backing data is retention-bound.
Retrieval can return a structured "expired" result with the original compact
summary and dashboard route still intact.

### Risk: token budgeting becomes false precision

Mitigation: call the field `estimatedTokens`, document it as approximate, and
use it only for selection. Billing/token accounting should remain provider- or
SDK-derived.

### Risk: bundle generation is expensive

Mitigation: start with anchor-local queries and hard limits. Cache deterministic
refs. Defer cross-signal deep search, vector search, and full replay/profile
expansion until explicitly requested.

### Risk: agents over-retrieve and lose the benefit

Mitigation: MCP tool descriptions should encourage retrieval only when the
compact bundle is insufficient. The server can default retrieval limits and
return search-within-ref suggestions for large slices.

### Risk: schema churn breaks agents

Mitigation: ship `EvidenceBundle` as a sibling contract with its own schema
version. Keep `EvidenceReference v1` stable until a clear need for v2 emerges.

## Privacy and security

The retrieval layer must be treated as another read path over observability
data, not as an escape hatch around access control.

Requirements:

- Enforce project scoping for all refs.
- Require dashboard token, ingest-key read access, or session auth exactly as
  existing internal endpoints do.
- Apply redaction before compacting and before retrieval.
- Avoid storing raw prompts, tool args, replay DOM, or profile blobs in the ref
  table unless retention and capture policy permit it.
- Include audit metadata for MCP retrieval calls where the Agent Action Graph
  context is available.
- Cap response size and record count for retrieval tools.

## Implementation plan

### Phase 1: Types and MCP shape

- Add `EvidenceRetrievalRef` and `EvidenceBundle` types in
  `@obs-unified/types`.
- Add JSON schemas and tool response contract metadata.
- Add MCP tool stubs that can return a bundle for a trace or action anchor.

### Phase 2: Trace and log bundles

- Implement `get_evidence_bundle` for `trace` anchors.
- Produce critical-path trace summary, failed span summary, correlated log
  exemplars, and log-window retrieval refs.
- Add `retrieve_evidence_ref` for log windows and full trace expansion.

### Phase 3: Agent Action Graph bundles

- Support `action`, `agent_run`, and `tool_call` anchors.
- Include causal path, side-effect metadata, approval state, eval outcomes, AI
  cost/model metadata, and connected trace/log refs.

### Phase 4: Replay, profile, and AI payload expansion

- Add replay event-window refs.
- Add profile hot-frame refs.
- Add AI/tool payload expansion subject to capture/redaction policy.

### Phase 5: Retrieval feedback

- Record aggregate retrieval behavior:
  - ref kind;
  - source endpoint/tool;
  - retrieval count;
  - search query class, not raw query if sensitive;
  - whether retrieval happened after a compact bundle.
- Use this feedback to tune future bundle selection.

## Acceptance criteria

- Agents can request a compact evidence bundle for at least one trace anchor
  with a target budget.
- The bundle includes existing `EvidenceReference` objects where applicable.
- The bundle includes at least one retrieval ref for omitted raw logs or trace
  detail.
- Retrieval refs are project-scoped and authorization-checked.
- MCP tools expose the bundle and retrieval flow with schema metadata.
- Dashboard links remain present for human inspection.
- Tests cover:
  - bundle generation;
  - retrieval ref authorization/project scoping;
  - redaction/capture policy;
  - expired or missing refs;
  - oversized retrieval limits;
  - backward compatibility with existing `EvidenceReference` responses.

## Non-goals

- Replacing `EvidenceReference`.
- Replacing Connected rail.
- Building a generic context-compression library.
- Provider-specific prompt-cache optimization.
- Vector search or embeddings in the first implementation.
- Letting retrieval refs grant access without normal collector authorization.

## Open questions

- Should refs be deterministic hashes, random IDs, or both?
- Should `EvidenceRetrievalRef` be embedded inside `EvidenceReference` v2, or
  remain bundle-level?
- What is the smallest useful budget interface: `targetTokens`, `detailLevel`,
  or both?
- Should retrieval feedback be stored as telemetry, action graph audit events,
  or a separate aggregate table?
- How should bundle generation behave when the anchor points to data near
  retention expiry?
- Should the investigation MCP server expose one generic
  `get_evidence_bundle` tool, or several intent-specific tools with narrower
  descriptions?
