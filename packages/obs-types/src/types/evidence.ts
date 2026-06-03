import { z } from "zod";

export type JsonSchema = Record<string, unknown>;

export const EVIDENCE_REFERENCE_SCHEMA_VERSION =
	"obs-unified.evidence-reference.v1";

export const TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION =
	"obs-unified.tool-response-contract.v1";

export const EvidenceEntityKindSchema = z.enum([
	"analysis",
	"alert",
	"agent_run",
	"action",
	"trace",
	"span",
	"tool_call",
	"eval",
	"profile",
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

export interface EvidenceReferenceContract {
	schemaVersion: typeof EVIDENCE_REFERENCE_SCHEMA_VERSION;
	jsonSchema: typeof EvidenceReferenceJsonSchema;
}

export const EVIDENCE_REFERENCE_CONTRACT = {
	schemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
	jsonSchema: EvidenceReferenceJsonSchema,
} as const satisfies EvidenceReferenceContract;

export interface ToolResponseContract {
	schemaVersion: typeof TOOL_RESPONSE_CONTRACT_SCHEMA_VERSION;
	transport: "http" | "mcp";
	tool: string;
	params: Record<string, unknown>;
	returns: string;
	evidenceReferenceSchemaVersion: typeof EVIDENCE_REFERENCE_SCHEMA_VERSION;
	evidenceReferenceJsonSchema?: typeof EvidenceReferenceJsonSchema;
}
