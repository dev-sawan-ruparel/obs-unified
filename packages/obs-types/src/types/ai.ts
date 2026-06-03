import type { EvidenceReference } from "./evidence";
import type { JsonValue } from "./primitives";

export type AICallType =
	| "text_completion"
	| "chat"
	| "prompt_to_image"
	| "embedding";

export interface AICallInput {
	traceId?: string;
	spanId?: string;
	serviceName?: string;
	modelName: string;
	provider: string;
	callType: AICallType;
	request?: Record<string, JsonValue>;
	response?: Record<string, JsonValue>;
	promptTokens?: number;
	completionTokens?: number;
	totalCostUsd?: number;
	latencyMs?: number;
	isError?: boolean;
	errorMessage?: string;
	occurredAt?: string;
	/** RFC 0004 — propagated from the active root span by the SDK. */
	sessionId?: string;
	/** RFC 0004 — same source as sessionId. */
	interactionId?: string;
}

export interface AICallPayload {
	calls: AICallInput[];
}

export interface AICallRecord {
	projectId: string;
	callId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	modelName: string;
	provider: string;
	callType: AICallType;
	requestJson: string | null;
	responseJson: string | null;
	promptTokens: number | null;
	completionTokens: number | null;
	totalCostUsd: number | null;
	latencyMs: number | null;
	isError: boolean;
	errorMessage: string | null;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string;
	/**
	 * RFC 0004 — denormalized from the parent trace's root span. Lets us
	 * pivot from an AI call directly to the user session that triggered
	 * it without a two-hop join through telemetry_spans.
	 */
	sessionId?: string | null;
	/** RFC 0004 — click-scoped correlation ID, same source as sessionId. */
	interactionId?: string | null;
}

export interface AICallRow {
	project_id: string;
	call_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	model_name: string;
	provider: string;
	call_type: string;
	request_json: string | null;
	response_json: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_cost_usd: number | null;
	latency_ms: number | null;
	is_error: number;
	error_message: string | null;
	occurred_at: string;
	received_at: string;
}

export interface AICallsOverviewOptions {
	projectId: string;
	hours: number;
	service?: string;
	model?: string;
	isError?: boolean;
	traceId?: string;
	limit?: number;
}

export interface AICallsOverviewResponse {
	calls: AICallRecord[];
	summary: {
		totalCalls: number;
		totalCostUsd: number;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		errorCalls: number;
	};
	windowHours: number;
	timestamp: string;
}

// ── OpenInference AI Spans ──

/** An OpenInference-kind span joined with its side-table payload. */
export interface AISpanRecord {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	spanName: string;
	spanKind: string; // OpenInferenceSpanKind
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	/** Full parsed attributes_json (excluding ai.payload.* — those live on the payload). */
	attributes: Record<string, JsonValue>;
	inputJson: string | null;
	outputJson: string | null;
}

export interface AISpansOverviewOptions {
	projectId: string;
	hours: number;
	kind?: string;
	service?: string;
	traceId?: string;
	limit?: number;
}

export interface AISpansOverviewResponse {
	spans: AISpanRecord[];
	summary: {
		totalSpans: number;
		byKind: Record<string, number>;
		errorSpans: number;
	};
	windowHours: number;
	timestamp: string;
}

// ── AI Sessions (conversation threads) ──

/** One row per unique session.id, with aggregates across its AI spans. */
export interface AISessionSummary {
	sessionId: string;
	userId: string | null;
	spanCount: number;
	llmSpanCount: number;
	errorCount: number;
	totalPromptTokens: number;
	totalCompletionTokens: number;
	totalCostUsd: number;
	firstSpanAt: string;
	lastSpanAt: string;
	/** Distinct trace ids this session spans. Useful for traversal. */
	traceCount: number;
	/** A preview of the most recent user input, for list rendering. */
	lastInputPreview: string | null;
}

export interface AISessionsListOptions {
	projectId: string;
	hours: number;
	userId?: string;
	limit?: number;
}

export interface AISessionsListResponse {
	sessions: AISessionSummary[];
	windowHours: number;
	timestamp: string;
}

export interface AISessionDetailResponse {
	sessionId: string;
	userId: string | null;
	spans: AISpanRecord[];
	evaluations: AIEvaluationRecord[];
	summary: {
		spanCount: number;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		totalCostUsd: number;
		errorCount: number;
		firstSpanAt: string | null;
		lastSpanAt: string | null;
	};
	timestamp: string;
}

// ── AI Span Evaluations ──

export type AIEvaluationSource = "llm_judge" | "code" | "human" | "user";

export interface AIEvaluationInput {
	traceId: string;
	spanId: string;
	name: string;
	score?: number;
	label?: string;
	explanation?: string;
	source: AIEvaluationSource;
	metadata?: Record<string, JsonValue>;
}

export interface AIEvaluationPayload {
	evaluations: AIEvaluationInput[];
}

export interface AIEvaluationRecord {
	evaluationId: string;
	projectId: string;
	traceId: string;
	spanId: string;
	name: string;
	score: number | null;
	label: string | null;
	explanation: string | null;
	source: AIEvaluationSource;
	metadata: Record<string, JsonValue>;
	createdAt: string;
	expiresAt: string;
	evidenceReferences?: EvidenceReference[];
}

export interface AIEvaluationsListOptions {
	projectId: string;
	traceId?: string;
	spanId?: string;
	name?: string;
	limit?: number;
}

export interface AIEvaluationsListResponse {
	evaluations: AIEvaluationRecord[];
	timestamp: string;
}

// ── User Profiles Types ──
