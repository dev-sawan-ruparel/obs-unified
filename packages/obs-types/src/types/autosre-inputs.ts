import { z } from "zod";
import { AgentAutonomyLevel } from "../constants";
import {
	CausalProofTierSchema,
	type ChangeEventInput,
	ChangeEventKindSchema,
	ChangeEventSourceSchema,
	CohortAttributionVerdictSchema,
	EvidencePredicateSchema,
	type InvestigationFindingInput,
	RelationshipCertaintySchema,
	RemediationActionKindSchema,
	type RemediationProposalInput,
} from "./autosre";
import { EvidenceEntityKindSchema } from "./evidence";
import type { JsonValue } from "./primitives";

// Kept in its own module (not autosre.ts) because evidence.ts imports value
// schemas from autosre.ts; importing EvidenceEntityKindSchema back into
// autosre.ts would create a circular value import.

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

export const ChangeEventInputSchema = z.object({
	id: z.string().optional(),
	environment: z.string().optional(),
	kind: ChangeEventKindSchema,
	source: ChangeEventSourceSchema.optional(),
	relationshipCertainty: RelationshipCertaintySchema.optional(),
	targetNodeId: z.string().optional(),
	serviceName: z.string().optional(),
	namespace: z.string().optional(),
	summary: z.string(),
	version: z.string().nullable().optional(),
	previousVersion: z.string().nullable().optional(),
	commitSha: z.string().nullable().optional(),
	previousCommitSha: z.string().nullable().optional(),
	configDigest: z.string().nullable().optional(),
	repositoryUrl: z.string().nullable().optional(),
	pullRequestUrl: z.string().nullable().optional(),
	actorId: z.string().nullable().optional(),
	causedByActionId: z.string().nullable().optional(),
	agentRunId: z.string().nullable().optional(),
	touchedPaths: z.array(z.string()).optional(),
	attributes: z.record(JsonValueSchema).optional(),
	occurredAt: z.string().optional(),
});

const CausalTripleSchema = z.object({
	subjectKind: EvidenceEntityKindSchema,
	subjectId: z.string(),
	predicate: EvidencePredicateSchema,
	objectKind: EvidenceEntityKindSchema,
	objectId: z.string(),
	relationshipCertainty: RelationshipCertaintySchema,
	causalProofTier: CausalProofTierSchema,
	confidence: z.number(),
	reason: z.string(),
});

export const InvestigationFindingInputSchema = z.object({
	id: z.string().optional(),
	idempotencyKey: z.string().optional(),
	environment: z.string().optional(),
	incidentId: z.string().nullable().optional(),
	fingerprintInput: z
		.object({
			environment: z.string(),
			originatingNodeId: z.string(),
			normalizedOperation: z.string(),
			errorSignature: z.string(),
			downstreamTargetNodeId: z.string().nullable().optional(),
		})
		.partial()
		.optional(),
	title: z.string(),
	summary: z.string(),
	causalProofTier: CausalProofTierSchema.optional(),
	confidence: z.number().optional(),
	confidenceBreakdown: z
		.object({
			relationshipScore: z.number(),
			cohortLiftScore: z.number(),
			temporalProximityScore: z.number(),
			counterfactualBonus: z.number(),
			priorRecurrenceBonus: z.number(),
			finalConfidence: z.number(),
		})
		.partial()
		.optional(),
	symptomEntityKind: EvidenceEntityKindSchema,
	symptomEntityId: z.string(),
	faultLocusEntityKind: EvidenceEntityKindSchema,
	faultLocusEntityId: z.string(),
	rootCauseEntityKind: EvidenceEntityKindSchema.nullable().optional(),
	rootCauseEntityId: z.string().nullable().optional(),
	contributingChangeId: z.string().nullable().optional(),
	cohortVerdict: CohortAttributionVerdictSchema.nullable().optional(),
	contendingTraceId: z.string().nullable().optional(),
	causalChain: z.array(CausalTripleSchema),
	citedEvidenceIds: z.array(z.string()),
	codeReferences: z
		.array(
			z.object({
				repoName: z.string().optional(),
				relativePath: z.string().optional(),
				absolutePath: z.string().optional(),
				originalPath: z.string().optional(),
				symbolName: z.string().optional(),
				lineNumber: z.number().optional(),
				columnNumber: z.number().optional(),
			}),
		)
		.optional(),
	actorType: z.enum(["agent", "user", "system"]).optional(),
	actorId: z.string().optional(),
	agentRunId: z.string().nullable().optional(),
});

const RemediationStateSpecSchema = z.object({
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
});

export const RemediationProposalInputSchema = z.object({
	environment: z.string().optional(),
	incidentId: z.string(),
	findingId: z.string(),
	idempotencyKey: z.string(),
	actionKind: RemediationActionKindSchema,
	targetNodeId: z.string(),
	expectedCurrentState: RemediationStateSpecSchema,
	desiredTargetState: RemediationStateSpecSchema,
	requestedAutonomy: AgentAutonomyLevelSchema.optional(),
});

// Compile-time guarantee that inferred inputs stay bidirectionally assignable to the interfaces.
type AssertAssignable<_T extends U, U> = true;
export type _InputSchemaChecks = [
	AssertAssignable<z.infer<typeof ChangeEventInputSchema>, ChangeEventInput>,
	AssertAssignable<ChangeEventInput, z.infer<typeof ChangeEventInputSchema>>,
	AssertAssignable<
		Exclude<
			keyof ChangeEventInput,
			keyof z.infer<typeof ChangeEventInputSchema>
		>,
		never
	>,
	AssertAssignable<
		z.infer<typeof InvestigationFindingInputSchema>,
		InvestigationFindingInput
	>,
	AssertAssignable<
		InvestigationFindingInput,
		z.infer<typeof InvestigationFindingInputSchema>
	>,
	AssertAssignable<
		Exclude<
			keyof InvestigationFindingInput,
			keyof z.infer<typeof InvestigationFindingInputSchema>
		>,
		never
	>,
	AssertAssignable<
		z.infer<typeof RemediationProposalInputSchema>,
		RemediationProposalInput
	>,
	AssertAssignable<
		RemediationProposalInput,
		z.infer<typeof RemediationProposalInputSchema>
	>,
	AssertAssignable<
		Exclude<
			keyof RemediationProposalInput,
			keyof z.infer<typeof RemediationProposalInputSchema>
		>,
		never
	>,
];
