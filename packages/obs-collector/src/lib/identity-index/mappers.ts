import type {
	ActionRef,
	AgentRunRef,
	AICallRef,
	ArtifactRef,
	EvalResultRef,
	LogRef,
	RetrievalEventRef,
	SpanRef,
	ToolCallRef,
	UsageEventRef,
} from "./types";

export const mapSpan = (r: {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	span_name: string;
	status_code: number;
	status_message: string | null;
	start_time: string;
	duration_ms: number;
	interaction_id: string | null;
}): SpanRef => ({
	traceId: r.trace_id,
	spanId: r.span_id,
	parentSpanId: r.parent_span_id,
	serviceName: r.service_name,
	spanName: r.span_name,
	statusCode: r.status_code,
	statusMessage: r.status_message,
	startTime: r.start_time,
	durationMs: r.duration_ms,
	interactionId: r.interaction_id,
});

export const mapLog = (r: {
	log_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	logger_name: string | null;
	severity: string;
	message: string;
	occurred_at: string;
	interaction_id: string | null;
}): LogRef => ({
	logId: r.log_id,
	traceId: r.trace_id,
	spanId: r.span_id,
	serviceName: r.service_name,
	loggerName: r.logger_name,
	severity: r.severity,
	message: r.message,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
});

export const mapUsage = (r: {
	event_id: string;
	event_type: string;
	event_name: string;
	page_path: string | null;
	severity: string | null;
	occurred_at: string;
	interaction_id: string | null;
	session_id: string | null;
}): UsageEventRef => ({
	eventId: r.event_id,
	eventType: r.event_type,
	eventName: r.event_name,
	pagePath: r.page_path,
	severity: r.severity,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
	sessionId: r.session_id,
});

export const mapAi = (r: {
	call_id: string;
	trace_id: string | null;
	model_name: string;
	provider: string;
	total_cost_usd: number | null;
	occurred_at: string;
	interaction_id: string | null;
}): AICallRef => ({
	callId: r.call_id,
	traceId: r.trace_id,
	modelName: r.model_name,
	provider: r.provider,
	totalCostUsd: r.total_cost_usd,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
});

export const mapAction = (r: {
	id: string;
	project_id: string;
	root_action_id: string;
	caused_by_action_id: string | null;
	actor_type: string;
	actor_id: string | null;
	action_kind: string;
	name: string | null;
	status: string;
	started_at: string;
	ended_at: string | null;
	duration_ms: number | null;
	trace_id: string | null;
	span_id: string | null;
	session_id: string | null;
	interaction_id: string | null;
	user_id: string | null;
	agent_run_id: string | null;
	step_id: string | null;
	tool_call_id: string | null;
	prompt_version: string | null;
	model_name: string | null;
	provider: string | null;
	total_cost_usd: number | null;
	attrs_json: string | null;
}): ActionRef => ({
	id: r.id,
	projectId: r.project_id,
	rootActionId: r.root_action_id,
	causedByActionId: r.caused_by_action_id,
	actorType: r.actor_type,
	actorId: r.actor_id,
	actionKind: r.action_kind,
	name: r.name,
	status: r.status,
	startedAt: r.started_at,
	endedAt: r.ended_at,
	durationMs: r.duration_ms,
	traceId: r.trace_id,
	spanId: r.span_id,
	sessionId: r.session_id,
	interactionId: r.interaction_id,
	userId: r.user_id,
	agentRunId: r.agent_run_id,
	stepId: r.step_id,
	toolCallId: r.tool_call_id,
	promptVersion: r.prompt_version,
	modelName: r.model_name,
	provider: r.provider,
	totalCostUsd: r.total_cost_usd,
	attrsJson: r.attrs_json,
});

export const mapAgentRun = (r: {
	id: string;
	project_id: string;
	agent_id: string;
	agent_name: string;
	agent_version: string;
	goal: string | null;
	outcome: string | null;
	autonomy_level: string;
	status: string;
	error_message: string | null;
	total_cost_usd: number | null;
	total_duration_ms: number | null;
	metadata_json: string | null;
}): AgentRunRef => ({
	id: r.id,
	projectId: r.project_id,
	agentId: r.agent_id,
	agentName: r.agent_name,
	agentVersion: r.agent_version,
	goal: r.goal,
	outcome: r.outcome,
	autonomyLevel: r.autonomy_level,
	status: r.status,
	errorMessage: r.error_message,
	totalCostUsd: r.total_cost_usd,
	totalDurationMs: r.total_duration_ms,
	metadataJson: r.metadata_json,
});

export const mapToolCall = (r: {
	id: string;
	action_id: string;
	project_id: string;
	tool_name: string;
	args_hash: string;
	result_hash: string;
	error_type: string | null;
	side_effect: number;
	approval_state: string | null;
	args_redacted: string | null;
	result_redacted: string | null;
}): ToolCallRef => ({
	id: r.id,
	actionId: r.action_id,
	projectId: r.project_id,
	toolName: r.tool_name,
	argsHash: r.args_hash,
	resultHash: r.result_hash,
	errorType: r.error_type,
	sideEffect: r.side_effect,
	approvalState: r.approval_state,
	argsRedacted: r.args_redacted,
	resultRedacted: r.result_redacted,
});

export const mapRetrievalEvent = (r: {
	id: string;
	action_id: string;
	project_id: string;
	retriever_name: string;
	query_hash: string;
	documents_json: string | null;
	total_results: number;
	max_relevance_score: number | null;
	duration_ms: number | null;
}): RetrievalEventRef => ({
	id: r.id,
	actionId: r.action_id,
	projectId: r.project_id,
	retrieverName: r.retriever_name,
	queryHash: r.query_hash,
	documentsJson: r.documents_json,
	totalResults: r.total_results,
	maxRelevanceScore: r.max_relevance_score,
	durationMs: r.duration_ms,
});

export const mapEvalResult = (r: {
	id: string;
	action_id: string;
	project_id: string;
	evaluator_name: string;
	evaluator_version: string;
	score: number | null;
	passed: number;
	reasoning: string | null;
	rubric_json: string | null;
}): EvalResultRef => ({
	id: r.id,
	actionId: r.action_id,
	projectId: r.project_id,
	evaluatorName: r.evaluator_name,
	evaluatorVersion: r.evaluator_version,
	score: r.score,
	passed: r.passed,
	reasoning: r.reasoning,
	rubricJson: r.rubric_json,
});

export const mapArtifact = (r: {
	id: string;
	action_id: string;
	project_id: string;
	artifact_name: string;
	artifact_type: string;
	storage_ref: string | null;
	size_bytes: number | null;
	sha256_hash: string | null;
	content_preview: string | null;
}): ArtifactRef => ({
	id: r.id,
	actionId: r.action_id,
	projectId: r.project_id,
	artifactName: r.artifact_name,
	artifactType: r.artifact_type,
	storageRef: r.storage_ref,
	sizeBytes: r.size_bytes,
	sha256Hash: r.sha256_hash,
	contentPreview: r.content_preview,
});
