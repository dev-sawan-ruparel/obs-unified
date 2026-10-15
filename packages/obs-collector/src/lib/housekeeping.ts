/**
 * Retention for the secondary tables the hourly sweep did not cover. Each
 * rule is tied to an existing contract rather than a new policy:
 *
 *  - `alert_evaluations`: `/internal/alerts/evaluations` accepts at most a
 *    720-hour window, so rows older than that are unreachable through the API.
 *  - `ask_evidence_events`: feeds `getTopAskedAnalyses`, whose trailing window
 *    is 7 days; rows older than 30 days cannot influence it.
 *  - `metric_series`: identity rows whose points have all expired and that
 *    were created before the retention window. They hold no data; the next
 *    ingest of that identity recreates the row.
 *  - `evidence_retrieval_refs`: rows carry their own `expires_at` (copied from
 *    the signal they reference); expansions follow their ref.
 */

import type { SqlDb } from "./sql-db";

export const ALERT_EVALUATIONS_MAX_AGE_HOURS = 720;
export const ASK_EVIDENCE_EVENTS_MAX_AGE_HOURS = 30 * 24;

export interface HousekeepingSummary {
	alert_evaluations: number;
	ask_evidence_events: number;
	metric_series: number;
	evidence_refs: number;
	evidence_ref_expansions: number;
	ontology_edges?: number;
	ontology_nodes?: number;
	change_events?: number;
	incident_investigations?: number;
	/** `leased` incidents whose lease expired and were returned to `open` (RFC 0013 § 11). */
	incident_leases_reaped?: number;
	investigation_findings?: number;
	remediation_proposals?: number;
}

export interface HousekeepingOptions {
	/** Window that bounds orphaned metric series; same value the main sweep uses. */
	retentionHours: number;
	/** Clock override for tests. */
	now?: () => number;
}

const changes = (r: { meta?: { changes?: number } }) => r.meta?.changes ?? 0;

