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

Introduce an evidence retrieval layer that turns observability data into
investigation-ready context for agent-facing debugging workflows.
obs-unified already stores the raw telemetry firehose and exposes structured
`EvidenceReference` objects with routes, confidence, citations, and suggested
pivots. This RFC adds the missing middle layer between raw telemetry and
agent-facing answers: budgeted evidence bundles that compact redundancy,
correlate adjacent signals, rank likely-relevant records, preserve provenance,
enforce redaction, expose suggested pivots, and provide explicit handles for
retrieving the raw source when an agent needs more detail.

The design is inspired by compress-cache-retrieve systems, but applies that
pattern to observability-specific investigation work:

1. **Shape:** cluster, rank, correlate, and summarize large observability
   payloads into a small agent-readable view.
2. **Cache:** keep the original raw payload or query definition available in
   collector storage.
3. **Retrieve:** let the agent expand the evidence by handle, optionally with a
   query, time range, or entity filter.

For obs-unified, "cache" usually does not mean copying raw data into a new
cache. The collector already stores logs, traces, profiles, replay chunks, AI
payloads, actions, tool calls, evals, and analyses. The retrieval layer records
a stable reference to the raw slice and the query needed to reconstruct it.

The product promise becomes:

> Agents get compact, cited, investigation-ready debugging context first, and
> can retrieve the raw telemetry behind any claim without receiving the whole
> firehose up front.

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

This layer should not try to make final root-cause decisions. Its job is to
prepare the next useful debugging envelope: reduce obvious redundancy, preserve
the records most likely to matter, expose how the reduction happened, and make
the omitted raw data retrievable.

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
| Budgeted evidence response | Endpoints return fixed shapes | No `targetTokens`, `detailLevel`, or intent-aware selection |
| Raw retrieval handle | Entity IDs and dashboard routes | No explicit "this compact slice can be expanded by this retrieval ref" |
| Large log handling | Logs list/detail endpoints | No cluster/exemplar view tied to a raw log window ref |
| Trace summarization | Full trace tree or overview rows | No compact critical-path view with expandable span windows |
| Replay summarization | Replay chunks | No event timeline/exemplar view with retrievable raw chunks |
| Payload provenance | Evidence references cite entities | No metadata about compaction, omitted counts, or reconstruction query |
| Agent-driven expansion | MCP tools fetch entities | No generic `retrieve_evidence` / `search_evidence_ref` flow |

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

### Compaction

A deterministic or heuristic reduction of redundant current evidence. Examples:
collapsing exact duplicate logs, grouping logs by normalized signature,
selecting severity exemplars, computing a trace critical path, or reducing
replay events to the interaction/error window. A compaction must report how many
records were reduced and how to retrieve the omitted raw records.

### Retrieval reference

A stable handle that lets an agent request more raw detail behind an evidence
slice. It may point to a materialized row, a blob, or a signed/replayable query
definition. It should be scoped by project and authorization.

### Evidence bundle

An agent-facing response that contains a compact summary, evidence references,
derived summaries, compaction provenance, retrieval references, suggested
pivots, dashboard links, and contract metadata. This is the "small first answer"
for a debugging request.

## Proposed design

### Incident-local by default

Evidence bundles are incident-local by default. They may include adjacent
current signals through explicit correlation such as trace IDs, span IDs,
session IDs, interaction IDs, action IDs, agent run IDs, tool call IDs, eval
IDs, and Connected rail manifests.

