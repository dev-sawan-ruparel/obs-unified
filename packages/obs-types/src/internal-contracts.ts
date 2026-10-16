import { z } from "zod";
import { AgentAutonomyLevel } from "./constants";
import type { AICallRecord, AICallType } from "./types/ai";
import {
	type CausalProofTier,
	CausalProofTierSchema,
	type CausalVerificationStatus,
	CausalVerificationStatusSchema,
	type ChangeBlastRadiusResult,
	type ChangeEvent,
	type ChangeEventInput,
	type ChangeEventKind,
	ChangeEventKindSchema,
	ChangeEventSourceSchema,
	CohortAttributionVerdictSchema,
	EvidencePredicateSchema,
	type GrantCallbackDelivery,
	type GrantDeliveryResult,
	type IncidentInvestigation,
	type IncidentStatus,
	IncidentStatusSchema,
	type InvestigationFinding,
	type InvestigationFindingInput,
	type OntologyEdge,
	type OntologyGraphResponse,
	type OntologyNode,
	OntologyNodeKindSchema,
	type PairedCounterfactualProof,
	type RecoveryStatus,
	RecoveryStatusSchema,
	type RelationshipCertainty,
	RelationshipCertaintySchema,
	RemediationActionKindSchema,
	type RemediationProposal,
	type RemediationProposalInput,
	type RemediationProposalStatus,
	RemediationProposalStatusSchema,
} from "./types/autosre";
import {
	ChangeEventInputSchema,
	InvestigationFindingInputSchema,
	RemediationProposalInputSchema,
} from "./types/autosre-inputs";
import type {
	EvalRun,
	EvalRunCandidate,
	EvalRunInput,
	EvalRunSourceCase,
	EvalRunStatus,
} from "./types/eval-runner";
import {
	EVIDENCE_BUNDLE_SCHEMA_VERSION,
	type EvidenceAnchor,
	EvidenceAnchorSchema,
	type EvidenceBundle,
	type EvidenceBundleDetailLevel,
	EvidenceBundleDetailLevelSchema,
	type EvidenceBundleIntent,
	EvidenceBundleIntentSchema,
	EvidenceBundleSchema,
	type EvidenceEntityKind,
	EvidenceEntityKindSchema,
	type EvidenceReference,
	type EvidenceReferenceContract,
	EvidenceReferenceSchema,
} from "./types/evidence";
import type { JsonValue } from "./types/primitives";
import type { TelemetryCodeReference } from "./types/telemetry";

export class ContractMismatchError extends Error {
	readonly status: number;
	readonly endpoint: string;
	readonly issues: z.ZodIssue[];
	readonly rawBody: unknown;

	constructor(options: {
		endpoint: string;
		status: number;
		issues: z.ZodIssue[];
		rawBody: unknown;
	}) {
		const summary = options.issues
			.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
			.join("; ");
		super(
			`Contract mismatch on ${options.endpoint} (HTTP ${options.status}): ${summary}`,
		);
		this.name = "ContractMismatchError";
		this.endpoint = options.endpoint;
		this.status = options.status;
		this.issues = options.issues;
		this.rawBody = options.rawBody;
	}
}

export class InternalClientHttpError extends Error {
	readonly endpoint: string;
	readonly status: number;
	readonly statusText: string;
	readonly rawBody: unknown;
	readonly errorMessage: string;

	constructor(options: {
		endpoint: string;
		status: number;
		statusText: string;
		rawBody: unknown;
		errorMessage?: string;
	}) {
		const rec =
			typeof options.rawBody === "object" && options.rawBody !== null
				? (options.rawBody as Record<string, unknown>)
				: null;
		const detail =
			options.errorMessage ??
			(rec && typeof rec.error === "string"
				? typeof rec.message === "string" && rec.message.length > 0
					? `${rec.error}: ${rec.message}`
					: rec.error
				: typeof options.rawBody === "string" && options.rawBody.length > 0
					? options.rawBody
					: "");
		super(
			`Collector request failed (${options.endpoint}): ${options.status} ${options.statusText}${detail ? ` — ${detail}` : ""}`,
		);
		this.name = "InternalClientHttpError";
		this.endpoint = options.endpoint;
		this.status = options.status;
		this.statusText = options.statusText;
		this.rawBody = options.rawBody;
		this.errorMessage = detail;
	}
}

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(JsonValueSchema),
		z.record(JsonValueSchema),
	]),
);

const AgentAutonomyLevelSchema = z.nativeEnum(AgentAutonomyLevel);

