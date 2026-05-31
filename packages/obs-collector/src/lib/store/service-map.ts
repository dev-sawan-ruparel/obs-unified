import { dialectFor, type SqlDb } from "../sql-db";
import { cutoffIso, percentile } from "./helpers";

export interface ServiceMapOptions {
	projectId: string;
	hours: number;
	source?: "all" | "sdk" | "ebpf";
}

export interface ServiceOperationsOptions {
	projectId: string;
	service: string;
	hours: number;
}

export async function getTelemetryServiceMap(
	db: SqlDb,
	options: ServiceMapOptions,
) {
	if (!options.projectId)
		throw new Error("TelemetryStore.getServiceMap: projectId is required");
	const cutoff = cutoffIso(options.hours);
	const dialect = dialectFor(db);
	const source = options.source ?? "all";

	// RFC 0009 — eBPF-derived agents identify themselves via
	// resource_attribute `telemetry.sdk.name`. The set is small and
	// stable enough to inline; expand as new agents land.
	const EBPF_SDK_NAMES = new Set(["beyla", "otel-ebpf-profiler"]);
	const sourceClause =
		source === "ebpf"
			? ` AND telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
					.map(() => "?")
					.join(",")})`
			: source === "sdk"
				? ` AND (telemetry_sdk_name IS NULL OR telemetry_sdk_name NOT IN (${Array.from(
						EBPF_SDK_NAMES,
					)
						.map(() => "?")
						.join(",")}))`
				: "";
	const sourceBinds: unknown[] =
		source === "all" ? [] : Array.from(EBPF_SDK_NAMES);

	const nodesResult = await db
		.prepare(
			`SELECT
					service_name,
					COUNT(*) AS span_count,
					SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS error_count,
					COUNT(DISTINCT trace_id) AS trace_count
				FROM telemetry_spans
				WHERE project_id = ? AND received_at >= ? AND service_name IS NOT NULL${sourceClause}
				GROUP BY service_name`,
		)
		.bind(options.projectId, cutoff, ...sourceBinds)
		.all<{
			service_name: string;
			span_count: number;
			error_count: number;
			trace_count: number;
		}>();

	// Edges come from two relationships:
	//   1. Synchronous: child span's parent_span_id points at the parent's
	//      span_id within the same trace, and they're in different services.
	//   2. Asynchronous: child span carries a `link` (in links_json) back
	//      to a producer span in another service — this is how OpenTelemetry
	//      represents Kafka / RabbitMQ / SQS / Pub/Sub dispatch, because
	//      consumers can process messages long after producers close their
	//      span and a single consume can correspond to many produces.
	// We UNION ALL both — duplicates are accumulated as separate calls,
	// which matches the synchronous semantics (each child = one call).
	// RFC 0009 — applying the source filter to *child* spans for sync
	// edges and to *consumer* spans for async edges. The producer
	// side is left unfiltered (an SDK-instrumented service that
	// publishes to a Kafka topic still belongs in the eBPF view if
	// the consumer is Beyla-instrumented; the edge represents the
	// kernel-observed call, not the producer's instrumentation).
	const childSourceClause =
		source === "ebpf"
			? ` AND c.telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
					.map(() => "?")
					.join(",")})`
			: source === "sdk"
				? ` AND (c.telemetry_sdk_name IS NULL OR c.telemetry_sdk_name NOT IN (${Array.from(
						EBPF_SDK_NAMES,
					)
						.map(() => "?")
						.join(",")}))`
				: "";
	const consumerSourceClause =
		source === "ebpf"
			? ` AND telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
					.map(() => "?")
					.join(",")})`
			: source === "sdk"
				? ` AND (telemetry_sdk_name IS NULL OR telemetry_sdk_name NOT IN (${Array.from(
						EBPF_SDK_NAMES,
					)
						.map(() => "?")
						.join(",")}))`
				: "";
	const linkEdgesSql =
		dialect.name === "postgres"
			? `link_edges AS (
					SELECT
						producer.service_name AS source,
						consumer.service_name AS target,
						consumer.status_code AS status_code,
						consumer.duration_ms AS duration_ms,
						consumer.received_at AS received_at
					FROM (
						SELECT trace_id, span_id, project_id, service_name,
							status_code, duration_ms, received_at, links_json
						FROM telemetry_spans
						WHERE project_id = ?
							AND received_at >= ?
							AND links_json IS NOT NULL
							AND links_json != '[]'${consumerSourceClause}
					) consumer
					CROSS JOIN LATERAL jsonb_array_elements(consumer.links_json::jsonb) link(value)
					JOIN telemetry_spans producer
						ON producer.trace_id = link.value ->> 'traceId'
						AND producer.span_id = link.value ->> 'spanId'
						AND producer.project_id = consumer.project_id
					WHERE producer.received_at >= ?
						AND consumer.service_name IS NOT NULL
						AND producer.service_name IS NOT NULL
						AND producer.service_name != consumer.service_name
				)`
			: `link_edges AS (
					SELECT
						producer.service_name AS source,
						consumer.service_name AS target,
						consumer.status_code AS status_code,
						consumer.duration_ms AS duration_ms,
						consumer.received_at AS received_at
					-- Pre-filter consumers in a subquery so json_each is only
					-- invoked on spans that actually carry links. Without this
					-- gate the cross product fans out across every span in the
					-- window and the query times out on tens of thousands of
					-- rows.
					FROM (
						SELECT trace_id, span_id, project_id, service_name,
							status_code, duration_ms, received_at, links_json
						FROM telemetry_spans
						WHERE project_id = ?
							AND received_at >= ?
							AND links_json IS NOT NULL
							AND links_json != '[]'${consumerSourceClause}
					) consumer,
						json_each(consumer.links_json) link
					-- Match on (trace_id, span_id) so the lookup hits the
					-- composite PRIMARY KEY index. span_id alone has no index
					-- (only the composite PK), so a span_id-only join would
					-- full-scan per link.
					JOIN telemetry_spans producer
						ON producer.trace_id = json_extract(link.value, '$.traceId')
						AND producer.span_id = json_extract(link.value, '$.spanId')
						AND producer.project_id = consumer.project_id
					WHERE producer.received_at >= ?
						AND consumer.service_name IS NOT NULL
						AND producer.service_name IS NOT NULL
						AND producer.service_name != consumer.service_name
				)`;

	const edgeRowsResult = await db
		.prepare(
			`WITH parent_child_edges AS (
					SELECT
						p.service_name AS source,
						c.service_name AS target,
						c.status_code AS status_code,
						c.duration_ms AS duration_ms,
						c.received_at AS received_at
					FROM telemetry_spans p
					JOIN telemetry_spans c
						ON c.parent_span_id = p.span_id
						AND c.trace_id = p.trace_id
						AND c.project_id = p.project_id
					WHERE p.project_id = ?
						AND p.received_at >= ?
						AND c.received_at >= ?
						AND p.service_name IS NOT NULL
						AND c.service_name IS NOT NULL
						AND p.service_name != c.service_name${childSourceClause}
				),
				${linkEdgesSql}
				SELECT * FROM parent_child_edges
				UNION ALL
				SELECT * FROM link_edges
				ORDER BY received_at DESC
				LIMIT 50000`,
		)
		.bind(
			options.projectId,
			cutoff,
			cutoff,
			...sourceBinds,
			options.projectId,
			cutoff,
			...sourceBinds,
			cutoff,
		)
		.all<{
			source: string;
			target: string;
			status_code: number;
			duration_ms: number;
		}>();

	interface EdgeAcc {
		source: string;
		target: string;
		calls: number;
		errors: number;
		durations: number[];
	}
	const edgeMap = new Map<string, EdgeAcc>();
	for (const row of edgeRowsResult.results ?? []) {
		const key = `${row.source}|${row.target}`;
		let acc = edgeMap.get(key);
		if (!acc) {
			acc = {
				source: row.source,
				target: row.target,
				calls: 0,
				errors: 0,
				durations: [],
			};
			edgeMap.set(key, acc);
		}
		acc.calls += 1;
		if (row.status_code === 2) acc.errors += 1;
		acc.durations.push(row.duration_ms ?? 0);
	}

	const windowSeconds = Math.max(1, options.hours * 3600);
	const edges = Array.from(edgeMap.values()).map((e) => ({
		source: e.source,
		target: e.target,
		calls: e.calls,
		errors: e.errors,
		errorRate: e.calls > 0 ? e.errors / e.calls : 0,
		p50DurationMs: percentile(e.durations, 0.5),
		p95DurationMs: percentile(e.durations, 0.95),
		rps: e.calls / windowSeconds,
	}));

	const nodes = (nodesResult.results ?? []).map((r) => ({
		service: r.service_name,
		spanCount: r.span_count,
		errorCount: r.error_count,
		traceCount: r.trace_count,
		errorRate: r.span_count > 0 ? r.error_count / r.span_count : 0,
	}));

	return { nodes, edges };
}

