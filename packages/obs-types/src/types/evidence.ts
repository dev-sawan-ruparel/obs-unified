import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export const EVIDENCE_REFERENCE_SCHEMA_VERSION =
	"obs-unified.evidence-reference.v1";

export const TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION =
	"obs-unified.tool-response-contract.v1";

export const EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION =
	"obs-unified.evidence-retrieval-ref.v1";

export const EVIDENCE_COMPACTION_SCHEMA_VERSION =
	"obs-unified.evidence-compaction.v1";

export const EVIDENCE_BUNDLE_SCHEMA_VERSION = "obs-unified.evidence-bundle.v1";

export const EvidenceEntityKindSchema = z.enum([
	"analysis",
	"alert",
	"agent_run",
	"action",
	"trace",
	"span",
	"tool_call",
	"ai_call",
	"eval",
	"profile",
	"replay",
	"service",
	"log",
	"docs",
]);

export type EvidenceEntityKind = z.infer<typeof EvidenceEntityKindSchema>;

export const EvidenceCitationSchema = z.object({
	label: z.string(),
	entityKind: EvidenceEntityKindSchema,
	entityId: z.string(),
	route: z.string().nullable().optional(),
});

export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;

export const EvidenceNextPivotSchema = z.object({
	label: z.string(),
	entityKind: EvidenceEntityKindSchema,
	entityId: z.string(),
	route: z.string(),
	reason: z.string().optional(),
});

export type EvidenceNextPivot = z.infer<typeof EvidenceNextPivotSchema>;

export const EvidenceAnchorSchema = z.object({
	entityKind: EvidenceEntityKindSchema,
	entityId: z.string(),
});

export type EvidenceAnchor = z.infer<typeof EvidenceAnchorSchema>;

export const EvidenceReferenceSchema = z.object({
	evidenceId: z.string(),
	entityKind: EvidenceEntityKindSchema,
	entityId: z.string(),
	route: z.string(),
	source: z.string(),
	confidence: z.number().min(0).max(1),
	reason: z.string(),
	citations: z.array(EvidenceCitationSchema),
	suggestedNextPivots: z.array(EvidenceNextPivotSchema),
});

export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;

export const EvidenceRetrievalKindSchema = z.enum([
	"logs",
	"trace",
	"span",
	"replay",
	"profile",
	"ai_call",
	"action",
	"agent_run",
	"tool_call",
	"eval",
	"analysis",
]);

export type EvidenceRetrievalKind = z.infer<typeof EvidenceRetrievalKindSchema>;

export const EvidenceCountEstimateSchema = z.object({
	recordCount: z.number().int().nonnegative().optional(),
	tokenEstimate: z.number().int().nonnegative().optional(),
	byteEstimate: z.number().int().nonnegative().optional(),
});

export type EvidenceCountEstimate = z.infer<typeof EvidenceCountEstimateSchema>;

export const EvidenceRetrievalRefSchema = z.object({
	refId: z.string(),
	kind: EvidenceRetrievalKindSchema,
	projectId: z.string().optional(),
	anchor: EvidenceAnchorSchema,
	source: z.string(),
	query: z.record(z.unknown()).optional(),
	compactedFrom: EvidenceCountEstimateSchema.optional(),
	returned: EvidenceCountEstimateSchema.optional(),
	expiresAt: z.string().optional(),
});

export type EvidenceRetrievalRef = z.infer<typeof EvidenceRetrievalRefSchema>;

export const EvidenceCompactionKindSchema = z.enum([
	"logs",
	"spans",
	"replay_events",
	"profiles",
	"ai_calls",
]);

export type EvidenceCompactionKind = z.infer<
	typeof EvidenceCompactionKindSchema
>;

export const EvidenceCompactionStrategySchema = z.enum([
	"exact_duplicate",
	"signature_cluster",
	"severity_exemplar",
	"critical_path",
	"time_window",
	"causal_path",
]);

