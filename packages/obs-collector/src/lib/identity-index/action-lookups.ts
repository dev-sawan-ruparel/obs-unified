import { ActionConfidence } from "@obsunified/types/constants";
import type { SqlDb } from "../sql-db";
import { FETCH_LIMIT } from "./constants";
import { manifestByInteraction } from "./key-lookups";
import {
	mapAction,
	mapAgentRun,
	mapAi,
	mapArtifact,
	mapEvalResult,
	mapLog,
	mapMetricExemplar,
	mapRetrievalEvent,
	mapSpan,
	mapToolCall,
} from "./mappers";
import type { ActionRef, EntityManifestExtended, ReplayRow } from "./types";

const emptyExtendedManifest = (): EntityManifestExtended => ({
	spans: [],
	logs: [],
	usageEvents: [],
	aiCalls: [],
	metricExemplars: [],
	replay: null,
	actions: [],
	agentRuns: [],
	toolCalls: [],
	retrievalEvents: [],
	evalResults: [],
	artifacts: [],
});

const earliest = (values: Array<string | null | undefined>): string =>
	values.filter((v): v is string => Boolean(v)).sort()[0] ??
	new Date(0).toISOString();

const latest = (values: Array<string | null | undefined>): string | null => {
	const sorted = values.filter((v): v is string => Boolean(v)).sort();
	return sorted[sorted.length - 1] ?? null;
};

const durationMs = (
	startedAt: string,
	endedAt: string | null,
): number | null => {
	if (!endedAt) return null;
	const duration = Date.parse(endedAt) - Date.parse(startedAt);
	return Number.isFinite(duration) && duration >= 0 ? duration : null;
};

const projectLegacyInteraction = async (
	db: SqlDb,
	projectId: string,
	interactionId: string,
): Promise<EntityManifestExtended> => {
	const manifest = await manifestByInteraction(db, projectId, interactionId);
	const hasSignals =
		manifest.spans.length > 0 ||
		manifest.logs.length > 0 ||
		manifest.usageEvents.length > 0 ||
		manifest.aiCalls.length > 0;

	if (!hasSignals) return emptyExtendedManifest();

	const startedAt = earliest([
		...manifest.spans.map((s) => s.startTime),
		...manifest.logs.map((l) => l.occurredAt),
		...manifest.usageEvents.map((u) => u.occurredAt),
		...manifest.aiCalls.map((a) => a.occurredAt),
	]);
	const endedAt = latest([
		...manifest.logs.map((l) => l.occurredAt),
		...manifest.usageEvents.map((u) => u.occurredAt),
		...manifest.aiCalls.map((a) => a.occurredAt),
	]);
	const firstSpan = manifest.spans[0];
	const firstUsage = manifest.usageEvents[0];
	const action: ActionRef = {
		id: interactionId,
		projectId,
		rootActionId: interactionId,
		causedByActionId: null,
		actorType: "human",
		actorId: null,
		actionKind: "browser.interaction",
		name: firstUsage?.eventName ?? firstSpan?.spanName ?? "Legacy interaction",
		status:
			manifest.logs.some((l) => l.severity.toLowerCase() === "error") ||
			manifest.spans.some((s) => s.statusCode >= 2)
				? "error"
				: "ok",
		startedAt,
		endedAt,
		durationMs: durationMs(startedAt, endedAt),
		traceId: firstSpan?.traceId ?? manifest.aiCalls[0]?.traceId ?? null,
		spanId: firstSpan?.spanId ?? null,
		sessionId: firstUsage?.sessionId ?? null,
		interactionId,
		userId: null,
		agentRunId: null,
		stepId: null,
		toolCallId: null,
		promptVersion: null,
		modelName: manifest.aiCalls[0]?.modelName ?? null,
		provider: manifest.aiCalls[0]?.provider ?? null,
		totalCostUsd:
			manifest.aiCalls.length > 0
				? manifest.aiCalls.reduce(
						(sum, call) => sum + (call.totalCostUsd ?? 0),
						0,
					)
				: null,
		causalConfidence: ActionConfidence.Fallback,
		attrsJson: JSON.stringify({ projectedFrom: "interaction_id" }),
	};

	return {
		...manifest,
		actions: [action],
		agentRuns: [],
		toolCalls: [],
		retrievalEvents: [],
		evalResults: [],
		artifacts: [],
	};
};

