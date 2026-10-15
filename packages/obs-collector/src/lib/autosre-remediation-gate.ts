import type {
	CausalTriple,
	EvidenceEntityKind,
	IncidentInvestigation,
	IncidentStatus,
	RemediationActionKind,
	RemediationProposal,
	RemediationProposalInput,
	RemediationProposalStatus,
	RemediationStateSpec,
} from "@obsunified/types";
import { AgentAutonomyLevel } from "@obsunified/types/constants";
import { getInvestigationFinding } from "./autosre-findings";
import { randomHex, sha256Hex } from "./hash";
import { parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";
import { assertSafeWebhookUrl } from "./webhook-url";

interface IncidentRow {
	project_id: string;
	environment: string;
	id: string;
	dedup_key: string;
	status: string;
	target_node_id: string;
	symptom_anchor_kind: string;
	symptom_anchor_id: string;
	symptom_fingerprint: string | null;
	alert_count: number;
	latest_bundle_json: string | null;
	lease_owner_id: string | null;
	lease_expires_at: string | null;
	dispatch_attempts: number;
	last_dispatched_at: string | null;
	opened_at: string;
	updated_at: string;
	resolved_at: string | null;
	expires_at: string | null;
}

export const mapIncidentRow = (row: IncidentRow): IncidentInvestigation => ({
	id: row.id,
	projectId: row.project_id,
	environment: row.environment,
	dedupKey: row.dedup_key,
	status: row.status as IncidentStatus,
	targetNodeId: row.target_node_id,
	symptomAnchorKind: row.symptom_anchor_kind as EvidenceEntityKind,
	symptomAnchorId: row.symptom_anchor_id,
	symptomFingerprint: row.symptom_fingerprint,
	alertCount: Number(row.alert_count ?? 1),
	latestBundle: row.latest_bundle_json
		? (parseJsonRecord(row.latest_bundle_json) as Record<string, unknown>)
		: null,
	leaseOwnerId: row.lease_owner_id,
	leaseExpiresAt: row.lease_expires_at,
	dispatchAttempts: Number(row.dispatch_attempts ?? 0),
	lastDispatchedAt: row.last_dispatched_at,
	openedAt: row.opened_at,
	updatedAt: row.updated_at,
	resolvedAt: row.resolved_at,
	expiresAt: row.expires_at,
});

export const ACTIVE_INCIDENT_STATUSES: ReadonlySet<IncidentStatus> = new Set([
	"open",
	"dispatched",
	"leased",
	"remediating",
	"verifying",
]);

/**
 * Opens or deduplicates an active `incident_investigation` (RFC 0013 § 6.A & P2 #7).
 * Multiple firing alerts or webhook retries for the same `(project_id, environment, target_node_id, symptom_category)`
 * coalesce into a single active incident.
 */
export async function openOrDeduplicateIncident(
	db: SqlDb,
	projectId: string,
	input: {
		id?: string;
		environment?: string;
		targetNodeId: string;
		symptomCategory?: string;
		symptomAnchorKind: EvidenceEntityKind;
		symptomAnchorId: string;
		symptomFingerprint?: string | null;
		latestBundle?: Record<string, unknown> | null;
	},
): Promise<{ incident: IncidentInvestigation; deduplicated: boolean }> {
	const nowIso = new Date().toISOString();
	const environment = (input.environment || "default").trim().toLowerCase();
	const category = (
		input.symptomCategory ??
		input.symptomFingerprint ??
		`${input.symptomAnchorKind}:${input.symptomAnchorId}`
	).trim();
	const dedupKey = await sha256Hex(
		`${projectId}::${environment}::${input.targetNodeId}::${category}`,
	);

	const existing = await db
		.prepare(
			`SELECT * FROM incident_investigations
			 WHERE project_id = ?
			   AND environment = ?
			   AND dedup_key = ?
			   AND status IN ('open', 'dispatched', 'leased', 'remediating', 'verifying')
			 ORDER BY opened_at DESC
			 LIMIT 1`,
		)
		.bind(projectId, environment, dedupKey)
		.first<IncidentRow>();

	if (existing) {
		await db
			.prepare(
				`UPDATE incident_investigations
				 SET alert_count = alert_count + 1,
				     latest_bundle_json = COALESCE(?, latest_bundle_json),
				     symptom_fingerprint = COALESCE(?, symptom_fingerprint),
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(
				input.latestBundle ? JSON.stringify(input.latestBundle) : null,
				input.symptomFingerprint ?? null,
				nowIso,
				projectId,
				environment,
				existing.id,
			)
			.run();

		const updated = await getIncidentInvestigation(
			db,
			projectId,
			existing.id,
			environment,
		);
		return {
			incident: updated ?? mapIncidentRow(existing),
			deduplicated: true,
		};
	}

	const id = input.id?.trim() || `inc_${randomHex(10)}`;
	const expiresAt = new Date(
		Date.now() + 30 * 24 * 3600_000,
	).toISOString();

	await db
		.prepare(
			`INSERT INTO incident_investigations (
				project_id, environment, id, dedup_key, status, target_node_id,
				symptom_anchor_kind, symptom_anchor_id, symptom_fingerprint,
				alert_count, latest_bundle_json, dispatch_attempts,
				opened_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)`,
		)
		.bind(
			projectId,
			environment,
			id,
			dedupKey,
			input.targetNodeId,
			input.symptomAnchorKind,
			input.symptomAnchorId,
			input.symptomFingerprint ?? null,
			input.latestBundle ? JSON.stringify(input.latestBundle) : null,
			nowIso,
			nowIso,
			expiresAt,
		)
		.run();

	const created = await getIncidentInvestigation(db, projectId, id, environment);
	if (!created) {
		throw new Error(`Failed to load created incident ${id}`);
	}
	return { incident: created, deduplicated: false };
}

export async function getIncidentInvestigation(
	db: SqlDb,
	projectId: string,
	incidentId: string,
	environment?: string,
): Promise<IncidentInvestigation | null> {
	const row = environment
		? await db
				.prepare(
					`SELECT * FROM incident_investigations
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, environment.toLowerCase(), incidentId)
				.first<IncidentRow>()
		: await db
				.prepare(
					`SELECT * FROM incident_investigations
					 WHERE project_id = ? AND id = ?
					 ORDER BY opened_at DESC
					 LIMIT 1`,
				)
				.bind(projectId, incidentId)
				.first<IncidentRow>();

	return row ? mapIncidentRow(row) : null;
}

export async function listIncidentInvestigations(
	db: SqlDb,
	options: {
		projectId: string;
		environment?: string;
		status?: string;
		limit?: number;
	},
): Promise<IncidentInvestigation[]> {
	const conditions: string[] = ["project_id = ?"];
	const binds: unknown[] = [options.projectId];

	if (options.environment) {
		conditions.push("environment = ?");
		binds.push(options.environment.toLowerCase());
	}
	if (options.status) {
		conditions.push("status = ?");
		binds.push(options.status);
	}
	const limit = Math.max(1, Math.min(100, options.limit ?? 50));
	binds.push(limit);

	const rows = await db
		.prepare(
			`SELECT * FROM incident_investigations
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY opened_at DESC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<IncidentRow>();

	return rows.results.map(mapIncidentRow);
}

/**
 * Exclusive runner lease acquisition / renewal (RFC 0013 § 6.B & P2 #7).
 * Prevents competing AutoSRE runners from investigating or remediating the same
 * incident simultaneously.
 */
export async function acquireIncidentLease(
	db: SqlDb,
	projectId: string,
	incidentId: string,
	input: {
		environment?: string;
		runnerId: string;
		leaseDurationSeconds?: number;
		nowIso?: string;
	},
): Promise<
	| { acquired: true; incident: IncidentInvestigation }
	| {
			acquired: false;
			reason: string;
			conflictOwnerId: string | null;
			leaseExpiresAt: string | null;
	  }
> {
	const nowIso = input.nowIso ?? new Date().toISOString();
	const incident = await getIncidentInvestigation(
		db,
		projectId,
		incidentId,
		input.environment,
	);
	if (!incident) {
		return {
			acquired: false,
			reason: `Incident ${incidentId} not found`,
			conflictOwnerId: null,
			leaseExpiresAt: null,
		};
	}

	if (
		incident.leaseOwnerId &&
		incident.leaseOwnerId !== input.runnerId &&
		incident.leaseExpiresAt &&
		incident.leaseExpiresAt > nowIso
	) {
		return {
			acquired: false,
			reason: `Incident ${incidentId} is already leased by runner ${incident.leaseOwnerId} until ${incident.leaseExpiresAt}`,
			conflictOwnerId: incident.leaseOwnerId,
			leaseExpiresAt: incident.leaseExpiresAt,
		};
	}

	const durationSec = Math.max(
		15,
		Math.min(600, input.leaseDurationSeconds ?? 120),
	);
	const leaseExpiresAt = new Date(
		Date.parse(nowIso) + durationSec * 1000,
	).toISOString();
	const nextStatus: IncidentStatus =
		incident.status === "open" || incident.status === "dispatched"
			? "leased"
			: incident.status;

	await db
		.prepare(
			`UPDATE incident_investigations
			 SET lease_owner_id = ?,
			     lease_expires_at = ?,
			     status = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(
			input.runnerId,
			leaseExpiresAt,
			nextStatus,
			nowIso,
			projectId,
			incident.environment,
			incident.id,
		)
		.run();

	const updated = await getIncidentInvestigation(
		db,
		projectId,
		incident.id,
		incident.environment,
	);
	return {
		acquired: true,
		incident: updated ?? {
			...incident,
			leaseOwnerId: input.runnerId,
			leaseExpiresAt,
			status: nextStatus,
			updatedAt: nowIso,
		},
	};
}

async function computeHmacSha256Hex(
	secret: string,
	body: string,
): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		enc.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
	const bytes = new Uint8Array(sig);
	let hex = "";
	for (const b of bytes) hex += b.toString(16).padStart(2, "0");
	return hex;
}

/**
 * SSRF-safe, HMAC-SHA256 signed AutoSRE incident webhook outbox delivery
 * (RFC 0013 § 6.A).
 */
export async function dispatchIncidentWebhook(
	db: SqlDb,
	projectId: string,
	incidentId: string,
	webhook: {
		url: string;
		secret?: string;
		allowPrivateNetworks?: boolean;
		fetchImpl?: typeof fetch;
	},
): Promise<{ delivered: boolean; status?: number; error?: string }> {
	const incident = await getIncidentInvestigation(db, projectId, incidentId);
	if (!incident) {
		return { delivered: false, error: "Incident not found" };
	}
	if (incident.dispatchAttempts >= 5) {
		return { delivered: false, error: "MAX_DISPATCH_ATTEMPTS (5) exceeded" };
	}

	const safeUrl = assertSafeWebhookUrl(webhook.url, {
		allowPrivateNetworks: webhook.allowPrivateNetworks,
	});

	const nowIso = new Date().toISOString();
	const body = JSON.stringify({
		event: "autosre.incident.opened",
		incidentId: incident.id,
		projectId: incident.projectId,
		environment: incident.environment,
		targetNodeId: incident.targetNodeId,
		dedupKey: incident.dedupKey,
		symptomAnchor: {
			kind: incident.symptomAnchorKind,
			id: incident.symptomAnchorId,
		},
		bundle: incident.latestBundle,
		dispatchedAt: nowIso,
	});

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Obs-Incident-Id": incident.id,
		"X-Obs-Deduplication-Key": incident.dedupKey,
	};
	if (webhook.secret) {
		const hmac = await computeHmacSha256Hex(webhook.secret, body);
		headers["X-Obs-Signature-256"] = `sha256=${hmac}`;
	}

	const fetchFn = webhook.fetchImpl ?? fetch;
	let delivered = false;
	let status: number | undefined;
	let errorMsg: string | undefined;

	try {
		const res = await fetchFn(safeUrl.toString(), {
			method: "POST",
			headers,
			body,
		});
		status = res.status;
		delivered = res.ok;
		if (!res.ok) {
			errorMsg = `HTTP ${res.status}`;
		}
	} catch (err) {
		errorMsg = err instanceof Error ? err.message : String(err);
	}

	await db
		.prepare(
			`UPDATE incident_investigations
			 SET dispatch_attempts = dispatch_attempts + 1,
			     last_dispatched_at = ?,
			     status = CASE WHEN ? = 1 AND status = 'open' THEN 'dispatched' ELSE status END,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(
			nowIso,
			delivered ? 1 : 0,
			nowIso,
			projectId,
			incident.environment,
			incident.id,
		)
		.run();

	return { delivered, status, error: errorMsg };
}

interface ProposalRow {
	project_id: string;
	environment: string;
	id: string;
	incident_id: string;
	finding_id: string;
	idempotency_key: string;
	action_kind: string;
	target_node_id: string;
	expected_current_state_json: string;
	desired_target_state_json: string;
	requested_autonomy: string;
	effective_autonomy: string;
	policy_decision_reason: string;
	status: string;
	grant_token_hash: string | null;
	grant_expires_at: string | null;
	approved_by_user_id: string | null;
	approved_at: string | null;
	claimed_by_runner_id: string | null;
	claimed_at: string | null;
	claim_expires_at: string | null;
	remediation_agent_run_id: string | null;
	resulting_change_id: string | null;
	failure_reason: string | null;
	created_at: string;
	updated_at: string;
	expires_at: string | null;
}

export const mapProposalRow = (
	row: ProposalRow,
	grantToken?: string,
): RemediationProposal => ({
	id: row.id,
	projectId: row.project_id,
	environment: row.environment,
	incidentId: row.incident_id,
	findingId: row.finding_id,
	idempotencyKey: row.idempotency_key,
	actionKind: row.action_kind as RemediationActionKind,
	targetNodeId: row.target_node_id,
	expectedCurrentState: parseJsonRecord(
		row.expected_current_state_json,
	) as unknown as RemediationStateSpec,
	desiredTargetState: parseJsonRecord(
		row.desired_target_state_json,
	) as unknown as RemediationStateSpec,
	requestedAutonomy: row.requested_autonomy as AgentAutonomyLevel,
	effectiveAutonomy: row.effective_autonomy as AgentAutonomyLevel,
	policyDecisionReason: row.policy_decision_reason,
	status: row.status as RemediationProposalStatus,
	grantExpiresAt: row.grant_expires_at,
	approvedByUserId: row.approved_by_user_id,
	approvedAt: row.approved_at,
	claimedByRunnerId: row.claimed_by_runner_id,
	claimedAt: row.claimed_at,
	claimExpiresAt: row.claim_expires_at,
	remediationAgentRunId: row.remediation_agent_run_id,
	resultingChangeId: row.resulting_change_id,
	failureReason: row.failure_reason,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	expiresAt: row.expires_at,
	...(grantToken ? { grantToken } : {}),
});

/**
 * Evaluates the RFC 0013 § 6.B Action-Specific Authorization Matrix & Circuit Breaker
 * (resolving P1 #1 and P1 #4).
 */
function evaluateActionPolicyMatrix(
	actionKind: RemediationActionKind,
	causalProofTier: string,
	recentProposalsLastHour: number,
): {
	effectiveAutonomy: AgentAutonomyLevel;
	reason: string;
} {
	if (recentProposalsLastHour >= 3) {
		return {
			effectiveAutonomy: AgentAutonomyLevel.BlockedByPolicy,
			reason: `Circuit breaker tripped: ${recentProposalsLastHour} remediation proposals already recorded in the last hour for this target/fingerprint (max 3/hr)`,
		};
	}

	switch (actionKind) {
		case "open_code_pr": {
			if (
				causalProofTier === "counterfactual_verified" ||
				causalProofTier === "cohort_rate_isolated" ||
				causalProofTier === "corroborated_candidate"
			) {
				return {
					effectiveAutonomy: AgentAutonomyLevel.AutonomousWrite,
					reason: `Non-merging PR creation permitted as autonomous_write for causalProofTier=${causalProofTier}`,
				};
			}
			return {
				effectiveAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
				reason: `open_code_pr requires human_approved_write when causalProofTier=${causalProofTier}`,
			};
		}
		case "toggle_feature_flag":
		case "rollback_deploy": {
			if (
				causalProofTier === "counterfactual_verified" ||
				causalProofTier === "cohort_rate_isolated"
			) {
				return {
					effectiveAutonomy: AgentAutonomyLevel.AutonomousWrite,
					reason: `${actionKind} authorized as autonomous_write with causalProofTier=${causalProofTier}`,
				};
			}
			if (causalProofTier === "corroborated_candidate") {
				return {
					effectiveAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
					reason: `${actionKind} with causalProofTier=corroborated_candidate (structural overlap or sequential cutover without concurrent cohort isolation) requires human_approved_write`,
				};
			}
			return {
				effectiveAutonomy: AgentAutonomyLevel.BlockedByPolicy,
				reason: `${actionKind} blocked_by_policy: causalProofTier=${causalProofTier} (unverified fault locus cannot authorize production ${actionKind})`,
			};
		}
		case "apply_config":
		case "promote_agent_prompt": {
			if (causalProofTier === "counterfactual_verified") {
				return {
					effectiveAutonomy: AgentAutonomyLevel.AutonomousWrite,
					reason: `${actionKind} authorized as autonomous_write with counterfactual_verified proof`,
				};
			}
			if (
				causalProofTier === "cohort_rate_isolated" ||
				causalProofTier === "corroborated_candidate"
			) {
				return {
					effectiveAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
					reason: `${actionKind} requires counterfactual_verified for autonomous_write; parked for human_approved_write (tier=${causalProofTier})`,
				};
			}
			return {
				effectiveAutonomy: AgentAutonomyLevel.BlockedByPolicy,
				reason: `${actionKind} blocked_by_policy: causalProofTier=${causalProofTier}`,
			};
		}
	}
}

export class RemediationGateError extends Error {
	constructor(
		message: string,
		readonly statusCode: number = 400,
	) {
		super(message);
		this.name = "RemediationGateError";
	}
}

/**
 * Pre-execution remediation proposal gate (RFC 0013 § 6.B & P1 #4).
 */
export async function proposeRemediationAction(
	db: SqlDb,
	projectId: string,
	input: RemediationProposalInput,
): Promise<RemediationProposal> {
	const nowIso = new Date().toISOString();
	const environment = (input.environment || "default").trim().toLowerCase();

	// 1. Check idempotency key first
	const existing = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND idempotency_key = ?`,
		)
		.bind(projectId, environment, input.idempotencyKey)
		.first<ProposalRow>();

	if (existing) {
		if (
			existing.action_kind !== input.actionKind ||
			existing.target_node_id !== input.targetNodeId
		) {
			throw new RemediationGateError(
				`Idempotency key ${input.idempotencyKey} already used for a different action or target node`,
				409,
			);
		}
		return mapProposalRow(existing);
	}

	const finding = await getInvestigationFinding(
		db,
		projectId,
		input.findingId,
		environment,
	);
	if (!finding) {
		throw new RemediationGateError(
			`Finding ${input.findingId} not found in environment ${environment}`,
			404,
		);
	}

	// 2. Circuit breaker count in last 60 minutes
	const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
	const recentCountRow = await db
		.prepare(
			`SELECT COUNT(*) AS cnt FROM remediation_proposals
			 WHERE project_id = ?
			   AND environment = ?
			   AND target_node_id = ?
			   AND created_at >= ?`,
		)
		.bind(projectId, environment, input.targetNodeId, oneHourAgo)
		.first<{ cnt: number }>();

	const recentCount = Number(recentCountRow?.cnt ?? 0);
	const requestedAutonomy =
		input.requestedAutonomy ?? AgentAutonomyLevel.AutonomousWrite;

	const policy = evaluateActionPolicyMatrix(
		input.actionKind,
		finding.causalProofTier,
		recentCount,
	);

	// Never escalate autonomy higher than what the caller requested
	let effectiveAutonomy = policy.effectiveAutonomy;
	let policyReason = policy.reason;
	if (
		requestedAutonomy === AgentAutonomyLevel.HumanApprovedWrite &&
		effectiveAutonomy === AgentAutonomyLevel.AutonomousWrite
	) {
		effectiveAutonomy = AgentAutonomyLevel.HumanApprovedWrite;
		policyReason = `Caller explicitly requested human_approved_write (${policy.reason})`;
	}

	let status: RemediationProposalStatus = "pending_human_approval";
	let grantToken: string | undefined;
	let grantTokenHash: string | null = null;
	let grantExpiresAt: string | null = null;

	if (effectiveAutonomy === AgentAutonomyLevel.AutonomousWrite) {
		status = "grant_issued";
		grantToken = `rgt_${randomHex(16)}`;
		grantTokenHash = await sha256Hex(grantToken);
		grantExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
	} else if (effectiveAutonomy === AgentAutonomyLevel.BlockedByPolicy) {
		status = "rejected";
	}

	const id = `rem_${randomHex(10)}`;
	const expiresAt = new Date(
		Date.now() + 30 * 24 * 3600_000,
	).toISOString();

	await db
		.prepare(
			`INSERT INTO remediation_proposals (
				project_id, environment, id, incident_id, finding_id,
				idempotency_key, action_kind, target_node_id,
				expected_current_state_json, desired_target_state_json,
				requested_autonomy, effective_autonomy, policy_decision_reason,
				status, grant_token_hash, grant_expires_at,
				created_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			projectId,
			environment,
			id,
			input.incidentId,
			input.findingId,
			input.idempotencyKey,
			input.actionKind,
			input.targetNodeId,
			JSON.stringify(input.expectedCurrentState),
			JSON.stringify(input.desiredTargetState),
			requestedAutonomy,
			effectiveAutonomy,
			policyReason,
			status,
			grantTokenHash,
			grantExpiresAt,
			nowIso,
			nowIso,
			expiresAt,
		)
		.run();

	const created = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, environment, id)
		.first<ProposalRow>();

	if (!created) {
		throw new Error(`Failed to load created remediation proposal ${id}`);
	}
	return mapProposalRow(created, grantToken);
}

export async function getRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	environment?: string,
): Promise<RemediationProposal | null> {
	const row = environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 ORDER BY created_at DESC
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	return row ? mapProposalRow(row) : null;
}

export async function listRemediationProposals(
	db: SqlDb,
	options: {
		projectId: string;
		environment?: string;
		status?: string;
		incidentId?: string;
		findingId?: string;
		limit?: number;
	},
): Promise<RemediationProposal[]> {
	const conditions: string[] = ["project_id = ?"];
	const binds: unknown[] = [options.projectId];

	if (options.environment) {
		conditions.push("environment = ?");
		binds.push(options.environment.toLowerCase());
	}
	if (options.status) {
		conditions.push("status = ?");
		binds.push(options.status);
	}
	if (options.incidentId) {
		conditions.push("incident_id = ?");
		binds.push(options.incidentId);
	}
	if (options.findingId) {
		conditions.push("finding_id = ?");
		binds.push(options.findingId);
	}

	const limit = Math.max(1, Math.min(100, options.limit ?? 50));
	binds.push(limit);

	const rows = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY created_at DESC
			 LIMIT ?`,
		)
		.bind(...binds)
		.all<ProposalRow>();

	return rows.results.map((r) => mapProposalRow(r));
}

/**
 * Human dashboard session approval for `pending_human_approval` proposals
 * (RFC 0013 § 6.B & P1 #4). Mints a single-use `grantToken`.
 */
export async function approveRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		approvedByUserId: string;
	},
): Promise<RemediationProposal> {
	const row = options.environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, options.environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (row.status !== "pending_human_approval") {
		throw new RemediationGateError(
			`Proposal ${proposalId} cannot be approved from status=${row.status}`,
			409,
		);
	}

	const nowIso = new Date().toISOString();
	const grantToken = `rgt_${randomHex(16)}`;
	const grantTokenHash = await sha256Hex(grantToken);
	const grantExpiresAt = new Date(Date.now() + 5 * 60_000).toISOString();

	await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'grant_issued',
			     grant_token_hash = ?,
			     grant_expires_at = ?,
			     approved_by_user_id = ?,
			     approved_at = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(
			grantTokenHash,
			grantExpiresAt,
			options.approvedByUserId,
			nowIso,
			nowIso,
			projectId,
			row.environment,
			row.id,
		)
		.run();

	const updated = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.id)
		.first<ProposalRow>();

	return mapProposalRow(updated ?? row, grantToken);
}

