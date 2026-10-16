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

const codeReferenceSchema = z.object({
	repoName: z.string().optional(),
	relativePath: z.string().optional(),
	absolutePath: z.string().optional(),
	originalPath: z.string().optional(),
	symbolName: z.string().optional(),
	lineNumber: z.number().int().optional(),
	columnNumber: z.number().int().optional(),
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
				idempotencyKey: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Retry key. Re-sending the same key in the same project and environment returns the already-recorded finding instead of inserting a duplicate.",
					),
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
						environment: z.string().optional(),
						originatingNodeId: z.string().optional(),
						normalizedOperation: z.string().optional(),
						errorSignature: z.string().optional(),
						downstreamTargetNodeId: z.string().nullable().optional(),
					})
					.optional()
					.describe(
						"Optional. Omitted fields are derived server-side from the fault-locus span's service, operation and error signature.",
					),
				causalChain: z.array(causalTripleSchema),
				citedEvidenceIds: z.array(z.string()),
				codeReferences: z.array(codeReferenceSchema).optional(),
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

				// Validate counterfactual prerequisites BEFORE persisting anything, so
				// a missing eval run never leaves behind a finding the caller cannot
				// see (and then duplicates on retry).
				if (counterfactual) {
					const runIds = Array.from(
						new Set([
							counterfactual.failingRunId,
							...counterfactual.passingRunIds,
						]),
					);
					for (const runId of runIds) {
						try {
							await client.get(
								`/internal/evals/runs/${encodeURIComponent(runId)}`,
							);
						} catch (err) {
							const message = err instanceof Error ? err.message : String(err);
							if (/\b404\b/.test(message)) {
								throw new Error(
									`Counterfactual eval run ${runId} was not found in this project; no finding was recorded. Fix the run id or omit "counterfactual" and verify later.`,
								);
							}
							throw err;
						}
					}
				}

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
				let counterfactualError: string | undefined;
				if (counterfactual && findingId) {
					try {
						counterfactualResult = await client.post(
							`/internal/findings/${encodeURIComponent(findingId)}/counterfactual`,
							counterfactual,
						);
					} catch (err) {
						// The finding is already persisted: report it instead of an
						// error that hides its id and invites a duplicate retry.
						counterfactualError =
							err instanceof Error ? err.message : String(err);
					}
				}

				const data = counterfactualError
					? {
							...(typeof created === "object" && created !== null
								? created
								: {}),
							finding: findingObj,
							counterfactualError,
							retryHint:
								"The finding was recorded. Retry only the counterfactual by re-sending this call with the same idempotencyKey (the finding is reused), or POST /internal/findings/:id/counterfactual.",
						}
					: counterfactualResult
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
		"open_incident",
		{
			description:
				"Open an AutoSRE incident (or join the active one for the same symptom). Deduplicated by project, environment, target node and symptom category; the result says whether an existing incident was reused. The returned incident id is what propose_remediation_action requires.",
			inputSchema: {
				environment: z
					.string()
					.optional()
					.describe(
						"Must match the environment of the telemetry and findings; defaults to 'default'.",
					),
				targetNodeId: z.string().min(1),
				symptomCategory: z.string().optional(),
				symptomAnchorKind: EvidenceEntityKindSchema.optional(),
				symptomAnchorId: z.string().optional(),
				symptomFingerprint: z.string().optional(),
				id: z.string().min(1).optional(),
				latestBundle: z.record(z.unknown()).optional(),
			},
		},
		async (params) => {
			try {
				const data = await client.post<Record<string, unknown>>(
					"/internal/incidents",
					params,
				);
				const incident =
					data && typeof data === "object" && "incident" in data
						? (data.incident as Record<string, unknown>)
						: undefined;
				const incidentId =
					typeof incident?.id === "string" ? incident.id : undefined;
				return toolResult(
					"open_incident",
					params as Record<string, unknown>,
					"{ data: { incident: IncidentInvestigation, deduplicated: boolean }, deduplicated: boolean, dashboardUrl?: string }",
					{
						data,
						deduplicated: Boolean(data?.deduplicated),
						dashboardUrl: incidentId
							? client.dashboardLink(
									`incidents/${encodeURIComponent(incidentId)}`,
								)
							: client.dashboardLink("incidents"),
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
				webhookUrl: z
					.string()
					.url()
					.optional()
					.describe(
						"Optional HTTPS receiver for the one-time grant token. Stored on a proposal that awaits human approval and used when it is approved; also used immediately for an autonomous grant. Private hosts are refused unless the operator allows them.",
					),
				webhookSecret: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional HMAC-SHA256 signing secret for the webhook (X-Obs-Signature-256). Stored server-side and never returned.",
					),
			},
		},
		async (params) => {
			try {
				const { webhookSecret, ...rest } = params;
				const payload = {
					...rest,
					...(webhookSecret ? { secret: webhookSecret } : {}),
				};
				const data = await client.post(
					"/internal/remediations/propose",
					payload,
				);
				return toolResult(
					"propose_remediation_action",
					{
						...(rest as Record<string, unknown>),
						...(webhookSecret ? { webhookSecret: "[redacted]" } : {}),
					},
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
