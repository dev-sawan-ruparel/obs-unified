import type {
	AISpanRecord,
	AISpansOverviewOptions,
	AISpansOverviewResponse,
	JsonValue,
} from "@obsunified/types";
import { parseJsonRecord } from "../json";
import { dialectFor, type SqlDb } from "../sql-db";
import { enrichCost } from "./helpers";
import type { AISpanRow } from "./types";
import { clampInt } from "./types";

export async function getAISpansOverview(
	db: SqlDb,
	options: AISpansOverviewOptions,
): Promise<AISpansOverviewResponse> {
	if (!options.projectId)
		throw new Error("AIStore.getAISpans: projectId is required");
	const dialect = dialectFor(db);
	const hours = clampInt(options.hours, 1, 720, 24);
	const limit = clampInt(options.limit, 1, 1000, 100);

	let sql = `
      SELECT
        s.trace_id            AS trace_id,
        s.span_id             AS span_id,
        s.parent_span_id      AS parent_span_id,
        s.service_name        AS service_name,
        s.span_name           AS span_name,
        s.status_code         AS status_code,
        s.status_message      AS status_message,
        s.start_time          AS start_time,
        s.end_time            AS end_time,
        s.duration_ms         AS duration_ms,
        s.attributes_json     AS attributes_json,
        p.span_kind           AS span_kind,
        p.input_json          AS input_json,
        p.output_json         AS output_json
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.received_at >= ${dialect.sinceHours("?")}
    `;
	const params: unknown[] = [options.projectId, hours];

	if (options.kind) {
		sql += ` AND p.span_kind = ?`;
		params.push(options.kind);
	}
	if (options.service) {
		sql += ` AND s.service_name = ?`;
		params.push(options.service);
	}
	if (options.traceId) {
		sql += ` AND s.trace_id = ?`;
		params.push(options.traceId);
	}

	sql += ` ORDER BY s.start_time DESC LIMIT ?`;
	params.push(limit);

	const results = await db
		.prepare(sql)
		.bind(...params)
		.all<AISpanRow>();

	const spans: AISpanRecord[] = (results.results || []).map((row) => {
		const attrs = parseJsonRecord(row.attributes_json) as Record<
			string,
			JsonValue
		>;
		enrichCost(attrs);
		return {
			traceId: row.trace_id,
			spanId: row.span_id,
			parentSpanId: row.parent_span_id,
			serviceName: row.service_name,
			spanName: row.span_name,
			spanKind: row.span_kind,
			statusCode: row.status_code ?? 0,
			statusMessage: row.status_message,
			startTime: row.start_time,
			endTime: row.end_time ?? row.start_time,
			durationMs: row.duration_ms ?? 0,
			attributes: attrs,
			inputJson: row.input_json,
			outputJson: row.output_json,
		};
	});

	const byKind: Record<string, number> = {};
	let errorSpans = 0;
	for (const span of spans) {
		byKind[span.spanKind] = (byKind[span.spanKind] ?? 0) + 1;
		if (span.statusCode === 2) errorSpans++;
	}

	return {
		spans,
		summary: {
			totalSpans: spans.length,
			byKind,
			errorSpans,
		},
		windowHours: hours,
		timestamp: new Date().toISOString(),
	};
}
