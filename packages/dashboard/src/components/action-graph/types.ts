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
	attrsJson: string | null;
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

export interface EntityManifestExtended {
	actions: ActionRef[];
	agentRuns: AgentRunRef[];
	toolCalls: ToolCallRef[];
	retrievalEvents: RetrievalEventRef[];
	evalResults: EvalResultRef[];
	artifacts: ArtifactRef[];
}

export interface ActionGraphRendererProps {
	actionId: string;
	rawManifest: EntityManifestExtended;
}

export interface TreeNode {
	action: ActionRef;
	children: TreeNode[];
}
