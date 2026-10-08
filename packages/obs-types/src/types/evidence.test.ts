import { describe, expect, it } from "vitest";
import {
	EVIDENCE_BUNDLE_CONTRACT,
	EVIDENCE_BUNDLE_SCHEMA_VERSION,
	EVIDENCE_COMPACTION_CONTRACT,
	EVIDENCE_COMPACTION_SCHEMA_VERSION,
	EVIDENCE_REFERENCE_CONTRACT,
	EVIDENCE_REFERENCE_SCHEMA_VERSION,
	EVIDENCE_RETRIEVAL_REF_CONTRACT,
	EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
	EvidenceBundleJsonSchema,
	EvidenceBundleSchema,
	EvidenceCitationSchema,
	EvidenceCompactionJsonSchema,
	EvidenceCompactionSchema,
	EvidenceEntityKindSchema,
	EvidenceReferenceJsonSchema,
	EvidenceReferenceSchema,
	EvidenceRetrievalRefJsonSchema,
	EvidenceRetrievalRefSchema,
} from "./evidence";

const validEvidenceReference = {
	evidenceId: "ev-1",
	entityKind: "analysis",
	entityId: "an-1",
	route: "/analyses/an-1",
	source: "slow-query-analyzer",
	confidence: 0.95,
	reason: "High self-time database query detected",
	citations: [
		{
			label: "Query trace",
			entityKind: "trace",
			entityId: "trace-abc",
		},
	],
	suggestedNextPivots: [
		{
			label: "Drill into CPU profiles",
			entityKind: "profile",
			entityId: "prof-xyz",
			route: "/profiles/prof-xyz",
		},
	],
} as const;

const validRetrievalRef = {
	refId: "eref_logs_404_products",
	kind: "logs",
	projectId: "project-1",
	anchor: {
		entityKind: "trace",
		entityId: "trace-abc",
	},
	source: "collector.log-clusterer",
	query: {
		traceId: "trace-abc",
		severity: ["error", "warn"],
	},
	compactedFrom: {
		recordCount: 500,
		tokenEstimate: 12000,
		byteEstimate: 180000,
	},
	returned: {
		recordCount: 3,
		tokenEstimate: 900,
		byteEstimate: 12000,
	},
	expiresAt: "2026-06-10T00:00:00.000Z",
} as const;

const validCompaction = {
	compactionId: "cmp_logs_404_products",
	kind: "logs",
	strategy: "signature_cluster",
	inputCount: 500,
	outputCount: 3,
	reason:
		"Collapsed matching 404 logs for GET /api/products/:id in the requested time window.",
	exemplarEntityIds: ["log_1", "log_29", "log_488"],
	retrievalRefIds: ["eref_logs_404_products"],
} as const;

const validEvidenceBundle = {
	schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
	intent: "debug_failure",
	anchor: {
		entityKind: "trace",
		entityId: "trace-abc",
	},
	budget: {
		targetTokens: 4000,
		estimatedTokens: 2600,
		detailLevel: "standard",
	},
	summary:
		"Checkout failure context for trace trace-abc with compacted related logs.",
	derivedSummaries: [
		{
			title: "Repeated product lookup failures",
			reason: "500 matching 404 logs were clustered into 3 exemplars.",
			confidence: 0.91,
			evidenceIds: ["ev-1"],
			retrievalRefIds: ["eref_logs_404_products"],
		},
	],
	findings: [
		{
			title: "Product lookup failed during checkout",
			reason:
				"The failed trace and error log exemplars share the same trace ID.",
			confidence: 0.82,
			evidenceIds: ["ev-1"],
			retrievalRefIds: ["eref_logs_404_products"],
		},
	],
	compactions: [validCompaction],
	evidenceReferences: [validEvidenceReference],
	retrievalRefs: [validRetrievalRef],
	suggestedNextPivots: [
		{
			label: "Open failed span",
			entityKind: "span",
			entityId: "span-failed",
			route: "/traces/trace-abc/spans/span-failed",
			reason: "Inspect the failed database span.",
		},
	],
	dashboardUrl: "/traces/trace-abc",
} as const;

