import { describe, expect, it } from "vitest";
import {
	buildCanonicalNodeId,
	buildFindingFingerprint,
	CausalProofTierSchema,
	CohortAttributionVerdictSchema,
	EvidencePredicateSchema,
	RelationshipCertaintySchema,
} from "./autosre";
import {
	EVIDENCE_BUNDLE_SCHEMA_VERSION,
	EvidenceBundleSchema,
	EvidenceEntityKindSchema,
	EvidenceReferenceSchema,
} from "./evidence";

describe("RFC 0013 AutoSRE Types & Deterministic Identity/Fingerprint Helpers", () => {
	describe("buildCanonicalNodeId (P1 #5: Environment & Physical Scope Isolation)", () => {
		it("separates staging and prod services with identical service.name", () => {
			const staging = buildCanonicalNodeId({
				kind: "service",
				environment: "staging",
				serviceName: "checkout-api",
			});
			const prod = buildCanonicalNodeId({
				kind: "service",
				environment: "prod",
				serviceName: "checkout-api",
			});

			expect(staging.id).toBe("service:staging:default:checkout-api");
			expect(prod.id).toBe("service:prod:default:checkout-api");
			expect(staging.id).not.toBe(prod.id);
			expect(staging.isScopedIdentity).toBe(true);
			expect(prod.isScopedIdentity).toBe(true);
		});

		it("separates two Postgres clusters that both host a database named orders", () => {
			const dbPrimary = buildCanonicalNodeId({
				kind: "database",
				environment: "prod",
				dbSystem: "postgresql",
				dbName: "orders",
				serverAddress: "pg-orders-us-east.internal",
				serverPort: 5432,
			});
			const dbAnalytics = buildCanonicalNodeId({
				kind: "database",
				environment: "prod",
				dbSystem: "postgresql",
				dbName: "orders",
				serverAddress: "pg-analytics-replica.internal",
				serverPort: 5432,
			});

			expect(dbPrimary.id).toBe(
				"database:prod:postgresql:pg-orders-us-east.internal:5432/orders",
			);
			expect(dbAnalytics.id).toBe(
				"database:prod:postgresql:pg-analytics-replica.internal:5432/orders",
			);
			expect(dbPrimary.id).not.toBe(dbAnalytics.id);
			expect(dbPrimary.isScopedIdentity).toBe(true);
			expect(dbAnalytics.isScopedIdentity).toBe(true);
		});

		it("marks database, cache, and queue nodes without serverAddress as unscoped", () => {
			const unscopedDb = buildCanonicalNodeId({
				kind: "database",
				environment: "prod",
				dbSystem: "postgresql",
				dbName: "orders",
			});
			const unscopedCache = buildCanonicalNodeId({
				kind: "cache",
				environment: "prod",
				dbSystem: "redis",
				dbName: "sessions",
			});
			const unscopedQueue = buildCanonicalNodeId({
				kind: "queue_topic",
				environment: "prod",
				messagingSystem: "kafka",
				messagingDestination: "payments.events",
			});

			expect(unscopedDb.id).toBe("database:prod:unscoped/postgresql:orders");
			expect(unscopedDb.isScopedIdentity).toBe(false);
			expect(unscopedCache.id).toBe("cache:prod:unscoped/redis:sessions");
			expect(unscopedCache.isScopedIdentity).toBe(false);
			expect(unscopedQueue.id).toBe(
				"queue:prod:unscoped/kafka:payments.events",
			);
			expect(unscopedQueue.isScopedIdentity).toBe(false);
		});

		it("normalizes dynamic UUIDs and numeric IDs in endpoint routes", () => {
			const ep1 = buildCanonicalNodeId({
				kind: "endpoint",
				environment: "prod",
				serviceName: "payment-api",
				methodOrRpc: "post",
				routeOrSpanName:
					"/v1/orders/492819/charge/550e8400-e29b-41d4-a716-446655440000",
			});
			const ep2 = buildCanonicalNodeId({
				kind: "endpoint",
				environment: "prod",
				serviceName: "payment-api",
				methodOrRpc: "POST",
				routeOrSpanName:
					"/v1/orders/991024/charge/123e4567-e89b-12d3-a456-426614174000",
			});

			expect(ep1.id).toBe(ep2.id);
			expect(ep1.id).toBe(
				"endpoint:prod:default:payment-api:POST:/v1/orders/:id/charge/:uuid",
			);
		});
	});

	describe("buildFindingFingerprint (P2 #8: Stable Recurrence Matching)", () => {
		it("produces identical fingerprints across recurrences with dynamic UUIDs/numbers", () => {
			const occ1 = buildFindingFingerprint({
				environment: "prod",
				originatingNodeId: "service:prod:default:payment-api",
				normalizedOperation: "POST /v1/charges/88412",
				errorSignature:
					"StripeTimeoutError: request 550e8400-e29b-41d4-a716-446655440000 timed out after 15000ms",
				downstreamTargetNodeId: "external:prod:api.stripe.com:443",
			});
			const occ2 = buildFindingFingerprint({
				environment: "prod",
				originatingNodeId: "service:prod:default:payment-api",
				normalizedOperation: "POST /v1/charges/11293",
				errorSignature:
					"StripeTimeoutError: request 999e8400-e29b-41d4-a716-446655449999 timed out after 15023ms",
				downstreamTargetNodeId: "external:prod:api.stripe.com:443",
			});

			expect(occ1.fingerprint).toBe(occ2.fingerprint);
			expect(occ1.fingerprint).toMatch(/^fp_[0-9a-f]{32}$/);
		});

		it("produces distinct fingerprints when environment or downstream target differs", () => {
			const prodFp = buildFindingFingerprint({
				environment: "prod",
				originatingNodeId: "service:prod:default:payment-api",
				normalizedOperation: "POST /v1/charges",
				errorSignature: "ConnectionRefusedError",
				downstreamTargetNodeId:
					"database:prod:postgresql:db-1.internal:5432/orders",
			});
			const stagingFp = buildFindingFingerprint({
				environment: "staging",
				originatingNodeId: "service:staging:default:payment-api",
				normalizedOperation: "POST /v1/charges",
				errorSignature: "ConnectionRefusedError",
				downstreamTargetNodeId:
					"database:staging:postgresql:db-1.internal:5432/orders",
			});

			expect(prodFp.fingerprint).not.toBe(stagingFp.fingerprint);
		});
	});

	describe("Orthogonal Epistemic Schemas & EvidenceBundle Extensions", () => {
		it("validates RelationshipCertainty, CausalProofTier, and EvidencePredicate on EvidenceReference", () => {
			const ref = EvidenceReferenceSchema.safeParse({
				evidenceId: "ev_change_241",
				entityKind: "change",
				entityId: "chg_payment_241",
				route: "#/changes/chg_payment_241",
				source: "collector.change-correlator",
				confidence: 0.92,
				relationshipCertainty: "exact",
				causalProofTier: "cohort_rate_isolated",
				predicate: "isolated_to_version_cohort",
				reason:
					"Version 2.4.1 shows 24% failure rate (N=100) vs 0% on concurrent 2.4.0 (N=100)",
				citations: [],
				suggestedNextPivots: [],
			});

			expect(ref.success).toBe(true);
			expect(EvidenceEntityKindSchema.safeParse("change").success).toBe(true);
			expect(EvidenceEntityKindSchema.safeParse("finding").success).toBe(true);
			expect(EvidenceEntityKindSchema.safeParse("incident").success).toBe(true);
			expect(RelationshipCertaintySchema.options).toEqual([
				"exact",
				"inferred",
				"heuristic",
			]);
			expect(CausalProofTierSchema.options).toEqual([
				"counterfactual_verified",
				"cohort_rate_isolated",
				"corroborated_candidate",
				"unverified_locus",
			]);
			expect(EvidencePredicateSchema.options).toContain(
				"contended_on_shared_resource",
			);
			expect(CohortAttributionVerdictSchema.options).toContain(
				"shared_degradation_new_version_aggressor",
			);
		});

		it("validates triage_incident EvidenceBundle with autosre section", () => {
			const bundle = EvidenceBundleSchema.safeParse({
				schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
				intent: "triage_incident",
				environment: "prod",
				incidentId: "inc_01J",
				symptomFingerprint: "fp_0123456789abcdef0123456789abcdef",
				summary: "AutoSRE triage bundle for payment-api error spike",
				derivedSummaries: [],
				findings: [],
				compactions: [],
				evidenceReferences: [],
				retrievalRefs: [],
				suggestedNextPivots: [],
				autosre: {
					faultLocus: {
						nodeId: "service:prod:default:payment-api",
						spanId: "span_leaf_1",
						relationshipCertainty: "exact",
						isBlackoutSuspected: false,
					},
					candidateChanges: [
						{
							changeId: "chg_payment_241",
							kind: "deploy",
							version: "2.4.1",
							previousVersion: "2.4.0",
							occurredAt: "2026-10-15T00:00:00.000Z",
							cohortVerdict: "isolated_to_new_version",
							causalProofTier: "cohort_rate_isolated",
							rateNew: 0.24,
							rateOld: 0,
							sampleNew: 100,
							sampleOld: 100,
							overlappingCodePaths: ["src/payments/retry.ts"],
						},
					],
					contentionCandidates: [],
					priorFindings: [],
				},
			});

			expect(bundle.success).toBe(true);
		});
	});
});
