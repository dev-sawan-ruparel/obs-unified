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
import { buildCanonicalNodeId } from "@obsunified/types";
import { AgentAutonomyLevel } from "@obsunified/types/constants";
import { consoleLogger, type Logger } from "../framework/logger";
import { getInvestigationFinding } from "./autosre-findings";
import { randomHex, sha256Hex } from "./hash";
import { parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";
import {
	assertSafeWebhookUrl,
	type HostLookup,
	resolveWebhookHost,
} from "./webhook-url";

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

const ACTIVE_STATUS_SQL =
	"('open', 'dispatched', 'leased', 'remediating', 'verifying')";

/**
 * Constant-time comparison for equal-purpose hex digests. Length is not secret
 * (always a SHA-256 hex digest), so a length mismatch returns early.
 */
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function loadProposalRow(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	environment?: string,
): Promise<ProposalRow | null> {
	return environment
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
}

/**
 * Resolves the environment and canonical node id an alert/analysis-triggered
 * incident should target. The environment is taken from the most recent span of
 * the service (rules and analyses carry no environment of their own); with no
 * service or no spans it falls back to `default` and the supplied node id.
 */
export async function resolveServiceIncidentTarget(
	db: SqlDb,
	projectId: string,
	serviceName: string | null | undefined,
	fallbackNodeId: string,
	logger: Logger = consoleLogger,
): Promise<{ environment: string; targetNodeId: string }> {
	const service = serviceName?.trim();
	if (!service) return { environment: "default", targetNodeId: fallbackNodeId };
	let environment = "default";
	try {
		const row = await db
			.prepare(
				`SELECT environment FROM telemetry_spans
				 WHERE project_id = ? AND service_name = ?
				 ORDER BY received_at DESC
				 LIMIT 1`,
			)
			.bind(projectId, service)
			.first<{ environment: string | null }>();
		if (row?.environment) environment = row.environment.trim().toLowerCase();
	} catch (err) {
		logger.warn("[autosre] could not resolve incident environment", {
			projectId,
			service,
			error: err instanceof Error ? err.message : String(err),
		});
	}
	return {
		environment,
		targetNodeId: buildCanonicalNodeId({
			kind: "service",
			environment,
			serviceName: service,
		}).id,
	};
}

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

	const selectActive = () =>
		db
			.prepare(
				`SELECT * FROM incident_investigations
				 WHERE project_id = ?
				   AND environment = ?
				   AND dedup_key = ?
				   AND status IN ${ACTIVE_STATUS_SQL}
				 ORDER BY opened_at DESC
				 LIMIT 1`,
			)
			.bind(projectId, environment, dedupKey)
			.first<IncidentRow>();

	const coalesceInto = async (
		row: IncidentRow,
	): Promise<{ incident: IncidentInvestigation; deduplicated: boolean }> => {
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
				row.id,
			)
			.run();

		const updated = await getIncidentInvestigation(
			db,
			projectId,
			row.id,
			environment,
		);
		return {
			incident: updated ?? mapIncidentRow(row),
			deduplicated: true,
		};
	};

	const existing = await selectActive();
	if (existing) return coalesceInto(existing);

	const id = input.id?.trim() || `inc_${randomHex(10)}`;
	const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

	// The partial unique index uq_incidents_active_dedup (migration 051) makes
	// a concurrent duplicate insert a no-op instead of a second active incident.
	const inserted = await db
		.prepare(
			`INSERT INTO incident_investigations (
				project_id, environment, id, dedup_key, status, target_node_id,
				symptom_anchor_kind, symptom_anchor_id, symptom_fingerprint,
				alert_count, latest_bundle_json, dispatch_attempts,
				opened_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, 1, ?, 0, ?, ?, ?)
			ON CONFLICT DO NOTHING`,
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

	if (inserted.meta.changes === 0) {
		// Lost the race to a concurrent opener: coalesce into the winner.
		const winner = await selectActive();
		if (winner) return coalesceInto(winner);
		throw new RemediationGateError(
			`Incident id ${id} already exists in environment ${environment}`,
			409,
		);
	}

	const created = await getIncidentInvestigation(
		db,
		projectId,
		id,
		environment,
	);
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
	const limit = Math.max(1, Math.min(200, options.limit ?? 50));
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

	if (!ACTIVE_INCIDENT_STATUSES.has(incident.status)) {
		return {
			acquired: false,
			reason: `Incident ${incidentId} is ${incident.status} and can no longer be leased`,
			conflictOwnerId: null,
			leaseExpiresAt: null,
		};
	}

	const durationSec = Math.max(
		15,
		Math.min(600, input.leaseDurationSeconds ?? 120),
	);
	const leaseExpiresAt = new Date(
		Date.parse(nowIso) + durationSec * 1000,
	).toISOString();

	// The lease precondition lives in the UPDATE itself so two runners racing
	// for the same incident cannot both succeed: only one sees changes === 1.
	const res = await db
		.prepare(
			`UPDATE incident_investigations
			 SET lease_owner_id = ?,
			     lease_expires_at = ?,
			     status = CASE WHEN status IN ('open', 'dispatched') THEN 'leased' ELSE status END,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?
			   AND status IN ${ACTIVE_STATUS_SQL}
			   AND (lease_owner_id IS NULL
			        OR lease_owner_id = ?
			        OR lease_expires_at IS NULL
			        OR lease_expires_at <= ?)`,
		)
		.bind(
			input.runnerId,
			leaseExpiresAt,
			nowIso,
			projectId,
			incident.environment,
			incident.id,
			input.runnerId,
			nowIso,
		)
		.run();

	const updated = await getIncidentInvestigation(
		db,
		projectId,
		incident.id,
		incident.environment,
	);
	if (res.meta.changes !== 1) {
		return {
			acquired: false,
			reason: `Incident ${incidentId} is already leased by runner ${updated?.leaseOwnerId ?? "unknown"} until ${updated?.leaseExpiresAt ?? "unknown"}`,
			conflictOwnerId: updated?.leaseOwnerId ?? null,
			leaseExpiresAt: updated?.leaseExpiresAt ?? null,
		};
	}
	return {
		acquired: true,
		incident: updated ?? {
			...incident,
			leaseOwnerId: input.runnerId,
			leaseExpiresAt,
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
 * Resolves the DNS-classification hook for hosts that can resolve names
 * (Node: `dns.lookup`). Workers cannot reach private networks from `fetch`, so
 * there the hook is left unset. The specifier is built at runtime so bundlers
 * for Workers do not try to resolve `node:dns` statically.
 */
async function defaultHostLookup(): Promise<HostLookup | undefined> {
	if (typeof process === "undefined" || !process.versions?.node) {
		return undefined;
	}
	try {
		const specifier = "node:dns/promises";
		const dns = (await import(/* @vite-ignore */ specifier)) as {
			lookup: (
				host: string,
				opts: { all: true; verbatim: true },
			) => Promise<Array<{ address: string }>>;
		};
		return async (hostname) =>
			(await dns.lookup(hostname, { all: true, verbatim: true })).map(
				(a) => a.address,
			);
	} catch {
		return undefined;
	}
}

/**
 * SSRF-safe, HMAC-SHA256 signed AutoSRE incident webhook outbox delivery
 * (RFC 0013 § 6.A). Mirrors the alert webhook delivery: literal host check,
 * DNS classification (fail closed on private/unresolvable), no redirects and
 * a 5s timeout.
 *
 * Grant handoff (RFC 0013 § 6.B): when `webhook.grant` is supplied the payload
 * is an `autosre.remediation.grant_issued` event carrying `proposalId`,
 * `status` and the plaintext `grantToken`. The plaintext token exists only at
 * approve/propose time (the DB keeps its hash), so the caller that mints it
 * must hand it to this function in the same request. Grant deliveries do not
 * count against the incident's 5-attempt dispatch budget.
 */
export async function dispatchIncidentWebhook(
	db: SqlDb,
	projectId: string,
	incidentId: string,
	webhook: {
		url: string;
		secret?: string;
		environment?: string;
		allowPrivateNetworks?: boolean;
		hostLookup?: HostLookup;
		fetchImpl?: typeof fetch;
		logger?: Logger;
		grant?: { proposalId: string; status: string; grantToken: string };
	},
): Promise<{ delivered: boolean; status?: number; error?: string }> {
	const logger = webhook.logger ?? consoleLogger;
	const incident = await getIncidentInvestigation(
		db,
		projectId,
		incidentId,
		webhook.environment,
	);
	if (!incident) {
		return { delivered: false, error: "Incident not found" };
	}
	if (!webhook.grant && incident.dispatchAttempts >= 5) {
		return { delivered: false, error: "MAX_DISPATCH_ATTEMPTS (5) exceeded" };
	}

	let safeUrl: URL;
	try {
		safeUrl = assertSafeWebhookUrl(webhook.url, {
			allowPrivateNetworks: webhook.allowPrivateNetworks,
		});
		if (!webhook.allowPrivateNetworks) {
			const lookup = webhook.hostLookup ?? (await defaultHostLookup());
			if (lookup) {
				const resolution = await resolveWebhookHost(safeUrl.hostname, lookup);
				if (resolution === "private") {
					throw new Error(
						`webhook host "${safeUrl.hostname}" resolves to a private address`,
					);
				}
				if (resolution === "unresolvable") {
					throw new Error(
						`webhook host "${safeUrl.hostname}" could not be resolved; refusing to deliver blind`,
					);
				}
			}
		}
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		logger.warn("[autosre] incident webhook target refused", {
			incidentId,
			error,
		});
		return { delivered: false, error };
	}

	const nowIso = new Date().toISOString();
	const body = JSON.stringify({
		event: webhook.grant
			? "autosre.remediation.grant_issued"
			: "autosre.incident.opened",
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
		...(webhook.grant
			? {
					proposalId: webhook.grant.proposalId,
					status: webhook.grant.status,
					grantToken: webhook.grant.grantToken,
				}
			: {}),
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
			// Never follow redirects: a 3xx could re-aim the POST (and its
			// signed body, which may carry a grant token) at another host.
			redirect: "manual",
			signal: AbortSignal.timeout(5000),
		});
		status = res.status;
		if (res.status >= 300 && res.status < 400) {
			errorMsg = `Redirect (HTTP ${res.status}) refused`;
		} else {
			delivered = res.ok;
			if (!res.ok) errorMsg = `HTTP ${res.status}`;
		}
	} catch (err) {
		errorMsg = err instanceof Error ? err.message : String(err);
	}

	if (!delivered) {
		logger.warn("[autosre] incident webhook delivery failed", {
			incidentId,
			error: errorMsg,
		});
	}

	if (webhook.grant) {
		return { delivered, status, error: errorMsg };
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
	// `recentProposalsLastHour` counts prior proposals only, so this proposal
	// would be the 4th within the hour once three already exist (max 3/hr).
	if (recentProposalsLastHour >= 3) {
		return {
			effectiveAutonomy: AgentAutonomyLevel.BlockedByPolicy,
			reason: `Circuit breaker tripped: ${recentProposalsLastHour} remediation proposals of this action kind already recorded in the last hour for this finding fingerprint (max 3/hr)`,
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
	options: { logger?: Logger } = {},
): Promise<RemediationProposal> {
	const logger = options.logger ?? consoleLogger;
	const nowIso = new Date().toISOString();
	const environment = (input.environment || "default").trim().toLowerCase();

	const loadByIdempotencyKey = () =>
		db
			.prepare(
				`SELECT * FROM remediation_proposals
				 WHERE project_id = ? AND environment = ? AND idempotency_key = ?`,
			)
			.bind(projectId, environment, input.idempotencyKey)
			.first<ProposalRow>();
	const replayExisting = (existing: ProposalRow): RemediationProposal => {
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
	};

	// 1. Check idempotency key first
	const existing = await loadByIdempotencyKey();
	if (existing) return replayExisting(existing);

	const incident = await getIncidentInvestigation(
		db,
		projectId,
		input.incidentId,
		environment,
	);
	if (!incident) {
		throw new RemediationGateError(
			`Incident ${input.incidentId} not found in environment ${environment}`,
			404,
		);
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

	// 2. Circuit breaker: proposals of the same action kind for the same finding
	// fingerprint in the last 60 minutes. Rejected and expired proposals never
	// executed, so they do not count against the budget.
	const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();
	const recentCountRow = await db
		.prepare(
			`SELECT COUNT(*) AS cnt
			 FROM remediation_proposals p
			 JOIN investigation_findings f
			   ON f.project_id = p.project_id
			  AND f.environment = p.environment
			  AND f.id = p.finding_id
			 WHERE p.project_id = ?
			   AND p.environment = ?
			   AND f.fingerprint = ?
			   AND p.action_kind = ?
			   AND p.status NOT IN ('rejected', 'expired')
			   AND p.created_at >= ?`,
		)
		.bind(
			projectId,
			environment,
			finding.fingerprint,
			input.actionKind,
			oneHourAgo,
		)
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
	} else if (
		(requestedAutonomy === AgentAutonomyLevel.ReadOnly ||
			requestedAutonomy === AgentAutonomyLevel.SuggestedAction) &&
		(effectiveAutonomy === AgentAutonomyLevel.AutonomousWrite ||
			effectiveAutonomy === AgentAutonomyLevel.HumanApprovedWrite)
	) {
		// A caller that only asked to read or suggest never gets a write grant;
		// a human can still approve the parked proposal explicitly.
		effectiveAutonomy = requestedAutonomy;
		policyReason = `Caller requested ${requestedAutonomy}; parked for human approval (${policy.reason})`;
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
	const expiresAt = new Date(Date.now() + 30 * 24 * 3600_000).toISOString();

	if (effectiveAutonomy === AgentAutonomyLevel.BlockedByPolicy) {
		logger.warn("[autosre] remediation proposal blocked by policy", {
			projectId,
			incidentId: input.incidentId,
			actionKind: input.actionKind,
			reason: policyReason,
		});
	}

	const insertRes = await db
		.prepare(
			`INSERT INTO remediation_proposals (
				project_id, environment, id, incident_id, finding_id,
				idempotency_key, action_kind, target_node_id,
				expected_current_state_json, desired_target_state_json,
				requested_autonomy, effective_autonomy, policy_decision_reason,
				status, grant_token_hash, grant_expires_at,
				created_at, updated_at, expires_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT DO NOTHING`,
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

	if (insertRes.meta.changes === 0) {
		// A concurrent request with the same idempotency key won the race
		// (UNIQUE project_id, environment, idempotency_key): replay its row.
		const winner = await loadByIdempotencyKey();
		if (winner) return replayExisting(winner);
		throw new RemediationGateError(
			`Remediation proposal ${id} conflicted with an existing row`,
			409,
		);
	}

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

	const limit = Math.max(1, Math.min(200, options.limit ?? 50));
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
 *
 * The status precondition lives in the UPDATE's WHERE clause (D1 and Postgres
 * have no multi-statement transactions beyond `batch`), so two concurrent
 * approvals cannot both mint a token: only one sees `meta.changes === 1`.
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
	const row = await loadProposalRow(
		db,
		projectId,
		proposalId,
		options.environment,
	);
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

	const res = await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'grant_issued',
			     grant_token_hash = ?,
			     grant_expires_at = ?,
			     approved_by_user_id = ?,
			     approved_at = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?
			   AND status = 'pending_human_approval'`,
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
	if (res.meta.changes !== 1) {
		throw new RemediationGateError(
			`Proposal ${proposalId} was modified concurrently and can no longer be approved`,
			409,
		);
	}

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
	const row = await loadProposalRow(
		db,
		projectId,
		proposalId,
		options.environment,
	);
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

	const res = await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'rejected',
			     grant_token_hash = NULL,
			     failure_reason = ?,
			     updated_at = ?
			 WHERE project_id = ? AND environment = ? AND id = ?
			   AND status IN ('pending_human_approval', 'grant_issued')`,
		)
		.bind(reason, nowIso, projectId, row.environment, row.id)
		.run();
	if (res.meta.changes !== 1) {
		throw new RemediationGateError(
			`Proposal ${proposalId} was modified concurrently and can no longer be rejected`,
			409,
		);
	}

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
 *
 * The status, token-hash and expiry preconditions are part of the claiming
 * UPDATE, and the outcome is read from `meta.changes`: of N concurrent claims
 * for one token exactly one sees `changes === 1`; the rest get a 409. The
 * incident transition rides in the same `batch` and is guarded by an EXISTS on
 * the winning claim, so a losing claim cannot touch the incident.
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
		logger?: Logger;
	},
): Promise<RemediationProposal> {
	const logger = options.logger ?? consoleLogger;
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = await loadProposalRow(
		db,
		projectId,
		proposalId,
		options.environment,
	);

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
				 SET status = 'expired', grant_token_hash = NULL, updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND status = 'grant_issued'`,
			)
			.bind(nowIso, projectId, row.environment, row.id)
			.run();
		throw new RemediationGateError(
			`Grant for proposal ${proposalId} expired at ${row.grant_expires_at}`,
			410,
		);
	}

	const incomingHash = await sha256Hex(options.grantToken);
	if (
		!row.grant_token_hash ||
		!constantTimeEqual(incomingHash, row.grant_token_hash)
	) {
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
		const lockFailure =
			expected.version &&
			targetNode.current_version &&
			targetNode.current_version !== expected.version
				? `Optimistic version lock failed on ${row.target_node_id}: expected version "${expected.version}", but current version is "${targetNode.current_version}"`
				: expected.commitSha &&
						targetNode.current_commit_sha &&
						targetNode.current_commit_sha !== expected.commitSha
					? `Optimistic commit lock failed on ${row.target_node_id}: expected commit "${expected.commitSha}", but current commit is "${targetNode.current_commit_sha}"`
					: expected.configDigest &&
							targetNode.current_config_digest &&
							targetNode.current_config_digest !== expected.configDigest
						? `Optimistic config lock failed on ${row.target_node_id}: expected digest "${expected.configDigest}", but current digest is "${targetNode.current_config_digest}"`
						: null;
		if (lockFailure) {
			logger.warn("[autosre] remediation claim rejected by state lock", {
				proposalId,
				error: lockFailure,
			});
			throw new RemediationGateError(lockFailure, 409);
		}
	}

	const claimExpiresAt = new Date(
		Date.parse(nowIso) + 5 * 60_000,
	).toISOString();
	const runnerId = options.runnerId ?? "autosre-runner";

	const results = await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'claimed_executing',
				     grant_token_hash = NULL,
				     claimed_by_runner_id = ?,
				     claimed_at = ?,
				     claim_expires_at = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND status = 'grant_issued'
				   AND grant_token_hash = ?
				   AND (grant_expires_at IS NULL OR grant_expires_at > ?)`,
			)
			.bind(
				runnerId,
				nowIso,
				claimExpiresAt,
				nowIso,
				projectId,
				row.environment,
				row.id,
				row.grant_token_hash,
				nowIso,
			),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'remediating', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND EXISTS (
				     SELECT 1 FROM remediation_proposals g
				     WHERE g.project_id = ? AND g.environment = ? AND g.id = ?
				       AND g.status = 'claimed_executing'
				       AND g.claimed_by_runner_id = ?
				       AND g.claimed_at = ?
				   )`,
			)
			.bind(
				nowIso,
				projectId,
				row.environment,
				row.incident_id,
				projectId,
				row.environment,
				row.id,
				runnerId,
				nowIso,
			),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new RemediationGateError(
			`Grant for proposal ${proposalId} was already claimed or is no longer valid (grants are single-use)`,
			409,
		);
	}

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
 *
 * Only the runner that holds the claim may complete, and only while the claim
 * window is open (`now <= claim_expires_at`); otherwise 409. All follow-up
 * writes are guarded on the completion UPDATE having applied.
 */
export async function completeRemediationProposal(
	db: SqlDb,
	projectId: string,
	proposalId: string,
	options: {
		environment?: string;
		runnerId?: string;
		resultingChangeId?: string | null;
		remediationAgentRunId?: string | null;
		baselineRequestRatePerMin?: number | null;
		nowIso?: string;
	},
): Promise<RemediationProposal> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = await loadProposalRow(
		db,
		projectId,
		proposalId,
		options.environment,
	);

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (row.status !== "claimed_executing") {
		throw new RemediationGateError(
			`Proposal ${proposalId} cannot be completed from status=${row.status} (must be claimed_executing)`,
			409,
		);
	}
	if (!options.runnerId || options.runnerId !== row.claimed_by_runner_id) {
		throw new RemediationGateError(
			`Proposal ${proposalId} is claimed by a different runner; only the claiming runner may complete it`,
			409,
		);
	}
	if (row.claim_expires_at && row.claim_expires_at < nowIso) {
		throw new RemediationGateError(
			`Claim on proposal ${proposalId} expired at ${row.claim_expires_at}`,
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

	// Follow-up writes only apply when the completion UPDATE below won.
	const completedGuard = `EXISTS (
		     SELECT 1 FROM remediation_proposals g
		     WHERE g.project_id = ? AND g.environment = ? AND g.id = ?
		       AND g.status = 'completed' AND g.updated_at = ?
		   )`;
	const guardBinds = [projectId, row.environment, row.id, nowIso];

	const results = await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'completed',
				     resulting_change_id = COALESCE(?, resulting_change_id),
				     remediation_agent_run_id = COALESCE(?, remediation_agent_run_id),
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND status = 'claimed_executing'
				   AND claimed_by_runner_id = ?
				   AND (claim_expires_at IS NULL OR claim_expires_at >= ?)`,
			)
			.bind(
				options.resultingChangeId ?? null,
				options.remediationAgentRunId ?? null,
				nowIso,
				projectId,
				row.environment,
				row.id,
				options.runnerId,
				nowIso,
			),
		db
			.prepare(
				`UPDATE ontology_nodes
				 SET current_version = COALESCE(?, current_version),
				     current_commit_sha = COALESCE(?, current_commit_sha),
				     current_config_digest = COALESCE(?, current_config_digest),
				     last_seen_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND ${completedGuard}`,
			)
			.bind(
				desired.version ?? null,
				desired.commitSha ?? null,
				desired.configDigest ?? null,
				nowIso,
				projectId,
				row.environment,
				row.target_node_id,
				...guardBinds,
			),
		db
			.prepare(
				`UPDATE investigation_findings
				 SET recovery_status = 'monitoring',
				     watchdog_step = 1,
				     consecutive_ok_checks = 0,
				     baseline_request_rate_per_min = COALESCE(?, baseline_request_rate_per_min),
				     next_watchdog_check_at = ?,
				     causal_chain_json = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND ${completedGuard}`,
			)
			.bind(
				options.baselineRequestRatePerMin ?? null,
				nextWatchdogAt,
				JSON.stringify(updatedChain),
				nowIso,
				projectId,
				row.environment,
				row.finding_id,
				...guardBinds,
			),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'verifying', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND ${completedGuard}`,
			)
			.bind(nowIso, projectId, row.environment, row.incident_id, ...guardBinds),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new RemediationGateError(
			`Proposal ${proposalId} changed state concurrently and can no longer be completed`,
			409,
		);
	}

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
		runnerId?: string;
		failureReason: string;
		nowIso?: string;
	},
): Promise<RemediationProposal> {
	const nowIso = options.nowIso ?? new Date().toISOString();
	const row = await loadProposalRow(
		db,
		projectId,
		proposalId,
		options.environment,
	);

	if (!row) {
		throw new RemediationGateError(`Proposal ${proposalId} not found`, 404);
	}
	if (row.status !== "claimed_executing") {
		throw new RemediationGateError(
			`Proposal ${proposalId} cannot be failed from status=${row.status} (must be claimed_executing)`,
			409,
		);
	}
	if (!options.runnerId || options.runnerId !== row.claimed_by_runner_id) {
		throw new RemediationGateError(
			`Proposal ${proposalId} is claimed by a different runner; only the claiming runner may fail it`,
			409,
		);
	}

	const results = await db.batch([
		db
			.prepare(
				`UPDATE remediation_proposals
				 SET status = 'failed_execution',
				     failure_reason = ?,
				     updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND status = 'claimed_executing'
				   AND claimed_by_runner_id = ?`,
			)
			.bind(
				options.failureReason,
				nowIso,
				projectId,
				row.environment,
				row.id,
				options.runnerId,
			),
		db
			.prepare(
				`UPDATE incident_investigations
				 SET status = 'escalated', updated_at = ?
				 WHERE project_id = ? AND environment = ? AND id = ?
				   AND EXISTS (
				     SELECT 1 FROM remediation_proposals g
				     WHERE g.project_id = ? AND g.environment = ? AND g.id = ?
				       AND g.status = 'failed_execution' AND g.updated_at = ?
				   )`,
			)
			.bind(
				nowIso,
				projectId,
				row.environment,
				row.incident_id,
				projectId,
				row.environment,
				row.id,
				nowIso,
			),
	]);
	if (results[0]?.meta.changes !== 1) {
		throw new RemediationGateError(
			`Proposal ${proposalId} changed state concurrently and can no longer be failed`,
			409,
		);
	}

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
	/** Findings whose evaluation threw; logged and retried on the next tick. */
	failed: number;
}

/** Watchdog checkpoints, in minutes after the remediation completed (RFC 0013 § 5.B). */
const WATCHDOG_STEP_OFFSET_MINUTES: Record<number, number> = {
	1: 2,
	2: 5,
	3: 15,
};
/** Consecutive sufficient-traffic healthy checkpoints required for `recovered`. */
const REQUIRED_CONSECUTIVE_OK_CHECKS = 2;

/**
 * Post-Remediation Watchdog & Lease/Claim Timeout Evaluator (RFC 0013 § 5.B, § 6.B & P1 #3).
 *
 * Strictly separates:
 *  - `recovery_status`: whether the service recovered under comparable traffic (`N >= minComparableRequests`)
 *  - `causal_verification_status`: `"operationally_corroborated"` (never promoted to `"counterfactual_verified"`
 *    by telemetry recovery alone!).
 *
 * Checkpoints are scheduled at +2m/+5m/+15m measured from the remediation's
 * completion time (not from whenever a tick happened to run), and a finding
 * only becomes `recovered` after two consecutive healthy checkpoints that each
 * had sufficient traffic. Pass `projectId` to scope the sweep to one tenant
 * (HTTP path); the cron path omits it and sweeps every project.
 */
export async function evaluateRemediationWatchdogs(
	db: SqlDb,
	options: {
		nowIso?: string;
		minComparableRequests?: number;
		projectId?: string;
		logger?: Logger;
	} = {},
): Promise<WatchdogEvaluationSummary> {
	const logger = options.logger ?? consoleLogger;
	const nowIso = options.nowIso ?? new Date().toISOString();
	const minComparableRequests = options.minComparableRequests ?? 50;
	const projectId = options.projectId;
	const projectClause = projectId ? " AND project_id = ?" : "";
	const projectBinds = projectId ? [projectId] : [];

	// 1. Expire unclaimed grants past grant_expires_at
	const expiredGrantsRes = await db
		.prepare(
			`UPDATE remediation_proposals
			 SET status = 'expired', grant_token_hash = NULL, updated_at = ?
			 WHERE status = 'grant_issued'
			   AND grant_expires_at IS NOT NULL
			   AND grant_expires_at <= ?${projectClause}`,
		)
		.bind(nowIso, nowIso, ...projectBinds)
		.run();

	// 2. Time out claimed_executing proposals past claim_expires_at and escalate their incidents
	const timedOutRows = await db
		.prepare(
			`SELECT project_id, environment, id, incident_id
			 FROM remediation_proposals
			 WHERE status = 'claimed_executing'
			   AND claim_expires_at IS NOT NULL
			   AND claim_expires_at <= ?${projectClause}`,
		)
		.bind(nowIso, ...projectBinds)
		.all<{
			project_id: string;
			environment: string;
			id: string;
			incident_id: string;
		}>();

	let timedOutClaims = 0;
	for (const t of timedOutRows.results) {
		const res = await db.batch([
			db
				.prepare(
					`UPDATE remediation_proposals
					 SET status = 'execution_timed_out',
					     failure_reason = 'Runner did not complete or fail within 5m claim window',
					     updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?
					   AND status = 'claimed_executing'`,
				)
				.bind(nowIso, t.project_id, t.environment, t.id),
			db
				.prepare(
					`UPDATE incident_investigations
					 SET status = 'escalated', updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?
					   AND EXISTS (
					     SELECT 1 FROM remediation_proposals g
					     WHERE g.project_id = ? AND g.environment = ? AND g.id = ?
					       AND g.status = 'execution_timed_out' AND g.updated_at = ?
					   )`,
				)
				.bind(
					nowIso,
					t.project_id,
					t.environment,
					t.incident_id,
					t.project_id,
					t.environment,
					t.id,
					nowIso,
				),
		]);
		if (res[0]?.meta.changes === 1) timedOutClaims += 1;
	}

	// 3. Evaluate findings in `monitoring` where `next_watchdog_check_at <= nowIso`
	const dueFindings = await db
		.prepare(
			`SELECT
				project_id, environment, id, incident_id,
				fault_locus_entity_id, root_cause_entity_id,
				watchdog_step, consecutive_ok_checks, baseline_request_rate_per_min,
				causal_verification_status, updated_at
			 FROM investigation_findings
			 WHERE recovery_status = 'monitoring'
			   AND next_watchdog_check_at IS NOT NULL
			   AND next_watchdog_check_at <= ?${projectClause}
			 LIMIT 50`,
		)
		.bind(nowIso, ...projectBinds)
		.all<{
			project_id: string;
			environment: string;
			id: string;
			incident_id: string | null;
			fault_locus_entity_id: string;
			root_cause_entity_id: string | null;
			watchdog_step: number;
			consecutive_ok_checks: number | null;
			baseline_request_rate_per_min: number | null;
			causal_verification_status: string;
			updated_at: string;
		}>();

	let recovered = 0;
	let inconclusiveLowTraffic = 0;
	let stillDegraded = 0;
	let failed = 0;

	for (const f of dueFindings.results) {
		try {
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

			// Traffic is measured since the remediation change took effect; the
			// checkpoint schedule is anchored on when the remediation completed.
			const sinceTs =
				completedProposal?.change_occurred_at ??
				completedProposal?.updated_at ??
				f.updated_at;
			const completedAtMs = Date.parse(
				completedProposal?.updated_at ?? f.updated_at,
			);
			const nextCheckFor = (step: number): string =>
				new Date(
					completedAtMs + (WATCHDOG_STEP_OFFSET_MINUTES[step] ?? 15) * 60_000,
				).toISOString();
			const targetNodeId =
				completedProposal?.target_node_id ?? f.fault_locus_entity_id;

			// Extract service name from canonical service:{env}:{ns}:{serviceName} if applicable
			const parts = targetNodeId.split(":");
			const serviceName =
				parts[0] === "service" && parts.length >= 4
					? parts.slice(3).join(":")
					: null;

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
				// Insufficient traffic breaks the consecutive-ok streak.
				if (f.watchdog_step < 3) {
					const nextStep = f.watchdog_step + 1;
					await db
						.prepare(
							`UPDATE investigation_findings
							 SET watchdog_step = ?, consecutive_ok_checks = 0,
							     next_watchdog_check_at = ?, updated_at = ?
							 WHERE project_id = ? AND environment = ? AND id = ?`,
						)
						.bind(
							nextStep,
							nextCheckFor(nextStep),
							nowIso,
							f.project_id,
							f.environment,
							f.id,
						)
						.run();
				} else {
					// Step 3 (+15m) with insufficient comparable traffic -> inconclusive_low_traffic
					inconclusiveLowTraffic += 1;
					await db
						.prepare(
							`UPDATE investigation_findings
							 SET recovery_status = 'inconclusive_low_traffic',
							     consecutive_ok_checks = 0,
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
						     consecutive_ok_checks = 0,
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
				continue;
			}

			// Traffic is sufficient AND error rate is healthy (<5%) at this checkpoint.
			const okChecks = Number(f.consecutive_ok_checks ?? 0) + 1;
			if (okChecks < REQUIRED_CONSECUTIVE_OK_CHECKS) {
				// Need one more healthy checkpoint. Advance along the schedule; past
				// the last step, re-check shortly after now.
				const nextStep = Math.min(3, f.watchdog_step + 1);
				const nextCheck =
					f.watchdog_step < 3
						? nextCheckFor(nextStep)
						: new Date(Date.parse(nowIso) + 5 * 60_000).toISOString();
				await db
					.prepare(
						`UPDATE investigation_findings
						 SET watchdog_step = ?, consecutive_ok_checks = ?,
						     next_watchdog_check_at = ?, updated_at = ?
						 WHERE project_id = ? AND environment = ? AND id = ?`,
					)
					.bind(
						nextStep,
						okChecks,
						nextCheck,
						nowIso,
						f.project_id,
						f.environment,
						f.id,
					)
					.run();
				continue;
			}

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
					     consecutive_ok_checks = ?,
					     next_watchdog_check_at = NULL,
					     updated_at = ?
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(
					nextCausalVerification,
					okChecks,
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
		} catch (err) {
			failed += 1;
			logger.error("[autosre] watchdog evaluation failed for finding", {
				findingId: f.id,
				projectId: f.project_id,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return {
		evaluated: dueFindings.results.length,
		recovered,
		inconclusiveLowTraffic,
		stillDegraded,
		timedOutClaims,
		expiredGrants: expiredGrantsRes.meta.changes,
		failed,
	};
}
