import { z } from "zod";
import type { AgentAutonomyLevel } from "../constants";
import type { EvidenceEntityKind } from "./evidence";
import type { JsonValue } from "./primitives";
import type { TelemetryCodeReference } from "./telemetry";

export const RelationshipCertaintySchema = z.enum([
	"exact",
	"inferred",
	"heuristic",
]);

export type RelationshipCertainty = z.infer<typeof RelationshipCertaintySchema>;

export const CausalProofTierSchema = z.enum([
	"counterfactual_verified",
	"cohort_rate_isolated",
	"corroborated_candidate",
	"unverified_locus",
]);

export type CausalProofTier = z.infer<typeof CausalProofTierSchema>;

export const EvidencePredicateSchema = z.enum([
	// User & Action Causality
	"triggered_by_interaction",
	"caused_by_action",
	"executed_in_agent_run",
	"mutated_external_state",
	// Execution-Tree & Cross-Trace Topology
	"originated_fault_in_span",
	"failed_due_to_child_span",
	"contended_on_shared_resource",
	"induced_shared_resource_contention",
	"blackout_on_dependency",
	"sampled_hot_frame",
	"uninstrumented_self_time_gap",
	"exemplifies_metric_spike",
	// Change & Cohort Correlation
	"degraded_after_change",
	"isolated_to_version_cohort",
	"touched_same_code_path",
	"mitigated_by_change",
	// Governance, Evals & Incident Memory
	"violated_eval",
	"verified_by_counterfactual",
	"remediated_by_agent_run",
	"matches_prior_finding",
]);

export type EvidencePredicate = z.infer<typeof EvidencePredicateSchema>;

export const OntologyNodeKindSchema = z.enum([
	"service",
	"endpoint",
	"database",
	"cache",
	"queue_topic",
	"external_api",
	"agent",
	"tool",
	"feature_flag",
	"host",
]);

export type OntologyNodeKind = z.infer<typeof OntologyNodeKindSchema>;

export const ChangeEventKindSchema = z.enum([
	"deploy",
	"rollback",
	"config_change",
	"feature_flag",
	"prompt_rollout",
	"agent_version",
	"schema_migration",
	"infra_scale",
]);

export type ChangeEventKind = z.infer<typeof ChangeEventKindSchema>;

export const ChangeEventSourceSchema = z.enum([
	"explicit_api",
	"inferred_telemetry",
	"autosre_remediation",
]);

export type ChangeEventSource = z.infer<typeof ChangeEventSourceSchema>;

export const CohortAttributionVerdictSchema = z.enum([
	"isolated_to_new_version",
	"sequential_post_cutover_regression",
	"shared_degradation_new_version_aggressor",
	"shared_degradation_external_cause",
	"no_regression_detected",
	"insufficient_sample",
]);

export type CohortAttributionVerdict = z.infer<
	typeof CohortAttributionVerdictSchema
>;

export const IncidentStatusSchema = z.enum([
	"open",
	"dispatched",
	"leased",
	"remediating",
	"verifying",
	"resolved",
	"escalated",
]);

export type IncidentStatus = z.infer<typeof IncidentStatusSchema>;

export const RecoveryStatusSchema = z.enum([
	"not_applicable",
	"monitoring",
	"recovered",
	"inconclusive_low_traffic",
	"still_degraded",
	"regression_recurred",
]);

export type RecoveryStatus = z.infer<typeof RecoveryStatusSchema>;

export const CausalVerificationStatusSchema = z.enum([
	"unverified",
	"operationally_corroborated",
	"counterfactual_verified",
	"refuted",
]);

export type CausalVerificationStatus = z.infer<
	typeof CausalVerificationStatusSchema
>;

export const RemediationActionKindSchema = z.enum([
	"open_code_pr",
	"toggle_feature_flag",
	"rollback_deploy",
	"apply_config",
	"promote_agent_prompt",
]);

export type RemediationActionKind = z.infer<typeof RemediationActionKindSchema>;

