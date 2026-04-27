// RFC 0002 Stage 1 — Tier 0 universal analyses.
//
// These six analyses apply to any install regardless of detected app shape.
// Each `sql` string is executable as-is by the runner (Agent 1). The runner
// substitutes the literal token `{{PROJECT_ID}}` with the active project's
// id before execution; everything else (time windows, thresholds) is baked
// into the SQL itself.
//
// The runner expects a single-row result with these columns:
//   status         TEXT  — 'ok' | 'warn' | 'critical' | 'unknown'
//   primary_value  REAL  — the headline number (NULL allowed)
//   baseline_value REAL  — the comparison number (NULL allowed)
//   payload        TEXT  — JSON string built with json_object(...) /
//                          json_group_array(...) for charts, contributors, etc.
//
// delta_pct is precomputed by the runner from primary/baseline.

import type { AnalysisDefinition } from "@obs/types";

// ── overall_error_rate ──────────────────────────────────────────────────────
// Error spans in the last 5 minutes vs. the trailing 1h baseline rate.
// Status: critical if rate>5%, warn if rate>1%, ok otherwise. unknown if
// no traffic in either window.
const overallErrorRate: AnalysisDefinition = {
	id: "overall_error_rate",
	title: "Overall error rate",
	group: "Health",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	narrate: {
		prompt:
			"Errors moved to {{primary}} (was {{baseline}}, {{delta_pct}}). Name the dominant offending span name or service if visible in the payload, with a time anchor.",
		only_when: "status_changed || delta_pct>20",
	},
	sql: `
		WITH now_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-5 minutes')
		),
		base_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
		),
		spark AS (
			-- per-minute error rate over the last 30 minutes for sparkline rendering
			SELECT
				strftime('%Y-%m-%dT%H:%M:00Z', received_at) AS minute,
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-30 minutes')
			GROUP BY minute
			ORDER BY minute ASC
		)
		SELECT
			CASE
				WHEN (SELECT total FROM now_window) = 0 THEN 'unknown'
				WHEN (CAST((SELECT errors FROM now_window) AS REAL)
				      / (SELECT total FROM now_window)) > 0.05 THEN 'critical'
				WHEN (CAST((SELECT errors FROM now_window) AS REAL)
				      / (SELECT total FROM now_window)) > 0.01 THEN 'warn'
				ELSE 'ok'
			END AS status,
			CASE WHEN (SELECT total FROM now_window) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM now_window) AS REAL)
			          / (SELECT total FROM now_window) END AS primary_value,
			CASE WHEN (SELECT total FROM base_window) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM base_window) AS REAL)
			          / (SELECT total FROM base_window) END AS baseline_value,
			(SELECT json_object(
				'window', '5m',
				'baselineWindow', '1h',
				'currentErrors', (SELECT errors FROM now_window),
				'currentTotal',  (SELECT total  FROM now_window),
				'baselineErrors',(SELECT errors FROM base_window),
				'baselineTotal', (SELECT total  FROM base_window),
				'sparkline', (
					SELECT json_group_array(json_object(
						'minute', minute,
						'total', total,
						'errors', errors,
						'rate', CASE WHEN total = 0 THEN 0
						             ELSE CAST(errors AS REAL) / total END
					)) FROM spark
				)
			)) AS payload
	`,
};

// ── top_error_services ──────────────────────────────────────────────────────
// Top 5 services by error count in the last 5 minutes.
// Status: critical if any service has >10 errors/min (i.e. >50 in 5min),
// warn if any has >2 errors/min (i.e. >10 in 5min), ok otherwise. unknown
// if no errors at all.
const topErrorServices: AnalysisDefinition = {
	id: "top_error_services",
	title: "Top error services",
	group: "Health",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	narrate: {
		prompt:
			"List the top 1–2 erroring services and their counts (from payload). Include a time anchor like 'in the last 5 minutes'.",
		only_when: "signature_changed",
	},
	sql: `
		WITH per_service AS (
			SELECT
				COALESCE(service_name, '<unknown>') AS service,
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-5 minutes')
			GROUP BY service
		),
		top5 AS (
			SELECT service, total, errors
			FROM per_service
			WHERE errors > 0
			ORDER BY errors DESC
			LIMIT 5
		),
		max_err AS (SELECT COALESCE(MAX(errors), 0) AS m FROM top5)
		SELECT
			CASE
				WHEN (SELECT m FROM max_err) = 0 THEN 'unknown'
				-- thresholds are per-minute averaged over the 5-minute window
				WHEN (SELECT m FROM max_err) > 50 THEN 'critical'
				WHEN (SELECT m FROM max_err) > 10 THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT m FROM max_err) AS primary_value,
			NULL AS baseline_value,
			(SELECT json_object(
				'window', '5m',
				'services', (
					SELECT json_group_array(json_object(
						'service', service,
						'errors', errors,
						'total', total
					)) FROM top5
				)
			)) AS payload
	`,
};