export const TelemetryCodeReferenceSchema: z.ZodType<TelemetryCodeReference> = z
	.object({
		repoName: z.string().optional(),
		relativePath: z.string().optional(),
		absolutePath: z.string().optional(),
		originalPath: z.string().optional(),
		symbolName: z.string().optional(),
		lineNumber: z.number().optional(),
		columnNumber: z.number().optional(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// AutoSRE Entity & Response Schemas (grounded in autosre-routes.ts)
// ---------------------------------------------------------------------------

export const IncidentInvestigationSchema: z.ZodType<IncidentInvestigation> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		environment: z.string(),
		dedupKey: z.string(),
		status: IncidentStatusSchema,
		targetNodeId: z.string(),
		symptomAnchorKind: EvidenceEntityKindSchema,
		symptomAnchorId: z.string(),
		symptomFingerprint: z.string().nullable(),
		alertCount: z.number(),
		latestBundle: z.record(z.unknown()).nullable(),
		leaseOwnerId: z.string().nullable(),
		leaseExpiresAt: z.string().nullable(),
		dispatchAttempts: z.number(),
		lastDispatchedAt: z.string().nullable(),
		openedAt: z.string(),
		updatedAt: z.string(),
		resolvedAt: z.string().nullable(),
		expiresAt: z.string().nullable(),
	})
	.passthrough();

const ChangeEventFields = {
	id: z.string(),
	projectId: z.string(),
	environment: z.string(),
	targetNodeId: z.string(),
	kind: ChangeEventKindSchema,
	source: ChangeEventSourceSchema,
	relationshipCertainty: RelationshipCertaintySchema,
	summary: z.string(),
	serviceName: z.string().nullable(),
	version: z.string().nullable(),
	previousVersion: z.string().nullable(),
	commitSha: z.string().nullable(),
	previousCommitSha: z.string().nullable(),
	configDigest: z.string().nullable(),
	repositoryUrl: z.string().nullable(),
	pullRequestUrl: z.string().nullable(),
	actorId: z.string().nullable(),
	causedByActionId: z.string().nullable(),
	agentRunId: z.string().nullable(),
	touchedPaths: z.array(z.string()),
	attributes: z.record(JsonValueSchema),
	occurredAt: z.string(),
	receivedAt: z.string(),
	expiresAt: z.string().nullable(),
};

export const ChangeEventSchema: z.ZodType<ChangeEvent> = z
	.object(ChangeEventFields)
	.passthrough();

export const CohortMetricsSummarySchema = z
	.object({
		cohortKey: z.string(),
		requestCount: z.number(),
		errorCount: z.number(),
		errorRate: z.number(),
		p95DurationMs: z.number().nullable(),
		avgDownstreamCallsPerRequest: z.number(),
		avgDownstreamDurationMs: z.number().nullable(),
	})
	.passthrough();

export const ContentionCandidateSchema = z
	.object({
		aggressorTraceId: z.string(),
		aggressorSpanId: z.string(),
		aggressorServiceName: z.string().nullable(),
		aggressorServiceVersion: z.string().nullable(),
		aggressorSpanName: z.string(),
		sharedTargetNodeId: z.string(),
		relationshipCertainty: RelationshipCertaintySchema,
		concurrentCalls: z.number(),
		maxDurationMs: z.number(),
		totalResourceTimeMs: z.number(),
	})
	.passthrough();

const ChangeBlastRadiusFields = {
	change: ChangeEventSchema,
	cohortVerdict: CohortAttributionVerdictSchema,
	causalProofTier: CausalProofTierSchema,
	relationshipCertainty: RelationshipCertaintySchema,
	minComparableSample: z.number(),
	newCohort: CohortMetricsSummarySchema,
	oldCohort: CohortMetricsSummarySchema,
	preChangeBaselineCohort: CohortMetricsSummarySchema.optional(),
	rateDifference: z.number(),
	relativeRisk: z.number(),
	overlappingCodePaths: z.array(z.string()),
	matchingErrorSpanIds: z.array(z.string()),
	sharedResourceAggressors: z.array(ContentionCandidateSchema),
	summary: z.string(),
};

export const ChangeBlastRadiusResultSchema: z.ZodType<ChangeBlastRadiusResult> =
	z.object(ChangeBlastRadiusFields).passthrough();

export const CausalTripleSchema = z
	.object({
		subjectKind: EvidenceEntityKindSchema,
		subjectId: z.string(),
		predicate: EvidencePredicateSchema,
		objectKind: EvidenceEntityKindSchema,
		objectId: z.string(),
		relationshipCertainty: RelationshipCertaintySchema,
		causalProofTier: CausalProofTierSchema,
		confidence: z.number(),
		reason: z.string(),
	})
	.passthrough();

export const PairedCounterfactualProofSchema: z.ZodType<PairedCounterfactualProof> =
	z
		.object({
			evalCaseId: z.string(),
			inputPayloadHash: z.string(),
			failingRunId: z.string(),
			failingVersion: z.string().nullable(),
			failingCommitSha: z.string().nullable(),
			failureFingerprint: z.string(),
			passingRunIds: z.array(z.string()),
			passingVersion: z.string().nullable(),
			passingCommitSha: z.string().nullable(),
			requiredTrials: z.number(),
			verifiedAt: z.string(),
		})
		.passthrough();

export const FindingFingerprintInputSchema = z
	.object({
		environment: z.string(),
		originatingNodeId: z.string(),
		normalizedOperation: z.string(),
		errorSignature: z.string(),
		downstreamTargetNodeId: z.string().nullable().optional(),
	})
	.passthrough();

export const ConfidenceBreakdownSchema = z
	.object({
		relationshipScore: z.number(),
		cohortLiftScore: z.number(),
		temporalProximityScore: z.number(),
		counterfactualBonus: z.number(),
		priorRecurrenceBonus: z.number(),
		finalConfidence: z.number(),
	})
	.passthrough();

const InvestigationFindingFields = {
	id: z.string(),
	projectId: z.string(),
	environment: z.string(),
	incidentId: z.string().nullable(),
	fingerprint: z.string(),
	fingerprintInput: FindingFingerprintInputSchema,
	title: z.string(),
	summary: z.string(),
	causalProofTier: CausalProofTierSchema,
	confidence: z.number(),
	confidenceBreakdown: ConfidenceBreakdownSchema,
	symptomEntityKind: EvidenceEntityKindSchema,
	symptomEntityId: z.string(),
	faultLocusEntityKind: EvidenceEntityKindSchema,
	faultLocusEntityId: z.string(),
	rootCauseEntityKind: EvidenceEntityKindSchema.nullable(),
	rootCauseEntityId: z.string().nullable(),
	contributingChangeId: z.string().nullable(),
	cohortVerdict: CohortAttributionVerdictSchema.nullable(),
	contendingTraceId: z.string().nullable(),
	causalChain: z.array(CausalTripleSchema),
	citedEvidenceIds: z.array(z.string()),
	codeReferences: z.array(TelemetryCodeReferenceSchema),
	counterfactualProof: PairedCounterfactualProofSchema.nullable(),
	recoveryStatus: RecoveryStatusSchema,
	causalVerificationStatus: CausalVerificationStatusSchema,
	watchdogStep: z.number(),
	baselineRequestRatePerMin: z.number().nullable(),
	nextWatchdogCheckAt: z.string().nullable(),
	actorType: z.string(),
	actorId: z.string(),
	agentRunId: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	expiresAt: z.string().nullable(),
};

export const InvestigationFindingSchema: z.ZodType<InvestigationFinding> = z
	.object(InvestigationFindingFields)
	.passthrough();

export const RemediationStateSpecSchema = z
	.object({
		version: z.string().nullable().optional(),
		commitSha: z.string().nullable().optional(),
		configDigest: z.string().nullable().optional(),
		flagKey: z.string().nullable().optional(),
		flagVariant: z
			.union([z.string(), z.boolean(), z.number()])
			.nullable()
			.optional(),
		promptVersion: z.string().nullable().optional(),
		branchOrPrUrl: z.string().nullable().optional(),
	})
	.passthrough();

export const GrantCallbackDeliverySchema: z.ZodType<GrantCallbackDelivery> = z
	.object({
		status: z.enum(["delivered", "failed"]),
		attempts: z.number(),
		lastError: z.string().nullable(),
		at: z.string(),
	})
	.passthrough();

export const GrantDeliveryResultSchema: z.ZodType<GrantDeliveryResult> = z
	.object({
		attempted: z.boolean(),
		delivered: z.boolean(),
		attempts: z.number(),
		host: z.string().nullable(),
		error: z.string().optional(),
	})
	.passthrough();

export const WebhookDeliveryResultSchema = z
	.object({
		delivered: z.boolean(),
		status: z.number().optional(),
		error: z.string().optional(),
		attempts: z.number(),
	})
	.passthrough();

const RemediationProposalBaseFields = {
	id: z.string(),
	projectId: z.string(),
	environment: z.string(),
	incidentId: z.string(),
	findingId: z.string(),
	idempotencyKey: z.string(),
	actionKind: RemediationActionKindSchema,
	targetNodeId: z.string(),
	expectedCurrentState: RemediationStateSpecSchema,
	desiredTargetState: RemediationStateSpecSchema,
	requestedAutonomy: AgentAutonomyLevelSchema,
	effectiveAutonomy: AgentAutonomyLevelSchema,
	policyDecisionReason: z.string(),
	status: RemediationProposalStatusSchema,
	grantExpiresAt: z.string().nullable(),
	approvedByUserId: z.string().nullable(),
	approvedAt: z.string().nullable(),
	claimedByRunnerId: z.string().nullable(),
	claimedAt: z.string().nullable(),
	claimExpiresAt: z.string().nullable(),
	remediationAgentRunId: z.string().nullable(),
	resultingChangeId: z.string().nullable(),
	failureReason: z.string().nullable(),
	callbackHost: z.string().nullable().optional(),
	callbackDelivery: GrantCallbackDeliverySchema.nullable().optional(),
	createdAt: z.string(),
	updatedAt: z.string(),
	expiresAt: z.string().nullable(),
};

export const RemediationProposalSchema: z.ZodType<RemediationProposal> = z
	.object({
		...RemediationProposalBaseFields,
		grantToken: z.string().optional(),
	})
	.passthrough();

export interface ProposeRemediationResponse
	extends Omit<RemediationProposal, "grantToken"> {
	proposal: RemediationProposal;
	grantToken?: string | null;
	grantDelivery?: GrantDeliveryResult;
	webhookDelivery?: {
		delivered: boolean;
		status?: number;
		error?: string;
		attempts: number;
	};
}

export const ProposeRemediationResponseSchema: z.ZodType<ProposeRemediationResponse> =
	z
		.object({
			...RemediationProposalBaseFields,
			grantToken: z.string().nullable().optional(),
			proposal: RemediationProposalSchema,
			grantDelivery: GrantDeliveryResultSchema.optional(),
			webhookDelivery: WebhookDeliveryResultSchema.optional(),
		})
		.passthrough();

export interface ApproveRemediationResponse
	extends Omit<RemediationProposal, "grantToken"> {
	proposal: RemediationProposal;
	grantToken: string | null;
	grantDelivery?: GrantDeliveryResult;
	webhookDelivery?: {
		delivered: boolean;
		status?: number;
		error?: string;
		attempts: number;
	};
}

export const ApproveRemediationResponseSchema: z.ZodType<ApproveRemediationResponse> =
	z
		.object({
			...RemediationProposalBaseFields,
			proposal: RemediationProposalSchema,
			grantToken: z.string().nullable(),
			grantDelivery: GrantDeliveryResultSchema.optional(),
			webhookDelivery: WebhookDeliveryResultSchema.optional(),
		})
		.passthrough();

export const RemediationMutationResponseSchema = z
	.object({
		...RemediationProposalBaseFields,
		grantToken: z.string().nullable().optional(),
		proposal: RemediationProposalSchema,
		claimed: z.boolean().optional(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Input Schemas for AutoSRE HTTP Handlers (supporting documented aliases)
// ---------------------------------------------------------------------------

export interface ChangeEventHttpInput extends Omit<ChangeEventInput, "kind"> {
	kind?: ChangeEventKind | "agent_prompt_release";
	service?: string;
	serviceNamespace?: string;
	repoUrl?: string | null;
	prUrl?: string | null;
	actor?: string | null;
	metadata?: Record<string, JsonValue>;
}

export const ChangeEventHttpInputSchema = ChangeEventInputSchema.extend({
	kind: z
		.union([ChangeEventKindSchema, z.literal("agent_prompt_release")])
		.optional(),
	service: z.string().optional(),
	serviceNamespace: z.string().optional(),
	repoUrl: z.string().nullable().optional(),
	prUrl: z.string().nullable().optional(),
	actor: z.string().nullable().optional(),
	metadata: z.record(JsonValueSchema).optional(),
}).passthrough();

export const CausalTripleHttpInputSchema = z
	.object({
		subjectKind: EvidenceEntityKindSchema,
		subjectId: z.string(),
		predicate: EvidencePredicateSchema,
		objectKind: EvidenceEntityKindSchema,
		objectId: z.string(),
		relationshipCertainty: RelationshipCertaintySchema.optional(),
		causalProofTier: CausalProofTierSchema.optional(),
		confidence: z.number().optional(),
		reason: z.string().optional(),
	})
	.passthrough();

export type InvestigationFindingHttpInput = Omit<
	InvestigationFindingInput,
	"causalChain" | "citedEvidenceIds"
> & {
	causalChain?: z.input<typeof CausalTripleHttpInputSchema>[];
	citedEvidenceIds?: string[];
};

export const InvestigationFindingHttpInputSchema =
	InvestigationFindingInputSchema.extend({
		causalChain: z.array(CausalTripleHttpInputSchema).optional(),
		citedEvidenceIds: z.array(z.string()).optional(),
	}).passthrough();

export interface RemediationProposalHttpInput
	extends Omit<
		RemediationProposalInput,
		"expectedCurrentState" | "desiredTargetState"
	> {
	expectedCurrentState?: RemediationProposalInput["expectedCurrentState"];
	desiredTargetState?: RemediationProposalInput["desiredTargetState"];
	webhookUrl?: string;
	secret?: string;
}

export const RemediationProposalHttpInputSchema =
	RemediationProposalInputSchema.extend({
		expectedCurrentState: RemediationStateSpecSchema.optional(),
		desiredTargetState: RemediationStateSpecSchema.optional(),
		webhookUrl: z.string().optional(),
		secret: z.string().optional(),
	}).passthrough();

export const OpenIncidentInputSchema = z
	.object({
		id: z.string().optional(),
		environment: z.string().optional(),
		targetNodeId: z.string().optional(),
		symptomNodeId: z.string().optional(),
		serviceName: z.string().optional(),
		namespace: z.string().optional(),
		symptomCategory: z.string().optional(),
		symptomAnchorKind: EvidenceEntityKindSchema.optional(),
		triggerKind: EvidenceEntityKindSchema.optional(),
		symptomAnchorId: z.string().optional(),
		triggerEntityId: z.string().optional(),
		symptomFingerprint: z.string().nullable().optional(),
		fingerprint: z.string().nullable().optional(),
		latestBundle: z.record(z.unknown()).nullable().optional(),
	})
	.passthrough();

export type OpenIncidentInput = z.infer<typeof OpenIncidentInputSchema>;

export const LeaseIncidentInputSchema = z
	.object({
		environment: z.string().optional(),
		runnerId: z.string().optional(),
		leaseOwner: z.string().optional(),
		leaseOwnerId: z.string().optional(),
		leaseDurationSeconds: z.number().optional(),
		ttlSeconds: z.number().optional(),
		leaseDurationMs: z.number().optional(),
		leaseSeconds: z.number().optional(),
	})
	.passthrough();

export const DispatchIncidentInputSchema = z
	.object({
		environment: z.string().optional(),
		webhookUrl: z.string().optional(),
		url: z.string().optional(),
		secret: z.string().optional(),
	})
	.passthrough();

export const CounterfactualVerificationInputSchema = z
	.object({
		environment: z.string().optional(),
		evalCaseId: z.string().min(1),
		failingRunId: z.string().min(1),
		passingRunIds: z.array(z.string().min(1)).optional(),
		requiredTrials: z.number().optional(),
	})
	.passthrough();

export const ApproveRemediationInputSchema = z
	.object({
		environment: z.string().optional(),
		webhookUrl: z.string().optional(),
		secret: z.string().optional(),
	})
	.passthrough();

export const RejectRemediationInputSchema = z
	.object({
		environment: z.string().optional(),
		reason: z.string().optional(),
	})
	.passthrough();

export const ClaimRemediationInputSchema = z
	.object({
		environment: z.string().optional(),
		grantToken: z.string().min(1),
		runnerId: z.string().optional(),
		leaseSeconds: z.number().optional(),
	})
	.passthrough();

export const CompleteRemediationInputSchema = z
	.object({
		environment: z.string().optional(),
		runnerId: z.string().optional(),
		resultingChangeId: z.string().nullable().optional(),
		remediationAgentRunId: z.string().nullable().optional(),
	})
	.passthrough();

export const FailRemediationInputSchema = z
	.object({
		environment: z.string().optional(),
		runnerId: z.string().optional(),
		failureReason: z.string().optional(),
		reason: z.string().optional(),
		remediationAgentRunId: z.string().optional(),
	})
	.passthrough();

export const WatchdogTickInputSchema = z
	.object({
		minComparableRequests: z.number().optional(),
		nowMs: z.number().optional(),
	})
	.passthrough();

export interface WatchdogEvaluationSummaryContract {
	evaluated: number;
	recovered: number;
	inconclusiveLowTraffic: number;
	stillDegraded: number;
	timedOutClaims: number;
	expiredGrants: number;
	failed: number;
}

export const WatchdogEvaluationSummaryFields = {
	evaluated: z.number(),
	recovered: z.number(),
	inconclusiveLowTraffic: z.number(),
	stillDegraded: z.number(),
	timedOutClaims: z.number(),
	expiredGrants: z.number(),
	failed: z.number(),
};

export const WatchdogEvaluationSummarySchema: z.ZodType<WatchdogEvaluationSummaryContract> =
	z.object(WatchdogEvaluationSummaryFields).passthrough();

export interface EvalRunLightweightSummary {
	id: string;
	evalCaseId: string | null;
	serviceVersion: string | null;
	commitSha: string | null;
	passCount: number;
	failCount: number;
}

export const EvalRunLightweightSummarySchema: z.ZodType<EvalRunLightweightSummary> =
	z
		.object({
			id: z.string(),
			evalCaseId: z.string().nullable(),
			serviceVersion: z.string().nullable(),
			commitSha: z.string().nullable(),
			passCount: z.number(),
			failCount: z.number(),
		})
		.passthrough();

// ---------------------------------------------------------------------------
// Evidence & Connected Route Schemas (grounded in evidence-retrieval-routes.ts
// and connected-routes.ts)
// ---------------------------------------------------------------------------

export interface EvidenceBundleRequestInput {
	anchor: EvidenceAnchor;
	intent?: EvidenceBundleIntent;
	detailLevel?: EvidenceBundleDetailLevel;
	budget?: {
		targetTokens?: number;
		detailLevel?: EvidenceBundleDetailLevel;
	};
	hours?: number;
}

export const EvidenceBundleRequestInputSchema: z.ZodType<EvidenceBundleRequestInput> =
	z
		.object({
			anchor: EvidenceAnchorSchema,
			intent: EvidenceBundleIntentSchema.optional(),
			detailLevel: EvidenceBundleDetailLevelSchema.optional(),
			budget: z
				.object({
					targetTokens: z.number().optional(),
					detailLevel: EvidenceBundleDetailLevelSchema.optional(),
				})
				.passthrough()
				.optional(),
			hours: z.number().optional(),
		})
		.passthrough();

export const EvidenceBundleResponseSchema: z.ZodType<EvidenceBundle> =
	EvidenceBundleSchema.passthrough() as unknown as z.ZodType<EvidenceBundle>;

export interface EvidenceMaterializationStatsResponse {
	projectId: string;
	generatedAt: string;
	byKind: Array<{
		kind: string;
		issuedCount: number;
		expansionCount: number;
	}>;
	bySource: Array<{
		source: string;
		kind: string;
		issuedCount: number;
		expansionCount: number;
	}>;
	recentRefs: Array<{
		refId: string;
		kind: string;
		anchor: {
			entityKind: string;
			entityId: string;
		};
		source: string;
		issuedAt: string;
		lastSeenAt: string;
	}>;
	recentExpansions: Array<{
		id: string;
		refId: string;
		kind: string;
		source: string | null;
		operation: string;
		resultStatus: string;
		limit: number | null;
		query: string | null;
		expandedAt: string;
	}>;
	warning?: string;
}

export const EvidenceMaterializationStatsResponseSchema: z.ZodType<EvidenceMaterializationStatsResponse> =
	z
		.object({
			projectId: z.string(),
			generatedAt: z.string(),
			byKind: z.array(
				z
					.object({
						kind: z.string(),
						issuedCount: z.number(),
						expansionCount: z.number(),
					})
					.passthrough(),
			),
			bySource: z.array(
				z
					.object({
						source: z.string(),
						kind: z.string(),
						issuedCount: z.number(),
						expansionCount: z.number(),
					})
					.passthrough(),
			),
			recentRefs: z.array(
				z
					.object({
						refId: z.string(),
						kind: z.string(),
						anchor: z
							.object({
								entityKind: z.string(),
								entityId: z.string(),
							})
							.passthrough(),
						source: z.string(),
						issuedAt: z.string(),
						lastSeenAt: z.string(),
					})
					.passthrough(),
			),
			recentExpansions: z.array(
				z
					.object({
						id: z.string(),
						refId: z.string(),
						kind: z.string(),
						source: z.string().nullable(),
						operation: z.string(),
						resultStatus: z.string(),
						limit: z.number().nullable(),
						query: z.string().nullable(),
						expandedAt: z.string(),
					})
					.passthrough(),
			),
			warning: z.string().optional(),
		})
		.passthrough();

export interface EvidenceRefRetrieveResponse {
	refId: string;
	kind: string;
	data: unknown;
}

export const EvidenceRefRetrieveResponseSchema: z.ZodType<EvidenceRefRetrieveResponse> =
	z
		.object({
			refId: z.string(),
			kind: z.string(),
			data: z.unknown(),
		})
		.passthrough() as unknown as z.ZodType<EvidenceRefRetrieveResponse>;

export interface EvidenceRefSearchResponse {
	refId: string;
	kind: string;
	query: string;
	data: unknown;
}

export const EvidenceRefSearchResponseSchema: z.ZodType<EvidenceRefSearchResponse> =
	z
		.object({
			refId: z.string(),
			kind: z.string(),
			query: z.string(),
			data: z.unknown(),
		})
		.passthrough() as unknown as z.ZodType<EvidenceRefSearchResponse>;

export const ConnectedEntityKindSchema = z.enum([
	"span",
	"profile",
	"log",
	"usage",
	"ai_call",
	"replay",
	"alert",
	"analysis",
	"user",
	"action",
	"agent_run",
	"tool_call",
	"change",
	"finding",
	"incident",
]);

export type ConnectedEntityKind = z.infer<typeof ConnectedEntityKindSchema>;

export interface ConnectedLinkContract {
	label: string;
	href: string;
	count?: number;
	sample?: string;
	entityKind?: ConnectedEntityKind | EvidenceEntityKind;
	entityId?: string;
	source?: string;
	confidence?: number;
	reason?: string;
	causalConfidence?: string;
	relationshipCertainty?: RelationshipCertainty;
	causalProofTier?: CausalProofTier;
}

export interface ConnectedSectionContract {
	label: string;
	links: ConnectedLinkContract[];
	emptyReason?: string;
}

export interface ConnectedManifestContract {
	entity: { kind: ConnectedEntityKind; id: string; projectId: string };
	up: ConnectedSectionContract[];
	across: ConnectedSectionContract[];
	down: ConnectedSectionContract[];
	related: ConnectedSectionContract[];
	rawManifest?: unknown;
}

export const ConnectedLinkContractSchema: z.ZodType<ConnectedLinkContract> = z
	.object({
		label: z.string(),
		href: z.string(),
		count: z.number().optional(),
		sample: z.string().optional(),
		entityKind: z
			.union([ConnectedEntityKindSchema, EvidenceEntityKindSchema])
			.optional(),
		entityId: z.string().optional(),
		source: z.string().optional(),
		confidence: z.number().optional(),
		reason: z.string().optional(),
		causalConfidence: z.string().optional(),
		relationshipCertainty: RelationshipCertaintySchema.optional(),
		causalProofTier: CausalProofTierSchema.optional(),
	})
	.passthrough();

export const ConnectedSectionContractSchema: z.ZodType<ConnectedSectionContract> =
	z
		.object({
			label: z.string(),
			links: z.array(ConnectedLinkContractSchema),
			emptyReason: z.string().optional(),
		})
		.passthrough();

export const ConnectedManifestContractSchema: z.ZodType<ConnectedManifestContract> =
	z
		.object({
			entity: z
				.object({
					kind: ConnectedEntityKindSchema,
					id: z.string(),
					projectId: z.string(),
				})
				.passthrough(),
			up: z.array(ConnectedSectionContractSchema),
			across: z.array(ConnectedSectionContractSchema),
			down: z.array(ConnectedSectionContractSchema),
			related: z.array(ConnectedSectionContractSchema),
			rawManifest: z.unknown().optional(),
		})
		.passthrough();

// ---------------------------------------------------------------------------
// Eval Cases, Eval Runs, and AI Call Route Schemas (grounded in
// eval-cases-routes.ts and ai-receiver.ts)
// ---------------------------------------------------------------------------

export const EvalCaseSourceTypeSchema = z.enum([
	"agent_run",
	"action",
	"ai_call",
	"tool_call",
	"trace",
]);

export type EvalCaseSourceTypeContract = z.infer<
	typeof EvalCaseSourceTypeSchema
>;

export interface EvalCaseContract {
	id: string;
	projectId: string;
	sourceEntityType: EvalCaseSourceTypeContract;
	sourceEntityId: string;
	name: string;
	expectedOutcome: string | null;
	rubric: JsonValue | null;
	redactedPrompt: JsonValue | null;
	referencePayload: JsonValue | null;
	metadata: Record<string, JsonValue>;
	sourceAgentRunId: string | null;
	sourceActionId: string | null;
	sourceAiCallId: string | null;
	sourceToolCallId: string | null;
	sourceTraceId: string | null;
	sourceSpanId: string | null;
	createdAt: string;
	updatedAt: string;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export const EvalCaseContractSchema: z.ZodType<EvalCaseContract> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		sourceEntityType: EvalCaseSourceTypeSchema,
		sourceEntityId: z.string(),
		name: z.string(),
		expectedOutcome: z.string().nullable(),
		rubric: JsonValueSchema.nullable(),
		redactedPrompt: JsonValueSchema.nullable(),
		referencePayload: JsonValueSchema.nullable(),
		metadata: z.record(JsonValueSchema),
		sourceAgentRunId: z.string().nullable(),
		sourceActionId: z.string().nullable(),
		sourceAiCallId: z.string().nullable(),
		sourceToolCallId: z.string().nullable(),
		sourceTraceId: z.string().nullable(),
		sourceSpanId: z.string().nullable(),
		createdAt: z.string(),
		updatedAt: z.string(),
		evidenceReferences: z.array(EvidenceReferenceSchema).optional(),
		evidenceContract: z.record(z.unknown()).optional(),
	})
	.passthrough() as unknown as z.ZodType<EvalCaseContract>;

export interface EvalCaseCreateContractInput {
	sourceEntityType?: EvalCaseSourceTypeContract;
	sourceEntityId?: string;
	source?: {
		type?: EvalCaseSourceTypeContract;
		id?: string;
		agentRunId?: string | null;
		actionId?: string | null;
		aiCallId?: string | null;
		toolCallId?: string | null;
		traceId?: string | null;
		spanId?: string | null;
	};
	name: string;
	expectedOutcome?: string | null;
	rubric?: JsonValue | null;
	redactedPrompt?: JsonValue | null;
	referencePayload?: JsonValue | null;
	metadata?: Record<string, JsonValue>;
}

export const EvalCaseCreateContractInputSchema: z.ZodType<EvalCaseCreateContractInput> =
	z
		.object({
			sourceEntityType: EvalCaseSourceTypeSchema.optional(),
			sourceEntityId: z.string().optional(),
			source: z
				.object({
					type: EvalCaseSourceTypeSchema.optional(),
					id: z.string().optional(),
					agentRunId: z.string().nullable().optional(),
					actionId: z.string().nullable().optional(),
					aiCallId: z.string().nullable().optional(),
					toolCallId: z.string().nullable().optional(),
					traceId: z.string().nullable().optional(),
					spanId: z.string().nullable().optional(),
				})
				.passthrough()
				.optional(),
			name: z.string().min(1),
			expectedOutcome: z.string().nullable().optional(),
			rubric: JsonValueSchema.nullable().optional(),
			redactedPrompt: JsonValueSchema.nullable().optional(),
			referencePayload: JsonValueSchema.nullable().optional(),
			metadata: z.record(JsonValueSchema).optional(),
		})
		.passthrough();

export const EvalRunStatusSchema: z.ZodType<EvalRunStatus> = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"canceled",
]);

export const EvalRunCandidateSchema: z.ZodType<EvalRunCandidate> = z
	.object({
		agentId: z.string().nullable(),
		agentVersion: z.string().nullable(),
		promptId: z.string().nullable(),
		promptVersion: z.string().nullable(),
		modelProvider: z.string().nullable(),
		model: z.string().nullable(),
		modelVersion: z.string().nullable(),
	})
	.passthrough();

export const EvalRunSourceCaseSchema: z.ZodType<EvalRunSourceCase> = z
	.object({
		id: z.string(),
		name: z.string(),
		sourceEntityType: z.string(),
		sourceEntityId: z.string(),
		sourceAgentRunId: z.string().nullable(),
		sourceActionId: z.string().nullable(),
		sourceAiCallId: z.string().nullable(),
		sourceToolCallId: z.string().nullable(),
		sourceTraceId: z.string().nullable(),
		sourceSpanId: z.string().nullable(),
		evidenceReferences: z.array(EvidenceReferenceSchema).optional(),
		evidenceContract: z.record(z.unknown()).optional(),
	})
	.passthrough() as unknown as z.ZodType<EvalRunSourceCase>;

export const EvalRunContractSchema: z.ZodType<EvalRun> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		environment: z.string().optional(),
		serviceVersion: z.string().nullable().optional(),
		commitSha: z.string().nullable().optional(),
		configDigest: z.string().nullable().optional(),
		inputPayloadHash: z.string().nullable().optional(),
		failureFingerprint: z.string().nullable().optional(),
		evalCaseId: z.string().nullable(),
		status: EvalRunStatusSchema,
		candidate: EvalRunCandidateSchema,
		startedAt: z.string().nullable(),
		endedAt: z.string().nullable(),
		totalCount: z.number(),
		passCount: z.number(),
		failCount: z.number(),
		averageScore: z.number().nullable(),
		metadata: z.record(JsonValueSchema),
		createdAt: z.string(),
		sourceEvalCase: EvalRunSourceCaseSchema.nullable().optional(),
		evidenceReferences: z.array(EvidenceReferenceSchema).optional(),
		evidenceContract: z.record(z.unknown()).optional(),
	})
	.passthrough() as unknown as z.ZodType<EvalRun>;

