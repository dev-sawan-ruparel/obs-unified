export const RETENTION_HOURS = 72;
export const DEFAULT_WINDOW_HOURS = 72;
export const MAX_RETENTION_HOURS = 720; // 30 days max
export const MAX_TRACE_ROWS = 100;
export const MAX_DURATION_SAMPLE_SIZE = 500;
export const MAX_ISSUE_ROWS = 50;
export const MAX_ISSUE_TRACE_ROWS = 20;

export const getConfiguredRetentionHours = (envValue?: string): number => {
	if (!envValue) return RETENTION_HOURS;
	const parsed = Number.parseInt(envValue, 10);
	if (Number.isNaN(parsed) || parsed < 1) return RETENTION_HOURS;
	return Math.min(parsed, MAX_RETENTION_HOURS);
};

// ── OpenInference span conventions ──
// Subset of https://github.com/Arize-ai/openinference/blob/main/spec/
// used to model AI calls as typed spans inside the trace tree.

export const OPENINFERENCE_SPAN_KIND_KEY = "openinference.span.kind";

/** Custom attribute keys used by @obs-unified/telemetry-sdk to carry large payloads
 * on a span. The collector strips these off the span and routes them to
 * the ai_span_payloads side table — they never hit telemetry_spans. */
export const AI_PAYLOAD_INPUT_KEY = "ai.payload.input";
export const AI_PAYLOAD_OUTPUT_KEY = "ai.payload.output";

/** OpenInference session / user grouping keys. Stamped by
 * `setAISessionContext()` in the SDK; denormalized into ai_span_payloads
 * for cheap grouping on the query side. */
export const SESSION_ID_KEY = "session.id";
export const USER_ID_KEY = "user.id";

/** RFC 0004 — click-scoped correlation id. Stamped by @obs-unified/telemetry-sdk's
 * `stampInteractionFromRequest()` (and exported as INTERACTION_ATTRIBUTE_KEY
 * from that package). Denormalized into telemetry_spans.interaction_id at
 * ingest by the default span enrichment plugin. */
export const INTERACTION_ID_KEY = "obs.interaction.id";

// ── RFC 0010 — Agent action graph conventions ─────────────────────────────
// Canonical attribute keys from docs/spec/action-id.md. Older Phase 1 code
// emitted a few pre-spec aliases; collectors should accept those during the
// migration, while SDKs should emit the canonical keys below.

export const ACTION_ID_KEY = "obs.action.id";
export const ACTION_ROOT_ID_KEY = "obs.action.root_id";
export const ACTION_CAUSED_BY_ID_KEY = "obs.action.caused_by_id";
export const ACTION_KIND_KEY = "obs.action.kind";
export const ACTION_NAME_KEY = "obs.action.name";
export const ACTION_CONFIDENCE_KEY = "obs.action.confidence";
export const ACTION_PROMPT_VERSION_KEY = "obs.action.prompt_version";
export const ACTION_MODEL_NAME_KEY = "obs.action.model_name";
export const ACTION_PROVIDER_KEY = "obs.action.provider";
export const ACTION_TOTAL_COST_USD_KEY = "obs.action.total_cost_usd";

export const ACTOR_TYPE_KEY = "obs.actor.type";
export const ACTOR_ID_KEY = "obs.actor.id";

export const AGENT_RUN_ID_KEY = "obs.agent.run_id";
export const AGENT_ID_KEY = "obs.agent.id";
export const AGENT_NAME_KEY = "obs.agent.name";
export const AGENT_VERSION_KEY = "obs.agent.version";
export const AGENT_GOAL_KEY = "obs.agent.goal";
export const AGENT_OUTCOME_KEY = "obs.agent.outcome";
export const AGENT_STEP_ID_KEY = "obs.agent.step_id";
export const AGENT_AUTONOMY_LEVEL_KEY = "obs.agent.autonomy_level";

export const TOOL_CALL_ID_KEY = "obs.tool.call_id";
export const TOOL_NAME_KEY = "obs.tool.name";
export const TOOL_ARGS_KEY = "obs.tool.args";
export const TOOL_RESULT_KEY = "obs.tool.result";
export const TOOL_ERROR_TYPE_KEY = "obs.tool.error_type";
export const TOOL_SIDE_EFFECT_KEY = "obs.tool.side_effect";
export const TOOL_APPROVAL_STATE_KEY = "obs.tool.approval_state";

export const RETRIEVAL_NAME_KEY = "obs.retrieval.retriever_name";
export const RETRIEVAL_QUERY_KEY = "obs.retrieval.query";
export const RETRIEVAL_DOCUMENTS_KEY = "obs.retrieval.documents";
export const RETRIEVAL_TOTAL_RESULTS_KEY = "obs.retrieval.total_results";
export const RETRIEVAL_MAX_RELEVANCE_SCORE_KEY =
	"obs.retrieval.max_relevance_score";

