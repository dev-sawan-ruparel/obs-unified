import type { TelemetryOverviewOptions } from "@obsunified/types";
import type { SqlDb } from "../sql-db";
import { cutoffIso } from "./helpers";

export async function getTelemetryExportRows(
	db: SqlDb,
	options: TelemetryOverviewOptions,
): Promise<string> {
	if (!options.projectId)
		throw new Error("TelemetryStore.getExportRows: projectId is required");
	const cutoff = cutoffIso(options.hours);
	const now = new Date().toISOString();
	let whereClause =
		"WHERE project_id = ? AND received_at > ? AND expires_at > ?";
	const params: unknown[] = [options.projectId, cutoff, now];

	if (options.service) {
		whereClause += " AND service_name = ?";
		params.push(options.service);
	}
	if (options.status === "error") {
		whereClause += " AND status_code = 2";
	} else if (options.status === "ok") {
		whereClause += " AND status_code != 2";
	}
	if (options.search) {
		const term = `%${options.search}%`;
		whereClause +=
			" AND (span_name LIKE ? OR status_message LIKE ? OR attributes_json LIKE ? OR events_json LIKE ?)";
		params.push(term, term, term, term);
	}

	const rows = await db
		.prepare(`
        SELECT trace_id, span_id, parent_span_id, service_name, span_name,
               status_code, status_message, start_time, end_time, duration_ms,
               attributes_json, events_json, received_at
        FROM telemetry_spans
        ${whereClause}
        ORDER BY received_at DESC
        LIMIT 1000
      `)
		.bind(...params)
		.all<Record<string, unknown>>();

	return (rows.results || [])
		.map((row) =>
			JSON.stringify({
				trace_id: row.trace_id,
				span_id: row.span_id,
				parent_span_id: row.parent_span_id,
				service: row.service_name,
				span_name: row.span_name,
				status_code: row.status_code,
				status_message: row.status_message,
				start_time: row.start_time,
				end_time: row.end_time,
				duration_ms: row.duration_ms,
				attributes: JSON.parse((row.attributes_json as string) || "{}"),
				events: JSON.parse((row.events_json as string) || "[]"),
				received_at: row.received_at,
			}),
		)
		.join("\n");
}