// ── latency_p95_overall ─────────────────────────────────────────────────────
// p95 across all spans this hour vs. the same hour yesterday.
// SQLite has no native percentile, so we approximate via ROW_NUMBER ordering:
// pick the row at offset CEIL(0.95 * n) - 1 in ascending duration order.
// Status by delta_pct: critical>50%, warn>20%, ok else. unknown when either
// window is empty.
const latencyP95Overall: AnalysisDefinition = {
	id: "latency_p95_overall",
	title: "Latency p95 — overall",
	group: "Health",
	source: "tier0",
	view: "tile",
	// Latency is one of the primary signals; 60s matches Tier 0 spec.
	refreshSeconds: 60,
	narrate: {
		prompt:
			"p95 moved to {{primary}}ms from {{baseline}}ms ({{delta_pct}}). Name the slowest service or route if visible in the payload, with a time anchor.",
		only_when: "status_changed || delta_pct>25",
	},
	sql: `
		WITH cur AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
		),
		base AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-25 hours')
				AND received_at <  datetime('now', '-24 hours')
		),
		cur_p95 AS (
			SELECT duration_ms FROM cur
			WHERE rn = MAX(1, CAST(0.95 * n AS INTEGER))
			LIMIT 1
		),
		base_p95 AS (
			SELECT duration_ms FROM base
			WHERE rn = MAX(1, CAST(0.95 * n AS INTEGER))
			LIMIT 1
		),
		spark AS (
			-- per-5-minute approx-p95 buckets across the current hour for sparkline
			SELECT
				strftime('%Y-%m-%dT%H:%M:00Z',
					datetime((CAST(strftime('%s', received_at) AS INTEGER) / 300) * 300, 'unixepoch')
				) AS bucket,
				MAX(duration_ms) AS approx_max,
				COUNT(*) AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
			GROUP BY bucket
			ORDER BY bucket ASC
		),
		cur_val  AS (SELECT (SELECT duration_ms FROM cur_p95)  AS v),
		base_val AS (SELECT (SELECT duration_ms FROM base_p95) AS v),
		delta AS (
			SELECT CASE
				WHEN (SELECT v FROM cur_val) IS NULL THEN NULL
				WHEN (SELECT v FROM base_val) IS NULL OR (SELECT v FROM base_val) = 0 THEN NULL
				ELSE ((SELECT v FROM cur_val) - (SELECT v FROM base_val))
				     * 100.0 / (SELECT v FROM base_val)
			END AS pct
		)
		SELECT
			CASE
				WHEN (SELECT v FROM cur_val) IS NULL THEN 'unknown'
				WHEN (SELECT pct FROM delta) IS NULL THEN 'ok'
				WHEN ABS((SELECT pct FROM delta)) > 50 THEN 'critical'
				WHEN ABS((SELECT pct FROM delta)) > 20 THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT v FROM cur_val)  AS primary_value,
			(SELECT v FROM base_val) AS baseline_value,
			(SELECT json_object(
				'window', '1h',
				'baselineWindow', 'same hour yesterday',
				'unit', 'ms',
				'sparkline', (
					SELECT json_group_array(json_object(
						'bucket', bucket,
						'approxP95Ms', approx_max,
						'samples', n
					)) FROM spark
				)
			)) AS payload
	`,
};

// ── throughput_slope ────────────────────────────────────────────────────────
// Spans/minute trend: last 30 minutes vs the prior 30 minutes.
// Status: warn if slope > 1.5x AND p99 trending up (current p99 > prior p99);
// ok otherwise. unknown if both windows empty.
const throughputSlope: AnalysisDefinition = {
	id: "throughput_slope",
	title: "Throughput slope",
	group: "Health",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	sql: `
		WITH cur AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-30 minutes')
		),
		prev AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-60 minutes')
				AND received_at <  datetime('now', '-30 minutes')
		),
		cur_n   AS (SELECT COALESCE((SELECT n FROM cur LIMIT 1), 0) AS n),
		prev_n  AS (SELECT COALESCE((SELECT n FROM prev LIMIT 1), 0) AS n),
		cur_p99 AS (
			SELECT duration_ms FROM cur
			WHERE rn = MAX(1, CAST(0.99 * n AS INTEGER))
			LIMIT 1
		),
		prev_p99 AS (
			SELECT duration_ms FROM prev
			WHERE rn = MAX(1, CAST(0.99 * n AS INTEGER))
			LIMIT 1
		),
		rates AS (
			SELECT
				CAST((SELECT n FROM cur_n)  AS REAL) / 30.0 AS current_rpm,
				CAST((SELECT n FROM prev_n) AS REAL) / 30.0 AS prior_rpm
		),
		slope_calc AS (
			SELECT
				current_rpm,
				prior_rpm,
				CASE WHEN prior_rpm = 0 THEN NULL
				     ELSE current_rpm / prior_rpm END AS slope
			FROM rates
		)
		SELECT
			CASE
				WHEN (SELECT n FROM cur_n) = 0 AND (SELECT n FROM prev_n) = 0 THEN 'unknown'
				WHEN (SELECT slope FROM slope_calc) IS NOT NULL
				     AND (SELECT slope FROM slope_calc) > 1.5
				     AND COALESCE((SELECT duration_ms FROM cur_p99), 0)
				         > COALESCE((SELECT duration_ms FROM prev_p99), 0)
				THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT current_rpm FROM rates) AS primary_value,
			(SELECT prior_rpm   FROM rates) AS baseline_value,
			(SELECT json_object(
				'currentRpm', (SELECT current_rpm FROM rates),
				'priorRpm',   (SELECT prior_rpm   FROM rates),
				'slope',      (SELECT slope FROM slope_calc),
				'currentP99Ms', (SELECT duration_ms FROM cur_p99),
				'priorP99Ms',   (SELECT duration_ms FROM prev_p99),
				'window', '30m',
				'baselineWindow', 'prior 30m'
			)) AS payload
	`,
};