export interface EvalRunCreateContractInput extends EvalRunInput {
	runId?: string;
	inputPayloadHash?: string | null;
	failureFingerprint?: string | null;
}

export const EvalRunCreateContractInputSchema: z.ZodType<EvalRunCreateContractInput> =
	z
		.object({
			id: z.string().optional(),
			runId: z.string().optional(),
			environment: z.string().optional(),
			serviceVersion: z.string().nullable().optional(),
			commitSha: z.string().nullable().optional(),
			configDigest: z.string().nullable().optional(),
			inputPayloadHash: z.string().nullable().optional(),
			failureFingerprint: z.string().nullable().optional(),
			evalCaseId: z.string().nullable().optional(),
			status: EvalRunStatusSchema.optional(),
			candidate: z.record(z.unknown()).optional(),
			startedAt: z.string().nullable().optional(),
			endedAt: z.string().nullable().optional(),
			totalCount: z.number().optional(),
			passCount: z.number().optional(),
			failCount: z.number().optional(),
			averageScore: z.number().nullable().optional(),
			metadata: z.record(JsonValueSchema).optional(),
		})
		.passthrough() as unknown as z.ZodType<EvalRunCreateContractInput>;

export interface EvalCaseResultContract {
	id: string;
	projectId: string;
	evalCaseId: string;
	runId: string;
	passed: boolean;
	score: number | null;
	actualOutcome: string | null;
	inputPayloadHash: string | null;
	failureFingerprint: string | null;
	details: unknown;
	createdAt: string;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export const EvalCaseResultContractSchema: z.ZodType<EvalCaseResultContract> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		evalCaseId: z.string(),
		runId: z.string(),
		passed: z.boolean(),
		score: z.number().nullable(),
		actualOutcome: z.string().nullable(),
		inputPayloadHash: z.string().nullable(),
		failureFingerprint: z.string().nullable(),
		details: z.unknown(),
		createdAt: z.string(),
		evidenceReferences: z.array(EvidenceReferenceSchema).optional(),
		evidenceContract: z.record(z.unknown()).optional(),
	})
	.passthrough() as unknown as z.ZodType<EvalCaseResultContract>;

