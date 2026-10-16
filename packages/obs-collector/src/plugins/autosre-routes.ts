import type {
	CausalProofTier,
	CausalVerificationStatus,
	ChangeEventKind,
	CohortAttributionVerdict,
	EvidenceEntityKind,
	InvestigationFindingInput,
	JsonValue,
	RemediationActionKind,
	RemediationProposalInput,
	RemediationProposalStatus,
	RemediationStateSpec,
} from "@obsunified/types";
import {
	ChangeEventKindSchema,
	EvidencePredicateSchema,
	RemediationActionKindSchema,
} from "@obsunified/types";
import { AgentAutonomyLevel } from "@obsunified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import {
	computeChangeBlastRadius,
	getChangeEvent,
	InvalidTimestampError,
	listChangeEvents,
	recordChangeEvent,
} from "../lib/autosre-change-correlation";
import {
	CounterfactualVerificationError,
	getInvestigationFinding,
	recordInvestigationFinding,
	searchInvestigationFindings,
	verifyPairedCounterfactualProof,
} from "../lib/autosre-findings";
import {
	getOntologyGraph,
	loadTraceFaultLocusFromDb,
} from "../lib/autosre-ontology";
import {
	acquireIncidentLease,
	approveRemediationProposal,
	claimRemediationGrant,
	completeRemediationProposal,
	dispatchIncidentWebhook,
	evaluateRemediationWatchdogs,
	failRemediationProposal,
	getIncidentInvestigation,
	getRemediationProposal,
	listIncidentInvestigations,
	listRemediationProposals,
	openOrDeduplicateIncident,
	proposeRemediationAction,
	RemediationGateError,
	rejectRemediationProposal,
} from "../lib/autosre-remediation-gate";
import { sha256Hex } from "../lib/hash";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";
import { readJsonObject } from "./_json";

const CHANGE_KINDS = new Set<string>(ChangeEventKindSchema.options);

const REMEDIATION_ACTION_KINDS = new Set<string>(
	RemediationActionKindSchema.options,
);