export type EvidenceCompactionStrategy = z.infer<
	typeof EvidenceCompactionStrategySchema
>;

export const EvidenceCompactionSchema = z.object({
	compactionId: z.string(),
	kind: EvidenceCompactionKindSchema,
	strategy: EvidenceCompactionStrategySchema,
	inputCount: z.number().int().nonnegative(),
	outputCount: z.number().int().nonnegative(),
	reason: z.string(),
	exemplarEntityIds: z.array(z.string()),
	retrievalRefIds: z.array(z.string()),
});

export type EvidenceCompaction = z.infer<typeof EvidenceCompactionSchema>;

export const EvidenceBundleIntentSchema = z.enum([
	"debug_failure",
	"explain_latency",
	"explain_cost",
	"inspect_agent_run",
	"inspect_tool_call",
	"find_instrumentation_gap",
	"general",
]);

export type EvidenceBundleIntent = z.infer<typeof EvidenceBundleIntentSchema>;

export const EvidenceBundleDetailLevelSchema = z.enum([
	"brief",
	"standard",
	"deep",
]);

export type EvidenceBundleDetailLevel = z.infer<
	typeof EvidenceBundleDetailLevelSchema
>;

export const EvidenceBundleBudgetSchema = z.object({
	targetTokens: z.number().int().nonnegative().optional(),
	estimatedTokens: z.number().int().nonnegative().optional(),
	detailLevel: EvidenceBundleDetailLevelSchema,
});

export type EvidenceBundleBudget = z.infer<typeof EvidenceBundleBudgetSchema>;

export const EvidenceBundleClaimSchema = z.object({
	title: z.string(),
	reason: z.string(),
	confidence: z.number().min(0).max(1),
	evidenceIds: z.array(z.string()),
	retrievalRefIds: z.array(z.string()).optional(),
});

export type EvidenceBundleClaim = z.infer<typeof EvidenceBundleClaimSchema>;

export const EvidenceBundleSchema = z.object({
	schemaVersion: z.literal(EVIDENCE_BUNDLE_SCHEMA_VERSION),
	intent: EvidenceBundleIntentSchema,
	anchor: EvidenceAnchorSchema.optional(),
	budget: EvidenceBundleBudgetSchema.optional(),
	summary: z.string(),
	derivedSummaries: z.array(EvidenceBundleClaimSchema),
	findings: z.array(EvidenceBundleClaimSchema),
	compactions: z.array(EvidenceCompactionSchema),
	evidenceReferences: z.array(EvidenceReferenceSchema),
	retrievalRefs: z.array(EvidenceRetrievalRefSchema),
	suggestedNextPivots: z.array(EvidenceNextPivotSchema),
	dashboardUrl: z.string().optional(),
});

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

const EvidenceAnchorJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["entityKind", "entityId"],
	properties: {
		entityKind: {
			type: "string",
			enum: EvidenceEntityKindSchema.options,
		},
		entityId: { type: "string" },
	},
} as const;

const EvidenceCountEstimateJsonSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		recordCount: { type: "integer", minimum: 0 },
		tokenEstimate: { type: "integer", minimum: 0 },
		byteEstimate: { type: "integer", minimum: 0 },
	},
} as const;

const EvidenceBundleClaimJsonSchema = {
	type: "object",
	additionalProperties: false,
	required: ["title", "reason", "confidence", "evidenceIds"],
	properties: {
		title: { type: "string" },
		reason: { type: "string" },
		confidence: { type: "number", minimum: 0, maximum: 1 },
		evidenceIds: {
			type: "array",
			items: { type: "string" },
		},
		retrievalRefIds: {
			type: "array",
			items: { type: "string" },
		},
	},
} as const;