export const AICallTypeSchema: z.ZodType<AICallType> = z.enum([
	"text_completion",
	"chat",
	"prompt_to_image",
	"embedding",
]);

export const AICallRecordSchema: z.ZodType<AICallRecord> = z
	.object({
		projectId: z.string(),
		callId: z.string(),
		traceId: z.string().nullable(),
		spanId: z.string().nullable(),
		serviceName: z.string().nullable(),
		modelName: z.string(),
		provider: z.string(),
		callType: AICallTypeSchema,
		requestJson: z.string().nullable(),
		responseJson: z.string().nullable(),
		promptTokens: z.number().nullable(),
		completionTokens: z.number().nullable(),
		totalCostUsd: z.number().nullable(),
		latencyMs: z.number().nullable(),
		isError: z.boolean(),
		errorMessage: z.string().nullable(),
		occurredAt: z.string(),
		receivedAt: z.string(),
		expiresAt: z.string().optional(),
		sessionId: z.string().nullable().optional(),
		interactionId: z.string().nullable().optional(),
	})
	.passthrough() as unknown as z.ZodType<AICallRecord>;

export interface AICallDetailResponse {
	call: AICallRecord;
	traceId: string | null;
	spanId: string | null;
}

export const AICallDetailResponseSchema: z.ZodType<AICallDetailResponse> = z
	.object({
		call: AICallRecordSchema,
		traceId: z.string().nullable(),
		spanId: z.string().nullable(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Projects & API Keys Schemas (used by CLI & control plane)
// ---------------------------------------------------------------------------

export interface ProjectSummary {
	id: string;
	name: string;
	slug: string;
	createdAt: string;
	payloadCaptureEnabled?: boolean;
}

export const ProjectSummarySchema: z.ZodType<ProjectSummary> = z
	.object({
		id: z.string(),
		name: z.string(),
		slug: z.string(),
		createdAt: z.string(),
		payloadCaptureEnabled: z.boolean().optional(),
	})
	.passthrough();

export interface ApiKeySummary {
	id: string;
	projectId: string;
	name: string;
	keyPrefix: string;
	createdAt: string;
	revokedAt: string | null;
}

export const ApiKeySummarySchema: z.ZodType<ApiKeySummary> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		name: z.string(),
		keyPrefix: z.string(),
		createdAt: z.string(),
		revokedAt: z.string().nullable(),
	})
	.passthrough();

export interface MintedApiKey extends ApiKeySummary {
	key: string;
	warning?: string;
}

export const MintedApiKeySchema: z.ZodType<MintedApiKey> = z
	.object({
		id: z.string(),
		projectId: z.string(),
		name: z.string(),
		keyPrefix: z.string(),
		createdAt: z.string(),
		revokedAt: z.string().nullable(),
		key: z.string(),
		warning: z.string().optional(),
	})
	.passthrough();

export const OntologyNodeSchema: z.ZodType<OntologyNode> = z
	.object({
		projectId: z.string(),
		environment: z.string(),
		id: z.string(),
		kind: OntologyNodeKindSchema,
		name: z.string(),
		namespaceOrEndpoint: z.string(),
		isScopedIdentity: z.boolean(),
		currentVersion: z.string().nullable(),
		currentCommitSha: z.string().nullable(),
		currentConfigDigest: z.string().nullable(),
		attributes: z.record(JsonValueSchema),
		firstSeenAt: z.string(),
		lastSeenAt: z.string(),
		sccId: z.string().optional(),
		inCycle: z.boolean().optional(),
		isBlackoutSuspected: z.boolean().optional(),
	})
	.passthrough();

export const OntologyEdgeSchema: z.ZodType<OntologyEdge> = z
	.object({
		projectId: z.string(),
		environment: z.string(),
		id: z.string(),
		sourceNodeId: z.string(),
		predicate: z.string(),
		targetNodeId: z.string(),
		relationshipCertainty: RelationshipCertaintySchema,
		callCount: z.number(),
		errorCount: z.number(),
		lastDurationMs: z.number().nullable(),
		firstSeenAt: z.string(),
		lastSeenAt: z.string(),
	})
	.passthrough();

export const OntologyGraphEndpointResponseSchema = z
	.object({
		environment: z.string(),
		nodes: z.array(OntologyNodeSchema),
		edges: z.array(OntologyEdgeSchema),
		stronglyConnectedComponents: z.array(
			z
				.object({
					sccId: z.string(),
					nodeIds: z.array(z.string()),
					isCyclic: z.boolean(),
				})
				.passthrough(),
		),
		faultLocus: z.unknown().nullable().optional(),
	})
	.passthrough();

// ---------------------------------------------------------------------------
// Endpoint Contract Map
// ---------------------------------------------------------------------------

export const InternalEndpointContracts = {
	"GET /internal/ontology": {
		query: z
			.object({
				environment: z.string().optional(),
				traceId: z.string().optional(),
			})
			.passthrough(),
		response: OntologyGraphEndpointResponseSchema,
	},
	"GET /internal/incidents": {
		query: z
			.object({
				environment: z.string().optional(),
				status: z.union([IncidentStatusSchema, z.string()]).optional(),
				targetNodeId: z.string().optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				incidents: z.array(IncidentInvestigationSchema),
			})
			.passthrough(),
	},
	"GET /internal/incidents/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				incident: IncidentInvestigationSchema,
				findings: z.array(InvestigationFindingSchema),
				proposals: z.array(RemediationProposalSchema),
			})
			.passthrough(),
	},
	"POST /internal/incidents": {
		body: OpenIncidentInputSchema,
		response: z
			.object({
				incident: IncidentInvestigationSchema,
				deduplicated: z.boolean(),
			})
			.passthrough(),
	},
	"POST /internal/incidents/open": {
		body: OpenIncidentInputSchema,
		response: z
			.object({
				incident: IncidentInvestigationSchema,
				deduplicated: z.boolean(),
			})
			.passthrough(),
	},
	"POST /internal/incidents/:id/lease": {
		params: z.object({ id: z.string().min(1) }),
		body: LeaseIncidentInputSchema,
		response: z
			.object({
				acquired: z.boolean(),
				incident: IncidentInvestigationSchema.nullable().optional(),
				reason: z.string().optional(),
				conflictOwnerId: z.string().nullable().optional(),
				leaseExpiresAt: z.string().nullable().optional(),
			})
			.passthrough(),
	},
	"POST /internal/incidents/:id/dispatch": {
		params: z.object({ id: z.string().min(1) }),
		body: DispatchIncidentInputSchema.optional(),
		response: z
			.object({
				delivered: z.boolean(),
				dispatched: z.boolean().optional(),
				status: z.number().optional(),
				error: z.string().optional(),
				attempts: z.number(),
			})
			.passthrough(),
	},
	"POST /v1/changes": {
		body: ChangeEventHttpInputSchema,
		response: z
			.object({
				...ChangeEventFields,
				changeEvent: ChangeEventSchema.optional(),
				change: ChangeEventSchema,
			})
			.passthrough(),
	},
	"GET /internal/changes": {
		query: z
			.object({
				environment: z.string().optional(),
				serviceName: z.string().optional(),
				service: z.string().optional(),
				targetNodeId: z.string().optional(),
				kind: z.string().optional(),
				since: z.string().optional(),
				until: z.string().optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				changes: z.array(ChangeEventSchema),
			})
			.passthrough(),
	},
	"GET /internal/changes/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				changeEvent: ChangeEventSchema.optional(),
				change: ChangeEventSchema,
			})
			.passthrough(),
	},
	"GET /internal/changes/:id/blast-radius": {
		params: z.object({ id: z.string().min(1) }),
		query: z
			.object({
				environment: z.string().optional(),
				minSample: z.union([z.number(), z.string()]).optional(),
				minComparableSample: z.union([z.number(), z.string()]).optional(),
				windowMinutes: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				...ChangeBlastRadiusFields,
				blastRadius: ChangeBlastRadiusResultSchema,
			})
			.passthrough(),
	},
	"GET /internal/findings": {
		query: z
			.object({
				environment: z.string().optional(),
				fingerprint: z.string().optional(),
				incidentId: z.string().optional(),
				symptomEntityId: z.string().optional(),
				rootCauseEntityId: z.string().optional(),
				faultLocusEntityId: z.string().optional(),
				originatingNodeId: z.string().optional(),
				targetNodeId: z.string().optional(),
				serviceName: z.string().optional(),
				causalVerificationStatus: z
					.union([CausalVerificationStatusSchema, z.string()])
					.optional(),
				recoveryStatus: z.union([RecoveryStatusSchema, z.string()]).optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				findings: z.array(InvestigationFindingSchema),
			})
			.passthrough(),
	},
	"GET /internal/findings/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				finding: InvestigationFindingSchema,
			})
			.passthrough(),
	},
	"POST /internal/findings": {
		body: InvestigationFindingHttpInputSchema,
		response: z
			.object({
				...InvestigationFindingFields,
				finding: InvestigationFindingSchema,
			})
			.passthrough(),
	},
	"POST /internal/findings/:id/counterfactual": {
		params: z.object({ id: z.string().min(1) }),
		body: CounterfactualVerificationInputSchema,
		response: z
			.object({
				verified: z.boolean(),
				finding: InvestigationFindingSchema,
				proof: PairedCounterfactualProofSchema.nullable().optional(),
			})
			.passthrough(),
	},
	"GET /internal/remediations": {
		query: z
			.object({
				environment: z.string().optional(),
				incidentId: z.string().optional(),
				findingId: z.string().optional(),
				status: z
					.union([RemediationProposalStatusSchema, z.string()])
					.optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				proposals: z.array(RemediationProposalSchema),
			})
			.passthrough(),
	},
	"GET /internal/remediations/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				proposal: RemediationProposalSchema,
			})
			.passthrough(),
	},
	"POST /internal/remediations/propose": {
		body: RemediationProposalHttpInputSchema,
		response: ProposeRemediationResponseSchema,
	},
	"POST /internal/remediations/:id/approve": {
		params: z.object({ id: z.string().min(1) }),
		body: ApproveRemediationInputSchema.optional(),
		response: ApproveRemediationResponseSchema,
	},
	"POST /internal/remediations/:id/reject": {
		params: z.object({ id: z.string().min(1) }),
		body: RejectRemediationInputSchema.optional(),
		response: RemediationMutationResponseSchema,
	},
	"POST /internal/remediations/:id/claim": {
		params: z.object({ id: z.string().min(1) }),
		body: ClaimRemediationInputSchema,
		response: RemediationMutationResponseSchema,
	},
	"POST /internal/remediations/:id/complete": {
		params: z.object({ id: z.string().min(1) }),
		body: CompleteRemediationInputSchema,
		response: RemediationMutationResponseSchema,
	},
	"POST /internal/remediations/:id/fail": {
		params: z.object({ id: z.string().min(1) }),
		body: FailRemediationInputSchema,
		response: RemediationMutationResponseSchema,
	},
	"POST /internal/remediations/watchdog": {
		body: WatchdogTickInputSchema.optional(),
		response: z
			.object({
				...WatchdogEvaluationSummaryFields,
				summary: WatchdogEvaluationSummarySchema,
			})
			.passthrough(),
	},
	"POST /internal/evidence/bundle": {
		body: EvidenceBundleRequestInputSchema,
		response: EvidenceBundleResponseSchema,
	},
	"GET /internal/evidence/stats": {
		query: z
			.object({
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: EvidenceMaterializationStatsResponseSchema,
	},
	"GET /internal/evidence/refs/:refId": {
		params: z.object({ refId: z.string().min(1) }),
		query: z
			.object({
				limit: z.union([z.number(), z.string()]).optional(),
				severity: z.string().optional(),
				search: z.string().optional(),
				chunkOffset: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: EvidenceRefRetrieveResponseSchema,
	},
	"POST /internal/evidence/refs/:refId/search": {
		params: z.object({ refId: z.string().min(1) }),
		body: z
			.object({
				query: z.string().min(1),
				limit: z.number().optional(),
			})
			.passthrough(),
		response: EvidenceRefSearchResponseSchema,
	},
	"GET /internal/connected/:kind/:id": {
		params: z.object({
			kind: ConnectedEntityKindSchema,
			id: z.string().min(1),
		}),
		query: z
			.object({
				spanId: z.string().optional(),
				traceId: z.string().optional(),
				sessionId: z.string().optional(),
				userId: z.string().optional(),
				service: z.string().optional(),
				hours: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: ConnectedManifestContractSchema,
	},
	"GET /internal/eval-cases": {
		query: z
			.object({
				sourceEntityType: EvalCaseSourceTypeSchema.optional(),
				sourceEntityId: z.string().optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				evalCases: z.array(EvalCaseContractSchema),
			})
			.passthrough(),
	},
	"GET /internal/eval-cases/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				evalCase: EvalCaseContractSchema,
			})
			.passthrough(),
	},
	"POST /internal/eval-cases": {
		body: EvalCaseCreateContractInputSchema,
		response: z
			.object({
				evalCase: EvalCaseContractSchema,
			})
			.passthrough(),
	},
	"GET /internal/eval-runs": {
		query: z
			.object({
				evalCaseId: z.string().optional(),
				status: z.union([EvalRunStatusSchema, z.string()]).optional(),
				limit: z.union([z.number(), z.string()]).optional(),
			})
			.passthrough(),
		response: z
			.object({
				evalRuns: z.array(EvalRunContractSchema),
			})
			.passthrough(),
	},
	"GET /internal/eval-runs/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				evalRun: EvalRunContractSchema,
				run: EvalRunContractSchema.optional(),
			})
			.passthrough(),
	},
	"GET /internal/evals/runs/:id": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				run: EvalRunLightweightSummarySchema,
			})
			.passthrough(),
	},
	"POST /internal/eval-runs": {
		body: EvalRunCreateContractInputSchema,
		response: z
			.object({
				evalRun: EvalRunContractSchema,
			})
			.passthrough(),
	},
	"POST /internal/eval-cases/:id/results": {
		params: z.object({ id: z.string().min(1) }),
		body: z
			.object({
				runId: z.string().optional(),
				passed: z.boolean(),
				score: z.number().nullable().optional(),
				actualOutcome: z.string().nullable().optional(),
				inputPayloadHash: z.string().nullable().optional(),
				failureFingerprint: z.string().nullable().optional(),
				details: z.unknown().optional(),
			})
			.passthrough(),
		response: z
			.object({
				evalCaseResult: EvalCaseResultContractSchema,
				evalRun: EvalRunContractSchema.nullable(),
			})
			.passthrough(),
	},
	"GET /internal/eval-cases/:id/results": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				evalCaseResults: z.array(EvalCaseResultContractSchema),
			})
			.passthrough(),
	},
	"GET /internal/ai/calls/:callId": {
		params: z.object({ callId: z.string().min(1) }),
		response: AICallDetailResponseSchema,
	},
	"GET /internal/projects": {
		response: z
			.object({
				projects: z.array(ProjectSummarySchema),
			})
			.passthrough(),
	},
	"GET /internal/projects/:id/keys": {
		params: z.object({ id: z.string().min(1) }),
		response: z
			.object({
				keys: z.array(ApiKeySummarySchema),
			})
			.passthrough(),
	},
	"POST /internal/projects/:id/keys": {
		params: z.object({ id: z.string().min(1) }),
		body: z.object({ name: z.string().min(1) }).passthrough(),
		response: MintedApiKeySchema,
	},
	"DELETE /internal/projects/:id/keys/:keyId": {
		params: z.object({
			id: z.string().min(1),
			keyId: z.string().min(1),
		}),
		response: z.object({ ok: z.boolean() }).passthrough(),
	},
} as const;