export const RemediationProposalStatusSchema = z.enum([
	"proposed",
	"pending_human_approval",
	"grant_issued",
	"claimed_executing",
	"completed",
	"failed_execution",
	"execution_timed_out",
	"rejected",
	"expired",
]);

export type RemediationProposalStatus = z.infer<
	typeof RemediationProposalStatusSchema
>;

export interface OntologyNode {
	projectId: string;
	environment: string;
	id: string;
	kind: OntologyNodeKind;
	name: string;
	namespaceOrEndpoint: string;
	isScopedIdentity: boolean;
	currentVersion: string | null;
	currentCommitSha: string | null;
	currentConfigDigest: string | null;
	attributes: Record<string, JsonValue>;
	firstSeenAt: string;
	lastSeenAt: string;
	sccId?: string;
	inCycle?: boolean;
	isBlackoutSuspected?: boolean;
}

export interface OntologyEdge {
	projectId: string;
	environment: string;
	id: string;
	sourceNodeId: string;
	predicate: string;
	targetNodeId: string;
	relationshipCertainty: RelationshipCertainty;
	callCount: number;
	errorCount: number;
	lastDurationMs: number | null;
	firstSeenAt: string;
	lastSeenAt: string;
}

export interface OntologyGraphResponse {
	environment: string;
	nodes: OntologyNode[];
	edges: OntologyEdge[];
	stronglyConnectedComponents: Array<{
		sccId: string;
		nodeIds: string[];
		isCyclic: boolean;
	}>;
}

export interface ChangeEventInput {
	id?: string;
	environment?: string;
	kind: ChangeEventKind;
	source?: ChangeEventSource;
	relationshipCertainty?: RelationshipCertainty;
	targetNodeId?: string;
	serviceName?: string;
	namespace?: string;
	summary: string;
	version?: string | null;
	previousVersion?: string | null;
	commitSha?: string | null;
	previousCommitSha?: string | null;
	configDigest?: string | null;
	repositoryUrl?: string | null;
	pullRequestUrl?: string | null;
	actorId?: string | null;
	causedByActionId?: string | null;
	agentRunId?: string | null;
	touchedPaths?: string[];
	attributes?: Record<string, JsonValue>;
	occurredAt?: string;
}

export interface ChangeEvent {
	id: string;
	projectId: string;
	environment: string;
	targetNodeId: string;
	kind: ChangeEventKind;
	source: ChangeEventSource;
	relationshipCertainty: RelationshipCertainty;
	summary: string;
	serviceName: string | null;
	version: string | null;
	previousVersion: string | null;
	commitSha: string | null;
	previousCommitSha: string | null;
	configDigest: string | null;
	repositoryUrl: string | null;
	pullRequestUrl: string | null;
	actorId: string | null;
	causedByActionId: string | null;
	agentRunId: string | null;
	touchedPaths: string[];
	attributes: Record<string, JsonValue>;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string | null;
}

export interface CohortMetricsSummary {
	cohortKey: string;
	requestCount: number;
	errorCount: number;
	errorRate: number;
	p95DurationMs: number | null;
	avgDownstreamCallsPerRequest: number;
	avgDownstreamDurationMs: number | null;
}

export interface ContentionCandidate {
	aggressorTraceId: string;
	aggressorSpanId: string;
	aggressorServiceName: string | null;
	aggressorServiceVersion: string | null;
	aggressorSpanName: string;
	sharedTargetNodeId: string;
	relationshipCertainty: RelationshipCertainty;
	concurrentCalls: number;
	maxDurationMs: number;
	totalResourceTimeMs: number;
}

export interface ChangeBlastRadiusResult {
	change: ChangeEvent;
	cohortVerdict: CohortAttributionVerdict;
	causalProofTier: CausalProofTier;
	relationshipCertainty: RelationshipCertainty;
	minComparableSample: number;
	newCohort: CohortMetricsSummary;
	oldCohort: CohortMetricsSummary;
	preChangeBaselineCohort?: CohortMetricsSummary;
	rateDifference: number;
	relativeRisk: number;
	overlappingCodePaths: string[];
	matchingErrorSpanIds: string[];
	sharedResourceAggressors: ContentionCandidate[];
	summary: string;
}

