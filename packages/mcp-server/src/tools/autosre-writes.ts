import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	CausalProofTierSchema,
	CohortAttributionVerdictSchema,
	EvidenceEntityKindSchema,
	EvidencePredicateSchema,
	RelationshipCertaintySchema,
	RemediationActionKindSchema,
} from "@obsunified/types";
import { z } from "zod";
import type { CollectorClient } from "../index";

interface ToolOutput {
	[key: string]: unknown;
	isError?: boolean;
	content: Array<{ type: "text"; text: string }>;
}

type ToolResultFn = (
	tool: string,
	params: Record<string, unknown>,
	returns: string,
	data: unknown,
) => ToolOutput;

export interface AutosreWriteHelpers {
	toolResult: ToolResultFn;
	errorToolResult: (error: unknown) => ToolOutput;
}

/** Mirrors the CausalTriple interface in @obsunified/types. */
const causalTripleSchema = z.object({
	subjectKind: EvidenceEntityKindSchema,
	subjectId: z.string().min(1),
	predicate: EvidencePredicateSchema,
	objectKind: EvidenceEntityKindSchema,
	objectId: z.string().min(1),
	relationshipCertainty: RelationshipCertaintySchema.optional(),
	causalProofTier: CausalProofTierSchema.optional(),
	confidence: z.number().min(0).max(1).optional(),
	reason: z.string().optional(),
});

/**
 * Opt-in write tools (OBS_MCP_ENABLE_WRITES=true). They mutate collector
 * state and require the dashboard bearer token.
 */
export function registerAutosreWriteTools(
	server: McpServer,
	client: CollectorClient,
	{ toolResult, errorToolResult }: AutosreWriteHelpers,
): void {
	server.registerTool(
		"record_investigation_finding",
		{
			description:
				"Record a structured investigation finding with causal chain, cited evidence, and optional counterfactual verification.",
			inputSchema: {
				environment: z.string().optional(),
				incidentId: z.string().optional(),
				title: z.string().min(1),
				summary: z.string().min(1),
				causalProofTier: CausalProofTierSchema.optional(),
				confidence: z.number().min(0).max(1).optional(),
				symptomEntityKind: z.string().min(1),
				symptomEntityId: z.string().min(1),
				faultLocusEntityKind: z.string().min(1),
				faultLocusEntityId: z.string().min(1),
				rootCauseEntityKind: z.string().optional(),
				rootCauseEntityId: z.string().optional(),
				contributingChangeId: z.string().optional(),
				cohortVerdict: CohortAttributionVerdictSchema.optional(),
				contendingTraceId: z.string().optional(),
				fingerprintInput: z
					.object({
						environment: z.string(),
						originatingNodeId: z.string(),
						normalizedOperation: z.string(),
						errorSignature: z.string(),
						downstreamTargetNodeId: z.string().nullable().optional(),
					})
					.optional(),
				causalChain: z.array(causalTripleSchema),
				citedEvidenceIds: z.array(z.string()),
				agentRunId: z.string().optional(),
				counterfactual: z
					.object({
						evalCaseId: z.string().min(1),
						failingRunId: z.string().min(1),
						passingRunIds: z.array(z.string()),
						requiredTrials: z.number().int().positive().optional(),
					})
					.optional(),
			},
		},
		async (params) => {
			try {
				const { counterfactual, ...findingPayload } = params;
				const created = await client.post<Record<string, unknown>>(
					"/internal/findings",
					findingPayload,
				);
				const findingObj =
					created &&
					typeof created === "object" &&
					"finding" in created &&
					created.finding &&
					typeof created.finding === "object"
						? (created.finding as Record<string, unknown>)
						: created;
				const findingId =
					typeof findingObj?.id === "string"
						? findingObj.id
						: typeof created?.id === "string"
							? created.id
							: undefined;

				let counterfactualResult: unknown;
				if (counterfactual && findingId) {
					counterfactualResult = await client.post(
						`/internal/findings/${encodeURIComponent(findingId)}/counterfactual`,
						counterfactual,
					);
				}

				const data = counterfactualResult
					? {
							...(typeof created === "object" && created !== null
								? created
								: {}),
							...(typeof counterfactualResult === "object" &&
							counterfactualResult !== null
								? counterfactualResult
								: {}),
							finding:
								typeof counterfactualResult === "object" &&
								counterfactualResult !== null &&
								"finding" in counterfactualResult
									? (counterfactualResult as Record<string, unknown>).finding
									: typeof counterfactualResult === "object" &&
											counterfactualResult !== null &&
											"id" in counterfactualResult
										? counterfactualResult
										: findingObj,
							counterfactual: counterfactualResult,
						}
					: created;

				return toolResult(
					"record_investigation_finding",
					params as Record<string, unknown>,
					"{ data: InvestigationFinding, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: findingId
							? client.dashboardLink(
									`findings/${encodeURIComponent(findingId)}`,
								)
							: client.dashboardLink("findings"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"propose_remediation_action",
		{
			description:
				"Propose a policy-gated remediation action with expected and desired state preconditions.",
			inputSchema: {
				environment: z.string().optional(),
				incidentId: z.string().min(1),
				findingId: z.string().min(1),
				idempotencyKey: z.string().min(1),
				actionKind: RemediationActionKindSchema,
				targetNodeId: z.string().min(1),
				expectedCurrentState: z.record(z.unknown()),
				desiredTargetState: z.record(z.unknown()),
				requestedAutonomy: z
					.enum([
						"read_only",
						"suggested_action",
						"human_approved_write",
						"autonomous_write",
						"blocked_by_policy",
					])
					.optional(),
			},
		},
		async (params) => {
			try {
				const data = await client.post(
					"/internal/remediations/propose",
					params,
				);
				return toolResult(
					"propose_remediation_action",
					params as Record<string, unknown>,
					"{ data: RemediationProposal, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink("remediations"),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);

	server.registerTool(
		"claim_remediation_grant",
		{
			description:
				"Claim, complete, or fail a remediation proposal using its single-use grant token.",
			inputSchema: {
				proposalId: z.string().min(1),
				operation: z
					.enum(["claim", "complete", "fail"])
					.optional()
					.default("claim"),
				environment: z.string().optional(),
				grantToken: z.string().optional(),
				runnerId: z.string().optional(),
				resultingChangeId: z.string().optional(),
				remediationAgentRunId: z.string().optional(),
				failureReason: z.string().optional(),
			},
		},
		async ({
			proposalId,
			operation,
			environment,
			grantToken,
			runnerId,
			resultingChangeId,
			remediationAgentRunId,
			failureReason,
		}) => {
			try {
				if (operation === "claim" && !grantToken?.trim()) {
					throw new Error("grantToken is required when operation is 'claim'");
				}
				const data = await client.post(
					`/internal/remediations/${encodeURIComponent(proposalId)}/${operation}`,
					{
						environment,
						grantToken,
						runnerId,
						resultingChangeId,
						remediationAgentRunId,
						failureReason,
					},
				);
				return toolResult(
					"claim_remediation_grant",
					{
						proposalId,
						operation,
						environment,
						grantToken,
						runnerId,
						resultingChangeId,
						remediationAgentRunId,
						failureReason,
					},
					"{ data: RemediationProposal, dashboardUrl?: string }",
					{
						data,
						dashboardUrl: client.dashboardLink(
							`remediations/${encodeURIComponent(proposalId)}`,
						),
					},
				);
			} catch (err) {
				return errorToolResult(err);
			}
		},
	);
}
