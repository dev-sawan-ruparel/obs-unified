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
		.bind(isoBefore(0))
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

	return {
		alert_evaluations: changes(alertEvaluations),
		ask_evidence_events: changes(askEvents),
		metric_series: changes(series),
		evidence_refs: changes(refs),
		evidence_ref_expansions: changes(expansions),
	};
}
