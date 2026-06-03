export type EvidenceEntityKind =
	| "analysis"
	| "alert"
	| "agent_run"
	| "action"
	| "trace"
	| "span"
	| "tool_call"
	| "eval"
	| "profile"
	| "service"
	| "log"
	| "docs";

export interface EvidenceCitation {
	label: string;
	entityKind: EvidenceEntityKind;
	entityId: string;
	route?: string | null;
}

export interface EvidenceNextPivot {
	label: string;
	entityKind: EvidenceEntityKind;
	entityId: string;
	route: string;
	reason?: string;
}

export interface EvidenceReference {
	evidenceId: string;
	entityKind: EvidenceEntityKind;
	entityId: string;
	route: string;
	source: string;
	confidence: number;
	reason: string;
	citations: EvidenceCitation[];
	suggestedNextPivots: EvidenceNextPivot[];
}
