import type { EvidenceReference, EvidenceReferenceContract } from "./evidence";
import type { JsonValue } from "./primitives";

export type EvalRunStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "canceled";

export interface EvalRunCandidate {
	agentId: string | null;
	agentVersion: string | null;
	promptId: string | null;
	promptVersion: string | null;
	modelProvider: string | null;
	model: string | null;
	modelVersion: string | null;
}

export interface EvalRunSourceCase {
	id: string;
	name: string;
	sourceEntityType: string;
	sourceEntityId: string;
	sourceAgentRunId: string | null;
	sourceActionId: string | null;
	sourceAiCallId: string | null;
	sourceToolCallId: string | null;
	sourceTraceId: string | null;
	sourceSpanId: string | null;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export interface EvalRun {
	id: string;
	projectId: string;
	evalCaseId: string | null;
	status: EvalRunStatus;
	candidate: EvalRunCandidate;
	startedAt: string | null;
	endedAt: string | null;
	totalCount: number;
	passCount: number;
	failCount: number;
	averageScore: number | null;
	metadata: Record<string, JsonValue>;
	createdAt: string;
	sourceEvalCase?: EvalRunSourceCase | null;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export interface EvalRunInput {
	id?: string;
	evalCaseId?: string | null;
	status?: EvalRunStatus;
	candidate?: Partial<EvalRunCandidate>;
	startedAt?: string | null;
	endedAt?: string | null;
	totalCount?: number;
	passCount?: number;
	failCount?: number;
	averageScore?: number | null;
	metadata?: Record<string, JsonValue>;
}

export interface EvalRunsListOptions {
	projectId: string;
	evalCaseId?: string;
	status?: EvalRunStatus;
	limit?: number;
}