export type InternalEndpointKey = keyof typeof InternalEndpointContracts;

export interface InternalEndpoints {
	"GET /internal/ontology": {
		query?: {
			environment?: string;
			traceId?: string;
		};
		response: OntologyGraphResponse & {
			faultLocus?: unknown | null;
		};
	};
	"GET /internal/incidents": {
		query?: {
			environment?: string;
			status?: IncidentStatus;
			targetNodeId?: string;
			limit?: number;
		};
		response: { incidents: IncidentInvestigation[] };
	};
	"GET /internal/incidents/:id": {
		params: { id: string };
		response: {
			incident: IncidentInvestigation;
			findings: InvestigationFinding[];
			proposals: RemediationProposal[];
		};
	};
	"POST /internal/incidents": {
		body: OpenIncidentInput;
		response: { incident: IncidentInvestigation; deduplicated: boolean };
	};
	"POST /internal/incidents/open": {
		body: OpenIncidentInput;
		response: { incident: IncidentInvestigation; deduplicated: boolean };
	};
	"POST /internal/incidents/:id/lease": {
		params: { id: string };
		body: z.infer<typeof LeaseIncidentInputSchema>;
		response: {
			acquired: boolean;
			incident?: IncidentInvestigation | null;
			reason?: string;
			conflictOwnerId?: string | null;
			leaseExpiresAt?: string | null;
		};
	};
	"POST /internal/incidents/:id/dispatch": {
		params: { id: string };
		body?: z.infer<typeof DispatchIncidentInputSchema>;
		response: {
			delivered: boolean;
			dispatched?: boolean;
			status?: number;
			error?: string;
			attempts: number;
		};
	};
	"POST /v1/changes": {
		body: ChangeEventHttpInput;
		response: ChangeEvent & {
			changeEvent?: ChangeEvent;
			change: ChangeEvent;
		};
	};
	"GET /internal/changes": {
		query?: {
			environment?: string;
			serviceName?: string;
			service?: string;
			targetNodeId?: string;
			kind?: string;
			since?: string;
			until?: string;
			limit?: number;
		};
		response: { changes: ChangeEvent[] };
	};
	"GET /internal/changes/:id": {
		params: { id: string };
		response: { changeEvent?: ChangeEvent; change: ChangeEvent };
	};
	"GET /internal/changes/:id/blast-radius": {
		params: { id: string };
		query?: {
			environment?: string;
			minSample?: number;
			minComparableSample?: number;
			windowMinutes?: number;
		};
		response: ChangeBlastRadiusResult & {
			blastRadius: ChangeBlastRadiusResult;
		};
	};
	"GET /internal/findings": {
		query?: {
			environment?: string;
			fingerprint?: string;
			incidentId?: string;
			symptomEntityId?: string;
			rootCauseEntityId?: string;
			faultLocusEntityId?: string;
			originatingNodeId?: string;
			targetNodeId?: string;
			serviceName?: string;
			causalVerificationStatus?: CausalVerificationStatus;
			recoveryStatus?: RecoveryStatus;
			limit?: number;
		};
		response: { findings: InvestigationFinding[] };
	};
	"GET /internal/findings/:id": {
		params: { id: string };
		response: { finding: InvestigationFinding };
	};
	"POST /internal/findings": {
		body: InvestigationFindingHttpInput;
		response: InvestigationFinding & { finding: InvestigationFinding };
	};
	"POST /internal/findings/:id/counterfactual": {
		params: { id: string };
		body: {
			environment?: string;
			evalCaseId: string;
			failingRunId: string;
			passingRunIds?: string[];
			requiredTrials?: number;
		};
		response: {
			verified: boolean;
			finding: InvestigationFinding;
			proof?: PairedCounterfactualProof | null;
		};
	};
	"GET /internal/remediations": {
		query?: {
			environment?: string;
			incidentId?: string;
			findingId?: string;
			status?: RemediationProposalStatus;
			limit?: number;
		};
		response: { proposals: RemediationProposal[] };
	};
	"GET /internal/remediations/:id": {
		params: { id: string };
		response: { proposal: RemediationProposal };
	};
	"POST /internal/remediations/propose": {
		body: RemediationProposalHttpInput;
		response: ProposeRemediationResponse;
	};
	"POST /internal/remediations/:id/approve": {
		params: { id: string };
		body?: { environment?: string; webhookUrl?: string; secret?: string };
		response: ApproveRemediationResponse;
	};
	"POST /internal/remediations/:id/reject": {
		params: { id: string };
		body?: { environment?: string; reason?: string };
		response: RemediationProposal & { proposal: RemediationProposal };
	};
	"POST /internal/remediations/:id/claim": {
		params: { id: string };
		body: {
			environment?: string;
			grantToken: string;
			runnerId?: string;
			leaseSeconds?: number;
		};
		response: RemediationProposal & {
			proposal: RemediationProposal;
			claimed?: boolean;
		};
	};
	"POST /internal/remediations/:id/complete": {
		params: { id: string };
		body: {
			environment?: string;
			runnerId?: string;
			resultingChangeId?: string | null;
			remediationAgentRunId?: string | null;
		};
		response: RemediationProposal & { proposal: RemediationProposal };
	};
	"POST /internal/remediations/:id/fail": {
		params: { id: string };
		body: {
			environment?: string;
			runnerId?: string;
			failureReason?: string;
			reason?: string;
			remediationAgentRunId?: string;
		};
		response: RemediationProposal & { proposal: RemediationProposal };
	};
	"POST /internal/remediations/watchdog": {
		body?: { minComparableRequests?: number; nowMs?: number };
		response: WatchdogEvaluationSummaryContract & {
			summary: WatchdogEvaluationSummaryContract;
		};
	};
	"POST /internal/evidence/bundle": {
		body: EvidenceBundleRequestInput;
		response: EvidenceBundle;
	};
	"GET /internal/evidence/stats": {
		query?: { limit?: number };
		response: EvidenceMaterializationStatsResponse;
	};
	"GET /internal/evidence/refs/:refId": {
		params: { refId: string };
		query?: {
			limit?: number;
			severity?: string;
			search?: string;
			chunkOffset?: number;
		};
		response: EvidenceRefRetrieveResponse;
	};
	"POST /internal/evidence/refs/:refId/search": {
		params: { refId: string };
		body: { query: string; limit?: number };
		response: EvidenceRefSearchResponse;
	};
	"GET /internal/connected/:kind/:id": {
		params: { kind: ConnectedEntityKind; id: string };
		query?: {
			spanId?: string;
			traceId?: string;
			sessionId?: string;
			userId?: string;
			service?: string;
			hours?: number;
		};
		response: ConnectedManifestContract;
	};
	"GET /internal/eval-cases": {
		query?: {
			sourceEntityType?: EvalCaseSourceTypeContract;
			sourceEntityId?: string;
			limit?: number;
		};
		response: { evalCases: EvalCaseContract[] };
	};
	"GET /internal/eval-cases/:id": {
		params: { id: string };
		response: { evalCase: EvalCaseContract };
	};
	"POST /internal/eval-cases": {
		body: EvalCaseCreateContractInput;
		response: { evalCase: EvalCaseContract };
	};
	"GET /internal/eval-runs": {
		query?: {
			evalCaseId?: string;
			status?: EvalRunStatus;
			limit?: number;
		};
		response: { evalRuns: EvalRun[] };
	};
	"GET /internal/eval-runs/:id": {
		params: { id: string };
		response: { evalRun: EvalRun; run?: EvalRun };
	};
	"GET /internal/evals/runs/:id": {
		params: { id: string };
		response: { run: EvalRunLightweightSummary };
	};
	"POST /internal/eval-runs": {
		body: EvalRunCreateContractInput;
		response: { evalRun: EvalRun };
	};
	"POST /internal/eval-cases/:id/results": {
		params: { id: string };
		body: {
			runId?: string;
			passed: boolean;
			score?: number | null;
			actualOutcome?: string | null;
			inputPayloadHash?: string | null;
			failureFingerprint?: string | null;
			details?: unknown;
		};
		response: {
			evalCaseResult: EvalCaseResultContract;
			evalRun: EvalRun | null;
		};
	};
	"GET /internal/eval-cases/:id/results": {
		params: { id: string };
		response: { evalCaseResults: EvalCaseResultContract[] };
	};
	"GET /internal/ai/calls/:callId": {
		params: { callId: string };
		response: AICallDetailResponse;
	};
	"GET /internal/projects": {
		response: { projects: ProjectSummary[] };
	};
	"GET /internal/projects/:id/keys": {
		params: { id: string };
		response: { keys: ApiKeySummary[] };
	};
	"POST /internal/projects/:id/keys": {
		params: { id: string };
		body: { name: string };
		response: MintedApiKey;
	};
	"DELETE /internal/projects/:id/keys/:keyId": {
		params: { id: string; keyId: string };
		response: { ok: boolean };
	};
}