export interface CausalTriple {
	subjectKind: EvidenceEntityKind;
	subjectId: string;
	predicate: EvidencePredicate;
	objectKind: EvidenceEntityKind;
	objectId: string;
	relationshipCertainty: RelationshipCertainty;
	causalProofTier: CausalProofTier;
	confidence: number;
	reason: string;
}

export interface PairedCounterfactualProof {
	evalCaseId: string;
	inputPayloadHash: string;
	failingRunId: string;
	failingVersion: string | null;
	failingCommitSha: string | null;
	failureFingerprint: string;
	passingRunIds: string[];
	passingVersion: string | null;
	passingCommitSha: string | null;
	requiredTrials: number;
	verifiedAt: string;
}

export interface FindingFingerprintInput {
	environment: string;
	originatingNodeId: string;
	normalizedOperation: string;
	errorSignature: string;
	downstreamTargetNodeId?: string | null;
}

export interface ConfidenceBreakdown {
	relationshipScore: number;
	cohortLiftScore: number;
	temporalProximityScore: number;
	counterfactualBonus: number;
	priorRecurrenceBonus: number;
	finalConfidence: number;
}

export type InvestigationActorType = "agent" | "user" | "system";

export interface InvestigationFindingInput {
	id?: string;
	environment?: string;
	incidentId?: string | null;
	fingerprintInput?: FindingFingerprintInput;
	title: string;
	summary: string;
	causalProofTier?: CausalProofTier;
	confidence?: number;
	confidenceBreakdown?: Partial<ConfidenceBreakdown>;
	symptomEntityKind: EvidenceEntityKind;
	symptomEntityId: string;
	faultLocusEntityKind: EvidenceEntityKind;
	faultLocusEntityId: string;
	rootCauseEntityKind?: EvidenceEntityKind | null;
	rootCauseEntityId?: string | null;
	contributingChangeId?: string | null;
	cohortVerdict?: CohortAttributionVerdict | null;
	contendingTraceId?: string | null;
	causalChain: CausalTriple[];
	citedEvidenceIds: string[];
	codeReferences?: TelemetryCodeReference[];
	actorType?: InvestigationActorType;
	actorId?: string;
	agentRunId?: string | null;
}

export interface InvestigationFinding {
	id: string;
	projectId: string;
	environment: string;
	incidentId: string | null;
	fingerprint: string;
	fingerprintInput: FindingFingerprintInput;
	title: string;
	summary: string;
	causalProofTier: CausalProofTier;
	confidence: number;
	confidenceBreakdown: ConfidenceBreakdown;
	symptomEntityKind: EvidenceEntityKind;
	symptomEntityId: string;
	faultLocusEntityKind: EvidenceEntityKind;
	faultLocusEntityId: string;
	rootCauseEntityKind: EvidenceEntityKind | null;
	rootCauseEntityId: string | null;
	contributingChangeId: string | null;
	cohortVerdict: CohortAttributionVerdict | null;
	contendingTraceId: string | null;
	causalChain: CausalTriple[];
	citedEvidenceIds: string[];
	codeReferences: TelemetryCodeReference[];
	counterfactualProof: PairedCounterfactualProof | null;
	recoveryStatus: RecoveryStatus;
	causalVerificationStatus: CausalVerificationStatus;
	watchdogStep: number;
	baselineRequestRatePerMin: number | null;
	nextWatchdogCheckAt: string | null;
	actorType: string;
	actorId: string;
	agentRunId: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
}

export interface IncidentInvestigation {
	id: string;
	projectId: string;
	environment: string;
	dedupKey: string;
	status: IncidentStatus;
	targetNodeId: string;
	symptomAnchorKind: EvidenceEntityKind;
	symptomAnchorId: string;
	symptomFingerprint: string | null;
	alertCount: number;
	latestBundle: Record<string, unknown> | null;
	leaseOwnerId: string | null;
	leaseExpiresAt: string | null;
	dispatchAttempts: number;
	lastDispatchedAt: string | null;
	openedAt: string;
	updatedAt: string;
	resolvedAt: string | null;
	expiresAt: string | null;
}

