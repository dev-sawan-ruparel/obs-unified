import type { SqlDb } from "../sql-db";
import {
	type ParsedSpan,
	placeholders,
	rowToSpan,
	spanSelectColumns,
	type TraceCandidateRow,
	toParsedSpan,
} from "./helpers";

const MAX_TRACE_ID_BINDINGS = 99;

export interface TraceCandidateOptions {
	projectId: string;
	cutoff: string;
	service?: string;
	search?: string;
	status?: "all" | "error" | "ok";
	limit: number;
}

export async function selectTraceCandidates(
	db: SqlDb,
	options: TraceCandidateOptions,
): Promise<TraceCandidateRow[]> {
	let whereClause = "WHERE project_id = ? AND received_at >= ?";
	const binds: unknown[] = [options.projectId, options.cutoff];

	if (options.service) {
		whereClause += " AND service_name = ?";
		binds.push(options.service);
	}
	if (options.search) {
		const term = `%${options.search}%`;
		whereClause +=
			" AND (span_name LIKE ? OR status_message LIKE ? OR attributes_json LIKE ? OR events_json LIKE ?)";
		binds.push(term, term, term, term);
	}

	const having =
		options.status === "error"
			? "HAVING SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) > 0"
			: options.status === "ok"
				? "HAVING SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) = 0"
				: "";

	const result = await db
		.prepare(`
				SELECT
					trace_id,
					MAX(received_at) AS latest_received_at,
					SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS error_span_count
				FROM telemetry_spans
				${whereClause}
				GROUP BY trace_id
				${having}
				ORDER BY latest_received_at DESC
				LIMIT ?
			`)
		.bind(...binds, options.limit)
		.all<TraceCandidateRow>();

	return result.results ?? [];
}

export async function fetchSpansForTraceIds(
	db: SqlDb,
	projectId: string,
	traceIds: string[],
): Promise<ParsedSpan[]> {
	if (traceIds.length === 0) return [];

	const rows: Record<string, unknown>[] = [];
	for (let i = 0; i < traceIds.length; i += MAX_TRACE_ID_BINDINGS) {
		const chunk = traceIds.slice(i, i + MAX_TRACE_ID_BINDINGS);
		const result = await db
			.prepare(`
				SELECT ${spanSelectColumns}
				FROM telemetry_spans
				WHERE project_id = ? AND trace_id IN (${placeholders(chunk.length)})
				ORDER BY received_at DESC, start_time ASC, span_id ASC
			`)
			.bind(projectId, ...chunk)
			.all<Record<string, unknown>>();
		rows.push(...(result.results ?? []));
	}

	return rows.map(rowToSpan).map(toParsedSpan);
}