// ---------------------------------------------------------------------------
// Validation Helpers & Shared Typed Internal Client
// ---------------------------------------------------------------------------

export function validateContractResponse<K extends InternalEndpointKey>(
	endpoint: K,
	rawBody: unknown,
	status = 200,
): InternalEndpoints[K]["response"] {
	const contract = InternalEndpointContracts[endpoint];
	const parsed = contract.response.safeParse(rawBody);
	if (!parsed.success) {
		throw new ContractMismatchError({
			endpoint,
			status,
			issues: parsed.error.issues,
			rawBody,
		});
	}
	return parsed.data as InternalEndpoints[K]["response"];
}

export interface InternalRequestBaseOptions {
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

type EndpointParamsPart<S> = S extends { params: infer P }
	? { params: P }
	: { params?: undefined };

type EndpointQueryPart<S> = S extends { query?: infer Q }
	? { query?: Q }
	: { query?: undefined };

type EndpointBodyPart<S> = S extends { body: infer B }
	? undefined extends B
		? { body?: Exclude<B, undefined> }
		: { body: B }
	: S extends { body?: infer B }
		? [B] extends [undefined]
			? { body?: undefined }
			: { body?: Exclude<B, undefined> }
		: { body?: undefined };

export type InternalRequestOptions<K extends InternalEndpointKey> =
	InternalRequestBaseOptions &
		EndpointParamsPart<InternalEndpoints[K]> &
		EndpointQueryPart<InternalEndpoints[K]> &
		EndpointBodyPart<InternalEndpoints[K]>;

type RequiresRequestOptions<K extends InternalEndpointKey> =
	InternalEndpoints[K] extends { params: unknown }
		? true
		: InternalEndpoints[K] extends { body: infer B }
			? undefined extends B
				? false
				: true
			: false;

export type InternalRequestArgs<K extends InternalEndpointKey> =
	RequiresRequestOptions<K> extends true
		? [options: InternalRequestOptions<K>]
		: [options?: InternalRequestOptions<K>];

export type FetchLike = (
	input: string | URL | Request,
	init?: RequestInit,
) => Response | Promise<Response>;

export interface InternalClientConfig {
	baseUrl?: string;
	fetch?: FetchLike;
	fetchImpl?: FetchLike;
	headers?:
		| Record<string, string | undefined>
		| (() =>
				| Record<string, string | undefined>
				| Promise<Record<string, string | undefined>>);
	defaultHeaders?:
		| Record<string, string | undefined>
		| (() =>
				| Record<string, string | undefined>
				| Promise<Record<string, string | undefined>>);
	projectId?: string | (() => string | undefined);
	timeoutMs?: number;
}

export interface InternalClient {
	request<K extends InternalEndpointKey>(
		endpoint: K,
		...args: InternalRequestArgs<K>
	): Promise<InternalEndpoints[K]["response"]>;
}

function splitEndpointKey(endpoint: InternalEndpointKey): {
	method: string;
	pathTemplate: string;
} {
	const spaceIndex = endpoint.indexOf(" ");
	return {
		method: endpoint.slice(0, spaceIndex),
		pathTemplate: endpoint.slice(spaceIndex + 1),
	};
}

export function buildInternalEndpointPath(
	pathTemplate: string,
	params?: Record<string, string | number>,
	query?: Record<string, unknown>,
): string {
	const resolvedPath = pathTemplate.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
		const value = params?.[key];
		if (value === undefined || value === null || String(value).length === 0) {
			throw new Error(
				`Missing path parameter :${key} for endpoint ${pathTemplate}`,
			);
		}
		return encodeURIComponent(String(value));
	});

	if (!query) return resolvedPath;
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value === undefined || value === null || value === "") continue;
		search.set(key, String(value));
	}
	const qs = search.toString();
	return qs ? `${resolvedPath}?${qs}` : resolvedPath;
}