describe("Evidence Types Zod Schemas", () => {
	describe("EvidenceEntityKindSchema", () => {
		it("accepts valid kinds", () => {
			const valid = [
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
			];
			for (const kind of valid) {
				expect(EvidenceEntityKindSchema.safeParse(kind).success).toBe(true);
			}
		});

		it("rejects invalid kinds", () => {
			expect(EvidenceEntityKindSchema.safeParse("invalid_kind").success).toBe(
				false,
			);
		});
	});

	describe("EvidenceCitationSchema", () => {
		it("parses valid citation", () => {
			const data = {
				label: "Alert details",
				entityKind: "alert",
				entityId: "alert-1",
				route: "/alerts/1",
			};
			const res = EvidenceCitationSchema.safeParse(data);
			expect(res.success).toBe(true);
		});

		it("allows null or omitted route", () => {
			const data1 = {
				label: "Trace details",
				entityKind: "trace",
				entityId: "trace-1",
			};
			const data2 = {
				label: "Span details",
				entityKind: "span",
				entityId: "span-1",
				route: null,
			};
			expect(EvidenceCitationSchema.safeParse(data1).success).toBe(true);
			expect(EvidenceCitationSchema.safeParse(data2).success).toBe(true);
		});
	});

	describe("EvidenceReferenceSchema", () => {
		it("parses valid EvidenceReference", () => {
			const res = EvidenceReferenceSchema.safeParse(validEvidenceReference);
			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.data.confidence).toBe(0.95);
				expect(res.data.citations[0].entityKind).toBe("trace");
			}
		});

		it("rejects invalid EvidenceReference", () => {
			const data = {
				evidenceId: "ev-1",
				entityKind: "invalid_kind",
				entityId: "an-1",
				route: "/analyses/an-1",
				source: "slow-query-analyzer",
				confidence: "high", // invalid: should be number
				reason: "High self-time database query detected",
				citations: [],
				suggestedNextPivots: [],
			};
			const res = EvidenceReferenceSchema.safeParse(data);
			expect(res.success).toBe(false);
		});

		it("rejects confidence values out of bounds [0, 1]", () => {
			const base = {
				evidenceId: "ev-1",
				entityKind: "analysis",
				entityId: "an-1",
				route: "/analyses/an-1",
				source: "slow-query-analyzer",
				reason: "High self-time database query detected",
				citations: [],
				suggestedNextPivots: [],
			};

			const low = EvidenceReferenceSchema.safeParse({
				...base,
				confidence: -0.1,
			});
			const high = EvidenceReferenceSchema.safeParse({
				...base,
				confidence: 1.1,
			});
			expect(low.success).toBe(false);
			expect(high.success).toBe(false);
		});
	});

	describe("EvidenceReferenceJsonSchema", () => {
		it("publishes a versioned JSON Schema aligned with the validator", () => {
			expect(EVIDENCE_REFERENCE_CONTRACT.schemaVersion).toBe(
				EVIDENCE_REFERENCE_SCHEMA_VERSION,
			);
			expect(EVIDENCE_REFERENCE_CONTRACT.jsonSchema).toBe(
				EvidenceReferenceJsonSchema,
			);
			expect(EvidenceReferenceJsonSchema.$id).toContain(
				EVIDENCE_REFERENCE_SCHEMA_VERSION,
			);
			expect(EvidenceReferenceJsonSchema.required).toContain("evidenceId");
			expect(EvidenceReferenceJsonSchema.required).toContain("confidence");
			expect(EvidenceReferenceJsonSchema.properties.entityKind.enum).toEqual(
				EvidenceEntityKindSchema.options,
			);
		});
	});

	describe("EvidenceRetrievalRefSchema", () => {
		it("parses valid EvidenceRetrievalRef", () => {
			const res = EvidenceRetrievalRefSchema.safeParse(validRetrievalRef);

			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.data.refId).toBe("eref_logs_404_products");
				expect(res.data.anchor.entityKind).toBe("trace");
				expect(res.data.compactedFrom?.recordCount).toBe(500);
			}
		});

		it("rejects an invalid retrieval kind", () => {
			const res = EvidenceRetrievalRefSchema.safeParse({
				...validRetrievalRef,
				kind: "metrics",
			});

			expect(res.success).toBe(false);
		});

		it("rejects negative count estimates", () => {
			const res = EvidenceRetrievalRefSchema.safeParse({
				...validRetrievalRef,
				returned: {
					recordCount: -1,
				},
			});

			expect(res.success).toBe(false);
		});
	});

	describe("EvidenceCompactionSchema", () => {
		it("parses valid EvidenceCompaction", () => {
			const res = EvidenceCompactionSchema.safeParse(validCompaction);

			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.data.inputCount).toBe(500);
				expect(res.data.retrievalRefIds).toEqual(["eref_logs_404_products"]);
			}
		});

		it("rejects invalid compaction strategy", () => {
			const res = EvidenceCompactionSchema.safeParse({
				...validCompaction,
				strategy: "semantic_summary",
			});

			expect(res.success).toBe(false);
		});

		it("rejects fractional counts", () => {
			const res = EvidenceCompactionSchema.safeParse({
				...validCompaction,
				outputCount: 1.5,
			});

			expect(res.success).toBe(false);
		});
	});

	describe("EvidenceBundleSchema", () => {
		it("parses valid EvidenceBundle", () => {
			const res = EvidenceBundleSchema.safeParse(validEvidenceBundle);

			expect(res.success).toBe(true);
			if (res.success) {
				expect(res.data.schemaVersion).toBe(EVIDENCE_BUNDLE_SCHEMA_VERSION);
				expect(res.data.intent).toBe("debug_failure");
				expect(res.data.evidenceReferences[0].evidenceId).toBe("ev-1");
				expect(res.data.retrievalRefs[0].refId).toBe("eref_logs_404_products");
			}
		});

		it("rejects bundles with a missing detail level when budget is present", () => {
			const res = EvidenceBundleSchema.safeParse({
				...validEvidenceBundle,
				budget: {
					targetTokens: 4000,
				},
			});

			expect(res.success).toBe(false);
		});

		it("rejects bundles with the wrong schema version", () => {
			const res = EvidenceBundleSchema.safeParse({
				...validEvidenceBundle,
				schemaVersion: EVIDENCE_REFERENCE_SCHEMA_VERSION,
			});

			expect(res.success).toBe(false);
		});

		it("rejects findings with confidence outside [0, 1]", () => {
			const res = EvidenceBundleSchema.safeParse({
				...validEvidenceBundle,
				findings: [
					{
						...validEvidenceBundle.findings[0],
						confidence: 1.1,
					},
				],
			});

			expect(res.success).toBe(false);
		});
	});

	describe("Evidence retrieval JSON Schemas", () => {
		it("publishes versioned contracts for the new sibling schemas", () => {
			expect(EVIDENCE_RETRIEVAL_REF_CONTRACT.schemaVersion).toBe(
				EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
			);
			expect(EVIDENCE_RETRIEVAL_REF_CONTRACT.jsonSchema).toBe(
				EvidenceRetrievalRefJsonSchema,
			);
			expect(EvidenceRetrievalRefJsonSchema.$id).toContain(
				EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
			);
			expect(EvidenceRetrievalRefJsonSchema.required).toEqual([
				"refId",
				"kind",
				"anchor",
				"source",
			]);

			expect(EVIDENCE_COMPACTION_CONTRACT.schemaVersion).toBe(
				EVIDENCE_COMPACTION_SCHEMA_VERSION,
			);
			expect(EVIDENCE_COMPACTION_CONTRACT.jsonSchema).toBe(
				EvidenceCompactionJsonSchema,
			);
			expect(EvidenceCompactionJsonSchema.$id).toContain(
				EVIDENCE_COMPACTION_SCHEMA_VERSION,
			);
			expect(EvidenceCompactionJsonSchema.required).toContain("inputCount");
		});

		it("publishes an EvidenceBundle contract without changing EvidenceReference v1", () => {
			expect(EVIDENCE_BUNDLE_CONTRACT.schemaVersion).toBe(
				EVIDENCE_BUNDLE_SCHEMA_VERSION,
			);
			expect(EVIDENCE_BUNDLE_CONTRACT.jsonSchema).toBe(
				EvidenceBundleJsonSchema,
			);
			expect(EVIDENCE_BUNDLE_CONTRACT.evidenceReferenceSchemaVersion).toBe(
				EVIDENCE_REFERENCE_SCHEMA_VERSION,
			);
			expect(EVIDENCE_BUNDLE_CONTRACT.evidenceRetrievalRefSchemaVersion).toBe(
				EVIDENCE_RETRIEVAL_REF_SCHEMA_VERSION,
			);
			expect(EVIDENCE_BUNDLE_CONTRACT.evidenceCompactionSchemaVersion).toBe(
				EVIDENCE_COMPACTION_SCHEMA_VERSION,
			);
			expect(EvidenceReferenceJsonSchema.required).not.toContain(
				"retrievalRefs",
			);
			expect(EvidenceBundleJsonSchema.required).toContain("retrievalRefs");
		});
	});
});