The bundle should not add unrelated context just because it might be useful. If
the caller asks for a trace, the bundle may include directly correlated logs,
actions, AI calls, replay markers, profiles, and evals. It should not introduce
evidence outside the requested anchor's correlated graph unless the request
explicitly includes that wider scope.

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
  compactedFrom?: {
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

export interface EvidenceCompaction {
  compactionId: string;
  kind: "logs" | "spans" | "replay_events" | "profiles" | "ai_calls";
  strategy:
    | "exact_duplicate"
    | "signature_cluster"
    | "severity_exemplar"
    | "critical_path"
    | "time_window"
    | "causal_path";
  inputCount: number;
  outputCount: number;
  reason: string;
  exemplarEntityIds: string[];
  retrievalRefIds: string[];
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
  derivedSummaries: Array<{
    title: string;
    reason: string;
    confidence: number;
    evidenceIds: string[];
    retrievalRefIds?: string[];
  }>;
  findings: Array<{
    title: string;
    reason: string;
    confidence: number;
    evidenceIds: string[];
    retrievalRefIds?: string[];
  }>;
  compactions: EvidenceCompaction[];
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

Search should start with bounded SQL/text matching over the referenced slice.

### MCP tools

Add read-only MCP tools:

| Tool | Purpose |
| --- | --- |
| `get_evidence_bundle` | Return compact evidence for an anchor, intent, and budget. |
| `retrieve_evidence_ref` | Expand a retrieval ref into raw or less-compacted records. |
| `search_evidence_ref` | Search within a retrieval ref without expanding everything. |

The existing entity-specific MCP tools remain useful. The new tools provide a
progressive-disclosure workflow: compact bundle first, raw expansion only when
needed.

### Evidence shaping strategies by signal

This layer should be domain-aware, not generic text compression. The useful
operation is often not summarization; it is selecting the right adjacent signal
and preserving the right exemplar.

| Signal | Shaping behavior | Retrieval behavior |
| --- | --- | --- |
| Logs | cluster repeated messages, select exemplars, preserve severity transitions, attach correlated span/action IDs | full log window, search within window, surrounding lines |
| Trace | compute critical path, identify failed/high-latency spans, summarize fanout | full trace tree or span neighborhood |
| Action graph | extract causal path, risky side effects, approval/eval state | full action subgraph |
| AI calls | expose model/cost/tokens, prompt version, tool choice, eval status | metadata expansion with raw request/response redacted unless a future allow-list permits more |
| Tool calls | expose args/result hashes, side-effect flag, approval state, error metadata | hashes plus redacted args/results and captured audit/mutation metadata |
| Replay | reduce to interaction timeline, console/network errors, and nearby user events | session metadata plus explicit bounded event-window refs |
| Profile | rank hot frames, trace-linked samples, self-time | profile metadata, trace IDs, and explicit bounded frame-summary refs |
| Analyses/evals | rank failed assertions, source links, and evidence references | full analysis/eval payload |

### Compaction provenance

Every lossy reduction must be visible in the response. For example, collapsing
500 repeated logs should produce a compaction record and a retrieval ref:

```json
{
  "compactionId": "cmp_logs_404_products",
  "kind": "logs",
  "strategy": "signature_cluster",
  "inputCount": 500,
  "outputCount": 3,
  "reason": "Collapsed matching 404 logs for GET /api/products/:id in the requested time window.",
  "exemplarEntityIds": ["log_1", "log_29", "log_488"],
  "retrievalRefIds": ["eref_logs_404_products"]
}
```

This makes compaction auditable. The agent can tell the difference between "no
other logs existed" and "497 similar logs were omitted because they matched this
cluster."

### Derived summaries and findings

The bundle should separate current-evidence summaries from stronger findings.

Derived summaries describe shaped evidence:

- "500 matching 404 logs were clustered into 3 exemplars."
- "The critical path spends 82% of its time under `payment.authorize`."
- "The side-effecting tool call was causally downstream of action `act_123`."

Findings are reserved for claims backed by strong current evidence. They should
not use root-cause language unless the evidence is explicit enough to support
it. When the evidence only suggests a next step, the response should prefer a
derived summary plus a suggested pivot.

### Division of labor

The collector is responsible for work that is deterministic, schema-aware, or
policy-sensitive:

- clustering repeated logs;
- selecting exemplars;
- computing trace critical paths;
- correlating trace, span, session, interaction, action, tool, eval, replay, and
  profile IDs;
- ranking failed or high-latency records;
- enforcing capture policy and redaction;
- producing retrieval refs;
- reporting confidence and compaction provenance.

The LLM is responsible for investigation judgment:

- choosing which hypothesis to test;
- deciding when compact context is insufficient;
- retrieving raw evidence through refs;
- comparing evidence across pivots;
- explaining the likely cause;
- recommending fixes without overstating certainty.

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
6. compaction provenance, suggested pivots, and retrieval refs.

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
  ref_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  anchor_kind TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  source TEXT NOT NULL,
  query_json TEXT,
  compacted_from_json TEXT,
  returned_json TEXT,
  issued_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE evidence_ref_expansions (
  id TEXT PRIMARY KEY,
  ref_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT,
  operation TEXT NOT NULL,
  result_status TEXT NOT NULL,
  limit_value INTEGER,
  query_text TEXT,
  expanded_at TEXT NOT NULL
);
```

If refs are deterministic hashes of `(project_id, kind, anchor, source, query)`,
the collector can deduplicate repeat bundle generation.

### Dashboard

The dashboard includes an Evidence tab backed by the same collector APIs as the
MCP tools. It shows:

- issued vs expanded retrieval refs by kind;
- top expanded ref sources;
- recent materialized refs and recent expansions;
- a bundle explorer for `trace`, `action`, `agent_run`, and `tool_call` anchors;
- explicit ref expansion from the dashboard, including replay event windows and
  profile frame summaries.

This keeps the human view aligned with agent behavior and prevents agent-only
mystery state.

## Risks and mitigations

### Risk: summarization hides the root cause

Mitigation: every lossy compaction includes retrieval refs, input/output counts,
exemplars, citations, and dashboard routes. Error logs, failed spans,
side-effecting tool calls, failed evals, and high-confidence evidence references
should be preserved before low-value records are dropped.

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
refs. Only expand full replay/profile payloads when explicitly requested.

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

- Add `EvidenceRetrievalRef`, `EvidenceCompaction`, and `EvidenceBundle` types
  in `@obs-unified/types`.
- Add JSON schemas and tool response contract metadata.
- Add MCP tool stubs that can return a bundle for a trace or action anchor.

### Phase 2: Trace and log bundles

- Implement `get_evidence_bundle` for `trace` anchors.
- Produce critical-path trace summary, failed span summary, correlated log
  exemplars, compaction provenance, and log-window retrieval refs.
- Add `retrieve_evidence_ref` for log windows and full trace expansion.

### Phase 3: Agent Action Graph bundles

- Support `action`, `agent_run`, and `tool_call` anchors.
- Include causal path, side-effect metadata, approval state, eval outcomes, AI
  cost/model metadata, and connected trace/log refs.

### Phase 4: Replay, profile, and AI payload expansion

- Add replay metadata refs and explicit bounded event-window refs with
  `chunkOffset` pagination.
- Add profile metadata refs with trace IDs plus explicit bounded frame-summary
  refs decoded from stored pprof blobs.
- Add AI/tool expansion subject to capture/redaction policy: AI raw
  request/response data stays redacted by default, and tool expansion returns
  hashes plus redacted args/results.

### Phase 5: Product hardening

- Materialize issued retrieval refs in `evidence_retrieval_refs`.
- Record successful `retrieve_evidence_ref` and `search_evidence_ref`
  operations in `evidence_ref_expansions`.
- Expose `/internal/evidence/stats` and the MCP `get_evidence_stats` tool.
- Add the dashboard Evidence tab for bundle loading, ref expansion, and
  issued/expanded ref telemetry.

## Acceptance criteria

- Agents can request a compact evidence bundle for at least one trace anchor
  with a target budget.
- The bundle includes existing `EvidenceReference` objects where applicable.
- The bundle includes at least one retrieval ref for omitted raw logs or trace
  detail.
- The bundle includes compaction provenance when records are omitted or clustered.
- Retrieval refs are project-scoped and authorization-checked.
- MCP tools expose the bundle and retrieval flow with schema metadata.
- MCP and dashboard surfaces expose issued/expanded ref telemetry.
- Dashboard links remain present for human inspection, and the Evidence tab can
  load bundles and expand refs through the implemented collector endpoints.
- Tests cover:
  - bundle generation;
  - retrieval ref authorization/project scoping;
  - redaction/capture policy;
  - compaction provenance for clustered logs;
  - expired or missing refs;
  - oversized retrieval limits;
  - backward compatibility with existing `EvidenceReference` responses.

## Non-goals

- Replacing `EvidenceReference`.
- Replacing Connected rail.
- Building a generic context-compression library.
- Provider-specific prompt-cache optimization.
- Letting retrieval refs grant access without normal collector authorization.

## Open questions

- Should refs be deterministic hashes, random IDs, or both?
- Should `EvidenceRetrievalRef` be embedded inside `EvidenceReference` v2, or
  remain bundle-level?
- What is the smallest useful budget interface: `targetTokens`, `detailLevel`,
  or both?
- How should bundle generation behave when the anchor points to data near
  retention expiry?
- Should the investigation MCP server expose one generic
  `get_evidence_bundle` tool, or several intent-specific tools with narrower
  descriptions?
