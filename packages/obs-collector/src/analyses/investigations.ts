/**
 * RFC 0002 Stage 4 — investigation templates.
 *
 * The RFC originally targeted a Python sidecar for these (Stage 2). We
 * skipped Stage 2; investigations here are pure SQL (multiple result-sets
 * stitched into one structured `payload.evidence` blob) executed by the
 * existing runner. SQLite's window functions + json builders cover what
 * Polars would do for the cohort/funnel/anomaly shapes we ship.
 *
 * Convention used by `InvestigationPage`:
 *
 *   payload.evidence = {
 *     [section_name]: {
 *       title?: string,
 *       headers: string[],
 *       rows: Array<Array<string | number | null>>,
 *       note?: string,
 *     }
 *   }
 *
 * The runner shapes status / primary / baseline / delta the same way as
 * tile analyses; the page UI renders the headline numbers above the
 * narrative and tables below.
 */

import type { AnalysisDefinition } from "@obs/types";

// ── error_top_offenders ────────────────────────────────────────────────────
// Cohort-comparison investigation. "Which services contributed the most
// errors in the last 5 minutes vs the trailing hour, and is the mix
// shifting?" Status: critical if current top-3 service error count > 50;
// warn if > 10; ok otherwise. Primary value is current top-1 error count.
const errorTopOffenders: AnalysisDefinition = {
	id: "investigate.error_top_offenders",
	title: "Error top offenders",
	group: "Health",
	source: "tier0",
	view: "page",
	refreshSeconds: 300,
	narrate: {
		prompt:
			"Summarize which services dominate errors right now and how the mix shifted vs the last hour. If one service moved sharply, name it. Time anchor.",
		only_when: "always",
	},
	sql: `
		WITH cur AS (
			SELECT COALESCE(service_name, '<unknown>') AS service,
				COUNT(*) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-5 minutes')
				AND status_code = 2
			GROUP BY service_name
			ORDER BY errors DESC
			LIMIT 5
		),
		prev AS (
			SELECT COALESCE(service_name, '<unknown>') AS service,
				COUNT(*) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
				AND status_code = 2
			GROUP BY service_name
			ORDER BY errors DESC
			LIMIT 5
		),
		top1 AS (
			SELECT errors AS top_errors FROM cur LIMIT 1
		)
		SELECT
			CASE
				WHEN COALESCE((SELECT top_errors FROM top1), 0) > 50 THEN 'critical'
				WHEN COALESCE((SELECT top_errors FROM top1), 0) > 10 THEN 'warn'
				ELSE 'ok'
			END AS status,
			COALESCE((SELECT top_errors FROM top1), 0) AS primary_value,
			(SELECT errors FROM prev LIMIT 1) AS baseline_value,
			(SELECT json_object(
				'window', '5m',
				'baselineWindow', '5m–60m ago',
				'evidence', json_object(
					'current_top_services', json_object(
						'title', 'Top error services — last 5 minutes',
						'headers', json_array('service', 'errors'),
						'rows', (
							SELECT json_group_array(json_array(service, errors))
							FROM cur
						)
					),
					'baseline_top_services', json_object(
						'title', 'Top error services — 5–60 minutes ago',
						'headers', json_array('service', 'errors'),
						'rows', (
							SELECT json_group_array(json_array(service, errors))
							FROM prev
						)
					)
				)
			)) AS payload
	`,
};

// ── latency_outlier_attribution ───────────────────────────────────────────
// Funnel-style investigation: of the slow tail (last 15min), which
// service+span combinations dominate? Helps users go from "p95 is up" to
// "checkout.submit is the offender" in one click.
const latencyOutlierAttribution: AnalysisDefinition = {
	id: "investigate.latency_outlier_attribution",
	title: "Latency outlier attribution",
	group: "Health",
	source: "tier0",
	view: "page",
	refreshSeconds: 300,
	narrate: {
		prompt:
			"Identify which span(s) dominate the slow tail in the last 15 minutes. Quote concrete duration numbers and span names from the evidence. Time anchor.",
		only_when: "always",
	},
	sql: `
		WITH ranked AS (
			SELECT
				duration_ms,
				COALESCE(service_name, '<unknown>') AS service,
				COALESCE(span_name, '<unknown>')   AS span,
				ROW_NUMBER() OVER (ORDER BY duration_ms DESC) AS rn,
				COUNT(*)    OVER ()                            AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-15 minutes')
		),
		p95_cut AS (
			-- Conservatively call "tail" the slowest 5% of the window.
			SELECT MIN(duration_ms) AS p95
			FROM ranked
			WHERE rn <= MAX(1, CAST(n / 20 AS INTEGER))
		),
		offenders AS (
			SELECT service, span,
				COUNT(*)       AS tail_count,
				MAX(duration_ms) AS max_ms,
				ROUND(AVG(duration_ms), 1) AS avg_ms
			FROM ranked, p95_cut
			WHERE duration_ms >= COALESCE(p95_cut.p95, 0)
			GROUP BY service, span
			ORDER BY tail_count DESC
			LIMIT 8
		),
		top_max AS (
			SELECT max_ms FROM offenders ORDER BY max_ms DESC LIMIT 1
		)
		SELECT
			CASE
				WHEN COALESCE((SELECT max_ms FROM top_max), 0) > 5000 THEN 'critical'
				WHEN COALESCE((SELECT max_ms FROM top_max), 0) > 1000 THEN 'warn'
				ELSE 'ok'
			END AS status,
			COALESCE((SELECT max_ms FROM top_max), 0) AS primary_value,
			(SELECT p95 FROM p95_cut)               AS baseline_value,
			(SELECT json_object(
				'window', '15m',
				'unit', 'ms',
				'evidence', json_object(
					'tail_offenders', json_object(
						'title', 'Top tail offenders — slowest 5% of last 15 minutes',
						'headers', json_array('service', 'span', 'count_in_tail', 'max_ms', 'avg_ms'),
						'rows', (
							SELECT json_group_array(json_array(service, span, tail_count, max_ms, avg_ms))
							FROM offenders
						)
					)
				)
			)) AS payload
	`,
};

