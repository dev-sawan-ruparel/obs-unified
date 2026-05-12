/**
 * RFC 0008 — cross-signal lookup primitive.
 *
 * Given any of the four identity-graph keys (`sessionId`, `traceId`,
 * `interactionId`, `userId`), return references to every entity that
 * carries it. This is the data-plane backing for:
 *  - `/internal/timeline/:sessionId` (RFC 0004 § Session timeline grouping)
 *  - `/internal/connected/:kind/:id` (RFC 0006 manifest endpoint, future)
 *
 * Each method runs ~3-5 indexed SELECTs in parallel via `Promise.all`.
 * Today's pattern is "lookup-only" — no joins inside SQL, the orchestration
 * happens in JS so the partial indices (RFC 0004 migration 027) stay
 * small and per-signal.
 *
 * Returned references are deliberately thin (`{ id, ts }` shapes plus a
 * couple of denormalized fields for human-readable display). Callers
 * fetch full payloads via the per-signal store as needed.
 */

import type { SqlDb } from "./sql-db";

export interface SpanRef {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	spanName: string;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	durationMs: number;
	interactionId: string | null;
}

export interface LogRef {
	logId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	loggerName: string | null;
	severity: string;
	message: string;
	occurredAt: string;
	interactionId: string | null;
}

export interface UsageEventRef {
	eventId: string;
	eventType: string;
	eventName: string;
	pagePath: string | null;
	severity: string | null;
	occurredAt: string;
	interactionId: string | null;
}

export interface AICallRef {
	callId: string;
	traceId: string | null;
	modelName: string;
	provider: string;
	totalCostUsd: number | null;
	occurredAt: string;
	interactionId: string | null;
}

export interface ReplayRef {
	sessionId: string;
	firstChunkAt: string;
	lastChunkAt: string;
	chunkCount: number;
	eventsCount: number;
}

export interface EntityManifest {
	spans: SpanRef[];
	logs: LogRef[];
	usageEvents: UsageEventRef[];
	aiCalls: AICallRef[];
	replay: ReplayRef | null;
}

const FETCH_LIMIT = 200;

const mapSpan = (r: {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	span_name: string;
	status_code: number;
	status_message: string | null;
	start_time: string;
	duration_ms: number;
	interaction_id: string | null;
}): SpanRef => ({
	traceId: r.trace_id,
	spanId: r.span_id,
	parentSpanId: r.parent_span_id,
	serviceName: r.service_name,
	spanName: r.span_name,
	statusCode: r.status_code,
	statusMessage: r.status_message,
	startTime: r.start_time,
	durationMs: r.duration_ms,
	interactionId: r.interaction_id,
});

const mapLog = (r: {
	log_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	logger_name: string | null;
	severity: string;
	message: string;
	occurred_at: string;
	interaction_id: string | null;
}): LogRef => ({
	logId: r.log_id,
	traceId: r.trace_id,
	spanId: r.span_id,
	serviceName: r.service_name,
	loggerName: r.logger_name,
	severity: r.severity,
	message: r.message,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
});

const mapUsage = (r: {
	event_id: string;
	event_type: string;
	event_name: string;
	page_path: string | null;
	severity: string | null;
	occurred_at: string;
	interaction_id: string | null;
}): UsageEventRef => ({
	eventId: r.event_id,
	eventType: r.event_type,
	eventName: r.event_name,
	pagePath: r.page_path,
	severity: r.severity,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
});

const mapAi = (r: {
	call_id: string;
	trace_id: string | null;
	model_name: string;
	provider: string;
	total_cost_usd: number | null;
	occurred_at: string;
	interaction_id: string | null;
}): AICallRef => ({
	callId: r.call_id,
	traceId: r.trace_id,
	modelName: r.model_name,
	provider: r.provider,
	totalCostUsd: r.total_cost_usd,
	occurredAt: r.occurred_at,
	interactionId: r.interaction_id,
});

export class IdentityIndex {
	constructor(private readonly db: SqlDb) {}

	/**
	 * Materialize every entity a session touches. Used by the session
	 * timeline; will be reused by RFC 0006's connected rail when scoped
	 * by sessionId.
	 */
	async bySession(
		projectId: string,
		sessionId: string,
	): Promise<EntityManifest> {
		const [spans, logs, usage, aiCalls, replay] = await Promise.all([
			this.db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND session_id = ?
					ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			this.db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id
					FROM logs
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id
					FROM usage_events
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapUsage>[0]>(),
			this.db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id
					FROM ai_calls
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapAi>[0]>(),
			this.db
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

	/**
	 * Every signal carrying the same trace_id. Replay is null —
	 * replays are session-scoped, not trace-scoped.
	 */
	async byTrace(projectId: string, traceId: string): Promise<EntityManifest> {
		const [spans, logs, aiCalls] = await Promise.all([
			this.db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND trace_id = ?
					ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, traceId, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			this.db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id
					FROM logs
					WHERE project_id = ? AND trace_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, traceId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id
					FROM ai_calls
					WHERE project_id = ? AND trace_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, traceId, FETCH_LIMIT)
				.all<Parameters<typeof mapAi>[0]>(),
		]);

		return {
			spans: spans.results.map(mapSpan),
			logs: logs.results.map(mapLog),
			usageEvents: [],
			aiCalls: aiCalls.results.map(mapAi),
			replay: null,
		};
	}

	/**
	 * RFC 0004 — every signal carrying the same interaction_id. The hot
	 * lookup behind the replay viewer's "Trace caused by this click"
	 * link and the timeline groups field.
	 */
	async byInteraction(
		projectId: string,
		interactionId: string,
	): Promise<EntityManifest> {
		const [spans, logs, usage, aiCalls] = await Promise.all([
			this.db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, interactionId, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			this.db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id
					FROM logs
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, interactionId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id
					FROM usage_events
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, interactionId, FETCH_LIMIT)
				.all<Parameters<typeof mapUsage>[0]>(),
			this.db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id
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
			replay: null,
		};
	}

	/**
	 * Cross-session lookup by user. Returns recent activity. Replay
	 * stays null — replay is session-scoped; callers iterate the user's
	 * sessions and hydrate per-session.
	 */
	async byUser(
		_projectId: string,
		_userId: string,
		_opts: { limit?: number } = {},
	): Promise<EntityManifest> {
		// user_id lives on user_profiles + (in some flows) on usage_events
		// via session_id linkage. Joining user_profiles correctly is a
		// follow-up — until then, throw rather than returning an empty
		// manifest, which would have been indistinguishable from "this user
		// has no signals" at the call site.
		throw new Error(
			"IdentityIndex.byUser is not implemented yet; iterate user sessions and hydrate per-session via bySession()",
		);
	}
}
