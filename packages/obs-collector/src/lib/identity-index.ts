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

import {
	mapAction,
	mapAgentRun,
	mapAi,
	mapArtifact,
	mapEvalResult,
	mapLog,
	mapRetrievalEvent,
	mapSpan,
	mapToolCall,
	mapUsage,
} from "./identity-index/mappers";
import type {
	EntityManifest,
	EntityManifestExtended,
	ReplayRow,
} from "./identity-index/types";
import type { SqlDb } from "./sql-db";

export type {
	ActionRef,
	AgentRunRef,
	AICallRef,
	ArtifactRef,
	EntityManifest,
	EntityManifestExtended,
	EvalResultRef,
	LogRef,
	ReplayRef,
	RetrievalEventRef,
	SpanRef,
	ToolCallRef,
	UsageEventRef,
} from "./identity-index/types";

const FETCH_LIMIT = 200;

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
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, sessionId, FETCH_LIMIT)
				.all<Parameters<typeof mapUsage>[0]>(),
			this.db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
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
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND trace_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, traceId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
						occurred_at, interaction_id, session_id
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
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, interactionId, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND interaction_id = ?
					ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, interactionId, FETCH_LIMIT)
				.all<Parameters<typeof mapUsage>[0]>(),
			this.db
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
			replay: null,
		};
	}

	/**
	 * Cross-session lookup by user. Walks
	 *   user_profiles.user_id → visitor_id → usage_events.session_id → other signals
	 * and returns the union across the user's recent sessions.
	 *
	 * Replay is the most-recent session's replay (if any) — replays are
	 * session-scoped, so collapsing across sessions would conflate distinct
	 * timelines. Callers wanting full history iterate the returned
	 * `usageEvents` for session_ids and hydrate via bySession().
	 *
	 * The `sessions` cap controls how many recent sessions feed the join.
	 * For Scenario B (AI cost spike → top spender → recent activity)
	 * five recent sessions is plenty; anything beyond that loses
	 * specificity in the rail.
	 */
	async byUser(
		projectId: string,
		userId: string,
		opts: { limit?: number; sessions?: number } = {},
	): Promise<EntityManifest> {
		const limit = Math.min(opts.limit ?? 100, FETCH_LIMIT);
		const sessionLimit = Math.max(1, Math.min(opts.sessions ?? 5, 20));

		// Step 1 — resolve user_id → visitor_id. user_profiles is the only
		// table that owns the user_id ↔ visitor_id binding.
		const profile = await this.db
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
		const sessions = await this.db
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
			this.db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, duration_ms, interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY start_time DESC LIMIT ?`,
				)
				.bind(projectId, ...sessionIds, limit)
				.all<Parameters<typeof mapSpan>[0]>(),
			this.db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
						severity, message, occurred_at, interaction_id, session_id
					FROM logs
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY occurred_at DESC LIMIT ?`,
				)
				.bind(projectId, ...sessionIds, limit)
				.all<Parameters<typeof mapLog>[0]>(),
			this.db
				.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity,
						occurred_at, interaction_id, session_id
					FROM usage_events
					WHERE project_id = ? AND session_id IN (${placeholders})
					ORDER BY occurred_at DESC LIMIT ?`,
				)
				.bind(projectId, ...sessionIds, limit)
				.all<Parameters<typeof mapUsage>[0]>(),
			this.db
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
			this.db
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

	/**
	 * Materialize every entity under an Action, resolving adjacent traces,
	 * logs, replays, and sub-actions.
	 */
	async byAction(
		projectId: string,
		actionId: string,
	): Promise<EntityManifestExtended> {
		const action = await this.db
			.prepare(`SELECT * FROM actions WHERE project_id = ? AND id = ? LIMIT 1`)
			.bind(projectId, actionId)
			.first<{
				id: string;
				project_id: string;
				root_action_id: string;
				caused_by_action_id: string | null;
				actor_type: string;
				actor_id: string | null;
				action_kind: string;
				name: string | null;
				status: string;
				started_at: string;
				ended_at: string | null;
				duration_ms: number | null;
				trace_id: string | null;
				span_id: string | null;
				session_id: string | null;
				interaction_id: string | null;
				user_id: string | null;
				agent_run_id: string | null;
				step_id: string | null;
				tool_call_id: string | null;
				prompt_version: string | null;
				model_name: string | null;
				provider: string | null;
				total_cost_usd: number | null;
				attrs_json: string | null;
			}>();

		if (!action) {
			return {
				spans: [],
				logs: [],
				usageEvents: [],
				aiCalls: [],
				replay: null,
				actions: [],
				agentRuns: [],
				toolCalls: [],
				retrievalEvents: [],
				evalResults: [],
				artifacts: [],
			};
		}

		// Retrieve all actions that share the same root_action_id
		const actionsRes = await this.db
			.prepare(
				`SELECT * FROM actions
				WHERE project_id = ? AND root_action_id = ?
				ORDER BY started_at ASC LIMIT ?`,
			)
			.bind(projectId, action.root_action_id, FETCH_LIMIT)
			.all<Parameters<typeof mapAction>[0]>();

		const matchedActions = actionsRes.results;
		const actionIds = matchedActions.map((a) => a.id);

		// Execute child queries in parallel
		const placeholders = actionIds.map(() => "?").join(", ");
		const [agentRuns, toolCalls, retrievalEvents, evalResults, artifacts] =
			await Promise.all([
				this.db
					.prepare(
						`SELECT * FROM agent_runs
					WHERE project_id = ? AND id = ?
					LIMIT 1`,
					)
					.bind(projectId, action.root_action_id)
					.all<Parameters<typeof mapAgentRun>[0]>(),
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapToolCall>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapRetrievalEvent>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapEvalResult>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM artifacts
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapArtifact>[0]>()
					: { results: [] },
			]);

		// Extract unique trace IDs and session IDs
		const traceIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.trace_id)
					.filter((t): t is string => Boolean(t)),
			),
		);
		const sessionIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.session_id)
					.filter((s): s is string => Boolean(s)),
			),
		);

		let spansRes = { results: [] as Parameters<typeof mapSpan>[0][] };
		let logsRes = { results: [] as Parameters<typeof mapLog>[0][] };
		let aiCallsRes = { results: [] as Parameters<typeof mapAi>[0][] };
		let replayRes: ReplayRow | null = null;

		if (traceIds.length > 0) {
			const tracePlaceholders = traceIds.map(() => "?").join(", ");
			const [s, l, a] = await Promise.all([
				this.db
					.prepare(
						`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapSpan>[0]>(),
				this.db
					.prepare(
						`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapLog>[0]>(),
				this.db
					.prepare(
						`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapAi>[0]>(),
			]);
			spansRes = s;
			logsRes = l;
			aiCallsRes = a;
		}

		if (sessionIds.length > 0) {
			const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
			replayRes = await this.db
				.prepare(
					`SELECT session_id, first_chunk_at, last_chunk_at, chunk_count, events_count
					FROM session_replay_metadata
					WHERE session_id IN (${sessionPlaceholders})
					ORDER BY last_chunk_at DESC LIMIT 1`,
				)
				.bind(...sessionIds)
				.first<{
					session_id: string;
					first_chunk_at: string;
					last_chunk_at: string;
					chunk_count: number;
					events_count: number;
				}>();
		}

		return {
			spans: spansRes.results.map(mapSpan),
			logs: logsRes.results.map(mapLog),
			usageEvents: [],
			aiCalls: aiCallsRes.results.map(mapAi),
			replay: replayRes
				? {
						sessionId: replayRes.session_id,
						firstChunkAt: replayRes.first_chunk_at,
						lastChunkAt: replayRes.last_chunk_at,
						chunkCount: replayRes.chunk_count,
						eventsCount: replayRes.events_count,
					}
				: null,
			actions: matchedActions.map(mapAction),
			agentRuns: agentRuns.results.map(mapAgentRun),
			toolCalls: toolCalls.results.map(mapToolCall),
			retrievalEvents: retrievalEvents.results.map(mapRetrievalEvent),
			evalResults: evalResults.results.map(mapEvalResult),
			artifacts: artifacts.results.map(mapArtifact),
		};
	}

	/**
	 * Materialize all entities under an Agent Run.
	 */
	async byAgentRun(
		projectId: string,
		agentRunId: string,
	): Promise<EntityManifestExtended> {
		const run = await this.db
			.prepare(
				`SELECT * FROM agent_runs WHERE project_id = ? AND id = ? LIMIT 1`,
			)
			.bind(projectId, agentRunId)
			.first<{
				id: string;
				project_id: string;
				agent_id: string;
				agent_name: string;
				agent_version: string;
				goal: string | null;
				outcome: string | null;
				autonomy_level: string;
				status: string;
				error_message: string | null;
				total_cost_usd: number | null;
				total_duration_ms: number | null;
				metadata_json: string | null;
			}>();

		if (!run) {
			return {
				spans: [],
				logs: [],
				usageEvents: [],
				aiCalls: [],
				replay: null,
				actions: [],
				agentRuns: [],
				toolCalls: [],
				retrievalEvents: [],
				evalResults: [],
				artifacts: [],
			};
		}

		const actionsRes = await this.db
			.prepare(
				`SELECT * FROM actions
				WHERE project_id = ? AND (root_action_id = ? OR agent_run_id = ?)
				ORDER BY started_at ASC LIMIT ?`,
			)
			.bind(projectId, agentRunId, agentRunId, FETCH_LIMIT)
			.all<Parameters<typeof mapAction>[0]>();

		const matchedActions = actionsRes.results;
		const actionIds = matchedActions.map((a) => a.id);

		// Execute child queries in parallel
		const placeholders = actionIds.map(() => "?").join(", ");
		const [agentRuns, toolCalls, retrievalEvents, evalResults, artifacts] =
			await Promise.all([
				this.db
					.prepare(
						`SELECT * FROM agent_runs
					WHERE project_id = ? AND id = ?
					LIMIT 1`,
					)
					.bind(projectId, agentRunId)
					.all<Parameters<typeof mapAgentRun>[0]>(),
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapToolCall>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapRetrievalEvent>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapEvalResult>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM artifacts
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapArtifact>[0]>()
					: { results: [] },
			]);

		// Extract unique trace IDs and session IDs
		const traceIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.trace_id)
					.filter((t): t is string => Boolean(t)),
			),
		);
		const sessionIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.session_id)
					.filter((s): s is string => Boolean(s)),
			),
		);

		let spansRes = { results: [] as Parameters<typeof mapSpan>[0][] };
		let logsRes = { results: [] as Parameters<typeof mapLog>[0][] };
		let aiCallsRes = { results: [] as Parameters<typeof mapAi>[0][] };
		let replayRes: ReplayRow | null = null;

		if (traceIds.length > 0) {
			const tracePlaceholders = traceIds.map(() => "?").join(", ");
			const [s, l, a] = await Promise.all([
				this.db
					.prepare(
						`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapSpan>[0]>(),
				this.db
					.prepare(
						`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapLog>[0]>(),
				this.db
					.prepare(
						`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapAi>[0]>(),
			]);
			spansRes = s;
			logsRes = l;
			aiCallsRes = a;
		}

		if (sessionIds.length > 0) {
			const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
			replayRes = await this.db
				.prepare(
					`SELECT session_id, first_chunk_at, last_chunk_at, chunk_count, events_count
					FROM session_replay_metadata
					WHERE session_id IN (${sessionPlaceholders})
					ORDER BY last_chunk_at DESC LIMIT 1`,
				)
				.bind(...sessionIds)
				.first<{
					session_id: string;
					first_chunk_at: string;
					last_chunk_at: string;
					chunk_count: number;
					events_count: number;
				}>();
		}

		return {
			spans: spansRes.results.map(mapSpan),
			logs: logsRes.results.map(mapLog),
			usageEvents: [],
			aiCalls: aiCallsRes.results.map(mapAi),
			replay: replayRes
				? {
						sessionId: replayRes.session_id,
						firstChunkAt: replayRes.first_chunk_at,
						lastChunkAt: replayRes.last_chunk_at,
						chunkCount: replayRes.chunk_count,
						eventsCount: replayRes.events_count,
					}
				: null,
			actions: matchedActions.map(mapAction),
			agentRuns: agentRuns.results.map(mapAgentRun),
			toolCalls: toolCalls.results.map(mapToolCall),
			retrievalEvents: retrievalEvents.results.map(mapRetrievalEvent),
			evalResults: evalResults.results.map(mapEvalResult),
			artifacts: artifacts.results.map(mapArtifact),
		};
	}

	/**
	 * Materialize all entities caused by a specific Actor.
	 */
	async byActor(
		projectId: string,
		actorType: string,
		actorId: string,
	): Promise<EntityManifestExtended> {
		const actionsRes = await this.db
			.prepare(
				`SELECT * FROM actions
				WHERE project_id = ? AND actor_type = ? AND actor_id = ?
				ORDER BY started_at DESC LIMIT ?`,
			)
			.bind(projectId, actorType, actorId, FETCH_LIMIT)
			.all<Parameters<typeof mapAction>[0]>();

		const matchedActions = actionsRes.results;
		if (matchedActions.length === 0) {
			return {
				spans: [],
				logs: [],
				usageEvents: [],
				aiCalls: [],
				replay: null,
				actions: [],
				agentRuns: [],
				toolCalls: [],
				retrievalEvents: [],
				evalResults: [],
				artifacts: [],
			};
		}

		const actionIds = matchedActions.map((a) => a.id);
		const rootActionIds = Array.from(
			new Set(matchedActions.map((a) => a.root_action_id)),
		);

		// Execute child queries in parallel
		const placeholders = actionIds.map(() => "?").join(", ");
		const rootPlaceholders = rootActionIds.map(() => "?").join(", ");
		const [agentRuns, toolCalls, retrievalEvents, evalResults, artifacts] =
			await Promise.all([
				rootActionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM agent_runs
							WHERE project_id = ? AND id IN (${rootPlaceholders})
							LIMIT ?`,
							)
							.bind(projectId, ...rootActionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapAgentRun>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapToolCall>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapRetrievalEvent>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapEvalResult>[0]>()
					: { results: [] },
				actionIds.length > 0
					? this.db
							.prepare(
								`SELECT * FROM artifacts
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
							)
							.bind(projectId, ...actionIds, FETCH_LIMIT)
							.all<Parameters<typeof mapArtifact>[0]>()
					: { results: [] },
			]);

		// Extract unique trace IDs and session IDs
		const traceIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.trace_id)
					.filter((t): t is string => Boolean(t)),
			),
		);
		const sessionIds = Array.from(
			new Set(
				matchedActions
					.map((a) => a.session_id)
					.filter((s): s is string => Boolean(s)),
			),
		);

		let spansRes = { results: [] as Parameters<typeof mapSpan>[0][] };
		let logsRes = { results: [] as Parameters<typeof mapLog>[0][] };
		let aiCallsRes = { results: [] as Parameters<typeof mapAi>[0][] };
		let replayRes: ReplayRow | null = null;

		if (traceIds.length > 0) {
			const tracePlaceholders = traceIds.map(() => "?").join(", ");
			const [s, l, a] = await Promise.all([
				this.db
					.prepare(
						`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapSpan>[0]>(),
				this.db
					.prepare(
						`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapLog>[0]>(),
				this.db
					.prepare(
						`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
					)
					.bind(projectId, ...traceIds, FETCH_LIMIT)
					.all<Parameters<typeof mapAi>[0]>(),
			]);
			spansRes = s;
			logsRes = l;
			aiCallsRes = a;
		}

		if (sessionIds.length > 0) {
			const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
			replayRes = await this.db
				.prepare(
					`SELECT session_id, first_chunk_at, last_chunk_at, chunk_count, events_count
					FROM session_replay_metadata
					WHERE session_id IN (${sessionPlaceholders})
					ORDER BY last_chunk_at DESC LIMIT 1`,
				)
				.bind(...sessionIds)
				.first<{
					session_id: string;
					first_chunk_at: string;
					last_chunk_at: string;
					chunk_count: number;
					events_count: number;
				}>();
		}

		return {
			spans: spansRes.results.map(mapSpan),
			logs: logsRes.results.map(mapLog),
			usageEvents: [],
			aiCalls: aiCallsRes.results.map(mapAi),
			replay: replayRes
				? {
						sessionId: replayRes.session_id,
						firstChunkAt: replayRes.first_chunk_at,
						lastChunkAt: replayRes.last_chunk_at,
						chunkCount: replayRes.chunk_count,
						eventsCount: replayRes.events_count,
					}
				: null,
			actions: matchedActions.map(mapAction),
			agentRuns: agentRuns.results.map(mapAgentRun),
			toolCalls: toolCalls.results.map(mapToolCall),
			retrievalEvents: retrievalEvents.results.map(mapRetrievalEvent),
			evalResults: evalResults.results.map(mapEvalResult),
			artifacts: artifacts.results.map(mapArtifact),
		};
	}
}
