import { describe, expect, it } from "vitest";
import { AgentAutonomyLevel } from "../constants";
import {
	ContractMismatchError,
	createInternalClient,
	InternalClientHttpError,
	validateContractResponse,
} from "../internal-contracts";
import {
	ChangeEventInputSchema,
	InvestigationFindingInputSchema,
	RemediationProposalInputSchema,
} from "../types/autosre-inputs";

const SAMPLE_INCIDENT = {
	id: "inc_1",
	projectId: "proj_1",
	environment: "prod",
	dedupKey: "dedup_1",
	status: "open" as const,
	targetNodeId: "service:prod:default/checkout",
	symptomAnchorKind: "trace" as const,
	symptomAnchorId: "trace_1",
	symptomFingerprint: "fp_1",
	alertCount: 2,
	latestBundle: null,
	leaseOwnerId: null,
	leaseExpiresAt: null,
	dispatchAttempts: 0,
	lastDispatchedAt: null,
	openedAt: "2026-10-16T00:00:00.000Z",
	updatedAt: "2026-10-16T00:00:00.000Z",
	resolvedAt: null,
	expiresAt: null,
};

const SAMPLE_FINDING = {
	id: "fnd_1",
	projectId: "proj_1",
	environment: "prod",
	incidentId: "inc_1",
	fingerprint: "fp_1",
	fingerprintInput: {
		environment: "prod",
		originatingNodeId: "service:prod:default/checkout",
		normalizedOperation: "POST /pay",
		errorSignature: "NullPointerException",
		downstreamTargetNodeId: null,
	},
	title: "NullPointer in checkout",
	summary: "Payment handler throws on null card token",
	causalProofTier: "cohort_rate_isolated" as const,
	confidence: 0.85,
	confidenceBreakdown: {
		relationshipScore: 0.3,
		cohortLiftScore: 0.3,
		temporalProximityScore: 0.15,
		counterfactualBonus: 0,
		priorRecurrenceBonus: 0.1,
		finalConfidence: 0.85,
	},
	symptomEntityKind: "trace" as const,
	symptomEntityId: "trace_1",
	faultLocusEntityKind: "span" as const,
	faultLocusEntityId: "span_1",
	rootCauseEntityKind: "change" as const,
	rootCauseEntityId: "chg_1",
	contributingChangeId: "chg_1",
	cohortVerdict: "isolated_to_new_version" as const,
	contendingTraceId: null,
	causalChain: [
		{
			subjectKind: "trace" as const,
			subjectId: "trace_1",
			predicate: "originated_fault_in_span" as const,
			objectKind: "span" as const,
			objectId: "span_1",
			relationshipCertainty: "exact" as const,
			causalProofTier: "unverified_locus" as const,
			confidence: 0.9,
			reason: "Direct error span in trace",
		},
	],
	citedEvidenceIds: ["ref_1"],
	codeReferences: [{ relativePath: "src/pay.ts", lineNumber: 42 }],
	counterfactualProof: null,
	recoveryStatus: "monitoring" as const,
	causalVerificationStatus: "unverified" as const,
	watchdogStep: 0,
	baselineRequestRatePerMin: 120,
	nextWatchdogCheckAt: null,
	actorType: "agent",
	actorId: "autosre-bot",
	agentRunId: "arun_1",
	createdAt: "2026-10-16T00:00:00.000Z",
	updatedAt: "2026-10-16T00:00:00.000Z",
	expiresAt: null,
};

const SAMPLE_PROPOSAL = {
	id: "rem_1",
	projectId: "proj_1",
	environment: "prod",
	incidentId: "inc_1",
	findingId: "fnd_1",
	idempotencyKey: "idem_1",
	actionKind: "rollback_deploy" as const,
	targetNodeId: "service:prod:default/checkout",
	expectedCurrentState: { version: "2.4.1" },
	desiredTargetState: { version: "2.4.0" },
	requestedAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
	effectiveAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
	policyDecisionReason: "Default policy",
	status: "pending_human_approval" as const,
	grantExpiresAt: null,
	approvedByUserId: null,
	approvedAt: null,
	claimedByRunnerId: null,
	claimedAt: null,
	claimExpiresAt: null,
	remediationAgentRunId: null,
	resultingChangeId: null,
	failureReason: null,
	createdAt: "2026-10-16T00:00:00.000Z",
	updatedAt: "2026-10-16T00:00:00.000Z",
	expiresAt: null,
};

