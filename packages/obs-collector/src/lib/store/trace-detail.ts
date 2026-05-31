import type {
	SpanDetailRow,
	TelemetrySpanDetail,
	TelemetryTraceDetailResponse,
} from "@obs-unified/types";
import { parseJsonArray, parseJsonRecord } from "../json";
import type { SqlDb } from "../sql-db";
import { normalizeService } from "./helpers";

export async function getTelemetryTraceDetail(
	db: SqlDb,
	traceId: string,
	projectId: string,
): Promise<TelemetryTraceDetailResponse | null> {
	if (!projectId)
		throw new Error("TelemetryStore.getTraceDetail: projectId is required");
	const result = await db
		.prepare(`
      SELECT project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
             scope_version, span_name, span_kind, status_code, status_message,
             start_time, end_time, duration_ms, attributes_json,
             resource_attributes_json, events_json, links_json,
             received_at, expires_at
      FROM telemetry_spans
      WHERE project_id = ? AND trace_id = ?
      ORDER BY start_time ASC, span_id ASC
    `)
		.bind(projectId, traceId)
		.all<SpanDetailRow>();

	const rows = result.results ?? [];
	if (rows.length === 0) return null;

	const spans: TelemetrySpanDetail[] = rows.map((row) => ({
		traceId: row.trace_id,
		spanId: row.span_id,
		parentSpanId: row.parent_span_id,
		serviceName: normalizeService(row.service_name),
		scopeName: row.scope_name,
		scopeVersion: row.scope_version,
		spanName: row.span_name,
		spanKind: row.span_kind,
		statusCode: row.status_code,
		statusMessage: row.status_message,
		startTime: row.start_time,
		endTime: row.end_time,
		durationMs: row.duration_ms,
		attributes: parseJsonRecord(row.attributes_json),
		resourceAttributes: parseJsonRecord(row.resource_attributes_json),
		events: parseJsonArray(row.events_json),
		links: parseJsonArray(row.links_json),
	}));

	const root = spans.find((span) => !span.parentSpanId) ?? spans[0];

	return {
		trace: {
			traceId,
			serviceName: root.serviceName,
			spanName: root.spanName,
			statusCode: spans.some((span) => span.statusCode === 2)
				? 2
				: root.statusCode,
			statusMessage:
				spans.find((span) => span.statusCode === 2)?.statusMessage ??
				root.statusMessage,
			startTime: root.startTime,
			endTime: root.endTime,
			durationMs: root.durationMs,
			receivedAt: rows[0]?.received_at ?? root.startTime,
			spanCount: spans.length,
			errorSpanCount: spans.filter((span) => span.statusCode === 2).length,
		},
		spans,
		timestamp: new Date().toISOString(),
	};
}