export const EvidenceReferenceJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://obs-unified.dev/schemas/${EVIDENCE_REFERENCE_SCHEMA_VERSION}.json`,
	title: "EvidenceReference",
	type: "object",
	additionalProperties: false,
	required: [
		"evidenceId",
		"entityKind",
		"entityId",
		"route",
		"source",
		"confidence",
		"reason",
		"citations",
		"suggestedNextPivots",
	],
	properties: {
		evidenceId: { type: "string" },
		entityKind: {
			type: "string",
			enum: EvidenceEntityKindSchema.options,
		},
		entityId: { type: "string" },
		route: { type: "string" },
		source: { type: "string" },
		confidence: { type: "number", minimum: 0, maximum: 1 },
		reason: { type: "string" },
		citations: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["label", "entityKind", "entityId"],
				properties: {
					label: { type: "string" },
					entityKind: {
						type: "string",
						enum: EvidenceEntityKindSchema.options,
					},
					entityId: { type: "string" },
					route: { type: ["string", "null"] },
				},
			},
		},
		suggestedNextPivots: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["label", "entityKind", "entityId", "route"],
				properties: {
					label: { type: "string" },
					entityKind: {
						type: "string",
						enum: EvidenceEntityKindSchema.options,
					},
					entityId: { type: "string" },
					route: { type: "string" },
					reason: { type: "string" },
				},
			},
		},
	},
} as const satisfies JsonSchema;

const EvidenceReferenceJsonSchemaRef = {
	type: "object",
	additionalProperties: false,
	required: EvidenceReferenceJsonSchema.required,
	properties: EvidenceReferenceJsonSchema.properties,
} as const;

export const EvidenceRetrievalRefJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://obs-unified.dev/schemas/${EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION}.json`,
	title: "EvidenceRetrievalRef",
	type: "object",
	additionalProperties: false,
	required: ["refId", "kind", "anchor", "source"],
	properties: {
		refId: { type: "string" },
		kind: {
			type: "string",
			enum: EvidenceRetrievalKindSchema.options,
		},
		projectId: { type: "string" },
		anchor: EvidenceAnchorJsonSchema,
		source: { type: "string" },
		query: {
			type: "object",
			additionalProperties: true,
		},
		compactedFrom: EvidenceCountEstimateJsonSchema,
		returned: EvidenceCountEstimateJsonSchema,
		expiresAt: { type: "string" },
	},
} as const satisfies JsonSchema;

export const EvidenceCompactionJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://obs-unified.dev/schemas/${EVIDENCE_COMPACTION_SCHEMA_VERSION}.json`,
	title: "EvidenceCompaction",
	type: "object",
	additionalProperties: false,
	required: [
		"compactionId",
		"kind",
		"strategy",
		"inputCount",
		"outputCount",
		"reason",
		"exemplarEntityIds",
		"retrievalRefIds",
	],
	properties: {
		compactionId: { type: "string" },
		kind: {
			type: "string",
			enum: EvidenceCompactionKindSchema.options,
		},
		strategy: {
			type: "string",
			enum: EvidenceCompactionStrategySchema.options,
		},
		inputCount: { type: "integer", minimum: 0 },
		outputCount: { type: "integer", minimum: 0 },
		reason: { type: "string" },
		exemplarEntityIds: {
			type: "array",
			items: { type: "string" },
		},
		retrievalRefIds: {
			type: "array",
			items: { type: "string" },
		},
	},
} as const satisfies JsonSchema;