// ── log_anomaly_summary ────────────────────────────────────────────────────
// Anomaly investigation: which ERROR-severity logger names showed up in
// the last 5 minutes that weren't present in the prior hour? These are
// the "first time we've ever seen this fail" cases — usually the most
// interesting line in an incident.
const logAnomalySummary: AnalysisDefinition = {
	id: "investigate.log_anomaly_summary",
	title: "Log anomaly summary",
	group: "Health",
	source: "tier0",
	view: "page",
	refreshSeconds: 300,
	narrate: {
		prompt:
			"List the new ERROR loggers (those absent from the prior hour). If any look like 'never seen before', call it out. Quote one representative message per logger. Time anchor.",
		only_when: "always",
	},
	sql: `
		WITH recent AS (
			-- Correlated subquery for sample_message uses the table alias
			-- l1 so SQLite resolves the outer column reference; the AS alias
			-- 'logger' defined in the SELECT list isn't visible inside a
			-- correlated subquery in SQLite.
			SELECT COALESCE(l1.logger_name, '<unknown>') AS logger,
				COUNT(*) AS occurrences,
				(SELECT l2.message FROM logs l2
					WHERE l2.project_id = '{{PROJECT_ID}}'
						AND COALESCE(l2.logger_name, '<unknown>') = COALESCE(l1.logger_name, '<unknown>')
						AND l2.received_at >= datetime('now', '-5 minutes')
						AND l2.severity_number >= 17
					ORDER BY l2.received_at DESC LIMIT 1) AS sample_message
			FROM logs l1
			WHERE l1.project_id = '{{PROJECT_ID}}'
				AND l1.received_at >= datetime('now', '-5 minutes')
				AND l1.severity_number >= 17
			GROUP BY l1.logger_name
		),
		baseline AS (
			SELECT DISTINCT COALESCE(logger_name, '<unknown>') AS logger
			FROM logs
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
				AND severity_number >= 17
		),
		newcomers AS (
			SELECT recent.*
			FROM recent
			LEFT JOIN baseline ON baseline.logger = recent.logger
			WHERE baseline.logger IS NULL
			ORDER BY recent.occurrences DESC
			LIMIT 8
		),
		all_recent AS (
			SELECT recent.*,
				CASE WHEN baseline.logger IS NULL THEN 1 ELSE 0 END AS is_new
			FROM recent
			LEFT JOIN baseline ON baseline.logger = recent.logger
			ORDER BY is_new DESC, occurrences DESC
			LIMIT 12
		)
		SELECT
			CASE
				WHEN (SELECT COUNT(*) FROM newcomers) >= 3 THEN 'critical'
				WHEN (SELECT COUNT(*) FROM newcomers) >= 1 THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT COUNT(*) FROM newcomers) AS primary_value,
			(SELECT COUNT(*) FROM baseline) AS baseline_value,
			(SELECT json_object(
				'window', '5m',
				'baselineWindow', '5–60m ago',
				'evidence', json_object(
					'new_error_loggers', json_object(
						'title', 'New ERROR loggers — first seen in last 5 minutes',
						'headers', json_array('logger', 'occurrences', 'sample_message'),
						'note', 'Loggers absent from the prior 5–60 minute window.',
						'rows', (
							SELECT json_group_array(json_array(logger, occurrences, sample_message))
							FROM newcomers
						)
					),
					'all_recent_loggers', json_object(
						'title', 'All ERROR loggers — last 5 minutes',
						'headers', json_array('logger', 'occurrences', 'is_new', 'sample_message'),
						'rows', (
							SELECT json_group_array(json_array(logger, occurrences, is_new, sample_message))
							FROM all_recent
						)
					)
				)
			)) AS payload
	`,
};

export const INVESTIGATION_ANALYSES: AnalysisDefinition[] = [
	errorTopOffenders,
	latencyOutlierAttribution,
	logAnomalySummary,
];
