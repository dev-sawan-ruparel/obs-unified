# EvidenceReference Contract

`EvidenceReference` is the stable agent-facing contract for structured evidence.
Collector responses may include:

- `evidenceReferences`: an array of evidence references.
- `evidenceContract`: the published schema metadata for those references.
- `contract`: a tool response contract when the endpoint maps directly to an
  MCP/HTTP tool surface.

Evidence references are produced by collector logic, schema-aware derivation,
and correlation/index lookups. They do not require an LLM. LLMs may summarize or
rank evidence for narrative features, but the evidence contract remains the
inspectable source of truth.

The canonical exports live in `@obs-unified/types`:

- `EvidenceReference`
- `EvidenceReferenceSchema`
- `EvidenceReferenceJsonSchema`
- `EvidenceReferenceContract`
- `ToolResponseContract`

Current schema versions:

- Evidence reference: `obs-unified.evidence-reference.v1`
- Tool response contract: `obs-unified.tool-response-contract.v1`

## EvidenceReference

Required fields:

- `evidenceId`: stable id for this evidence item.
- `entityKind`: one of the published entity kinds.
- `entityId`: stable id for the referenced entity.
- `route`: dashboard route for human inspection.
- `source`: response field or derivation that produced the evidence.
- `confidence`: number from `0` to `1`.
- `reason`: human-readable explanation.
- `citations`: supporting entities.
- `suggestedNextPivots`: follow-up entities/routes.

Agents should trust explicit action IDs more than fallback-derived IDs, cite the
`source` field when summarizing, and use `suggestedNextPivots` before inventing
new lookups.

## ToolResponseContract

MCP tool outputs include a `contract` object:

```json
{
  "schemaVersion": "obs-unified.tool-response-contract.v1",
  "transport": "mcp",
  "tool": "get_eval",
  "params": { "evaluationId": "eval_123" },
  "returns": "{ data: { evaluation: AIEvaluationRecord, timestamp: string }, dashboardUrl?: string }",
  "evidenceReferenceSchemaVersion": "obs-unified.evidence-reference.v1"
}
```

HTTP endpoints with direct tool parity use the same shape with
`transport: "http"`.