export const EvidenceBundleJsonSchema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: `https://obs-unified.dev/schemas/${EVIDENCE_BUNDLE_SCHEMA_VERSION}.json`,
	title: "EvidenceBundle",
	type: "object",
	additionalProperties: false,
	required: [
		"schemaVersion",
		"intent",
		"summary",
		"derivedSummaries",
		"findings",
		"compactions",
		"evidenceReferences",
		"retrievalRefs",
		"suggestedNextPivots",
	],
	properties: {
		schemaVersion: {
			type: "string",
			const: EVIDENCE_BUNDLE_SCHEMA_VERSION,
		},
		intent: {
			type: "string",
			enum: EvidenceBundleIntentSchema.options,
		},
		anchor: EvidenceAnchorJsonSchema,
		budget: {
			type: "object",
			additionalProperties: false,
			required: ["detailLevel"],
			properties: {
				targetTokens: { type: "integer", minimum: 0 },
				estimatedTokens: { type: "integer", minimum: 0 },
				detailLevel: {
					type: "string",
					enum: EvidenceBundleDetailLevelSchema.options,
				},
			},
		},
		summary: { type: "string" },
		derivedSummaries: {
			type: "array",
			items: EvidenceBundleClaimJsonSchema,
		},
		findings: {
			type: "array",
			items: EvidenceBundleClaimJsonSchema,
		},
		compactions: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: EvidenceCompactionJsonSchema.required,
				properties: EvidenceCompactionJsonSchema.properties,
			},
		},
		evidenceReferences: {
			type: "array",
			items: EvidenceReferenceJsonSchemaRef,
		},
		retrievalRefs: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: EvidenceRetrievalRefJsonSchema.required,
				properties: EvidenceRetrievalRefJsonSchema.properties,
			},
		},
		suggestedNextPivots:
			EvidenceReferenceJsonSchema.properties.suggestedNextPivots,
		dashboardUrl: { type: "string" },
	},
} as const satisfies JsonSchema;

export interface EvidenceReferenceContract {
	schemaVersion: typeof EVIDENCE_REFERENCE_SCHEMA_VERSION;
	jsonSchema: typeof EvidenceReferenceJsonSchema;
}

export const EVIDENCE_REFERENCE_CONTRACT = {
	schemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
	jsonSchema: EvidenceReferenceJsonSchema,
} as const satisfies EvidenceReferenceContract;

export interface EvidenceRetrievalRefContract {
	schemaVersion: typeof EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION;
	jsonSchema: typeof EvidenceRetrievalRefJsonSchema;
}

export const EVIDENCE_RETRIEVAL_REF_CONTRACT = {
	schemaVersion: EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
	jsonSchema: EvidenceRetrievalRefJsonSchema,
} as const satisfies EvidenceRetrievalRefContract;

export interface EvidenceCompactionContract {
	schemaVersion: typeof EVIDENCE_COMPACTION_SCHEMA_VERSION;
	jsonSchema: typeof EvidenceCompactionJsonSchema;
}

export const EVIDENCE_COMPACTION_CONTRACT = {
	schemaVersion: EVIDENCE_COMPACTION_SCHEMA_VERSION,
	jsonSchema: EvidenceCompactionJsonSchema,
} as const satisfies EvidenceCompactionContract;

export interface EvidenceBundleContract {
	schemaVersion: typeof EVIDENCE_BUNDLE_SCHEMA_VERSION;
	jsonSchema: typeof EvidenceBundleJsonSchema;
	evidenceReferenceSchemaVersion: typeof EVIDENCE_REFERENCE_SCHEMA_VERSION;
	evidenceRetrievalRefSchemaVersion: typeof EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION;
	evidenceCompactionSchemaVersion: typeof EVIDENCE_COMPACTION_SCHEMA_VERSION;
}

export const EVIDENCE_BUNDLE_CONTRACT = {
	schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
	jsonSchema: EvidenceBundleJsonSchema,
	evidenceReferenceSchemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
	evidenceRetrievalRefSchemaVersion: EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
	evidenceCompactionSchemaVersion: EVIDENCE_COMPACTION_SCHEMA_VERSION,
} as const satisfies EvidenceBundleContract;

export interface ToolResponseContract {
	schemaVersion: typeof TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION;
	transport: "http" | "mcp";
	tool: string;
	params: Record<string, unknown>;
	returns: string;
	evidenceReferenceSchemaVersion: typeof EVIDENCE_REFERENCE_SCHEMA_VERSION;
	evidenceReferenceJsonSchema?: typeof EvidenceReferenceJsonSchema;
}
