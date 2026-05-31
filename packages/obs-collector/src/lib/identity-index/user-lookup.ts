import type { SqlDb } from "../sql-db";
import { FETCH_LIMIT } from "./constants";
import { mapAi, mapLog, mapSpan, mapUsage } from "./mappers";
import type { EntityManifest } from "./types";

export async function manifestByUser(
	db: SqlDb,
	projectId: string,
	userId: string,
	opts: { limit?: number; sessions?: number } = {},
): Promise<EntityManifest> {
	const limit = Math.min(opts.limit ?? 100, FETCH_LIMIT);
	const sessionLimit = Math.max(1, Math.min(opts.sessions ?? 5, 20));

	// Step 1 — resolve user_id → visitor_id. user_profiles is the only
	// table that owns the user_id ↔ visitor_id binding.
	const profile = await db
		.prepare(`SELECT visitor_id FROM user_profiles WHERE user_id = ? LIMIT 1`)
		.bind(userId)
		.first<{ visitor_id: string }>();
	if (!profile) {
		return {
			spans: [],
			logs: [],
			usageEvents: [],
			aiCalls: [],
			replay: null,
		};
	}

	// Step 2 — recent session_ids for that visitor. Pull from usage_events
	// (the table that always carries visitor_id; ai_span_payloads has
	// user_id directly but only when present in AI traffic).
	const sessions = await db
		.prepare(
			`SELECT DISTINCT session_id, MAX(occurred_at) AS last_at
				FROM usage_events
				WHERE project_id = ? AND visitor_id = ? AND session_id IS NOT NULL
				GROUP BY session_id
				ORDER BY last_at DESC
				LIMIT ?`,
		)
		.bind(projectId, profile.visitor_id, sessionLimit)
		.all<{ session_id: string; last_at: string }>();
	const sessionIds = sessions.results.map((r) => r.session_id);
	if (sessionIds.length === 0) {
		return {
			spans: [],
			logs: [],
			usageEvents: [],
			aiCalls: [],
			replay: null,
		};
	}

	// Step 3 — fan out to each signal table with IN (?, ?, …). D1 caps
	// bound parameters at 100, so the sessionLimit clamp above (≤20)
	// keeps us well under.
	const placeholders = sessionIds.map(() => "?").join(", ");
	const [spans, logs, usage, aiCalls, replay] = await Promise.all([
		db
			.prepare(
				`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY start_time DESC LIMIT ?`,
			)
			.bind(projectId, ...sessionIds, limit)
			.all<Parameters<typeof mapSpan>[0]>(),
		db
			.prepare(
				`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY occurred_at DESC LIMIT ?`,
			)
			.bind(projectId, ...sessionIds, limit)
			.all<Parameters<typeof mapLog>[0]>(),
		db
			.prepare(
				`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY occurred_at DESC LIMIT ?`,
			)
			.bind(projectId, ...sessionIds, limit)
			.all<Parameters<typeof mapUsage>[0]>(),
		db
			.prepare(
				`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
					FROM ai_calls
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY occurred_at DESC LIMIT ?`,
			)
			.bind(projectId, ...sessionIds, limit)
			.all<Parameters<typeof mapAi>[0]>(),
		// Most recent replay across the user's sessions, if any.
		db
			.prepare(
				`SELECT session_id, first_chunk_at, last_chunk_at, chunk_count, events_count
					FROM session_replay_metadata
					WHERE session_id IN (${placeholders})
					ORDER BY last_chunk_at DESC LIMIT 1`,
			)
			.bind(...sessionIds)
			.first<{
				session_id: string;
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
		replay: replay
			? {
					sessionId: replay.session_id,
					firstChunkAt: replay.first_chunk_at,
					lastChunkAt: replay.last_chunk_at,
					chunkCount: replay.chunk_count,
					eventsCount: replay.events_count,
				}
			: null,
	};
}