export const EVAL_ID_KEY = "obs.eval.id";
export const EVAL_EVALUATOR_NAME_KEY = "obs.eval.evaluator_name";
export const EVAL_EVALUATOR_VERSION_KEY = "obs.eval.evaluator_version";
export const EVAL_SCORE_KEY = "obs.eval.score";
export const EVAL_PASSED_KEY = "obs.eval.passed";
export const EVAL_REASONING_KEY = "obs.eval.reasoning";
export const EVAL_RUBRIC_KEY = "obs.eval.rubric";
export const POLICY_ID_KEY = "obs.policy.id";

export const ARTIFACT_NAME_KEY = "obs.artifact.name";
export const ARTIFACT_TYPE_KEY = "obs.artifact.type";
export const ARTIFACT_CONTENT_KEY = "obs.artifact.content";
export const ARTIFACT_STORAGE_REF_KEY = "obs.artifact.storage_ref";
export const ARTIFACT_SIZE_BYTES_KEY = "obs.artifact.size_bytes";
export const ARTIFACT_SHA256_HASH_KEY = "obs.artifact.sha256_hash";

export const ACTION_ROOT_HEADER_NAME = "x-obs-root-action";
export const ACTION_HEADER_NAME = "x-obs-action";

export const ACTION_ID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const ActionKind = {
	AgentRun: "agent.run",
	AgentStep: "agent.step",
	LlmCall: "llm.call",
	ToolCall: "tool.call",
	Retrieval: "retrieval",
	Eval: "eval",
	Artifact: "artifact",
} as const;

export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export const ActionConfidence = {
	Explicit: "explicit",
	Fallback: "fallback",
} as const;

export type ActionConfidence =
	(typeof ActionConfidence)[keyof typeof ActionConfidence];

export const ToolApprovalState = {
	Suggested: "suggested",
	HumanApproved: "human_approved",
	Bypassed: "bypassed",
	Blocked: "blocked",
} as const;

export type ToolApprovalState =
	(typeof ToolApprovalState)[keyof typeof ToolApprovalState];

export const AgentAutonomyLevel = {
	ReadOnly: "read_only",
	SuggestedAction: "suggested_action",
	HumanApprovedWrite: "human_approved_write",
	AutonomousWrite: "autonomous_write",
	BlockedByPolicy: "blocked_by_policy",
} as const;

export type AgentAutonomyLevel =
	(typeof AgentAutonomyLevel)[keyof typeof AgentAutonomyLevel];

export const ACTION_ATTRIBUTE_ALIASES = {
	[ACTOR_TYPE_KEY]: ["obs.action.actor_type"],
	[ACTOR_ID_KEY]: ["obs.action.actor_id"],
	[AGENT_RUN_ID_KEY]: ["obs.action.agent_run_id", "obs.agent_run.id"],
	[AGENT_STEP_ID_KEY]: ["obs.action.step_id"],
	[TOOL_CALL_ID_KEY]: ["obs.action.tool_call_id"],
	[AGENT_ID_KEY]: ["obs.agent_run.agent_id"],
	[AGENT_NAME_KEY]: ["obs.agent_run.agent_name"],
	[AGENT_VERSION_KEY]: ["obs.agent_run.agent_version"],
	[AGENT_GOAL_KEY]: ["obs.agent_run.goal"],
	[AGENT_OUTCOME_KEY]: ["obs.agent_run.outcome"],
	[AGENT_AUTONOMY_LEVEL_KEY]: ["obs.agent_run.autonomy_level"],
	[TOOL_NAME_KEY]: ["obs.tool_call.tool_name"],
	[TOOL_ARGS_KEY]: ["obs.tool_call.args"],
	[TOOL_RESULT_KEY]: ["obs.tool_call.result"],
	[TOOL_ERROR_TYPE_KEY]: ["obs.tool_call.error_type"],
	[TOOL_SIDE_EFFECT_KEY]: ["obs.tool_call.side_effect"],
	[TOOL_APPROVAL_STATE_KEY]: ["obs.tool_call.approval_state"],
} as const;

export const OpenInferenceSpanKind = {
	LLM: "LLM",
	CHAIN: "CHAIN",
	RETRIEVER: "RETRIEVER",
	EMBEDDING: "EMBEDDING",
	TOOL: "TOOL",
	AGENT: "AGENT",
	RERANKER: "RERANKER",
	GUARDRAIL: "GUARDRAIL",
	EVALUATOR: "EVALUATOR",
	PROMPT: "PROMPT",
} as const;

export type OpenInferenceSpanKind =
	(typeof OpenInferenceSpanKind)[keyof typeof OpenInferenceSpanKind];

const OPENINFERENCE_SPAN_KIND_VALUES: ReadonlySet<string> = new Set(
	Object.values(OpenInferenceSpanKind),
);

export const isOpenInferenceSpanKind = (
	value: unknown,
): value is OpenInferenceSpanKind =>
	typeof value === "string" && OPENINFERENCE_SPAN_KIND_VALUES.has(value);
