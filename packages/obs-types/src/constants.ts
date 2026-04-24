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

/** Custom attribute keys used by @obs/telemetry-sdk to carry large payloads
 * on a span. The collector strips these off the span and routes them to
 * the ai_span_payloads side table — they never hit telemetry_spans. */
export const AI_PAYLOAD_INPUT_KEY = "ai.payload.input";
export const AI_PAYLOAD_OUTPUT_KEY = "ai.payload.output";

/** OpenInference session / user grouping keys. Stamped by
 * `setAISessionContext()` in the SDK; denormalized into ai_span_payloads
 * for cheap grouping on the query side. */
export const SESSION_ID_KEY = "session.id";
export const USER_ID_KEY = "user.id";

export const OpenInferenceSpanKind = {
	LLM: "LLM",
	CHAIN: "CHAIN",
	RETRIEVER: "RETRIEVER",
	EMBEDDING: "EMBEDDING",
	TOOL: "TOOL",
	AGENT: "AGENT",
	RERANKER: "RERANKER",
	GUARDRAIL: "GUARDRAIL",
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