export function createInternalClient(
	configOrFetch: InternalClientConfig | FetchLike = {},
): InternalClient {
	const config: InternalClientConfig =
		typeof configOrFetch === "function"
			? { fetch: configOrFetch }
			: configOrFetch;

	const fetchImpl: FetchLike =
		config.fetch ?? config.fetchImpl ?? globalThis.fetch;
	const baseUrl = (config.baseUrl ?? "http://localhost").replace(/\/+$/, "");

	return {
		async request<K extends InternalEndpointKey>(
			endpoint: K,
			...args: InternalRequestArgs<K>
		): Promise<InternalEndpoints[K]["response"]> {
			const options = (args[0] ?? {}) as InternalRequestOptions<K>;
			const contract = InternalEndpointContracts[endpoint];
			const { method, pathTemplate } = splitEndpointKey(endpoint);

			if ("params" in contract && contract.params) {
				const parsedParams = contract.params.safeParse(options.params);
				if (!parsedParams.success) {
					throw new ContractMismatchError({
						endpoint,
						status: 0,
						issues: parsedParams.error.issues,
						rawBody: options.params,
					});
				}
			}

			const relativePath = buildInternalEndpointPath(
				pathTemplate,
				options.params as Record<string, string | number> | undefined,
				options.query as Record<string, unknown> | undefined,
			);
			const url = `${baseUrl}${relativePath}`;

			const resolvedHeaders: Record<string, string> = {
				Accept: "application/json",
			};

			const configHeaders = config.headers ?? config.defaultHeaders;
			if (configHeaders) {
				const hdrs =
					typeof configHeaders === "function"
						? await configHeaders()
						: configHeaders;
				for (const [k, v] of Object.entries(hdrs)) {
					if (v !== undefined) resolvedHeaders[k] = v;
				}
			}

			const projectId =
				typeof config.projectId === "function"
					? config.projectId()
					: config.projectId;
			if (projectId && !resolvedHeaders["X-Project-Id"]) {
				resolvedHeaders["X-Project-Id"] = projectId;
			}

			if (options.headers) {
				for (const [k, v] of Object.entries(options.headers)) {
					if (v !== undefined) resolvedHeaders[k] = v;
				}
			}

			const hasBody = options.body !== undefined;
			if (hasBody && !resolvedHeaders["Content-Type"]) {
				resolvedHeaders["Content-Type"] = "application/json";
			}

			const timeoutMs = options.timeoutMs ?? config.timeoutMs;
			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			let signal: AbortSignal | undefined = options.signal;

			if (timeoutMs !== undefined && timeoutMs > 0) {
				const controller = new AbortController();
				if (options.signal) {
					if (options.signal.aborted) {
						controller.abort(options.signal.reason);
					} else {
						options.signal.addEventListener(
							"abort",
							() => controller.abort(options.signal?.reason),
							{ once: true },
						);
					}
				}
				timeoutId = setTimeout(() => controller.abort(), timeoutMs);
				signal = controller.signal;
			}

			let response: Response;
			try {
				response = await fetchImpl(url, {
					method,
					headers: resolvedHeaders,
					body: hasBody ? JSON.stringify(options.body) : undefined,
					signal,
				});
			} finally {
				if (timeoutId !== undefined) clearTimeout(timeoutId);
			}

			const rawText = await response.text();
			let parsedJson: unknown = null;
			if (rawText.length > 0) {
				try {
					parsedJson = JSON.parse(rawText);
				} catch {
					parsedJson = rawText;
				}
			}

			if (!response.ok) {
				throw new InternalClientHttpError({
					endpoint,
					status: response.status,
					statusText: response.statusText,
					rawBody: parsedJson,
				});
			}

			return validateContractResponse(endpoint, parsedJson, response.status);
		},
	};
}

export { EVIDENCE_BUNDLE_SCHEMA_VERSION };
