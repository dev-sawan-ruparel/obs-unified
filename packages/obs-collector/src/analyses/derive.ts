// RFC 0002 Stage 1 — Tier 1 derivation engine.
//
// `deriveAnalysesForProject` queries the project's recent telemetry to infer
// its `TelemetryShape` (services, cross-service edges, messaging topics,
// presence of LLM spans) and emits one or more AnalysisDefinitions per
// detected dimension. The shape query is cached in module-level memory for
// 5 minutes per project — the derivation cron runs every ~5min so this
// avoids re-hitting D1 on the dashboard request path.
//
// All emitted SQL is executable as-is by the runner; the project id and
// the relevant scope (service / edge / topic) are baked in at derivation
// time. Identifiers in analysis ids are slugged (slashes, colons, spaces
// → underscores) so they're URL-safe.

import type { AnalysisDefinition } from "@obs-unified/types";

interface TelemetryShape {
	services: string[];
	edges: Array<{ source: string; target: string }>;
	messagingTopics: string[];
	hasLlmSpans: boolean;
}

interface CachedShape {
	shape: TelemetryShape;
	expiresAt: number;
}

const SHAPE_CACHE_TTL_MS = 5 * 60 * 1000;
const shapeCache: Map<string, CachedShape> = new Map();

const slug = (value: string): string =>
	value.replace(/[/:\s]+/g, "_").replace(/[^A-Za-z0-9_.-]/g, "_");

