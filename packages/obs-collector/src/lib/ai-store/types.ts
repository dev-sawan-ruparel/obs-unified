import type { AICallRecord, AIEvaluationSource } from "@obs-unified/types";

export interface IngestEvaluation {
	projectId: string;
	evaluationId: string;
	traceId: string;
	spanId: string;
	name: string;
	score: number | null;
	label: string | null;
	explanation: string | null;
	source: AIEvaluationSource;
	metadataJson: string | null;
	createdAt: string;
	expiresAt: string;
}

/** Clamp an integer to a safe range */
export const clampInt = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	const n = typeof value === "number" ? value : parseInt(String(value), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

export interface AICallRow {
	project_id?: string;
	call_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	model_name: string;
	provider: string;
	call_type: AICallRecord["callType"];
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
	expires_at: string;
	session_id: string | null;
	interaction_id: string | null;
}

export interface AICallSummaryRow {
	totalCalls?: number;
	totalCostUsd?: number;
	totalPromptTokens?: number;
	totalCompletionTokens?: number;
	errorCalls?: number;
}

export interface AISpanRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	span_name: string;
	span_kind: string;
	status_code: number | null;
	status_message: string | null;
	start_time: string;
	end_time: string | null;
	duration_ms: number | null;
	attributes_json: string | null;
	input_json: string | null;
	output_json: string | null;
	user_id?: string | null;
}

export interface AISessionRow {
	session_id: string;
	user_id: string | null;
	span_count: number | null;
	llm_span_count: number | null;
	error_count: number | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	cost_usd: number | null;
	first_span_at: string;
	last_span_at: string;
	trace_count: number | null;
}

export interface AISessionPreviewRow {
	session_id: string;
	input_json: string | null;
}

export interface AIEvaluationRow {
	evaluation_id: string;
	project_id: string;
	trace_id: string;
	span_id: string;
	name: string;
	score: number | null;
	label: string | null;
	explanation: string | null;
	source: AIEvaluationSource;
	metadata_json: string | null;
	created_at: string;
	expires_at: string;
}