export async function getTelemetryServiceOperations(
	db: SqlDb,
	options: ServiceOperationsOptions,
) {
	if (!options.projectId)
		throw new Error(
			"TelemetryStore.getServiceOperations: projectId is required",
		);
	const cutoff = cutoffIso(options.hours);

	// Top operations — group by span_name, accumulate durations in JS.
	const opsResult = await db
		.prepare(
			// One row per span; calls/errors/percentiles are aggregated per
			// span_name in JS below. Do NOT reintroduce COUNT()/SUM() without
			// a GROUP BY — that collapses the result to a single row in SQLite.
			`SELECT
					span_name,
					status_code,
					duration_ms
				FROM telemetry_spans
				WHERE project_id = ?
					AND service_name = ?
					AND received_at >= ?
				ORDER BY received_at DESC
				LIMIT 20000`,
		)
		.bind(options.projectId, options.service, cutoff)
		.all<{
			span_name: string;
			status_code: number | null;
			duration_ms: number;
		}>();

	interface OpAcc {
		calls: number;
		errors: number;
		durations: number[];
	}
	const opMap = new Map<string, OpAcc>();
	let totalSpans = 0;
	let totalErrors = 0;
	for (const row of opsResult.results ?? []) {
		const isError = row.status_code === 2;
		totalSpans += 1;
		if (isError) totalErrors += 1;
		let acc = opMap.get(row.span_name);
		if (!acc) {
			acc = { calls: 0, errors: 0, durations: [] };
			opMap.set(row.span_name, acc);
		}
		acc.calls += 1;
		if (isError) acc.errors += 1;
		acc.durations.push(row.duration_ms ?? 0);
	}
	const operations = Array.from(opMap.entries())
		.map(([spanName, acc]) => ({
			spanName,
			calls: acc.calls,
			errors: acc.errors,
			errorRate: acc.calls > 0 ? acc.errors / acc.calls : 0,
			p50DurationMs: percentile(acc.durations, 0.5),
			p95DurationMs: percentile(acc.durations, 0.95),
		}))
		.sort((l, r) => r.calls - l.calls)
		.slice(0, 12);

	// Recent error spans for triage.
	const errorRows = await db
		.prepare(
			`SELECT trace_id, span_id, span_name, status_message, duration_ms, start_time
				FROM telemetry_spans
				WHERE project_id = ?
					AND service_name = ?
					AND received_at >= ?
					AND status_code = 2
				ORDER BY received_at DESC
				LIMIT 10`,
		)
		.bind(options.projectId, options.service, cutoff)
		.all<{
			trace_id: string;
			span_id: string;
			span_name: string;
			status_message: string | null;
			duration_ms: number;
			start_time: string;
		}>();

	// Distinct trace count for this service.
	const traceCountRow = await db
		.prepare(
			`SELECT COUNT(DISTINCT trace_id) AS trace_count
				FROM telemetry_spans
				WHERE project_id = ? AND service_name = ? AND received_at >= ?`,
		)
		.bind(options.projectId, options.service, cutoff)
		.first<{ trace_count: number }>();

	return {
		service: options.service,
		spanCount: totalSpans,
		traceCount: traceCountRow?.trace_count ?? 0,
		errorCount: totalErrors,
		operations,
		recentErrors: (errorRows.results ?? []).map((r) => ({
			traceId: r.trace_id,
			spanId: r.span_id,
			spanName: r.span_name,
			statusMessage: r.status_message,
			durationMs: r.duration_ms,
			startTime: r.start_time,
		})),
	};
}