const sqlEscape = (value: string): string => value.replace(/'/g, "''");

interface D1Result<T = Record<string, unknown>> {
	results: T[];
}

interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

const fetchShape = async (
	projectId: string,
	db: D1Database,
): Promise<TelemetryShape> => {
	// Distinct services in the last hour.
	const servicesRes = await db
		.prepare(
			`SELECT DISTINCT service_name
			 FROM telemetry_spans
			 WHERE project_id = ?
			   AND service_name IS NOT NULL
			   AND received_at >= datetime('now', '-1 hour')`,
		)
		.bind(projectId)
		.all<{ service_name: string }>();

	const services = servicesRes.results
		.map((row) => row.service_name)
		.filter(
			(name): name is string => typeof name === "string" && name.length > 0,
		);

	// Cross-service edges: parent span's service != child span's service,
	// within the same trace, in the last hour. We only keep distinct
	// (parent_service, child_service) pairs.
	const edgesRes = await db
		.prepare(
			`SELECT DISTINCT parent.service_name AS source_service,
			                  child.service_name  AS target_service
			 FROM telemetry_spans child
			 JOIN telemetry_spans parent
			   ON parent.project_id = child.project_id
			  AND parent.trace_id   = child.trace_id
			  AND parent.span_id    = child.parent_span_id
			 WHERE child.project_id = ?
			   AND child.received_at >= datetime('now', '-1 hour')
			   AND parent.service_name IS NOT NULL
			   AND child.service_name  IS NOT NULL
			   AND parent.service_name <> child.service_name`,
		)
		.bind(projectId)
		.all<{ source_service: string; target_service: string }>();

	const edges = edgesRes.results
		.filter((row) => row.source_service && row.target_service)
		.map((row) => ({ source: row.source_service, target: row.target_service }));

	// Messaging topics: spans that carry a messaging.destination attribute.
	const topicsRes = await db
		.prepare(
			`SELECT DISTINCT json_extract(attributes_json, '$."messaging.destination"') AS topic
			 FROM telemetry_spans
			 WHERE project_id = ?
			   AND received_at >= datetime('now', '-1 hour')
			   AND json_extract(attributes_json, '$."messaging.destination"') IS NOT NULL`,
		)
		.bind(projectId)
		.all<{ topic: string }>();

	const messagingTopics = topicsRes.results
		.map((row) => row.topic)
		.filter(
			(topic): topic is string => typeof topic === "string" && topic.length > 0,
		);

	// Are there any LLM-kind spans? OpenInference uses
	// `openinference.span.kind` = 'LLM'. We also accept the more general
	// `gen_ai.system` attribute as a heuristic.
	const llmRes = await db
		.prepare(
			`SELECT 1
			 FROM telemetry_spans
			 WHERE project_id = ?
			   AND received_at >= datetime('now', '-1 hour')
			   AND (
			     json_extract(attributes_json, '$."openinference.span.kind"') = 'LLM'
			     OR json_extract(attributes_json, '$."gen_ai.system"') IS NOT NULL
			   )
			 LIMIT 1`,
		)
		.bind(projectId)
		.all<{ "1": number }>();

	return {
		services,
		edges,
		messagingTopics,
		hasLlmSpans: llmRes.results.length > 0,
	};
};

const getShape = async (
	projectId: string,
	db: D1Database,
): Promise<TelemetryShape> => {
	const cached = shapeCache.get(projectId);
	const nowMs = Date.now();
	if (cached && cached.expiresAt > nowMs) return cached.shape;

	const shape = await fetchShape(projectId, db);
	shapeCache.set(projectId, {
		shape,
		expiresAt: nowMs + SHAPE_CACHE_TTL_MS,
	});
	return shape;
};

// ── Builders ────────────────────────────────────────────────────────────────

const makeServiceErrorRate = (
	projectId: string,
	service: string,
): AnalysisDefinition => ({
	id: `service_error_rate::${slug(service)}`,
	title: `${service} — error rate`,
	group: "Services",
	source: "tier1",
	view: "tile",
	refreshSeconds: 60,
	scope: { service },
	narrate: {
		prompt: `${service} error rate moved to {{primary}} (was {{baseline}}, {{delta_pct}}). If the payload names the dominant span/route, call it out. Time anchor.`,
		only_when: "status_changed || delta_pct>25",
	},
	// Last 5 minutes vs trailing 1h baseline (excluding the current 5m).
	// Status thresholds match overall_error_rate: critical>5%, warn>1%.
	sql: `
		WITH now_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id   = '${sqlEscape(projectId)}'
				AND service_name = '${sqlEscape(service)}'
				AND received_at >= datetime('now', '-5 minutes')
		),
		base_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id   = '${sqlEscape(projectId)}'
				AND service_name = '${sqlEscape(service)}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
		),
		spark AS (
			SELECT
				strftime('%Y-%m-%dT%H:%M:00Z', received_at) AS minute,
				COUNT(*) AS total,
				SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors
			FROM telemetry_spans
			WHERE project_id   = '${sqlEscape(projectId)}'
				AND service_name = '${sqlEscape(service)}'
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
				'service', '${sqlEscape(service)}',
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
});

const makeServiceLatencyP95 = (
	projectId: string,
	service: string,
): AnalysisDefinition => ({
	id: `service_latency_p95::${slug(service)}`,
	title: `${service} — p95 latency`,
	group: "Services",
	source: "tier1",
	view: "tile",
	refreshSeconds: 60,
	scope: { service },
	narrate: {
		prompt: `${service} p95 moved to {{primary}}ms from {{baseline}}ms ({{delta_pct}}). Name the span pattern dominating the tail if visible. Time anchor.`,
		only_when: "status_changed || delta_pct>30",
	},
	// p95 of duration_ms over the last hour vs. same hour yesterday.
	// Approximate via ROW_NUMBER (no native percentile in SQLite).
	// Status by delta_pct: critical>50%, warn>20%, ok else.
	sql: `
		WITH cur AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id   = '${sqlEscape(projectId)}'
				AND service_name = '${sqlEscape(service)}'
				AND received_at >= datetime('now', '-1 hour')
		),
		base AS (
			SELECT duration_ms,
				ROW_NUMBER() OVER (ORDER BY duration_ms ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM telemetry_spans
			WHERE project_id   = '${sqlEscape(projectId)}'
				AND service_name = '${sqlEscape(service)}'
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
				'service', '${sqlEscape(service)}',
				'window', '1h',
				'baselineWindow', 'same hour yesterday',
				'unit', 'ms'
			)) AS payload
	`,
});

const makeDependencyHealth = (
	projectId: string,
	source: string,
	target: string,
): AnalysisDefinition => ({
	id: `dependency_health::${slug(source)}->${slug(target)}`,
	title: `${source} → ${target}`,
	group: "Dependencies",
	source: "tier1",
	view: "tile",
	// Dependency edges change shape slowly; sampling every 5 min keeps the
	// per-minute analyses tick cheap on installs with many edges.
	refreshSeconds: 300,
	scope: { source, target },
	// Error rate on the child-side spans of the edge over the last 5 minutes
	// vs trailing 1h baseline. We identify edges by joining child↔parent on
	// trace_id+parent_span_id where parent.service_name = source and
	// child.service_name = target.
	sql: `
		WITH edge_now AS (
			SELECT child.status_code AS sc
			FROM telemetry_spans child
			JOIN telemetry_spans parent
			  ON parent.project_id = child.project_id
			 AND parent.trace_id   = child.trace_id
			 AND parent.span_id    = child.parent_span_id
			WHERE child.project_id   = '${sqlEscape(projectId)}'
				AND parent.service_name = '${sqlEscape(source)}'
				AND child.service_name  = '${sqlEscape(target)}'
				AND child.received_at >= datetime('now', '-5 minutes')
		),
		edge_base AS (
			SELECT child.status_code AS sc
			FROM telemetry_spans child
			JOIN telemetry_spans parent
			  ON parent.project_id = child.project_id
			 AND parent.trace_id   = child.trace_id
			 AND parent.span_id    = child.parent_span_id
			WHERE child.project_id   = '${sqlEscape(projectId)}'
				AND parent.service_name = '${sqlEscape(source)}'
				AND child.service_name  = '${sqlEscape(target)}'
				AND child.received_at >= datetime('now', '-1 hour')
				AND child.received_at <  datetime('now', '-5 minutes')
		),
		now_agg AS (
			SELECT COUNT(*) AS total,
			       SUM(CASE WHEN sc = 2 THEN 1 ELSE 0 END) AS errors
			FROM edge_now
		),
		base_agg AS (
			SELECT COUNT(*) AS total,
			       SUM(CASE WHEN sc = 2 THEN 1 ELSE 0 END) AS errors
			FROM edge_base
		)
		SELECT
			CASE
				WHEN (SELECT total FROM now_agg) = 0 THEN 'unknown'
				WHEN (CAST((SELECT errors FROM now_agg) AS REAL)
				      / (SELECT total FROM now_agg)) > 0.05 THEN 'critical'
				WHEN (CAST((SELECT errors FROM now_agg) AS REAL)
				      / (SELECT total FROM now_agg)) > 0.01 THEN 'warn'
				ELSE 'ok'
			END AS status,
			CASE WHEN (SELECT total FROM now_agg) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM now_agg) AS REAL)
			          / (SELECT total FROM now_agg) END AS primary_value,
			CASE WHEN (SELECT total FROM base_agg) = 0 THEN NULL
			     ELSE CAST((SELECT errors FROM base_agg) AS REAL)
			          / (SELECT total FROM base_agg) END AS baseline_value,
			(SELECT json_object(
				'source', '${sqlEscape(source)}',
				'target', '${sqlEscape(target)}',
				'window', '5m',
				'baselineWindow', '1h',
				'currentTotal',  (SELECT total  FROM now_agg),
				'currentErrors', (SELECT errors FROM now_agg),
				'baselineTotal', (SELECT total  FROM base_agg),
				'baselineErrors',(SELECT errors FROM base_agg)
			)) AS payload
	`,
});

const makeMessagingLag = (
	projectId: string,
	topic: string,
): AnalysisDefinition => ({
	id: `messaging_lag::${slug(topic)}`,
	title: `${topic} — messaging lag`,
	group: "Async",
	source: "tier1",
	view: "tile",
	refreshSeconds: 60,
	scope: { topic },
	// Producer span_kind = 4, Consumer span_kind = 5 (OTel SpanKind enum).
	// We approximate lag as the time gap between producer end_time and the
	// matching consumer start_time on the same trace_id. Spans without a
	// matching counterpart are excluded. Status thresholds in seconds:
	// critical>30s, warn>5s.
	sql: `
		WITH producers AS (
			SELECT trace_id,
			       end_time,
			       json_extract(attributes_json, '$."messaging.destination"') AS topic
			FROM telemetry_spans
			WHERE project_id = '${sqlEscape(projectId)}'
				AND span_kind = 4
				AND json_extract(attributes_json, '$."messaging.destination"') = '${sqlEscape(topic)}'
				AND received_at >= datetime('now', '-15 minutes')
		),
		consumers AS (
			SELECT trace_id,
			       start_time,
			       json_extract(attributes_json, '$."messaging.destination"') AS topic
			FROM telemetry_spans
			WHERE project_id = '${sqlEscape(projectId)}'
				AND span_kind = 5
				AND json_extract(attributes_json, '$."messaging.destination"') = '${sqlEscape(topic)}'
				AND received_at >= datetime('now', '-15 minutes')
		),
		gaps AS (
			SELECT
				(julianday(c.start_time) - julianday(p.end_time)) * 86400.0 AS lag_seconds
			FROM producers p
			JOIN consumers c USING (trace_id)
			WHERE c.start_time >= p.end_time
		),
		ordered AS (
			SELECT lag_seconds,
				ROW_NUMBER() OVER (ORDER BY lag_seconds ASC) AS rn,
				COUNT(*)    OVER () AS n
			FROM gaps
		),
		p95_row AS (
			SELECT lag_seconds FROM ordered
			WHERE rn = MAX(1, CAST(0.95 * n AS INTEGER))
			LIMIT 1
		),
		stats AS (
			SELECT
				(SELECT COUNT(*) FROM gaps)   AS pairs,
				(SELECT AVG(lag_seconds) FROM gaps) AS avg_lag,
				(SELECT lag_seconds FROM p95_row)  AS p95_lag,
				(SELECT MAX(lag_seconds) FROM gaps) AS max_lag
		)
		SELECT
			CASE
				WHEN (SELECT pairs FROM stats) = 0 THEN 'unknown'
				WHEN COALESCE((SELECT p95_lag FROM stats), 0) > 30 THEN 'critical'
				WHEN COALESCE((SELECT p95_lag FROM stats), 0) > 5  THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT p95_lag FROM stats) AS primary_value,
			(SELECT avg_lag FROM stats) AS baseline_value,
			(SELECT json_object(
				'topic', '${sqlEscape(topic)}',
				'unit', 's',
				'window', '15m',
				'pairs',  (SELECT pairs   FROM stats),
				'avgLag', (SELECT avg_lag FROM stats),
				'p95Lag', (SELECT p95_lag FROM stats),
				'maxLag', (SELECT max_lag FROM stats)
			)) AS payload
	`,
});

const makeAiCostBurn = (projectId: string): AnalysisDefinition => ({
	id: "ai_cost_burn",
	title: "AI cost burn",
	group: "AI",
	source: "tier1",
	view: "tile",
	// Cost moves slowly compared to error rates; 5 min cadence keeps the
	// per-minute tick cheap.
	refreshSeconds: 300,
	// USD spent in the last hour vs the prior hour, summed from ai_calls.
	// Status by relative delta: critical>50%, warn>20%. unknown if no cost
	// signal at all.
	sql: `
		WITH cur AS (
			SELECT COALESCE(SUM(total_cost_usd), 0) AS cost,
			       COUNT(*) AS n
			FROM ai_calls
			WHERE project_id = '${sqlEscape(projectId)}'
				AND received_at >= datetime('now', '-1 hour')
		),
		prev AS (
			SELECT COALESCE(SUM(total_cost_usd), 0) AS cost,
			       COUNT(*) AS n
			FROM ai_calls
			WHERE project_id = '${sqlEscape(projectId)}'
				AND received_at >= datetime('now', '-2 hours')
				AND received_at <  datetime('now', '-1 hour')
		),
		delta AS (
			SELECT CASE
				WHEN (SELECT cost FROM prev) = 0 THEN NULL
				ELSE ((SELECT cost FROM cur) - (SELECT cost FROM prev))
				     * 100.0 / (SELECT cost FROM prev)
			END AS pct
		)
		SELECT
			CASE
				WHEN (SELECT n FROM cur) = 0 AND (SELECT n FROM prev) = 0 THEN 'unknown'
				WHEN (SELECT pct FROM delta) IS NULL THEN 'ok'
				WHEN (SELECT pct FROM delta) > 50 THEN 'critical'
				WHEN (SELECT pct FROM delta) > 20 THEN 'warn'
				ELSE 'ok'
			END AS status,
			(SELECT cost FROM cur)  AS primary_value,
			(SELECT cost FROM prev) AS baseline_value,
			(SELECT json_object(
				'unit', 'usd',
				'window', '1h',
				'baselineWindow', 'prior 1h',
				'currentCalls',  (SELECT n FROM cur),
				'baselineCalls', (SELECT n FROM prev)
			)) AS payload
	`,
});

const makeAiErrorRate = (projectId: string): AnalysisDefinition => ({
	id: "ai_error_rate",
	title: "AI error rate",
	group: "AI",
	source: "tier1",
	view: "tile",
	// AI error rate is per-call; 5 min cadence balances signal vs cost on
	// installs with hundreds of LLM spans.
	refreshSeconds: 300,
	// is_error = 1 fraction in the last 5 minutes vs trailing 1h baseline.
	// Same thresholds as overall_error_rate.
	sql: `
		WITH now_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors
			FROM ai_calls
			WHERE project_id = '${sqlEscape(projectId)}'
				AND received_at >= datetime('now', '-5 minutes')
		),
		base_window AS (
			SELECT
				COUNT(*) AS total,
				SUM(CASE WHEN is_error = 1 THEN 1 ELSE 0 END) AS errors
			FROM ai_calls
			WHERE project_id = '${sqlEscape(projectId)}'
				AND received_at >= datetime('now', '-1 hour')
				AND received_at <  datetime('now', '-5 minutes')
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
				'baselineTotal', (SELECT total  FROM base_window)
			)) AS payload
	`,
});

// ── Public API ──────────────────────────────────────────────────────────────

/** Test hook — clears the per-project shape cache. */
export const __resetShapeCache = (): void => {
	shapeCache.clear();
};

export const deriveAnalysesForProject = async (
	projectId: string,
	db: D1Database,
): Promise<AnalysisDefinition[]> => {
	const shape = await getShape(projectId, db);
	const out: AnalysisDefinition[] = [];

	for (const service of shape.services) {
		out.push(makeServiceErrorRate(projectId, service));
		out.push(makeServiceLatencyP95(projectId, service));
	}

	for (const edge of shape.edges) {
		out.push(makeDependencyHealth(projectId, edge.source, edge.target));
	}

	for (const topic of shape.messagingTopics) {
		out.push(makeMessagingLag(projectId, topic));
	}

	if (shape.hasLlmSpans) {
		out.push(makeAiCostBurn(projectId));
		out.push(makeAiErrorRate(projectId));
	}

	return out;
};