describe("autosre-inputs schema-interface parity", () => {
	it("accepts idempotencyKey and partial fingerprintInput in InvestigationFindingInputSchema", () => {
		const parsed = InvestigationFindingInputSchema.safeParse({
			idempotencyKey: "idem-fnd-1",
			fingerprintInput: {
				errorSignature: "ECONNREFUSED",
			},
			title: "DB connection refused",
			summary: "Checkout cannot connect to postgres",
			symptomEntityKind: "trace",
			symptomEntityId: "t1",
			faultLocusEntityKind: "span",
			faultLocusEntityId: "s1",
			causalChain: [],
			citedEvidenceIds: [],
		});
		expect(parsed.success).toBe(true);
		if (parsed.success) {
			expect(parsed.data.idempotencyKey).toBe("idem-fnd-1");
			expect(parsed.data.fingerprintInput).toEqual({
				errorSignature: "ECONNREFUSED",
			});
		}
	});

	it("validates ChangeEventInputSchema and RemediationProposalInputSchema", () => {
		expect(
			ChangeEventInputSchema.safeParse({
				kind: "deploy",
				summary: "Deploy checkout 2.4.1",
			}).success,
		).toBe(true);
		expect(
			RemediationProposalInputSchema.safeParse({
				incidentId: "inc_1",
				findingId: "fnd_1",
				idempotencyKey: "idem_1",
				actionKind: "rollback_deploy",
				targetNodeId: "service:prod:default/checkout",
				expectedCurrentState: { version: "2.4.1" },
				desiredTargetState: { version: "2.4.0" },
			}).success,
		).toBe(true);
	});
});

