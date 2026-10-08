import type { SqlDb } from "../sql-db";
import { FETCH_LIMIT } from "./constants";
import { mapAi, mapLog, mapMetricExemplar, mapSpan, mapUsage } from "./mappers";
import type { EntityManifest } from "./types";

export async function manifestBySession(
	db: SqlDb,
	projectId: string,
	sessionId: string,
): Promise<EntityManifest> {
	const [spans, logs, usage, aiCalls, replay] = await Promise.all([
		db
			.prepare(
				`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND session_id = ?
					ORDER BY start_time ASC LIMIT ?`,
			)
			.bind(projectId, sessionId, FETCH_LIMIT)
			.all<Parameters<typeof mapSpan>[0]>(),
		db
			.prepare(
				`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, sessionId, FETCH_LIMIT)
			.all<Parameters<typeof mapLog>[0]>(),
		db
			.prepare(
				`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, sessionId, FETCH_LIMIT)
			.all<Parameters<typeof mapUsage>[0]>(),
		db
			.prepare(
				`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
					FROM ai_calls
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, sessionId, FETCH_LIMIT)
			.all<Parameters<typeof mapAi>[0]>(),
		db
			.prepare(
				`SELECT first_chunk_at, last_chunk_at, chunk_count, events_count
					FROM session_replay_metadata
					WHERE session_id = ?`,
			)
			.bind(sessionId)
			.first<{
				first_chunk_at: string;
				last_chunk_at: string;
				chunk_count: number;
				events_count: number;
			}>(),
	]);

	return {
		spans: spans.results.map(mapSpan),
		logs: logs.results.map(mapLog),
		usageEvents: usage.results.map(mapUsage),
		aiCalls: aiCalls.results.map(mapAi),
		metricExemplars: [],
		replay: replay
			? {
					sessionId,
					firstChunkAt: replay.first_chunk_at,
					lastChunkAt: replay.last_chunk_at,
					chunkCount: replay.chunk_count,
					eventsCount: replay.events_count,
				}
			: null,
	};
}

export async function manifestByTrace(
	db: SqlDb,
	projectId: string,
	traceId: string,
): Promise<EntityManifest> {
	const [spans, logs, aiCalls, metricExemplars] = await Promise.all([
		db
			.prepare(
				`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND trace_id = ?
					ORDER BY start_time ASC LIMIT ?`,
			)
			.bind(projectId, traceId, FETCH_LIMIT)
			.all<Parameters<typeof mapSpan>[0]>(),
		db
			.prepare(
				`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND trace_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, traceId, FETCH_LIMIT)
			.all<Parameters<typeof mapLog>[0]>(),
		db
			.prepare(
				`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
					FROM ai_calls
					WHERE project_id = ? AND trace_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, traceId, FETCH_LIMIT)
			.all<Parameters<typeof mapAi>[0]>(),
		db
			.prepare(
				`SELECT id, point_id, series_id, metric_name, service_name,
						trace_id, span_id, ts_ns, value, received_at
					FROM metric_exemplars
					WHERE project_id = ? AND trace_id = ?
					ORDER BY ts_ns DESC LIMIT ?`,
			)
			.bind(projectId, traceId, FETCH_LIMIT)
			.all<Parameters<typeof mapMetricExemplar>[0]>(),
	]);

	return {
		spans: spans.results.map(mapSpan),
		logs: logs.results.map(mapLog),
		usageEvents: [],
		aiCalls: aiCalls.results.map(mapAi),
		metricExemplars: metricExemplars.results.map(mapMetricExemplar),
		replay: null,
	};
}

export async function manifestByInteraction(
	db: SqlDb,
	projectId: string,
	interactionId: string,
): Promise<EntityManifest> {
	const [spans, logs, usage, aiCalls] = await Promise.all([
		db
			.prepare(
				`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY start_time ASC LIMIT ?`,
			)
			.bind(projectId, interactionId, FETCH_LIMIT)
			.all<Parameters<typeof mapSpan>[0]>(),
		db
			.prepare(
				`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, interactionId, FETCH_LIMIT)
			.all<Parameters<typeof mapLog>[0]>(),
		db
			.prepare(
				`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, interactionId, FETCH_LIMIT)
			.all<Parameters<typeof mapUsage>[0]>(),
		db
			.prepare(
				`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
					FROM ai_calls
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
			)
			.bind(projectId, interactionId, FETCH_LIMIT)
			.all<Parameters<typeof mapAi>[0]>(),
	]);

	return {
		spans: spans.results.map(mapSpan),
		logs: logs.results.map(mapLog),
		usageEvents: usage.results.map(mapUsage),
		aiCalls: aiCalls.results.map(mapAi),
		metricExemplars: [],
		replay: null,
	};
}
