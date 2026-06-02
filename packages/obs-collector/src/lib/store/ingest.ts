import type { StoredSpan } from "@obs-unified/types";
import type { SqlDb } from "../sql-db";
import { updateTraceInstrumentationGaps } from "./trace-detail";

export async function ingestTelemetrySpans(
	db: SqlDb,
	spans: StoredSpan[],
): Promise<{ inserted: number; traceCount: number }> {
	if (spans.length === 0) return { inserted: 0, traceCount: 0 };

	const statements = spans.map((span) => {
		if (!span.projectId)
			throw new Error("TelemetryStore.ingest: span.projectId is required");
		return db
			.prepare(`
        INSERT OR IGNORE INTO telemetry_spans (
          project_id, trace_id, span_id, parent_span_id, trace_state,
          service_name, scope_name, scope_version, span_name, span_kind,
          status_code, status_message, start_time, end_time, duration_ms,
          attributes_json, dropped_attributes_count,
          resource_attributes_json, events_json, dropped_events_count,
          links_json, dropped_links_count, received_at, expires_at,
          session_id, interaction_id, telemetry_sdk_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
			.bind(
				span.projectId,
				span.traceId,
				span.spanId,
				span.parentSpanId,
				span.traceState,
				span.serviceName,
				span.scopeName,
				span.scopeVersion,
				span.spanName,
				span.spanKind,
				span.statusCode,
				span.statusMessage,
				span.startTime,
				span.endTime,
				span.durationMs,
				span.attributesJson,
				span.droppedAttributesCount,
				span.resourceAttributesJson,
				span.eventsJson,
				span.droppedEventsCount,
				span.linksJson,
				span.droppedLinksCount,
				span.receivedAt,
				span.expiresAt,
				span.sessionId ?? null,
				span.interactionId ?? null,
				span.telemetrySdkName ?? null,
			);
	});

	await db.batch(statements);

	const uniqueTraces = Array.from(
		new Map(
			spans.map((s) => [
				`${s.projectId}:${s.traceId}`,
				{ projectId: s.projectId, traceId: s.traceId },
			]),
		).values(),
	);

	await Promise.all(
		uniqueTraces.map(({ projectId, traceId }) =>
			updateTraceInstrumentationGaps(db, projectId, traceId).catch((err) => {
				console.error(
					`Error updating trace instrumentation gaps for trace ${traceId}:`,
					err,
				);
			}),
		),
	);

	return {
		inserted: spans.length,
		traceCount: uniqueTraces.length,
	};
}