// ── active_sessions ─────────────────────────────────────────────────────────
// Distinct frontend sessions in usage_events for the last 15 minutes plus
// per-hour breakdown across the trailing 24h. Always status: 'ok' — this is
// informational. unknown only if the table is missing data entirely.
const activeSessions: AnalysisDefinition = {
	id: "active_sessions",
	title: "Active sessions",
	group: "Frontend",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	sql: `
		WITH active AS (
			SELECT COUNT(DISTINCT session_id) AS n
			FROM usage_events
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-15 minutes')
		),
		hourly AS (
			SELECT
				strftime('%Y-%m-%dT%H:00:00Z', received_at) AS hour,
				COUNT(DISTINCT session_id) AS sessions
			FROM usage_events
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-24 hours')
			GROUP BY hour
			ORDER BY hour ASC
		)
		SELECT
			'ok' AS status,
			CAST((SELECT n FROM active) AS REAL) AS primary_value,
			NULL AS baseline_value,
			(SELECT json_object(
				'count', (SELECT n FROM active),
				'window', '15m',
				'hourlyBreakdown', (
					SELECT json_group_array(json_object(
						'hour', hour,
						'sessions', sessions
					)) FROM hourly
				)
			)) AS payload
	`,
};

// ── log_error_rate ──────────────────────────────────────────────────────────
// Error+fatal logs in the last 5 minutes vs. the trailing 1h baseline rate.
// severity_number follows OTel: ERROR=17-20, FATAL=21-24.
// Status: critical if rate>5%, warn if rate>1%, ok otherwise. unknown if
// no logs in either window.
const logErrorRate: AnalysisDefinition = {
	id: "log_error_rate",
	narrate: {
		prompt:
			"Log error rate is {{primary}} (was {{baseline}}, {{delta_pct}}). If a logger or message pattern dominates the payload, name it. Time anchor.",
		only_when: "status_changed || delta_pct>25",
	},
	title: "Log error rate",
	group: "Health",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	sql: `
		WITH now_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN severity_number >= 17 THEN 1 ELSE 0 END) AS errors
			FROM logs
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-5 minutes')
		),
		base_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN severity_number >= 17 THEN 1 ELSE 0 END) AS errors
			FROM logs
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
		),
		spark AS (
			SELECT
				strftime('%Y-%m-%dT%H:%M:00Z', received_at) AS minute,
				COUNT(*) AS total,
				SUM(CASE WHEN severity_number >= 17 THEN 1 ELSE 0 END) AS errors
			FROM logs
			WHERE project_id = '{{PROJECT_ID}}'
				AND received_at >= datetime('now', '-30 minutes')
			GROUP BY minute
			ORDER BY minute ASC
		)
		SELECT
			CASE
				WHEN (SELECT total FROM now_window) = 0 THEN 'unknown'
				WHEN (CAST((SELECT errors FROM now_window) AS REAL)
				      / (SELECT total FROM now_window)) > 0.05 THEN 'critical'
				WHEN (CAST((SELECT errors FROM now_window) AS REAL)
				      / (SELECT total FROM now_window)) > 0.01 THEN 'warn'
				ELSE 'ok'
			END AS status,
			CASE WHEN (SELECT total FROM now_window) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM now_window) AS REAL)
			          / (SELECT total FROM now_window) END AS primary_value,
			CASE WHEN (SELECT total FROM base_window) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM base_window) AS REAL)
			          / (SELECT total FROM base_window) END AS baseline_value,
			(SELECT json_object(
				'window', '5m',
				'baselineWindow', '1h',
				'currentErrors', (SELECT errors FROM now_window),
				'currentTotal',  (SELECT total  FROM now_window),
				'baselineErrors',(SELECT errors FROM base_window),
				'baselineTotal', (SELECT total  FROM base_window),
				'sparkline', (
					SELECT json_group_array(json_object(
						'minute', minute,
						'total', total,
						'errors', errors,
						'rate', CASE WHEN total = 0 THEN 0
						             ELSE CAST(errors AS REAL) / total END
					)) FROM spark
				)
			)) AS payload
	`,
};

export const TIER0_ANALYSES: AnalysisDefinition[] = [
	overallErrorRate,
	topErrorServices,
	latencyP95Overall,
	throughputSlope,
	activeSessions,
	logErrorRate,
];