export interface RemediationStateSpec {
	version?: string | null;
	commitSha?: string | null;
	configDigest?: string | null;
	flagKey?: string | null;
	flagVariant?: string | boolean | number | null;
	promptVersion?: string | null;
	branchOrPrUrl?: string | null;
}

export interface RemediationProposalInput {
	environment?: string;
	incidentId: string;
	findingId: string;
	idempotencyKey: string;
	actionKind: RemediationActionKind;
	targetNodeId: string;
	expectedCurrentState: RemediationStateSpec;
	desiredTargetState: RemediationStateSpec;
	requestedAutonomy?: AgentAutonomyLevel;
}

export interface RemediationProposal {
	id: string;
	projectId: string;
	environment: string;
	incidentId: string;
	findingId: string;
	idempotencyKey: string;
	actionKind: RemediationActionKind;
	targetNodeId: string;
	expectedCurrentState: RemediationStateSpec;
	desiredTargetState: RemediationStateSpec;
	requestedAutonomy: AgentAutonomyLevel;
	effectiveAutonomy: AgentAutonomyLevel;
	policyDecisionReason: string;
	status: RemediationProposalStatus;
	grantExpiresAt: string | null;
	approvedByUserId: string | null;
	approvedAt: string | null;
	claimedByRunnerId: string | null;
	claimedAt: string | null;
	claimExpiresAt: string | null;
	remediationAgentRunId: string | null;
	resultingChangeId: string | null;
	failureReason: string | null;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	/** Returned ONLY at grant issuance (`propose` when autonomous_write, or `approve`) */
	grantToken?: string;
}

export interface CanonicalNodeIdentityInput {
	kind: OntologyNodeKind;
	environment?: string | null;
	namespace?: string | null;
	serviceName?: string | null;
	methodOrRpc?: string | null;
	routeOrSpanName?: string | null;
	dbSystem?: string | null;
	dbName?: string | null;
	messagingSystem?: string | null;
	messagingDestination?: string | null;
	serverAddress?: string | null;
	serverPort?: string | number | null;
	agentId?: string | null;
	toolName?: string | null;
	flagKey?: string | null;
	cloudRegion?: string | null;
	hostIdOrName?: string | null;
}

export interface CanonicalNodeIdentity {
	id: string;
	environment: string;
	kind: OntologyNodeKind;
	name: string;
	namespaceOrEndpoint: string;
	isScopedIdentity: boolean;
}

const cleanRoute = (value: string | null | undefined): string => {
	const trimmed = value?.trim();
	return trimmed ? trimmed.replace(/\s+/g, "_") : "/";
};

const cleanSegment = (
	value: string | number | null | undefined,
	fallback = "default",
): string => {
	if (value === null || value === undefined) return fallback;
	const trimmed = String(value).trim();
	if (!trimmed) return fallback;
	// Percent-encode the delimiter characters so segment content can never
	// collide with the `:` / `/` separators of canonical node ids.
	return trimmed
		.replace(/\s+/g, "_")
		.replace(/%/g, "%25")
		.replace(/:/g, "%3A")
		.replace(/\//g, "%2F");
};

export const normalizeRouteSegment = (raw: string): string => {
	return raw
		.trim()
		.replace(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
			":uuid",
		)
		.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, ":ulid")
		.replace(/\/\d+(?=\/|$)/g, "/:id");
};

/**
 * Deterministic environment- and physical-endpoint-scoped canonical node identity builder
 * (RFC 0013 § 1.A). Never collides across environments or distinct DB/queue endpoints.
 */