export async function rejectRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		rejectedByUserId: string;
		reason?: string;
	},
): Promise<RemediationProposal> {
	const row = options.environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, options.environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (
		row.status !== "pending_human_approval" &&
		row.status !== "grant_issued"
	) {
		throw new RemediationGateError(
			`Proposal ${proposalId} cannot be rejected from status=${row.status}`,
			409,
		);
	}

	const nowIso = new Date().toISOString();
	const reason = options.reason
		? `Rejected by ${options.rejectedByUserId}: ${options.reason}`
		: `Rejected by ${options.rejectedByUserId}`;

	await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'rejected',
			     grant_token_hash = NULL,
			     failure_reason = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(reason, nowIso, projectId, row.environment, row.id)
		.run();

	const updated = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.id)
		.first<ProposalRow>();

	return mapProposalRow(updated ?? row);
}

/**
 * Single-use grant redemption with optimistic `expectedCurrentState` verification
 * against `ontology_nodes` (RFC 0013 § 6.B & P1 #4).
 */
export async function claimRemediationGrant(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		grantToken: string;
		runnerId?: string;
		nowIso?: string;
	},
): Promise<RemediationProposal> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = options.environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, options.environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (row.status !== "grant_issued") {
		throw new RemediationGateError(
			`Grant cannot be claimed from status=${row.status} (grants are single-use)`,
			409,
		);
	}
	if (row.grant_expires_at && row.grant_expires_at <= nowIso) {
		await db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'expired', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(nowIso, projectId, row.environment, row.id)
			.run();
		throw new RemediationGateError(
			`Grant for proposal ${proposalId} expired at ${row.grant_expires_at}`,
			410,
		);
	}

	const incomingHash = await sha256Hex(options.grantToken);
	if (!row.grant_token_hash || incomingHash !== row.grant_token_hash) {
		throw new RemediationGateError("Invalid grantToken", 403);
	}

	// Optimistic version/commit/config check against ontology_nodes
	const expected = parseJsonRecord(
		row.expected_current_state_json,
	) as unknown as RemediationStateSpec;
	const targetNode = await db
		.prepare(
			`SELECT current_version, current_commit_sha, current_config_digest
			 FROM ontology_nodes
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.target_node_id)
		.first<{
			current_version: string | null;
			current_commit_sha: string | null;
			current_config_digest: string | null;
		}>();

	if (targetNode) {
		if (
			expected.version &&
			targetNode.current_version &&
			targetNode.current_version !== expected.version
		) {
			throw new RemediationGateError(
				`Optimistic version lock failed on ${row.target_node_id}: expected version "${expected.version}", but current version is "${targetNode.current_version}"`,
				409,
			);
		}
		if (
			expected.commitSha &&
			targetNode.current_commit_sha &&
			targetNode.current_commit_sha !== expected.commitSha
		) {
			throw new RemediationGateError(
				`Optimistic commit lock failed on ${row.target_node_id}: expected commit "${expected.commitSha}", but current commit is "${targetNode.current_commit_sha}"`,
				409,
			);
		}
		if (
			expected.configDigest &&
			targetNode.current_config_digest &&
			targetNode.current_config_digest !== expected.configDigest
		) {
			throw new RemediationGateError(
				`Optimistic config lock failed on ${row.target_node_id}: expected digest "${expected.configDigest}", but current digest is "${targetNode.current_config_digest}"`,
				409,
			);
		}
	}

	const claimExpiresAt = new Date(
		Date.parse(nowIso) + 5 * 60_000,
	).toISOString();

	await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'claimed_executing',
				     grant_token_hash = NULL,
				     claimed_by_runner_id = ?,
				     claimed_at = ?,
				     claim_expires_at = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(
				options.runnerId ?? "autosre-runner",
				nowIso,
				claimExpiresAt,
				nowIso,
				projectId,
				row.environment,
				row.id,
			),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'remediating', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(nowIso, projectId, row.environment, row.incident_id),
	]);

	const updated = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.id)
		.first<ProposalRow>();

	return mapProposalRow(updated ?? row);
}

/**
 * Records remediation completion, updates `ontology_nodes` to desired state,
 * and arms the +2m/+5m/+15m post-remediation watchdog on the finding.
 */
export async function completeRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		resultingChangeId?: string | null;
		remediationAgentRunId?: string | null;
		baselineRequestRatePerMin?: number | null;
		nowIso?: string;
	},
): Promise<RemediationProposal> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = options.environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, options.environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (row.status !== "claimed_executing") {
		throw new RemediationGateError(
			`Proposal ${proposalId} cannot be completed from status=${row.status} (must be claimed_executing)`,
			409,
		);
	}

	const desired = parseJsonRecord(
		row.desired_target_state_json,
	) as unknown as RemediationStateSpec;
	const nextWatchdogAt = new Date(
		Date.parse(nowIso) + 2 * 60_000,
	).toISOString();

	const finding = await getInvestigationFinding(
		db,
		projectId,
		row.finding_id,
		row.environment,
	);
	const updatedChain: CausalTriple[] = finding ? [...finding.causalChain] : [];
	if (options.resultingChangeId) {
		updatedChain.push({
			subjectKind: "finding",
			subjectId: row.finding_id,
			predicate: "mitigated_by_change",
			objectKind: "change",
			objectId: options.resultingChangeId,
			relationshipCertainty: "exact",
			causalProofTier: finding?.causalProofTier ?? "cohort_rate_isolated",
			confidence: 0.9,
			reason: `Remediation proposal ${row.id} (${row.action_kind}) applied change ${options.resultingChangeId}`,
		});
	}
	if (options.remediationAgentRunId) {
		updatedChain.push({
			subjectKind: "finding",
			subjectId: row.finding_id,
			predicate: "remediated_by_agent_run",
			objectKind: "agent_run",
			objectId: options.remediationAgentRunId,
			relationshipCertainty: "exact",
			causalProofTier: finding?.causalProofTier ?? "cohort_rate_isolated",
			confidence: 0.9,
			reason: `Remediation executed by agent run ${options.remediationAgentRunId}`,
		});
	}

	await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'completed',
				     resulting_change_id = COALESCE(?, resulting_change_id),
				     remediation_agent_run_id = COALESCE(?, remediation_agent_run_id),
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(
				options.resultingChangeId ?? null,
				options.remediationAgentRunId ?? null,
				nowIso,
				projectId,
				row.environment,
				row.id,
			),
		db
			.prepare(
				`UPDATE ontology_nodes
				 SET current_version = COALESCE(?, current_version),
				     current_commit_sha = COALESCE(?, current_commit_sha),
				     current_config_digest = COALESCE(?, current_config_digest),
				     last_seen_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(
				desired.version ?? null,
				desired.commitSha ?? null,
				desired.configDigest ?? null,
				nowIso,
				projectId,
				row.environment,
				row.target_node_id,
			),
		db
			.prepare(
				`UPDATE investigation_findings
				 SET recovery_status = 'monitoring',
				     watchdog_step = 1,
				     baseline_request_rate_per_min = COALESCE(?, baseline_request_rate_per_min),
				     next_watchdog_check_at = ?,
				     causal_chain_json = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(
				options.baselineRequestRatePerMin ?? null,
				nextWatchdogAt,
				JSON.stringify(updatedChain),
				nowIso,
				projectId,
				row.environment,
				row.finding_id,
			),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'verifying', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(nowIso, projectId, row.environment, row.incident_id),
	]);

	const updated = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.id)
		.first<ProposalRow>();

	return mapProposalRow(updated ?? row);
}

export async function failRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		failureReason: string;
		nowIso?: string;
	},
): Promise<RemediationProposal> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = options.environment
		? await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(projectId, options.environment.toLowerCase(), proposalId)
				.first<ProposalRow>()
		: await db
				.prepare(
					`SELECT * FROM remediation_proposals
					 WHERE project_id = ? AND id = ?
					 LIMIT 1`,
				)
				.bind(projectId, proposalId)
				.first<ProposalRow>();

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}

	await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'failed_execution',
				     failure_reason = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(options.failureReason, nowIso, projectId, row.environment, row.id),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'escalated', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?`,
			)
			.bind(nowIso, projectId, row.environment, row.incident_id),
	]);

	const updated = await db
		.prepare(
			`SELECT * FROM remediation_proposals
			 WHERE project_id = ? AND environment = ? AND id = ?`,
		)
		.bind(projectId, row.environment, row.id)
		.first<ProposalRow>();

	return mapProposalRow(updated ?? row);
}