export async function purgeSecondaryRows(
	db: SqlDb,
	options: HousekeepingOptions,
): Promise<HousekeepingSummary> {
	const nowMs = options.now?.() ?? Date.now();
	const isoBefore = (hours: number) =>
		new Date(nowMs - hours * 3_600_000).toISOString();
	const nowIso = isoBefore(0);

	const alertEvaluations = await db
		.prepare(`DELETE FROM alert_evaluations WHERE evaluated_at < ?`)
		.bind(isoBefore(ALERT_EVALUATIONS_MAX_AGE_HOURS))
		.run();

	const askEvents = await db
		.prepare(`DELETE FROM ask_evidence_events WHERE asked_at < ?`)
		.bind(nowMs - ASK_EVIDENCE_EVENTS_MAX_AGE_HOURS * 3_600_000)
		.run();

	// Points and exemplars for the window are purged by MetricsStore first;
	// a series created before the window with no remaining points is inert.
	const series = await db
		.prepare(
			`DELETE FROM metric_series
			 WHERE created_at < ?
			   AND NOT EXISTS (
			     SELECT 1 FROM metric_point p WHERE p.series_id = metric_series.id
			   )`,
		)
		.bind(isoBefore(options.retentionHours))
		.run();

	const refs = await db
		.prepare(
			`DELETE FROM evidence_retrieval_refs
			 WHERE expires_at IS NOT NULL AND expires_at < ?`,
		)
		.bind(nowIso)
		.run();
	const expansions = await db
		.prepare(
			`DELETE FROM evidence_ref_expansions
			 WHERE NOT EXISTS (
			   SELECT 1 FROM evidence_retrieval_refs r
			   WHERE r.ref_id = evidence_ref_expansions.ref_id
			 )`,
		)
		.run();

	// RFC 0013 — AutoSRE ontology, change events, incident investigations,
	// investigation findings, and remediation proposals retention, plus lease
	// reaping. Errors propagate (the retention caller logs them); the
	// post-remediation watchdog runs on the 1-minute analyses tick instead.
	const thirtyDaysAgoIso = isoBefore(30 * 24);
	const ninetyDaysAgoIso = isoBefore(90 * 24);
	const edgesRes = await db
		.prepare(`DELETE FROM ontology_edges WHERE last_seen_at < ?`)
		.bind(thirtyDaysAgoIso)
		.run();
	const ontologyEdgesPurged = changes(edgesRes);

	const nodesRes = await db
		.prepare(
			`DELETE FROM ontology_nodes
			 WHERE last_seen_at < ?
			   AND NOT EXISTS (
			     SELECT 1 FROM ontology_edges e
			     WHERE e.project_id = ontology_nodes.project_id
			       AND e.environment = ontology_nodes.environment
			       AND (e.source_node_id = ontology_nodes.id OR e.target_node_id = ontology_nodes.id)
			   )`,
		)
		.bind(thirtyDaysAgoIso)
		.run();
	const ontologyNodesPurged = changes(nodesRes);

	const proposalsRes = await db
		.prepare(
			`DELETE FROM remediation_proposals
			 WHERE (expires_at IS NOT NULL AND expires_at < ?)
			    OR (expires_at IS NULL AND created_at < ?)`,
		)
		.bind(nowIso, ninetyDaysAgoIso)
		.run();
	const remediationProposalsPurged = changes(proposalsRes);

	const findingsRes = await db
		.prepare(
			`DELETE FROM investigation_findings
			 WHERE causal_verification_status NOT IN ('counterfactual_verified', 'operationally_corroborated')
			   AND ((expires_at IS NOT NULL AND expires_at < ?)
			     OR (expires_at IS NULL AND created_at < ?))`,
		)
		.bind(nowIso, ninetyDaysAgoIso)
		.run();
	const investigationFindingsPurged = changes(findingsRes);

	// Preserve change_events referenced by active investigation_findings
	const changesRes = await db
		.prepare(
			`DELETE FROM change_events
			 WHERE ((expires_at IS NOT NULL AND expires_at < ?)
			     OR (expires_at IS NULL AND occurred_at < ?))
			   AND NOT EXISTS (
			     SELECT 1 FROM investigation_findings f
			     WHERE f.project_id = change_events.project_id
			       AND f.environment = change_events.environment
			       AND f.contributing_change_id = change_events.id
			   )`,
		)
		.bind(nowIso, ninetyDaysAgoIso)
		.run();
	const changeEventsPurged = changes(changesRes);

	const incidentsRes = await db
		.prepare(
			`DELETE FROM incident_investigations
			 WHERE status IN ('resolved', 'escalated')
			   AND ((expires_at IS NOT NULL AND expires_at < ?)
			     OR (expires_at IS NULL AND updated_at < ?))`,
		)
		.bind(nowIso, ninetyDaysAgoIso)
		.run();
	const incidentInvestigationsPurged = changes(incidentsRes);

	// Lease reaping (RFC 0013 § 11): a runner that died holding a lease must not
	// strand the incident. Expired `leased` incidents go back to `open` so the
	// next runner can pick them up. `remediating`/`verifying` are owned by the
	// proposal claim/watchdog timeouts, not by this reaper.
	const leasesRes = await db
		.prepare(
			`UPDATE incident_investigations
			 SET status = 'open', lease_owner_id = NULL, lease_expires_at = NULL, updated_at = ?
			 WHERE status = 'leased'
			   AND lease_expires_at IS NOT NULL
			   AND lease_expires_at < ?`,
		)
		.bind(nowIso, nowIso)
		.run();
	const incidentLeasesReaped = changes(leasesRes);

	return {
		alert_evaluations: changes(alertEvaluations),
		ask_evidence_events: changes(askEvents),
		metric_series: changes(series),
		evidence_refs: changes(refs),
		evidence_ref_expansions: changes(expansions),
		ontology_edges: ontologyEdgesPurged,
		ontology_nodes: ontologyNodesPurged,
		change_events: changeEventsPurged,
		incident_investigations: incidentInvestigationsPurged,
		incident_leases_reaped: incidentLeasesReaped,
		investigation_findings: investigationFindingsPurged,
		remediation_proposals: remediationProposalsPurged,
	};
}