export async function manifestByAction(
	db: SqlDb,
	projectId: string,
	actionId: string,
): Promise<EntityManifestExtended> {
	const action = await db
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
		return projectLegacyInteraction(db, projectId, actionId);
	}

	// Retrieve all actions that share the same root_action_id
	const actionsRes = await db
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
			db
				.prepare(
					`SELECT * FROM agent_runs
					WHERE project_id = ? AND id = ?
					LIMIT 1`,
				)
				.bind(projectId, action.root_action_id)
				.all<Parameters<typeof mapAgentRun>[0]>(),
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapToolCall>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapRetrievalEvent>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapEvalResult>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
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
	let metricExemplarsRes = {
		results: [] as Parameters<typeof mapMetricExemplar>[0][],
	};
	let replayRes: ReplayRow | null = null;

	if (traceIds.length > 0) {
		const tracePlaceholders = traceIds.map(() => "?").join(", ");
		const [s, l, a, e] = await Promise.all([
			db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapAi>[0]>(),
			db
				.prepare(
					`SELECT id, point_id, series_id, metric_name, service_name,
							trace_id, span_id, ts_ns, value, received_at
						FROM metric_exemplars
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY ts_ns DESC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapMetricExemplar>[0]>(),
		]);
		spansRes = s;
		logsRes = l;
		aiCallsRes = a;
		metricExemplarsRes = e;
	}

	if (sessionIds.length > 0) {
		const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
		replayRes = await db
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

	const sumAiCost = aiCallsRes.results.reduce(
		(sum, a) => sum + (a.total_cost_usd ?? 0),
		0,
	);
	const startTimes = matchedActions.map((a) => a.started_at).filter(Boolean);
	const endTimes = matchedActions.map((a) => a.ended_at).filter(Boolean);
	const earliestStart = startTimes.sort()[0] ?? null;
	const latestEnd = endTimes.sort()[endTimes.length - 1] ?? null;
	const totalDurationMs =
		earliestStart && latestEnd
			? Date.parse(latestEnd) - Date.parse(earliestStart)
			: null;

	const mappedRuns = agentRuns.results.map((r) => {
		const mapped = mapAgentRun(r);
		return {
			...mapped,
			totalCostUsd: sumAiCost || mapped.totalCostUsd || 0.0,
			totalDurationMs: totalDurationMs || mapped.totalDurationMs,
		};
	});

	return {
		spans: spansRes.results.map(mapSpan),
		logs: logsRes.results.map(mapLog),
		usageEvents: [],
		aiCalls: aiCallsRes.results.map(mapAi),
		metricExemplars: metricExemplarsRes.results.map(mapMetricExemplar),
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
		agentRuns: mappedRuns,
		toolCalls: toolCalls.results.map(mapToolCall),
		retrievalEvents: retrievalEvents.results.map(mapRetrievalEvent),
		evalResults: evalResults.results.map(mapEvalResult),
		artifacts: artifacts.results.map(mapArtifact),
	};
}

export async function manifestByAgentRun(
	db: SqlDb,
	projectId: string,
	agentRunId: string,
): Promise<EntityManifestExtended> {
	const run = await db
		.prepare(`SELECT * FROM agent_runs WHERE project_id = ? AND id = ? LIMIT 1`)
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
		return emptyExtendedManifest();
	}

	const actionsRes = await db
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
			db
				.prepare(
					`SELECT * FROM agent_runs
					WHERE project_id = ? AND id = ?
					LIMIT 1`,
				)
				.bind(projectId, agentRunId)
				.all<Parameters<typeof mapAgentRun>[0]>(),
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapToolCall>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapRetrievalEvent>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapEvalResult>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
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
	let metricExemplarsRes = {
		results: [] as Parameters<typeof mapMetricExemplar>[0][],
	};
	let replayRes: ReplayRow | null = null;

	if (traceIds.length > 0) {
		const tracePlaceholders = traceIds.map(() => "?").join(", ");
		const [s, l, a, e] = await Promise.all([
			db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapAi>[0]>(),
			db
				.prepare(
					`SELECT id, point_id, series_id, metric_name, service_name,
							trace_id, span_id, ts_ns, value, received_at
						FROM metric_exemplars
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY ts_ns DESC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapMetricExemplar>[0]>(),
		]);
		spansRes = s;
		logsRes = l;
		aiCallsRes = a;
		metricExemplarsRes = e;
	}

	if (sessionIds.length > 0) {
		const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
		replayRes = await db
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

	const sumAiCost = aiCallsRes.results.reduce(
		(sum, a) => sum + (a.total_cost_usd ?? 0),
		0,
	);
	const startTimes = matchedActions.map((a) => a.started_at).filter(Boolean);
	const endTimes = matchedActions.map((a) => a.ended_at).filter(Boolean);
	const earliestStart = startTimes.sort()[0] ?? null;
	const latestEnd = endTimes.sort()[endTimes.length - 1] ?? null;
	const totalDurationMs =
		earliestStart && latestEnd
			? Date.parse(latestEnd) - Date.parse(earliestStart)
			: null;

	const mappedRuns = agentRuns.results.map((r) => {
		const mapped = mapAgentRun(r);
		return {
			...mapped,
			totalCostUsd: sumAiCost || mapped.totalCostUsd || 0.0,
			totalDurationMs: totalDurationMs || mapped.totalDurationMs,
		};
	});

	return {
		spans: spansRes.results.map(mapSpan),
		logs: logsRes.results.map(mapLog),
		usageEvents: [],
		aiCalls: aiCallsRes.results.map(mapAi),
		metricExemplars: metricExemplarsRes.results.map(mapMetricExemplar),
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
		agentRuns: mappedRuns,
		toolCalls: toolCalls.results.map(mapToolCall),
		retrievalEvents: retrievalEvents.results.map(mapRetrievalEvent),
		evalResults: evalResults.results.map(mapEvalResult),
		artifacts: artifacts.results.map(mapArtifact),
	};
}

export async function manifestByActor(
	db: SqlDb,
	projectId: string,
	actorType: string,
	actorId: string,
): Promise<EntityManifestExtended> {
	const actionsRes = await db
		.prepare(
			`SELECT * FROM actions
				WHERE project_id = ? AND actor_type = ? AND actor_id = ?
				ORDER BY started_at DESC LIMIT ?`,
		)
		.bind(projectId, actorType, actorId, FETCH_LIMIT)
		.all<Parameters<typeof mapAction>[0]>();

	const matchedActions = actionsRes.results;
	if (matchedActions.length === 0) {
		return emptyExtendedManifest();
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
				? db
						.prepare(
							`SELECT * FROM agent_runs
							WHERE project_id = ? AND id IN (${rootPlaceholders})
							LIMIT ?`,
						)
						.bind(projectId, ...rootActionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapAgentRun>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM tool_calls
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapToolCall>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM retrieval_events
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapRetrievalEvent>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
						.prepare(
							`SELECT * FROM eval_results
							WHERE project_id = ? AND action_id IN (${placeholders})
							LIMIT ?`,
						)
						.bind(projectId, ...actionIds, FETCH_LIMIT)
						.all<Parameters<typeof mapEvalResult>[0]>()
				: { results: [] },
			actionIds.length > 0
				? db
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
	let metricExemplarsRes = {
		results: [] as Parameters<typeof mapMetricExemplar>[0][],
	};
	let replayRes: ReplayRow | null = null;

	if (traceIds.length > 0) {
		const tracePlaceholders = traceIds.map(() => "?").join(", ");
		const [s, l, a, e] = await Promise.all([
			db
				.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
							status_code, status_message, start_time, duration_ms, interaction_id
						FROM telemetry_spans
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY start_time ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapSpan>[0]>(),
			db
				.prepare(
					`SELECT log_id, trace_id, span_id, service_name, logger_name,
							severity, message, occurred_at, interaction_id, session_id
						FROM logs
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapLog>[0]>(),
			db
				.prepare(
					`SELECT call_id, trace_id, model_name, provider, total_cost_usd,
							occurred_at, interaction_id, session_id
						FROM ai_calls
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY occurred_at ASC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapAi>[0]>(),
			db
				.prepare(
					`SELECT id, point_id, series_id, metric_name, service_name,
							trace_id, span_id, ts_ns, value, received_at
						FROM metric_exemplars
						WHERE project_id = ? AND trace_id IN (${tracePlaceholders})
						ORDER BY ts_ns DESC LIMIT ?`,
				)
				.bind(projectId, ...traceIds, FETCH_LIMIT)
				.all<Parameters<typeof mapMetricExemplar>[0]>(),
		]);
		spansRes = s;
		logsRes = l;
		aiCallsRes = a;
		metricExemplarsRes = e;
	}

	if (sessionIds.length > 0) {
		const sessionPlaceholders = sessionIds.map(() => "?").join(", ");
		replayRes = await db
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
		metricExemplars: metricExemplarsRes.results.map(mapMetricExemplar),
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