export interface WatchdogEvaluationSummary {
	evaluated: number;
	recovered: number;
	inconclusiveLowTraffic: number;
	stillDegraded: number;
	timedOutClaims: number;
	expiredGrants: number;
}

/**
 * Post-Remediation Watchdog & Lease/Claim Timeout Evaluator (RFC 0013 § 5.B, § 6.B & P1 #3).
 *
 * Strictly separates:
 *  - `recovery_status`: whether the service recovered under comparable traffic (`N >= minComparableRequests`)
 *  - `causal_verification_status`: `"operationally_corroborated"` (never promoted to `"counterfactual_verified"`
 *    by telemetry recovery alone!).
 */
export async function evaluateRemediationWatchdogs(
	db: SqlDb,
	options: {
		nowIso?: string;
		minComparableRequests?: number;
	} = {},
): Promise<WatchdogEvaluationSummary> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const minComparableRequests = options.minComparableRequests ?? 50;

	// 1. Expire unclaimed grants past grant_expires_at
	const expiredGrantsRes = await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'expired', grant_token_hash = NULL, updated_at = ?
			 WHERE status = 'grant_issued'
			   AND grant_expires_at IS NOT NULL
			   AND grant_expires_at <= ?`,
		)
		.bind(nowIso, nowIso)
		.run();

	// 2. Time out claimed_executing proposals past claim_expires_at and escalate their incidents
	const timedOutRows = await db
		.prepare(
			`SELECT project_id, environment, id, incident_id
			 FROM remediation_proposals
			 WHERE status = 'claimed_executing'
			   AND claim_expires_at IS NOT NULL
			   AND claim_expires_at <= ?`,
		)
		.bind(nowIso)
		.all<{
			project_id: string;
			environment: string;
			id: string;
			incident_id: string;
		}>();

	for (const t of timedOutRows.results) {
		await db.batch([
			db
				.prepare(
					`UPDATE remediation_proposals
					 SET status = 'execution_timed_out',
					     failure_reason = 'Runner did not complete or fail within 5m claim window',
					     updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(nowIso, t.project_id, t.environment, t.id),
			db
				.prepare(
					`UPDATE incident_investigations
					 SET status = 'escalated', updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(nowIso, t.project_id, t.environment, t.incident_id),
		]);
	}

	// 3. Evaluate findings in `monitoring` where `next_watchdog_check_at <= nowIso`
	const dueFindings = await db
		.prepare(
			`SELECT
				project_id, environment, id, incident_id,
				fault_locus_entity_id, root_cause_entity_id,
				watchdog_step, baseline_request_rate_per_min,
				causal_verification_status, updated_at
			 FROM investigation_findings
			 WHERE recovery_status = 'monitoring'
			   AND next_watchdog_check_at IS NOT NULL
			   AND next_watchdog_check_at <= ?
			 LIMIT 50`,
		)
		.bind(nowIso)
		.all<{
			project_id: string;
			environment: string;
			id: string;
			incident_id: string | null;
			fault_locus_entity_id: string;
			root_cause_entity_id: string | null;
			watchdog_step: number;
			baseline_request_rate_per_min: number | null;
			causal_verification_status: string;
			updated_at: string;
		}>();

	let recovered = 0;
	let inconclusiveLowTraffic = 0;
	let stillDegraded = 0;

	for (const f of dueFindings.results) {
		// Find the completed remediation timestamp for this finding
		const completedProposal = await db
			.prepare(
				`SELECT
					p.updated_at,
					p.target_node_id,
					p.resulting_change_id,
					c.occurred_at AS change_occurred_at
				 FROM remediation_proposals p
				 LEFT JOIN change_events c
				   ON c.project_id = p.project_id
				  AND c.environment = p.environment
				  AND c.id = p.resulting_change_id
				 WHERE p.project_id = ? AND p.environment = ? AND p.finding_id = ? AND p.status = 'completed'
				 ORDER BY p.updated_at DESC
				 LIMIT 1`,
			)
			.bind(f.project_id, f.environment, f.id)
			.first<{
				updated_at: string;
				target_node_id: string;
				resulting_change_id: string | null;
				change_occurred_at: string | null;
			}>();

		const sinceTs =
			completedProposal?.change_occurred_at ??
			completedProposal?.updated_at ??
			f.updated_at;
		const targetNodeId =
			completedProposal?.target_node_id ?? f.fault_locus_entity_id;

		// Extract service name from canonical service:{env}:{ns}:{serviceName} if applicable
		const parts = targetNodeId.split(":");
		const serviceName = parts[0] === "service" && parts.length >= 4 ? parts.slice(3).join(":") : null;

		const stats = serviceName
			? await db
					.prepare(
						`SELECT
							COUNT(*) AS total_requests,
							SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS error_requests
						 FROM telemetry_spans
						 WHERE project_id = ?
						   AND environment = ?
						   AND service_name = ?
						   AND (parent_span_id IS NULL OR span_kind = 1)
						   AND (start_time >= ? OR received_at >= ?)`,
					)
					.bind(f.project_id, f.environment, serviceName, sinceTs, sinceTs)
					.first<{ total_requests: number; error_requests: number }>()
			: await db
					.prepare(
						`SELECT
							COUNT(*) AS total_requests,
							SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS error_requests
						 FROM telemetry_spans
						 WHERE project_id = ?
						   AND environment = ?
						   AND (parent_span_id IS NULL OR span_kind = 1)
						   AND (start_time >= ? OR received_at >= ?)`,
					)
					.bind(f.project_id, f.environment, sinceTs, sinceTs)
					.first<{ total_requests: number; error_requests: number }>();

		const totalReq = Number(stats?.total_requests ?? 0);
		const errorReq = Number(stats?.error_requests ?? 0);
		const errorRate = totalReq > 0 ? errorReq / totalReq : 0;

		const requiredTraffic = Math.max(
			minComparableRequests,
			f.baseline_request_rate_per_min
				? Math.floor(0.5 * f.baseline_request_rate_per_min * 5)
				: minComparableRequests,
		);

		if (totalReq < requiredTraffic) {
			if (f.watchdog_step < 3) {
				const nextStep = f.watchdog_step + 1;
				const offsetMins = nextStep === 2 ? 5 : 15;
				const nextCheck = new Date(
					Date.parse(nowIso) + offsetMins * 60_000,
				).toISOString();
				await db
					.prepare(
						`UPDATE investigation_findings
						 SET watchdog_step = ?, next_watchdog_check_at = ?, updated_at = ?
						 WHERE project_id = ? AND environment = ? AND id = ?`,
					)
					.bind(nextStep, nextCheck, nowIso, f.project_id, f.environment, f.id)
					.run();
			} else {
				// Step 3 (+15m) with insufficient comparable traffic -> inconclusive_low_traffic
				inconclusiveLowTraffic += 1;
				await db
					.prepare(
						`UPDATE investigation_findings
						 SET recovery_status = 'inconclusive_low_traffic',
						     next_watchdog_check_at = NULL,
						     updated_at = ?
						 WHERE project_id = ? AND environment = ? AND id = ?`,
					)
					.bind(nowIso, f.project_id, f.environment, f.id)
					.run();
			}
			continue;
		}

		if (errorRate >= 0.05) {
			stillDegraded += 1;
			await db
				.prepare(
					`UPDATE investigation_findings
					 SET recovery_status = 'still_degraded',
					     causal_verification_status = 'refuted',
					     next_watchdog_check_at = NULL,
					     updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(nowIso, f.project_id, f.environment, f.id)
				.run();
			if (f.incident_id) {
				await db
					.prepare(
						`UPDATE incident_investigations
						 SET status = 'escalated', updated_at = ?
						 WHERE project_id = ? AND environment = ? AND id = ?`,
					)
					.bind(nowIso, f.project_id, f.environment, f.incident_id)
					.run();
			}
		} else {
			// Traffic is sufficient AND error rate recovered (<5%)
			recovered += 1;
			const nextCausalVerification =
				f.causal_verification_status === "counterfactual_verified"
					? "counterfactual_verified"
					: "operationally_corroborated";

			await db
				.prepare(
					`UPDATE investigation_findings
					 SET recovery_status = 'recovered',
					     causal_verification_status = ?,
					     watchdog_step = 3,
					     next_watchdog_check_at = NULL,
					     updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(
					nextCausalVerification,
					nowIso,
					f.project_id,
					f.environment,
					f.id,
				)
				.run();

			if (f.incident_id) {
				await db
					.prepare(
						`UPDATE incident_investigations
						 SET status = 'resolved', resolved_at = ?, updated_at = ?
						 WHERE project_id = ? AND environment = ? AND id = ?`,
					)
					.bind(nowIso, nowIso, f.project_id, f.environment, f.incident_id)
					.run();
			}
		}
	}

	return {
		evaluated: dueFindings.results.length,
		recovered,
		inconclusiveLowTraffic,
		stillDegraded,
		timedOutClaims: timedOutRows.results.length,
		expiredGrants: expiredGrantsRes.meta.changes,
	};
}