export function buildCanonicalNodeId(
	input: CanonicalNodeIdentityInput,
): CanonicalNodeIdentity {
	const env = cleanSegment(input.environment, "default").toLowerCase();
	const ns = cleanSegment(input.namespace, "default");

	switch (input.kind) {
		case "service": {
			const name = cleanSegment(input.serviceName, "unknown-service");
			return {
				id: `service:${env}:${ns}:${name}`,
				environment: env,
				kind: "service",
				name,
				namespaceOrEndpoint: ns,
				isScopedIdentity: true,
			};
		}
		case "endpoint": {
			const svc = cleanSegment(input.serviceName, "unknown-service");
			const method = cleanSegment(input.methodOrRpc, "CALL").toUpperCase();
			// Route is the trailing id segment and legitimately contains `/` and `:`.
			const route = normalizeRouteSegment(cleanRoute(input.routeOrSpanName));
			return {
				id: `endpoint:${env}:${ns}:${svc}:${method}:${route}`,
				environment: env,
				kind: "endpoint",
				name: `${method} ${route}`,
				namespaceOrEndpoint: `${ns}:${svc}`,
				isScopedIdentity: true,
			};
		}
		case "database": {
			const system = cleanSegment(input.dbSystem, "db").toLowerCase();
			const dbName = cleanSegment(input.dbName, "default");
			const host = input.serverAddress ? cleanSegment(input.serverAddress) : "";
			const port = input.serverPort
				? cleanSegment(input.serverPort, "default")
				: "default";
			if (!host) {
				return {
					id: `database:${env}:unscoped/${system}:${dbName}`,
					environment: env,
					kind: "database",
					name: dbName,
					namespaceOrEndpoint: `unscoped/${system}`,
					isScopedIdentity: false,
				};
			}
			return {
				id: `database:${env}:${system}:${host}:${port}/${dbName}`,
				environment: env,
				kind: "database",
				name: dbName,
				namespaceOrEndpoint: `${system}:${host}:${port}`,
				isScopedIdentity: true,
			};
		}
		case "cache": {
			const system = cleanSegment(input.dbSystem, "redis").toLowerCase();
			const host = input.serverAddress ? cleanSegment(input.serverAddress) : "";
			const port = input.serverPort
				? cleanSegment(input.serverPort, "default")
				: "default";
			if (!host) {
				const name = cleanSegment(input.dbName, system);
				return {
					id: `cache:${env}:unscoped/${system}:${name}`,
					environment: env,
					kind: "cache",
					name,
					namespaceOrEndpoint: `unscoped/${system}`,
					isScopedIdentity: false,
				};
			}
			return {
				id: `cache:${env}:${system}:${host}:${port}`,
				environment: env,
				kind: "cache",
				name: `${system}:${host}:${port}`,
				namespaceOrEndpoint: `${host}:${port}`,
				isScopedIdentity: true,
			};
		}
		case "queue_topic": {
			const system = cleanSegment(input.messagingSystem, "queue").toLowerCase();
			const dest = cleanSegment(input.messagingDestination, "default");
			const host = input.serverAddress ? cleanSegment(input.serverAddress) : "";
			if (!host) {
				return {
					id: `queue:${env}:unscoped/${system}:${dest}`,
					environment: env,
					kind: "queue_topic",
					name: dest,
					namespaceOrEndpoint: `unscoped/${system}`,
					isScopedIdentity: false,
				};
			}
			return {
				id: `queue:${env}:${system}:${host}/${dest}`,
				environment: env,
				kind: "queue_topic",
				name: dest,
				namespaceOrEndpoint: `${system}:${host}`,
				isScopedIdentity: true,
			};
		}
		case "external_api": {
			const host = cleanSegment(input.serverAddress, "unknown-external");
			const port = cleanSegment(input.serverPort, "443");
			const isScoped = Boolean(input.serverAddress?.trim());
			return {
				id: `external:${env}:${host}:${port}`,
				environment: env,
				kind: "external_api",
				name: host,
				namespaceOrEndpoint: `${host}:${port}`,
				isScopedIdentity: isScoped,
			};
		}
		case "agent": {
			const agentId = cleanSegment(input.agentId, "unknown-agent");
			return {
				id: `agent:${env}:${agentId}`,
				environment: env,
				kind: "agent",
				name: agentId,
				namespaceOrEndpoint: env,
				isScopedIdentity: true,
			};
		}
		case "tool": {
			const owner = cleanSegment(input.agentId ?? input.serviceName, "default");
			const toolName = cleanSegment(input.toolName, "unknown-tool");
			return {
				id: `tool:${env}:${owner}:${toolName}`,
				environment: env,
				kind: "tool",
				name: toolName,
				namespaceOrEndpoint: owner,
				isScopedIdentity: true,
			};
		}
		case "feature_flag": {
			const flagKey = cleanSegment(input.flagKey, "unknown-flag");
			return {
				id: `flag:${env}:${flagKey}`,
				environment: env,
				kind: "feature_flag",
				name: flagKey,
				namespaceOrEndpoint: env,
				isScopedIdentity: true,
			};
		}
		case "host": {
			const region = cleanSegment(input.cloudRegion, "default");
			const host = cleanSegment(input.hostIdOrName, "unknown-host");
			return {
				id: `host:${env}:${region}:${host}`,
				environment: env,
				kind: "host",
				name: host,
				namespaceOrEndpoint: region,
				isScopedIdentity: Boolean(input.hostIdOrName?.trim()),
			};
		}
	}
}