describe("InternalEndpointContracts & createInternalClient", () => {
	it("substitutes path params, serializes query params, sets headers, and validates responses", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = createInternalClient({
			baseUrl: "https://collector.example.com/",
			projectId: "proj_alpha",
			headers: () => ({ Authorization: "Bearer secret_token" }),
			fetch: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(
					JSON.stringify({
						incidents: [{ ...SAMPLE_INCIDENT, extraServerField: "preserved" }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			},
		});

		const res = await client.request("GET /internal/incidents", {
			query: {
				environment: "prod",
				status: "open",
				limit: 10,
			},
		});

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(
			"https://collector.example.com/internal/incidents?environment=prod&status=open&limit=10",
		);
		const headers = calls[0]?.init?.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer secret_token");
		expect(headers["X-Project-Id"]).toBe("proj_alpha");
		expect(res.incidents).toHaveLength(1);
		expect(
			(res.incidents[0] as unknown as Record<string, unknown>).extraServerField,
		).toBe("preserved");
	});

	it("validates GET /internal/incidents/:id and URL-encodes path parameters", async () => {
		let requestedUrl = "";
		const client = createInternalClient({
			baseUrl: "https://collector.example.com",
			fetch: async (input) => {
				requestedUrl = String(input);
				return new Response(
					JSON.stringify({
						incident: SAMPLE_INCIDENT,
						findings: [SAMPLE_FINDING],
						proposals: [SAMPLE_PROPOSAL],
					}),
					{ status: 200 },
				);
			},
		});

		const detail = await client.request("GET /internal/incidents/:id", {
			params: { id: "inc/special id" },
		});
		expect(requestedUrl).toBe(
			"https://collector.example.com/internal/incidents/inc%2Fspecial%20id",
		);
		expect(detail.incident.id).toBe("inc_1");
		expect(detail.findings[0]?.id).toBe("fnd_1");
		expect(detail.proposals[0]?.id).toBe("rem_1");
	});

	it("tolerates older-collector responses that omit newer optional fields (callbackHost, callbackDelivery, grantDelivery)", async () => {
		const client = createInternalClient(async () => {
			// Older collector response without callbackHost, callbackDelivery, or grantDelivery
			return new Response(
				JSON.stringify({
					proposal: { ...SAMPLE_PROPOSAL, status: "grant_issued" },
					...SAMPLE_PROPOSAL,
					status: "grant_issued",
					grantToken: "grant_tok_123",
				}),
				{ status: 200 },
			);
		});

		const approved = await client.request(
			"POST /internal/remediations/:id/approve",
			{
				params: { id: "rem_1" },
			},
		);
		expect(approved.status).toBe("grant_issued");
		expect(approved.grantToken).toBe("grant_tok_123");
		expect(approved.grantDelivery).toBeUndefined();
	});

	it("throws ContractMismatchError with endpoint, status, issues, and rawBody when response violates schema", async () => {
		const badPayload = { incidents: "not-an-array" };
		const client = createInternalClient(async () => {
			return new Response(JSON.stringify(badPayload), { status: 200 });
		});

		let caught: unknown;
		try {
			await client.request("GET /internal/incidents");
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeInstanceOf(ContractMismatchError);
		const mismatch = caught as ContractMismatchError;
		expect(mismatch.endpoint).toBe("GET /internal/incidents");
		expect(mismatch.status).toBe(200);
		expect(mismatch.rawBody).toEqual(badPayload);
		expect(mismatch.issues.length).toBeGreaterThan(0);
		expect(mismatch.message).toContain("GET /internal/incidents");
		expect(mismatch.message).toContain("incidents");
	});

	it("throws InternalClientHttpError on non-2xx responses with error message", async () => {
		const client = createInternalClient(async () => {
			return new Response(
				JSON.stringify({
					error:
						"Remediation approval requires an authenticated human user session",
				}),
				{ status: 403, statusText: "Forbidden" },
			);
		});

		await expect(
			client.request("POST /internal/remediations/:id/approve", {
				params: { id: "rem_1" },
			}),
		).rejects.toThrow(InternalClientHttpError);

		try {
			await client.request("POST /internal/remediations/:id/approve", {
				params: { id: "rem_1" },
			});
		} catch (err) {
			const httpErr = err as InternalClientHttpError;
			expect(httpErr.status).toBe(403);
			expect(httpErr.endpoint).toBe("POST /internal/remediations/:id/approve");
			expect(httpErr.errorMessage).toContain(
				"authenticated human user session",
			);
		}
	});

	it("validates responses directly via validateContractResponse", () => {
		const valid = validateContractResponse(
			"DELETE /internal/projects/:id/keys/:keyId",
			{
				ok: true,
			},
		);
		expect(valid.ok).toBe(true);

		expect(() =>
			validateContractResponse("DELETE /internal/projects/:id/keys/:keyId", {
				ok: "yes",
			}),
		).toThrow(ContractMismatchError);
	});

	it("enforces compile-time contract types with @ts-expect-error negative checks", () => {
		const client = createInternalClient(async () => new Response("{}"));

		// Unused function that exercises compile-time type checking only
		const _typeChecks = async () => {
			// @ts-expect-error — unknown endpoint key must fail to compile
			await client.request("GET /internal/not-a-route");

			// @ts-expect-error — endpoint with :id requires options with params
			await client.request("GET /internal/incidents/:id");

			await client.request("GET /internal/incidents/:id", {
				// @ts-expect-error — endpoint with :id requires params.id to be string
				params: { id: 123 },
			});

			// @ts-expect-error — approve requires params: { id: string }
			await client.request("POST /internal/remediations/:id/approve");

			// @ts-expect-error — POST /internal/findings requires body
			await client.request("POST /internal/findings", {});

			await client.request("POST /internal/findings", {
				body: {
					title: "t",
					summary: "s",
					symptomEntityKind: "trace",
					symptomEntityId: "t1",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "s1",
					// @ts-expect-error — invalid actorType must fail to compile
					actorType: "robot",
				},
			});
		};
		expect(typeof _typeChecks).toBe("function");
	});
});
