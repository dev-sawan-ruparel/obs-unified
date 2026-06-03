import type { ActionConfidence } from "@obs-unified/types/constants";

export type CausalConfidence = ActionConfidence;

export interface SpanRef {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	spanName: string;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	durationMs: number;
	interactionId: string | null;
}

export interface LogRef {
	logId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	loggerName: string | null;
	severity: string;
	message: string;
	occurredAt: string;
	interactionId: string | null;
}

export interface UsageEventRef {
	eventId: string;
	eventType: string;
	eventName: string;
	pagePath: string | null;
	severity: string | null;
	occurredAt: string;
	interactionId: string | null;
	sessionId: string | null;
}

export interface AICallRef {
	callId: string;
	traceId: string | null;
	modelName: string;
	provider: string;
	totalCostUsd: number | null;
	occurredAt: string;
	interactionId: string | null;
}

export interface MetricExemplarRef {
	id: string;
	pointId: string;
	seriesId: string;
	metricName: string;
	serviceName: string | null;
	traceId: string | null;
	spanId: string | null;
	tsNs: string;
	value: number;
	receivedAt: string;
}

export interface ReplayRef {
	sessionId: string;
	firstChunkAt: string;
	lastChunkAt: string;
	chunkCount: number;
	eventsCount: number;
}

export interface ReplayRow {
	session_id: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
}

export interface EntityManifest {
	spans: SpanRef[];
	logs: LogRef[];
	usageEvents: UsageEventRef[];
	aiCalls: AICallRef[];
	metricExemplars: MetricExemplarRef[];
	replay: ReplayRef | null;
}

export interface ActionRef {
	id: string;
	projectId: string;
	rootActionId: string;
	causedByActionId: string | null;
	actorType: string;
	actorId: string | null;
	actionKind: string;
	name: string | null;
	status: string;
	startedAt: string;
	endedAt: string | null;
	durationMs: number | null;
	traceId: string | null;
	spanId: string | null;
	sessionId: string | null;
	interactionId: string | null;
	userId: string | null;
	agentRunId: string | null;
	stepId: string | null;
	toolCallId: string | null;
	promptVersion: string | null;
	modelName: string | null;
	provider: string | null;
	totalCostUsd: number | null;
	causalConfidence: CausalConfidence;
	attrsJson: string | null;
}

export interface AgentRunRef {
	id: string;
	projectId: string;
	agentId: string;
	agentName: string;
	agentVersion: string;
	goal: string | null;
	outcome: string | null;
	autonomyLevel: string;
	status: string;
	errorMessage: string | null;
	totalCostUsd: number | null;
	totalDurationMs: number | null;
	metadataJson: string | null;
}

export interface ToolCallRef {
	id: string;
	actionId: string;
	projectId: string;
	toolName: string;
	argsHash: string;
	resultHash: string;
	errorType: string | null;
	sideEffect: number;
	approvalState: string | null;
	argsRedacted: string | null;
	resultRedacted: string | null;
	mcpAuditJson: string | null;
	mutationBeforeJson: string | null;
	mutationAfterJson: string | null;
	mutationDiffJson: string | null;
	mutationArtifactId: string | null;
}

export interface RetrievalEventRef {
	id: string;
	actionId: string;
	projectId: string;
	retrieverName: string;
	queryHash: string;
	documentsJson: string | null;
	totalResults: number;
	maxRelevanceScore: number | null;
	durationMs: number | null;
}

export interface EvalResultRef {
	id: string;
	actionId: string;
	projectId: string;
	evaluatorName: string;
	evaluatorVersion: string;
	score: number | null;
	passed: number;
	reasoning: string | null;
	rubricJson: string | null;
}

export interface ArtifactRef {
	id: string;
	actionId: string;
	projectId: string;
	artifactName: string;
	artifactType: string;
	storageRef: string | null;
	sizeBytes: number | null;
	sha256Hash: string | null;
	contentPreview: string | null;
}

export interface EntityManifestExtended extends EntityManifest {
	actions: ActionRef[];
	agentRuns: AgentRunRef[];
	toolCalls: ToolCallRef[];
	retrievalEvents: RetrievalEventRef[];
	evalResults: EvalResultRef[];
	artifacts: ArtifactRef[];
}