export const normalizeErrorSignature = (raw: string): string => {
	return raw
		.trim()
		.replace(
			/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/gi,
			"<ts>",
		)
		.replace(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
			"<uuid>",
		)
		.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/g, "<ulid>")
		.replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
		.replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
		.replace(/\b\d+(?:\.\d+)?(?:ms|s|us|ns)\b/gi, "<num>")
		.replace(/\d{4,}/g, "<num>")
		.slice(0, 160);
};

/**
 * Pure synchronous deterministic 128-bit FNV-1a / Murmur-style hash for portable
 * recurrence fingerprints across Browser, Cloudflare Workers, and Node.
 */
function deterministicHexHash(canonicalInput: string): string {
	let h1 = 0xdeadbeef ^ canonicalInput.length;
	let h2 = 0x41c6ce57 ^ canonicalInput.length;
	let h3 = 0x9e3779b9 ^ canonicalInput.length;
	let h4 = 0x85ebca6b ^ canonicalInput.length;

	for (let i = 0; i < canonicalInput.length; i++) {
		const ch = canonicalInput.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
		h3 = Math.imul(h3 ^ ch, 2246822507);
		h4 = Math.imul(h4 ^ ch, 3266489909);
	}

	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	h3 =
		Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^
		Math.imul(h4 ^ (h4 >>> 13), 3266489909);
	h4 =
		Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^
		Math.imul(h3 ^ (h3 >>> 13), 3266489909);

	const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
	return `fp_${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}`;
}

/**
 * Computes a stable recurrence fingerprint from structural attributes (RFC 0013 § 3 & P2 #8).
 * Never hashes instance UUIDs (`trace_id`, `span_id`, `action_id`), ensuring recurring
 * incidents produce the exact same fingerprint.
 */
export function buildFindingFingerprint(input: FindingFingerprintInput): {
	fingerprint: string;
	normalizedInput: FindingFingerprintInput;
} {
	const normalizedInput: FindingFingerprintInput = {
		environment: cleanSegment(input.environment, "default").toLowerCase(),
		originatingNodeId: input.originatingNodeId.trim(),
		normalizedOperation: normalizeRouteSegment(
			input.normalizedOperation.trim(),
		),
		errorSignature: normalizeErrorSignature(input.errorSignature),
		downstreamTargetNodeId: input.downstreamTargetNodeId?.trim() || null,
	};

	const canonicalPayload = [
		normalizedInput.environment,
		normalizedInput.originatingNodeId,
		normalizedInput.normalizedOperation,
		normalizedInput.errorSignature,
		normalizedInput.downstreamTargetNodeId ?? "",
	].join("::");

	return {
		fingerprint: deterministicHexHash(canonicalPayload),
		normalizedInput,
	};
}
