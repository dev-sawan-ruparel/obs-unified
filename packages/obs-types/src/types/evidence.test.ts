import { describe, expect, it } from "vitest";
import {
	EVIDENCE_REFERENCE_CONTRACT,
	EVIDENCE_REFERENCE_SCHEMA_VERSION,
	EvidenceCitationSchema,
	EvidenceEntityKindSchema,
	EvidenceReferenceJsonSchema,
	EvidenceReferenceSchema,
} from "./evidence";

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
			const data = {
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
			};
			const res = EvidenceReferenceSchema.safeParse(data);
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
});