const parseLimit = (raw: string | undefined, fallback = 50): number => {
	const parsed = Number.parseInt(raw ?? String(fallback), 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.max(1, Math.min(200, parsed));
};

const isAgentAutonomyLevel = (value: unknown): value is AgentAutonomyLevel =>
	typeof value === "string" &&
	Object.values(AgentAutonomyLevel).includes(value as AgentAutonomyLevel);

/**
 * Enforces Review Item #4: POST /internal/remediations/:id/approve and /reject
 * require an authenticated human dashboard session (`obs_session` cookie) and
 * reject programmatic agent/MCP bearer tokens (`403 Forbidden`).
 */
async function requireHumanDashboardSession(c: {
	req: { header: (name: string) => string | undefined };
}): Promise<
	{ ok: true; sessionActor: string } | { ok: false; message: string }
> {
	const authHeader = c.req.header("Authorization");
	if (authHeader) {
		return {
			ok: false,
			message:
				"Human approval requires an authenticated human dashboard session (obs_session cookie); agent/API bearer tokens cannot self-approve or reject remediation proposals.",
		};
	}
	const cookieHeader = c.req.header("Cookie") ?? "";
	const match = cookieHeader.match(/(?:^|;\s*)obs_session=([^;]*)/);
	if (!match?.[1]) {
		return {
			ok: false,
			message:
				"Human approval requires an authenticated human dashboard session (obs_session cookie).",
		};
	}
	// The recorded approver is derived from the session itself. Client-supplied
	// identities (X-Obs-User-Actor, body.approvedByUserId) are never trusted:
	// they would let any session holder attribute an approval to someone else.
	// Only a hash prefix is stored so the cookie value never reaches the DB.
	let rawSession = match[1];
	try {
		rawSession = decodeURIComponent(rawSession);
	} catch {
		// keep the raw value; it is only hashed
	}
	const sessionActor = `dashboard_session:${(await sha256Hex(rawSession)).slice(0, 16)}`;
	return { ok: true, sessionActor };
}

export const autosreRoutesPlugin: CollectorPlugin = {
	name: "autosre-routes",
	register(app, runtime) {
		/**
		 * Grant handoff: the plaintext grant token exists only in the response of
		 * the request that mints it (propose with an autonomous grant, or human
		 * approve). Incidents do not store a webhook, so the caller may pass
		 * `webhookUrl` (+ optional `secret`) in that same request and the token is
		 * pushed to the runner over the SSRF-guarded, HMAC-signed incident webhook.
		 * Without a `webhookUrl` the token is simply returned in the response.
		 */
		const deliverGrant = async (
			env: CollectorEnv | undefined,
			db: ReturnType<typeof sqlDbFor>,
			projectId: string,
			body: Record<string, unknown>,
			proposal: {
				id: string;
				incidentId: string;
				environment: string;
				status: string;
				grantToken?: string;
			},
		) => {
			const webhookUrl =
				typeof body.webhookUrl === "string" ? body.webhookUrl.trim() : "";
			if (!webhookUrl || !proposal.grantToken) return undefined;
			if (proposal.status !== "grant_issued") return undefined;
			return dispatchIncidentWebhook(db, projectId, proposal.incidentId, {
				url: webhookUrl,
				secret: typeof body.secret === "string" ? body.secret : undefined,
				environment: proposal.environment,
				allowPrivateNetworks: env?.ALERT_WEBHOOK_ALLOW_PRIVATE === "true",
				logger: runtime.logger,
				grant: {
					proposalId: proposal.id,
					status: proposal.status,
					grantToken: proposal.grantToken,
				},
			});
		};

		// 1. Change Ingestion (Ingest Auth /v1/changes)
		app.post("/v1/changes", async (c) => {
			const projectId = getProjectId(c);
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const rawKind =
				typeof body.kind === "string" ? body.kind.trim() : "deploy";
			const normalizedKind = (
				rawKind === "agent_prompt_release" ? "prompt_rollout" : rawKind
			) as ChangeEventKind;
			if (!CHANGE_KINDS.has(normalizedKind)) {
				return c.json(
					{
						error: `Invalid change kind: ${String(body.kind)}. Must be one of: ${Array.from(CHANGE_KINDS).join(", ")}`,
					},
					400,
				);
			}
			const summary =
				typeof body.summary === "string" ? body.summary.trim() : "";
			if (!summary) {
				return c.json({ error: "summary is required" }, 400);
			}

			const db = runtime.getSqlDb(c.env);
			const touchedPaths = Array.isArray(body.touchedPaths)
				? body.touchedPaths.filter((p): p is string => typeof p === "string")
				: undefined;
			const rawAttrs = body.attributes ?? body.metadata;
			const attributes =
				rawAttrs && typeof rawAttrs === "object" && !Array.isArray(rawAttrs)
					? (rawAttrs as Record<string, JsonValue>)
					: undefined;

			const serviceName =
				typeof body.serviceName === "string"
					? body.serviceName
					: typeof body.service === "string"
						? body.service
						: undefined;
			const namespace =
				typeof body.namespace === "string"
					? body.namespace
					: typeof body.serviceNamespace === "string"
						? body.serviceNamespace
						: undefined;
			const repositoryUrl =
				typeof body.repositoryUrl === "string"
					? body.repositoryUrl
					: typeof body.repoUrl === "string"
						? body.repoUrl
						: null;
			const pullRequestUrl =
				typeof body.pullRequestUrl === "string"
					? body.pullRequestUrl
					: typeof body.prUrl === "string"
						? body.prUrl
						: null;
			const actorId =
				typeof body.actorId === "string"
					? body.actorId
					: typeof body.actor === "string"
						? body.actor
						: null;

			let changeEvent: Awaited<ReturnType<typeof recordChangeEvent>>;
			try {
				changeEvent = await recordChangeEvent(db, projectId, {
					id: typeof body.id === "string" ? body.id : undefined,
					environment:
						typeof body.environment === "string" ? body.environment : undefined,
					kind: normalizedKind,
					source:
						body.source === "inferred_telemetry" ||
						body.source === "autosre_remediation" ||
						body.source === "ci_webhook"
							? body.source
							: "explicit_api",
					targetNodeId:
						typeof body.targetNodeId === "string"
							? body.targetNodeId
							: undefined,
					serviceName,
					namespace,
					version: typeof body.version === "string" ? body.version : null,
					previousVersion:
						typeof body.previousVersion === "string"
							? body.previousVersion
							: null,
					commitSha: typeof body.commitSha === "string" ? body.commitSha : null,
					previousCommitSha:
						typeof body.previousCommitSha === "string"
							? body.previousCommitSha
							: null,
					configDigest:
						typeof body.configDigest === "string" ? body.configDigest : null,
					summary,
					actorId,
					repositoryUrl,
					pullRequestUrl,
					causedByActionId:
						typeof body.causedByActionId === "string"
							? body.causedByActionId
							: null,
					agentRunId:
						typeof body.agentRunId === "string" ? body.agentRunId : null,
					touchedPaths,
					attributes,
					occurredAt:
						typeof body.occurredAt === "string" ? body.occurredAt : undefined,
				});
			} catch (err) {
				if (err instanceof InvalidTimestampError) {
					return c.json({ error: err.message }, 400);
				}
				throw err;
			}

			return c.json({ changeEvent, change: changeEvent }, 201);
		});

		// 2. Ontology Graph & Fault Localization
		app.get("/internal/ontology", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const environment = c.req.query("environment") || undefined;
			const traceId = c.req.query("traceId") || undefined;

			const graph = await getOntologyGraph(db, {
				projectId,
				environment,
			});
			const faultLocus = traceId
				? await loadTraceFaultLocusFromDb(db, projectId, traceId)
				: null;

			return c.json({
				...graph,
				faultLocus,
			});
		});

		// 3. Change Events Query & Blast Radius
		app.get("/internal/changes", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const rawKind = c.req.query("kind");
			const normalizedKind =
				rawKind === "agent_prompt_release" ? "prompt_rollout" : rawKind;
			if (normalizedKind && !CHANGE_KINDS.has(normalizedKind)) {
				return c.json({ error: `Invalid kind: ${rawKind}` }, 400);
			}
			try {
				const changes = await listChangeEvents(db, {
					projectId,
					environment: c.req.query("environment") || undefined,
					serviceName:
						c.req.query("serviceName") || c.req.query("service") || undefined,
					targetNodeId: c.req.query("targetNodeId") || undefined,
					kind: normalizedKind || undefined,
					since: c.req.query("since") || undefined,
					limit: parseLimit(c.req.query("limit"), 50),
				});
				return c.json({ changes });
			} catch (err) {
				if (err instanceof InvalidTimestampError) {
					return c.json({ error: err.message }, 400);
				}
				throw err;
			}
		});

		app.get("/internal/changes/:id/blast-radius", async (c) => {
			const projectId = getProjectId(c);
			const changeId = c.req.param("id");
			if (!changeId) {
				return c.json({ error: "changeId is required" }, 400);
			}
			const db = sqlDbFor(c.env);
			const minSampleRaw =
				c.req.query("minSample") ?? c.req.query("minComparableSample");
			const minSample = minSampleRaw
				? Number.parseInt(minSampleRaw, 10)
				: undefined;
			const blastRadius = await computeChangeBlastRadius(
				db,
				projectId,
				changeId,
				{
					environment: c.req.query("environment") || undefined,
					minComparableSample:
						minSample !== undefined && Number.isFinite(minSample)
							? minSample
							: undefined,
				},
			);
			if (!blastRadius) {
				return c.json({ error: "Change event not found" }, 404);
			}
			return c.json({ blastRadius, ...blastRadius });
		});

		// 4. Incident Investigations & Lease Coordination
		app.get("/internal/incidents", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const incidents = await listIncidentInvestigations(db, {
				projectId,
				environment: c.req.query("environment") || undefined,
				status: c.req.query("status") || undefined,
				limit: parseLimit(c.req.query("limit"), 50),
			});
			return c.json({ incidents });
		});

		app.post("/internal/incidents", async (c) => {
			const projectId = getProjectId(c);
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const targetNodeId =
				typeof body.targetNodeId === "string"
					? body.targetNodeId.trim()
					: typeof body.symptomNodeId === "string"
						? body.symptomNodeId.trim()
						: "";
			if (!targetNodeId) {
				return c.json({ error: "targetNodeId is required" }, 400);
			}
			const symptomAnchorKind = (
				typeof body.symptomAnchorKind === "string"
					? body.symptomAnchorKind
					: typeof body.triggerKind === "string"
						? body.triggerKind
						: "alert"
			) as EvidenceEntityKind;
			const symptomAnchorId =
				typeof body.symptomAnchorId === "string"
					? body.symptomAnchorId
					: typeof body.triggerEntityId === "string"
						? body.triggerEntityId
						: targetNodeId;

			const db = sqlDbFor(c.env);
			const result = await openOrDeduplicateIncident(db, projectId, {
				id: typeof body.id === "string" ? body.id : undefined,
				environment:
					typeof body.environment === "string" ? body.environment : undefined,
				targetNodeId,
				symptomCategory:
					typeof body.symptomCategory === "string"
						? body.symptomCategory
						: undefined,
				symptomAnchorKind,
				symptomAnchorId,
				symptomFingerprint:
					typeof body.symptomFingerprint === "string"
						? body.symptomFingerprint
						: typeof body.fingerprint === "string"
							? body.fingerprint
							: null,
				latestBundle:
					body.latestBundle &&
					typeof body.latestBundle === "object" &&
					!Array.isArray(body.latestBundle)
						? (body.latestBundle as Record<string, unknown>)
						: null,
			});
			return c.json(result, result.deduplicated ? 200 : 201);
		});

		app.post("/internal/incidents/:id/lease", async (c) => {
			const projectId = getProjectId(c);
			const incidentId = c.req.param("id");
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const runnerId =
				typeof body.runnerId === "string"
					? body.runnerId.trim()
					: typeof body.leaseOwner === "string"
						? body.leaseOwner.trim()
						: "";
			if (!runnerId) {
				return c.json({ error: "runnerId is required" }, 400);
			}
			const db = sqlDbFor(c.env);
			const leaseDurationSeconds =
				typeof body.leaseDurationSeconds === "number" &&
				Number.isFinite(body.leaseDurationSeconds)
					? body.leaseDurationSeconds
					: typeof body.ttlSeconds === "number" &&
							Number.isFinite(body.ttlSeconds)
						? body.ttlSeconds
						: typeof body.leaseDurationMs === "number" &&
								Number.isFinite(body.leaseDurationMs)
							? Math.ceil(body.leaseDurationMs / 1000)
							: undefined;
			const result = await acquireIncidentLease(db, projectId, incidentId, {
				environment:
					typeof body.environment === "string" ? body.environment : undefined,
				runnerId,
				leaseDurationSeconds,
			});
			return c.json(result, result.acquired ? 200 : 409);
		});

		app.post("/internal/incidents/:id/dispatch", async (c) => {
			const projectId = getProjectId(c);
			const incidentId = c.req.param("id");
			const body = await readJsonObject<Record<string, unknown>>(c);
			const webhookUrl =
				typeof body?.webhookUrl === "string"
					? body.webhookUrl
					: typeof body?.url === "string"
						? body.url
						: "";
			if (!webhookUrl) {
				return c.json({ error: "webhookUrl is required" }, 400);
			}
			const db = sqlDbFor(c.env);
			const result = await dispatchIncidentWebhook(db, projectId, incidentId, {
				url: webhookUrl,
				secret: typeof body?.secret === "string" ? body.secret : undefined,
				environment:
					typeof body?.environment === "string" ? body.environment : undefined,
				// Operator-level setting only: a request body must never be able to
				// turn off the SSRF guard.
				allowPrivateNetworks: c.env?.ALERT_WEBHOOK_ALLOW_PRIVATE === "true",
				logger: runtime.logger,
			});
			return c.json(result, result.delivered ? 200 : 502);
		});

		// 5. Investigation Findings & Counterfactual Verification
		app.get("/internal/findings", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const findings = await searchInvestigationFindings(db, {
				projectId,
				environment: c.req.query("environment") || undefined,
				fingerprint: c.req.query("fingerprint") || undefined,
				symptomEntityId: c.req.query("symptomEntityId") || undefined,
				rootCauseEntityId:
					c.req.query("rootCauseEntityId") ||
					c.req.query("faultLocusEntityId") ||
					undefined,
				causalVerificationStatus:
					(c.req.query("causalVerificationStatus") as
						| CausalVerificationStatus
						| undefined) || undefined,
				incidentId: c.req.query("incidentId") || undefined,
				limit: parseLimit(c.req.query("limit"), 20),
			});
			return c.json({ findings });
		});

		app.post("/internal/findings", async (c) => {
			const projectId = getProjectId(c);
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const title = typeof body.title === "string" ? body.title.trim() : "";
			const summary =
				typeof body.summary === "string" ? body.summary.trim() : "";
			const symptomEntityKind =
				typeof body.symptomEntityKind === "string"
					? body.symptomEntityKind.trim()
					: "";
			const symptomEntityId =
				typeof body.symptomEntityId === "string"
					? body.symptomEntityId.trim()
					: "";
			const faultLocusEntityKind =
				typeof body.faultLocusEntityKind === "string"
					? body.faultLocusEntityKind.trim()
					: "";
			const faultLocusEntityId =
				typeof body.faultLocusEntityId === "string"
					? body.faultLocusEntityId.trim()
					: "";

			if (
				!title ||
				!summary ||
				!symptomEntityKind ||
				!symptomEntityId ||
				!faultLocusEntityKind ||
				!faultLocusEntityId
			) {
				return c.json(
					{
						error:
							"title, summary, symptomEntityKind, symptomEntityId, faultLocusEntityKind, and faultLocusEntityId are required",
					},
					400,
				);
			}

			if (body.causalChain !== undefined && !Array.isArray(body.causalChain)) {
				return c.json({ error: "causalChain must be an array" }, 400);
			}
			for (const [i, triple] of (
				(body.causalChain as unknown[] | undefined) ?? []
			).entries()) {
				const predicate =
					triple && typeof triple === "object"
						? (triple as Record<string, unknown>).predicate
						: undefined;
				if (!EvidencePredicateSchema.safeParse(predicate).success) {
					return c.json(
						{
							error: `causalChain[${i}].predicate is not a known evidence predicate: ${String(predicate)}`,
						},
						400,
					);
				}
			}

			const db = sqlDbFor(c.env);
			const input: InvestigationFindingInput = {
				id: typeof body.id === "string" ? body.id : undefined,
				environment:
					typeof body.environment === "string" ? body.environment : undefined,
				incidentId:
					typeof body.incidentId === "string" ? body.incidentId : null,
				fingerprintInput:
					body.fingerprintInput && typeof body.fingerprintInput === "object"
						? (body.fingerprintInput as InvestigationFindingInput["fingerprintInput"])
						: undefined,
				title,
				summary,
				causalProofTier:
					typeof body.causalProofTier === "string"
						? (body.causalProofTier as CausalProofTier)
						: undefined,
				confidence:
					typeof body.confidence === "number" ? body.confidence : undefined,
				symptomEntityKind: symptomEntityKind as EvidenceEntityKind,
				symptomEntityId,
				faultLocusEntityKind: faultLocusEntityKind as EvidenceEntityKind,
				faultLocusEntityId,
				rootCauseEntityKind:
					typeof body.rootCauseEntityKind === "string"
						? (body.rootCauseEntityKind as EvidenceEntityKind)
						: null,
				rootCauseEntityId:
					typeof body.rootCauseEntityId === "string"
						? body.rootCauseEntityId
						: null,
				contributingChangeId:
					typeof body.contributingChangeId === "string"
						? body.contributingChangeId
						: null,
				cohortVerdict:
					typeof body.cohortVerdict === "string"
						? (body.cohortVerdict as CohortAttributionVerdict)
						: null,
				contendingTraceId:
					typeof body.contendingTraceId === "string"
						? body.contendingTraceId
						: null,
				causalChain: Array.isArray(body.causalChain)
					? (body.causalChain as InvestigationFindingInput["causalChain"])
					: [],
				citedEvidenceIds: Array.isArray(body.citedEvidenceIds)
					? body.citedEvidenceIds.filter(
							(id): id is string => typeof id === "string",
						)
					: [],
				agentRunId:
					typeof body.agentRunId === "string" ? body.agentRunId : null,
			};

			const finding = await recordInvestigationFinding(db, projectId, input, {
				logger: runtime.logger,
			});
			return c.json({ finding, id: finding.id }, 201);
		});

		app.post("/internal/findings/:id/counterfactual", async (c) => {
			const projectId = getProjectId(c);
			const findingId = c.req.param("id");
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const evalCaseId =
				typeof body.evalCaseId === "string" ? body.evalCaseId.trim() : "";
			const failingRunId =
				typeof body.failingRunId === "string" ? body.failingRunId.trim() : "";
			const passingRunIds = Array.isArray(body.passingRunIds)
				? body.passingRunIds.filter(
						(id): id is string => typeof id === "string" && id.trim() !== "",
					)
				: [];

			if (!evalCaseId || !failingRunId) {
				return c.json(
					{ error: "evalCaseId and failingRunId are required" },
					400,
				);
			}

			const db = sqlDbFor(c.env);
			try {
				const finding = await verifyPairedCounterfactualProof(
					db,
					projectId,
					findingId,
					{
						environment:
							typeof body.environment === "string"
								? body.environment
								: undefined,
						evalCaseId,
						failingRunId,
						passingRunIds,
						requiredTrials:
							typeof body.requiredTrials === "number" &&
							Number.isFinite(body.requiredTrials)
								? body.requiredTrials
								: undefined,
					},
				);
				return c.json({ verified: true, finding });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (err instanceof CounterfactualVerificationError) {
					const isNotFound = message.includes("not found in project");
					return c.json(
						{ verified: false, error: message, reason: message },
						isNotFound ? 404 : 422,
					);
				}
				return c.json({ verified: false, error: message }, 400);
			}
		});

		// 6. Remediation Proposals, Human Approval, Claim Grant, Watchdog
		app.get("/internal/remediations", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const proposals = await listRemediationProposals(db, {
				projectId,
				environment: c.req.query("environment") || undefined,
				incidentId: c.req.query("incidentId") || undefined,
				findingId: c.req.query("findingId") || undefined,
				status:
					(c.req.query("status") as RemediationProposalStatus | undefined) ||
					undefined,
				limit: parseLimit(c.req.query("limit"), 50),
			});
			return c.json({ proposals });
		});

		app.post("/internal/remediations/propose", async (c) => {
			const projectId = getProjectId(c);
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const incidentId =
				typeof body.incidentId === "string" ? body.incidentId.trim() : "";
			const findingId =
				typeof body.findingId === "string" ? body.findingId.trim() : "";
			const idempotencyKey =
				typeof body.idempotencyKey === "string"
					? body.idempotencyKey.trim()
					: "";
			const actionKind = (
				typeof body.actionKind === "string" ? body.actionKind.trim() : ""
			) as RemediationActionKind;
			const targetNodeId =
				typeof body.targetNodeId === "string" ? body.targetNodeId.trim() : "";

			if (
				!incidentId ||
				!findingId ||
				!idempotencyKey ||
				!REMEDIATION_ACTION_KINDS.has(actionKind) ||
				!targetNodeId
			) {
				return c.json(
					{
						error:
							"incidentId, findingId, idempotencyKey, valid actionKind, and targetNodeId are required",
					},
					400,
				);
			}

			const expectedCurrentState =
				body.expectedCurrentState &&
				typeof body.expectedCurrentState === "object" &&
				!Array.isArray(body.expectedCurrentState)
					? (body.expectedCurrentState as RemediationStateSpec)
					: {};
			const desiredTargetState =
				body.desiredTargetState &&
				typeof body.desiredTargetState === "object" &&
				!Array.isArray(body.desiredTargetState)
					? (body.desiredTargetState as RemediationStateSpec)
					: {};
			const requestedAutonomy: AgentAutonomyLevel = isAgentAutonomyLevel(
				body.requestedAutonomy,
			)
				? body.requestedAutonomy
				: "autonomous_write";

			const db = sqlDbFor(c.env);
			const input: RemediationProposalInput = {
				environment:
					typeof body.environment === "string" ? body.environment : undefined,
				incidentId,
				findingId,
				idempotencyKey,
				actionKind,
				targetNodeId,
				expectedCurrentState,
				desiredTargetState,
				requestedAutonomy,
			};

			try {
				const proposal = await proposeRemediationAction(db, projectId, input, {
					logger: runtime.logger,
				});
				const webhookDelivery = await deliverGrant(
					c.env,
					db,
					projectId,
					body,
					proposal,
				);
				return c.json(
					{
						proposal,
						...proposal,
						grantToken: proposal.grantToken ?? null,
						...(webhookDelivery ? { webhookDelivery } : {}),
					},
					201,
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 404 | 409)
						: 400;
				return c.json({ error: message }, status);
			}
		});

		app.post("/internal/remediations/:id/approve", async (c) => {
			const sessionCheck = await requireHumanDashboardSession(c);
			if (!sessionCheck.ok) {
				return c.json(
					{ error: "Forbidden", message: sessionCheck.message },
					403,
				);
			}
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const body =
				(await readJsonObject<Record<string, unknown>>(c).catch(() => null)) ??
				{};
			const environment =
				typeof body.environment === "string" ? body.environment : undefined;
			const approvedByUserId = sessionCheck.sessionActor;

			const db = sqlDbFor(c.env);
			try {
				const proposal = await approveRemediationProposal(
					db,
					projectId,
					proposalId,
					{
						environment,
						approvedByUserId,
					},
				);
				const webhookDelivery = await deliverGrant(
					c.env,
					db,
					projectId,
					body,
					proposal,
				);
				return c.json({
					proposal,
					...proposal,
					grantToken: proposal.grantToken ?? null,
					...(webhookDelivery ? { webhookDelivery } : {}),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 404 | 409)
						: 400;
				return c.json({ error: message }, status);
			}
		});

		app.post("/internal/remediations/:id/reject", async (c) => {
			const sessionCheck = await requireHumanDashboardSession(c);
			if (!sessionCheck.ok) {
				return c.json(
					{ error: "Forbidden", message: sessionCheck.message },
					403,
				);
			}
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const body =
				(await readJsonObject<Record<string, unknown>>(c).catch(() => null)) ??
				{};
			const environment =
				typeof body.environment === "string" ? body.environment : undefined;
			const reason = typeof body.reason === "string" ? body.reason : undefined;

			const db = sqlDbFor(c.env);
			try {
				const proposal = await rejectRemediationProposal(
					db,
					projectId,
					proposalId,
					{
						environment,
						rejectedByUserId: sessionCheck.sessionActor,
						reason,
					},
				);
				return c.json({ proposal, ...proposal });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 404 | 409)
						: 400;
				return c.json({ error: message }, status);
			}
		});

		app.post("/internal/remediations/:id/claim", async (c) => {
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const body = await readJsonObject<Record<string, unknown>>(c);
			if (!body) {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const grantToken =
				typeof body.grantToken === "string" ? body.grantToken.trim() : "";
			if (!grantToken) {
				return c.json({ error: "grantToken is required" }, 400);
			}
			const db = sqlDbFor(c.env);
			try {
				const proposal = await claimRemediationGrant(
					db,
					projectId,
					proposalId,
					{
						environment:
							typeof body.environment === "string"
								? body.environment
								: undefined,
						grantToken,
						runnerId:
							typeof body.runnerId === "string" ? body.runnerId : undefined,
						logger: runtime.logger,
					},
				);
				return c.json({ claimed: true, proposal, ...proposal });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 403 | 404 | 409 | 410)
						: 409;
				return c.json(
					{ claimed: false, error: message, reason: message },
					status,
				);
			}
		});

		app.post("/internal/remediations/:id/complete", async (c) => {
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const body =
				(await readJsonObject<Record<string, unknown>>(c).catch(() => null)) ??
				{};
			const runnerId =
				typeof body.runnerId === "string" && body.runnerId.trim()
					? body.runnerId.trim()
					: "autosre-runner";
			const db = sqlDbFor(c.env);
			try {
				const proposal = await completeRemediationProposal(
					db,
					projectId,
					proposalId,
					{
						environment:
							typeof body.environment === "string"
								? body.environment
								: undefined,
						runnerId,
						resultingChangeId:
							typeof body.resultingChangeId === "string"
								? body.resultingChangeId
								: null,
						remediationAgentRunId:
							typeof body.remediationAgentRunId === "string"
								? body.remediationAgentRunId
								: null,
					},
				);
				return c.json({ proposal, ...proposal });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 404 | 409)
						: 400;
				return c.json({ error: message }, status);
			}
		});

		app.post("/internal/remediations/:id/fail", async (c) => {
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const body =
				(await readJsonObject<Record<string, unknown>>(c).catch(() => null)) ??
				{};
			const runnerId =
				typeof body.runnerId === "string" && body.runnerId.trim()
					? body.runnerId.trim()
					: "autosre-runner";
			const db = sqlDbFor(c.env);
			try {
				const proposal = await failRemediationProposal(
					db,
					projectId,
					proposalId,
					{
						environment:
							typeof body.environment === "string"
								? body.environment
								: undefined,
						runnerId,
						failureReason:
							typeof body.failureReason === "string"
								? body.failureReason
								: "Execution failed",
					},
				);
				return c.json({ proposal, ...proposal });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				const status =
					err instanceof RemediationGateError
						? (err.statusCode as 400 | 404 | 409)
						: 400;
				return c.json({ error: message }, status);
			}
		});

		app.post("/internal/remediations/watchdog", async (c) => {
			const db = sqlDbFor(c.env);
			const body =
				(await readJsonObject<Record<string, unknown>>(c).catch(() => null)) ??
				{};
			// Scoped to the caller's project; the clock is never client-controlled
			// and the traffic floor can only be raised, never lowered, by a caller.
			const summary = await evaluateRemediationWatchdogs(db, {
				projectId: getProjectId(c),
				minComparableRequests:
					typeof body.minComparableRequests === "number" &&
					Number.isFinite(body.minComparableRequests)
						? Math.max(50, body.minComparableRequests)
						: undefined,
				logger: runtime.logger,
			});
			return c.json({ summary, ...summary });
		});

		app.get("/internal/remediations/:id", async (c) => {
			const projectId = getProjectId(c);
			const proposalId = c.req.param("id");
			const db = sqlDbFor(c.env);
			const proposal = await getRemediationProposal(
				db,
				projectId,
				proposalId,
				c.req.query("environment") || undefined,
			);
			if (!proposal) {
				return c.json({ error: "Proposal not found" }, 404);
			}
			return c.json({ proposal });
		});

		app.get("/internal/incidents/:id", async (c) => {
			const projectId = getProjectId(c);
			const incidentId = c.req.param("id");
			const environment = c.req.query("environment") || undefined;
			const db = sqlDbFor(c.env);
			const incident = await getIncidentInvestigation(
				db,
				projectId,
				incidentId,
				environment,
			);
			if (!incident) {
				return c.json({ error: "Incident not found" }, 404);
			}
			const [findings, proposals] = await Promise.all([
				searchInvestigationFindings(db, {
					projectId,
					environment: incident.environment,
					incidentId: incident.id,
					limit: 20,
				}),
				listRemediationProposals(db, {
					projectId,
					environment: incident.environment,
					incidentId: incident.id,
					limit: 20,
				}),
			]);
			return c.json({ incident, findings, proposals });
		});

		app.get("/internal/findings/:id", async (c) => {
			const projectId = getProjectId(c);
			const findingId = c.req.param("id");
			const db = sqlDbFor(c.env);
			const finding = await getInvestigationFinding(
				db,
				projectId,
				findingId,
				c.req.query("environment") || undefined,
			);
			if (!finding) {
				return c.json({ error: "Finding not found" }, 404);
			}
			return c.json({ finding });
		});

		app.get("/internal/changes/:id", async (c) => {
			const projectId = getProjectId(c);
			const changeId = c.req.param("id");
			const db = sqlDbFor(c.env);
			const changeEvent = await getChangeEvent(
				db,
				projectId,
				changeId,
				c.req.query("environment") || undefined,
			);
			if (!changeEvent) {
				return c.json({ error: "Change event not found" }, 404);
			}
			return c.json({ changeEvent, change: changeEvent });
		});
	},
};
