/**
 * RFC 0006 Phase 3.1 — Connected rail manifest endpoint.
 *
 *   GET /internal/connected/:kind/:id
 *
 * Returns the entity's identity-graph neighbors (Up / Across / Down) +
 * topic neighbors (Related), bundled into the shape the dashboard's
 * <ConnectedRail /> renders directly. Built on `IdentityIndex` so the
 * underlying SQL is shared with `/internal/timeline/:sessionId` and any
 * future cross-signal consumer.
 *
 * The handler is the single read path the rail uses. Sections that have
 * no neighbors render as `links: []` with an `emptyReason` explaining
 * why — never absent. This is the "informative absence" pattern from
 * RFC 0006 § Connected rail / Empty-state.
 */

import { ActionConfidence } from "@obsunified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { IdentityIndex } from "../lib/identity-index";
import {
	mapAction,
	mapAgentRun,
	mapEvalResult,
	mapToolCall,
} from "../lib/identity-index/mappers";
import type {
	ActionRef,
	AgentRunRef,
	EvalResultRef,
	ToolCallRef,
} from "../lib/identity-index/types";
import type { SqlDb } from "../lib/sql-db";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

import {
	type ActionContextLinkMetadata,
	type ConnectedEntityKind,
	type ConnectedManifest,
	KNOWN_KINDS,
	linksFromActions,
	linksFromAi,
	linksFromArtifacts,
	linksFromEvalResults,
	linksFromLogs,
	linksFromMetricExemplars,
	linksFromRetrievalEvents,
	linksFromSpans,
	linksFromToolCalls,
	linksFromUsage,
	linkToAction,
	linkToAgentRun,
	linkToSession,
	linkToTrace,
	MAX_LINKS_INLINE,
	profileLinksForTrace,
} from "./connected-routes/manifest";

export type {
	ConnectedEntityKind,
	ConnectedLink,
	ConnectedManifest,
	ConnectedSection,
} from "./connected-routes/manifest";

interface SignalActionContext {
	actions: ActionRef[];
	agentRuns: AgentRunRef[];
	toolCalls: ToolCallRef[];
	evalResults: EvalResultRef[];
	matchLevel: "span" | "trace" | "none";
}

const emptySignalActionContext = (): SignalActionContext => ({
	actions: [],
	agentRuns: [],
	toolCalls: [],
	evalResults: [],
	matchLevel: "none",
});

const loadSignalActionContext = async (
	db: SqlDb,
	projectId: string,
	traceId: string | null | undefined,
	spanId?: string | null,
): Promise<SignalActionContext> => {
	if (!traceId) return emptySignalActionContext();

	const exactRows = spanId
		? await db
				.prepare(
					`SELECT *
					 FROM actions
					 WHERE project_id = ? AND trace_id = ? AND span_id = ?
					 ORDER BY started_at ASC
					 LIMIT 20`,
				)
				.bind(projectId, traceId, spanId)
				.all<Parameters<typeof mapAction>[0]>()
		: { results: [] as Parameters<typeof mapAction>[0][] };

	const traceRows =
		exactRows.results.length > 0
			? exactRows
			: await db
					.prepare(
						`SELECT *
						 FROM actions
						 WHERE project_id = ? AND trace_id = ?
						 ORDER BY started_at ASC
						 LIMIT 20`,
					)
					.bind(projectId, traceId)
					.all<Parameters<typeof mapAction>[0]>();

	const actionRows = traceRows.results;
	if (actionRows.length === 0) return emptySignalActionContext();

	const actionIds = actionRows.map((action) => action.id);
	const rootActionIds = Array.from(
		new Set(
			actionRows
				.map((action) => action.agent_run_id ?? action.root_action_id)
				.filter((id): id is string => Boolean(id)),
		),
	);
	const actionPlaceholders = actionIds.map(() => "?").join(", ");
	const rootPlaceholders = rootActionIds.map(() => "?").join(", ");

	const [toolCalls, evalResults, agentRuns] = await Promise.all([
		db
			.prepare(
				`SELECT *
				 FROM tool_calls
				 WHERE project_id = ? AND action_id IN (${actionPlaceholders})
				 ORDER BY id ASC
				 LIMIT 20`,
			)
			.bind(projectId, ...actionIds)
			.all<Parameters<typeof mapToolCall>[0]>(),
		db
			.prepare(
				`SELECT *
				 FROM eval_results
				 WHERE project_id = ? AND action_id IN (${actionPlaceholders})
				 ORDER BY id ASC
				 LIMIT 20`,
			)
			.bind(projectId, ...actionIds)
			.all<Parameters<typeof mapEvalResult>[0]>(),
		rootActionIds.length > 0
			? db
					.prepare(
						`SELECT *
						 FROM agent_runs
						 WHERE project_id = ? AND id IN (${rootPlaceholders})
						 ORDER BY id ASC
						 LIMIT 20`,
					)
					.bind(projectId, ...rootActionIds)
					.all<Parameters<typeof mapAgentRun>[0]>()
			: { results: [] as Parameters<typeof mapAgentRun>[0][] },
	]);

	return {
		actions: actionRows.map(mapAction),
		agentRuns: agentRuns.results.map(mapAgentRun),
		toolCalls: toolCalls.results.map(mapToolCall),
		evalResults: evalResults.results.map(mapEvalResult),
		matchLevel: exactRows.results.length > 0 ? "span" : "trace",
	};
};

const actionMatchEmptyReason = (context: SignalActionContext): string =>
	context.matchLevel === "trace"
		? "No exact span-level action existed, so these links use trace-level action context."
		: "No action graph records share this signal's trace/span identity.";

const actionContextLinkMetadata = (
	context: SignalActionContext,
	entityLabel: string,
): ActionContextLinkMetadata => {
	if (context.matchLevel === "trace") {
		return {
			source: "trace_id",
			causalConfidence: ActionConfidence.Fallback,
			confidence: 0.55,
			reason: `No exact span-level action matched this ${entityLabel}; linked by shared trace_id instead.`,
		};
	}
	return {
		source: "trace_id+span_id",
		confidence: 0.95,
		reason: `Action context matched this ${entityLabel} by exact trace_id and span_id.`,
	};
};

const metadataForSignalActions = (
	context: SignalActionContext,
	entityLabel: string,
): ((actionId: string) => ActionContextLinkMetadata | undefined) => {
	const byActionId = new Map(
		context.actions.map((action) => {
			const metadata = actionContextLinkMetadata(context, entityLabel);
			return [
				action.id,
				context.matchLevel === "span"
					? { ...metadata, causalConfidence: action.causalConfidence }
					: metadata,
			] as const;
		}),
	);
	return (actionId) => byActionId.get(actionId);
};

const traceLevelMetadata = (
	entityLabel: string,
): ActionContextLinkMetadata => ({
	source: "trace_id",
	causalConfidence: ActionConfidence.Fallback,
	confidence: 0.55,
	reason: `Linked ${entityLabel} through sampled trace_id context; no exact span-level causal edge is implied.`,
});

const linksForAgentRuns = (
	runs: AgentRunRef[],
	context: SignalActionContext,
	entityLabel: string,
) =>
	runs.slice(0, MAX_LINKS_INLINE).map((run) => ({
		...linkToAgentRun(run.id, `${run.agentName} (v${run.agentVersion})`),
		...actionContextLinkMetadata(context, entityLabel),
	}));

export const connectedRoutesPlugin: CollectorPlugin = {
	name: "connected-routes",
	register(app) {
		app.get("/internal/connected/:kind/:id", async (c) => {
			const projectId = getProjectId(c);
			const rawKind = c.req.param("kind");
			const id = c.req.param("id");
			if (!id) {
				return c.json({ error: "id required" }, 400);
			}
			if (!KNOWN_KINDS.has(rawKind)) {
				// Unknown kinds used to fall through every `if` branch and
				// return 200 + empty sections, which hid client bugs.
				return c.json(
					{
						error: `unknown entity kind: ${rawKind}`,
						known: [...KNOWN_KINDS],
					},
					400,
				);
			}
			const kind = rawKind as ConnectedEntityKind;

			const index = new IdentityIndex(sqlDbFor(c.env));

			// Each entity kind starts with a different lookup key. The
			// helpers above shape ref arrays into ConnectedSection.
			const manifest: ConnectedManifest = {
				entity: { kind, id, projectId },
				up: [],
				across: [],
				down: [],
				related: [],
			};

			if (kind === "span") {
				// Span: load by trace_id (its parent chain) + by interaction_id
				// (the click that caused it). Then bucket.
				const traceManifest = await index.byTrace(
					projectId,
					id.split(":")[0] ?? id,
				);
				const span = traceManifest.spans.find(
					(s) => `${s.traceId}:${s.spanId}` === id,
				);
				if (span) {
					const actionContext = await loadSignalActionContext(
						sqlDbFor(c.env),
						projectId,
						span.traceId,
						span.spanId,
					);
					const otherSpans = traceManifest.spans.filter(
						(s) => s.spanId !== span.spanId,
					);
					manifest.up = [
						{
							label: "Trace",
							links: [linkToTrace(span.traceId, "Parent trace")],
						},
					];
					manifest.across = [
						linksFromSpans(otherSpans, `Other spans in this trace`),
						linksFromLogs(traceManifest.logs, "Logs in this trace"),
						linksFromAi(traceManifest.aiCalls, "AI calls in this trace"),
					];
					// RFC 0009 acceptance #5 — surface pprof profiles
					// (CPU + off-CPU) covering this trace's window in the
					// rail's Down section. Each profile_type renders as
					// its own link so a viewer can see at a glance whether
					// only CPU was sampled or off-CPU is present too.
					manifest.down = [
						...(await profileLinksForTrace(
							sqlDbFor(c.env),
							projectId,
							span.traceId,
						)),
						linksFromActions(
							actionContext.actions,
							actionContext.matchLevel === "span"
								? "Causal actions for this span"
								: "Trace-level actions for this span",
							actionContextLinkMetadata(actionContext, "span"),
						),
						linksFromToolCalls(
							actionContext.toolCalls,
							actionContext.matchLevel === "span"
								? "Tool calls for this span"
								: "Trace-level tool calls for this span",
							metadataForSignalActions(actionContext, "span"),
						),
						linksFromEvalResults(
							actionContext.evalResults,
							actionContext.matchLevel === "span"
								? "Evaluations for this span"
								: "Trace-level evaluations for this span",
							metadataForSignalActions(actionContext, "span"),
						),
						linksFromMetricExemplars(
							traceManifest.metricExemplars.filter(
								(e) => !e.spanId || e.spanId === span.spanId,
							),
							"Metric exemplars in this trace",
						),
					];
					if (span.interactionId) {
						const interactionManifest = await index.byInteraction(
							projectId,
							span.interactionId,
						);
						manifest.related = [
							linksFromUsage(
								interactionManifest.usageEvents,
								`Click that caused this trace`,
							),
						];
					} else {
						manifest.related = [
							{
								label: "Originating click",
								links: [],
								emptyReason:
									"Server-originated work (cron, retry, queue consumer) — not bound to a user click.",
							},
						];
					}
					if (actionContext.agentRuns.length > 0) {
						manifest.related.push({
							label:
								actionContext.matchLevel === "span"
									? "Agent runs for this span"
									: "Trace-level agent runs for this span",
							links: linksForAgentRuns(
								actionContext.agentRuns,
								actionContext,
								"span",
							),
						});
					} else {
						manifest.related.push({
							label: "Agent runs for this span",
							links: [],
							emptyReason: actionMatchEmptyReason(actionContext),
						});
					}
				}
			} else if (kind === "profile") {
				const db = sqlDbFor(c.env);
				const profile = await db
					.prepare(
						`SELECT id, service_name, profile_type, start_ts, end_ts,
								duration_ms, sample_count, agent
						 FROM profile_blobs
						 WHERE project_id = ? AND id = ?
						 LIMIT 1`,
					)
					.bind(projectId, id)
					.first<{
						id: string;
						service_name: string | null;
						profile_type: string;
						start_ts: string;
						end_ts: string;
						duration_ms: number;
						sample_count: number | null;
						agent: string | null;
					}>();

				if (profile) {
					const traceRows = await db
						.prepare(
							`SELECT trace_id
							 FROM profile_trace_index
							 WHERE project_id = ? AND profile_id = ?
							 ORDER BY trace_id ASC
							 LIMIT 50`,
						)
						.bind(projectId, id)
						.all<{ trace_id: string }>();
					const traceIds = traceRows.results.map((row) => row.trace_id);
					const sampledTraceIds = traceIds.slice(0, MAX_LINKS_INLINE);
					const traceManifests = await Promise.all(
						sampledTraceIds.map((traceId) => index.byTrace(projectId, traceId)),
					);
					const spans = traceManifests.flatMap((m) => m.spans);
					const logs = traceManifests.flatMap((m) => m.logs);
					const aiCalls = traceManifests.flatMap((m) => m.aiCalls);
					const metricExemplars = traceManifests.flatMap(
						(m) => m.metricExemplars,
					);

					manifest.up = [
						{
							label: "Profile window",
							links: [],
							emptyReason: `${profile.service_name ?? "unknown service"} · ${profile.profile_type} · ${profile.duration_ms}ms · ${profile.sample_count ?? "unknown"} samples`,
						},
					];
					manifest.across = [
						traceIds.length > 0
							? {
									label: "Sampled traces",
									links:
										traceIds.length > MAX_LINKS_INLINE
											? [
													{
														label: `${traceIds.length} sampled traces`,
														href: `#/traces?trace=${encodeURIComponent(traceIds[0])}`,
														count: traceIds.length,
														sample: traceIds[0],
													},
												]
											: traceIds.map((traceId) => linkToTrace(traceId)),
								}
							: {
									label: "Sampled traces",
									links: [],
									emptyReason:
										"No trace_id labels were indexed for this profile. Push pprof samples with trace_id labels or x-obs-trace-ids to enable trace pivots.",
								},
						linksFromSpans(spans, "Sampled spans"),
						linksFromLogs(logs, "Logs in sampled traces"),
						linksFromAi(aiCalls, "AI calls in sampled traces"),
						linksFromMetricExemplars(
							metricExemplars,
							"Metric exemplars in sampled traces",
						),
					];

					if (traceIds.length > 0) {
						const placeholders = traceIds.map(() => "?").join(", ");
						const actions = await db
							.prepare(
								`SELECT id, action_kind, name
								 FROM actions
								 WHERE project_id = ? AND trace_id IN (${placeholders})
								 ORDER BY started_at ASC
								 LIMIT 20`,
							)
							.bind(projectId, ...traceIds)
							.all<{
								id: string;
								action_kind: string;
								name: string | null;
							}>();
						const actionIds = actions.results.map((action) => action.id);
						const actionPlaceholders = actionIds.map(() => "?").join(", ");

						const toolCalls =
							actionIds.length > 0
								? await db
										.prepare(
											`SELECT id, tool_name
											 FROM tool_calls
											 WHERE project_id = ? AND action_id IN (${actionPlaceholders})
											 ORDER BY id ASC
											 LIMIT 20`,
										)
										.bind(projectId, ...actionIds)
										.all<{ id: string; tool_name: string }>()
								: { results: [] as Array<{ id: string; tool_name: string }> };

						const agentRuns = await db
							.prepare(
								`SELECT DISTINCT ar.id, ar.agent_name, ar.agent_version
								 FROM actions a
								 JOIN agent_runs ar
								   ON ar.project_id = a.project_id
								  AND ar.id = COALESCE(a.agent_run_id, a.root_action_id)
								 WHERE a.project_id = ? AND a.trace_id IN (${placeholders})
								 ORDER BY ar.id ASC
								 LIMIT 20`,
							)
							.bind(projectId, ...traceIds)
							.all<{
								id: string;
								agent_name: string;
								agent_version: string;
							}>();

						manifest.down = [
							actions.results.length > 0
								? {
										label: "Causal actions in sampled traces",
										links: actions.results
											.slice(0, MAX_LINKS_INLINE)
											.map((action) => ({
												...linkToAction(
													action.id,
													`[${action.action_kind}] ${action.name ?? action.id}`,
												),
												...traceLevelMetadata("profile action"),
											})),
									}
								: {
										label: "Causal actions in sampled traces",
										links: [],
										emptyReason:
											"No action graph records share this profile's sampled trace IDs.",
									},
							toolCalls.results.length > 0
								? {
										label: "Tool calls in sampled traces",
										links: toolCalls.results
											.slice(0, MAX_LINKS_INLINE)
											.map((toolCall) => ({
												label: `tool: ${toolCall.tool_name}`,
												href: `#/tool-calls/${toolCall.id}`,
												entityKind: "tool_call",
												entityId: toolCall.id,
												...traceLevelMetadata("profile tool call"),
											})),
									}
								: {
										label: "Tool calls in sampled traces",
										links: [],
										emptyReason:
											"No tool calls were attached to actions in this profile.",
									},
						];

						manifest.related =
							agentRuns.results.length > 0
								? [
										{
											label: "Agent runs",
											links: agentRuns.results
												.slice(0, MAX_LINKS_INLINE)
												.map((run) => ({
													...linkToAgentRun(
														run.id,
														`${run.agent_name} (v${run.agent_version})`,
													),
													...traceLevelMetadata("profile agent run"),
												})),
										},
									]
								: [
										{
											label: "Agent runs",
											links: [],
											emptyReason:
												"No agent runs were attached to actions in this profile.",
										},
									];
					} else {
						manifest.down = [
							{
								label: "Causal actions in sampled traces",
								links: [],
								emptyReason:
									"No action graph records can be joined because this profile has no indexed trace IDs.",
							},
							{
								label: "Tool calls in sampled traces",
								links: [],
								emptyReason:
									"No tool calls can be joined because this profile has no indexed trace IDs.",
							},
						];
						manifest.related = [
							{
								label: "Agent runs",
								links: [],
								emptyReason:
									"No agent runs can be joined because this profile has no indexed trace IDs.",
							},
						];
					}
				}
			} else if (kind === "log") {
				// Log: resolve direct log ids when the caller did not already carry
				// trace/session params, then add exact action graph pivots.
				const db = sqlDbFor(c.env);
				const logRow = await db
					.prepare(
						`SELECT trace_id, span_id, session_id
						 FROM logs
						 WHERE project_id = ? AND log_id = ?
						 LIMIT 1`,
					)
					.bind(projectId, id)
					.first<{
						trace_id: string | null;
						span_id: string | null;
						session_id: string | null;
					}>();
				const traceId =
					c.req.query("trace_id") ?? logRow?.trace_id ?? undefined;
				const spanId = c.req.query("span_id") ?? logRow?.span_id ?? undefined;
				const sessionId =
					c.req.query("session_id") ?? logRow?.session_id ?? undefined;
				if (traceId) {
					const traceManifest = await index.byTrace(projectId, traceId);
					const actionContext = await loadSignalActionContext(
						db,
						projectId,
						traceId,
						spanId,
					);
					manifest.up = [
						{
							label: "Trace",
							links: [linkToTrace(traceId, "Parent trace")],
						},
					];
					manifest.across = [
						linksFromLogs(
							traceManifest.logs.filter((l) => l.logId !== id),
							"Other logs in this trace",
						),
					];
					manifest.down = [
						linksFromActions(
							actionContext.actions,
							actionContext.matchLevel === "span"
								? "Causal actions for this log"
								: "Trace-level actions for this log",
							actionContextLinkMetadata(actionContext, "log"),
						),
						linksFromToolCalls(
							actionContext.toolCalls,
							actionContext.matchLevel === "span"
								? "Tool calls for this log"
								: "Trace-level tool calls for this log",
							metadataForSignalActions(actionContext, "log"),
						),
						linksFromEvalResults(
							actionContext.evalResults,
							actionContext.matchLevel === "span"
								? "Evaluations for this log"
								: "Trace-level evaluations for this log",
							metadataForSignalActions(actionContext, "log"),
						),
					];
					manifest.related = [
						actionContext.agentRuns.length > 0
							? {
									label:
										actionContext.matchLevel === "span"
											? "Agent runs for this log"
											: "Trace-level agent runs for this log",
									links: actionContext.agentRuns
										.slice(0, MAX_LINKS_INLINE)
										.map((run) => ({
											...linkToAgentRun(
												run.id,
												`${run.agentName} (v${run.agentVersion})`,
											),
											...actionContextLinkMetadata(actionContext, "log"),
										})),
								}
							: {
									label: "Agent runs for this log",
									links: [],
									emptyReason: actionMatchEmptyReason(actionContext),
								},
					];
				}
				if (sessionId) {
					const sessionManifest = await index.bySession(projectId, sessionId);
					manifest.across.push(
						linksFromUsage(
							sessionManifest.usageEvents,
							"Usage events in this session",
						),
					);
					if (sessionManifest.replay) {
						manifest.across.push({
							label: "Replay",
							links: [linkToSession(sessionId)],
						});
					}
				}
			} else if (kind === "usage" || kind === "replay") {
				// Usage / replay events are session-scoped — load by session_id
				// from the query string.
				const sessionId = c.req.query("session_id") ?? id;
				const sessionManifest = await index.bySession(projectId, sessionId);
				manifest.up = [
					{
						label: "Session",
						links: [linkToSession(sessionId)],
					},
				];
				manifest.across = [
					linksFromSpans(sessionManifest.spans, "Spans in this session"),
					linksFromLogs(sessionManifest.logs, "Logs in this session"),
					linksFromAi(sessionManifest.aiCalls, "AI calls in this session"),
				];
				manifest.related = [
					sessionManifest.replay
						? {
								label: "Replay",
								links: [linkToSession(sessionId)],
							}
						: {
								label: "Replay",
								links: [],
								emptyReason: "No rrweb replay recorded for this session.",
							},
				];
			} else if (kind === "ai_call") {
				const db = sqlDbFor(c.env);
				const callRow = await db
					.prepare(
						`SELECT trace_id, span_id, session_id
						 FROM ai_calls
						 WHERE project_id = ? AND call_id = ?
						 LIMIT 1`,
					)
					.bind(projectId, id)
					.first<{
						trace_id: string | null;
						span_id: string | null;
						session_id: string | null;
					}>();
				const traceId =
					c.req.query("trace_id") ?? callRow?.trace_id ?? undefined;
				const spanId = c.req.query("span_id") ?? callRow?.span_id ?? undefined;
				if (traceId) {
					const traceManifest = await index.byTrace(projectId, traceId);
					const actionContext = await loadSignalActionContext(
						db,
						projectId,
						traceId,
						spanId,
					);
					manifest.up = [
						{
							label: "Trace",
							links: [linkToTrace(traceId, "Parent trace")],
						},
					];
					manifest.across = [
						linksFromSpans(traceManifest.spans, "Spans in this trace"),
						linksFromAi(
							traceManifest.aiCalls.filter((a) => a.callId !== id),
							"Other AI calls in this trace",
						),
						linksFromMetricExemplars(
							traceManifest.metricExemplars,
							"Metric exemplars in this trace",
						),
					];
					manifest.down = [
						linksFromActions(
							actionContext.actions,
							actionContext.matchLevel === "span"
								? "Causal actions for this AI call"
								: "Trace-level actions for this AI call",
							actionContextLinkMetadata(actionContext, "AI call"),
						),
						linksFromToolCalls(
							actionContext.toolCalls,
							actionContext.matchLevel === "span"
								? "Tool calls for this AI call"
								: "Trace-level tool calls for this AI call",
							metadataForSignalActions(actionContext, "AI call"),
						),
						linksFromEvalResults(
							actionContext.evalResults,
							actionContext.matchLevel === "span"
								? "Evaluations for this AI call"
								: "Trace-level evaluations for this AI call",
							metadataForSignalActions(actionContext, "AI call"),
						),
					];
					manifest.related = [
						actionContext.agentRuns.length > 0
							? {
									label:
										actionContext.matchLevel === "span"
											? "Agent runs for this AI call"
											: "Trace-level agent runs for this AI call",
									links: actionContext.agentRuns
										.slice(0, MAX_LINKS_INLINE)
										.map((run) => ({
											...linkToAgentRun(
												run.id,
												`${run.agentName} (v${run.agentVersion})`,
											),
											...actionContextLinkMetadata(actionContext, "AI call"),
										})),
								}
							: {
									label: "Agent runs for this AI call",
									links: [],
									emptyReason: actionMatchEmptyReason(actionContext),
								},
					];
				}
				const sessionId =
					c.req.query("session_id") ?? callRow?.session_id ?? undefined;
				if (sessionId) {
					manifest.across.push({
						label: "Session",
						links: [linkToSession(sessionId)],
					});
				}
			} else if (kind === "user") {
				// RFC 0006 Scenario B — pivot from a user. Loads the user's
				// most recent sessions and surfaces top-line activity in
				// `across`. The "first" session is the canonical "latest
				// session" link used by the AI-cost-spike walkthrough.
				const userManifest = await index.byUser(projectId, id, {
					sessions: 5,
					limit: 50,
				});
				const recentSessions = Array.from(
					new Set(
						userManifest.usageEvents
							.map((e) => e.sessionId)
							.filter((s): s is string => Boolean(s)),
					),
				);
				manifest.up = [
					{
						label: "User",
						links: [],
						emptyReason: "User is the root identity — no parent context above.",
					},
				];
				if (recentSessions.length > 0) {
					manifest.across = [
						{
							label: "Latest session",
							links: [linkToSession(recentSessions[0])],
						},
						{
							label: "Recent sessions",
							links: recentSessions
								.slice(0, MAX_LINKS_INLINE)
								.map((sid) => linkToSession(sid)),
						},
						linksFromSpans(userManifest.spans, "Recent traces"),
						linksFromAi(userManifest.aiCalls, "Recent AI calls"),
					];
				} else {
					manifest.across = [
						{
							label: "Sessions",
							links: [],
							emptyReason:
								"No sessions found for this user. user_profiles needs a visitor_id, and that visitor needs at least one usage_event with a session_id.",
						},
					];
				}
				if (userManifest.replay) {
					manifest.related = [
						{
							label: "Replay",
							links: [linkToSession(userManifest.replay.sessionId)],
						},
					];
				}
			} else if (kind === "action") {
				const actionManifest = await index.byAction(projectId, id);
				const action = actionManifest.actions.find((a) => a.id === id);
				if (action) {
					manifest.up = [];
					if (action.causedByActionId) {
						manifest.up.push({
							label: "Parent Action",
							links: [linkToAction(action.causedByActionId)],
						});
					}
					if (action.agentRunId) {
						manifest.up.push({
							label: "Agent Run",
							links: [linkToAgentRun(action.agentRunId)],
						});
					}
					if (manifest.up.length === 0) {
						manifest.up.push({
							label: "Up",
							links: [],
							emptyReason:
								"No parent context: this action is the root of its execution tree.",
						});
					}

					manifest.across = [
						linksFromActions(
							actionManifest.actions.filter(
								(a) =>
									a.id !== id && a.causedByActionId === action.causedByActionId,
							),
							"Sibling Actions",
						),
						linksFromLogs(actionManifest.logs, "Logs in this action context"),
						linksFromAi(actionManifest.aiCalls, "AI Calls in this action"),
					];

					manifest.down = [
						linksFromActions(
							actionManifest.actions.filter((a) => a.causedByActionId === id),
							"Sub-actions",
						),
						linksFromToolCalls(
							actionManifest.toolCalls.filter((t) => t.actionId === id),
							"Tool Calls",
						),
						linksFromRetrievalEvents(
							actionManifest.retrievalEvents.filter((r) => r.actionId === id),
							"Retrievals",
						),
						linksFromEvalResults(
							actionManifest.evalResults.filter((e) => e.actionId === id),
							"Evaluations",
						),
						linksFromArtifacts(
							actionManifest.artifacts.filter((a) => a.actionId === id),
							"Artifacts",
						),
					];

					if (action.traceId) {
						manifest.related = [
							{
								label: "OTel Trace",
								links: [linkToTrace(action.traceId)],
							},
						];
					}
					manifest.rawManifest = actionManifest;
				}
			} else if (kind === "agent_run") {
				const runManifest = await index.byAgentRun(projectId, id);
				const run = runManifest.agentRuns.find((r) => r.id === id);
				if (run) {
					manifest.up = [
						{
							label: "Agent",
							links: [
								{
									label: `${run.agentName} (v${run.agentVersion})`,
									href: `#/agents/${run.agentId}`,
								},
							],
						},
					];

					manifest.across = [
						linksFromSpans(runManifest.spans, "Traces triggered by this run"),
						linksFromAi(runManifest.aiCalls, "AI Calls in this run"),
					];

					manifest.down = [
						linksFromActions(
							runManifest.actions.filter((a) => a.rootActionId === id),
							"Actions (Decision Spine)",
						),
						linksFromToolCalls(runManifest.toolCalls, "Tool Calls Executed"),
					];

					if (runManifest.replay) {
						manifest.related = [
							{
								label: "User Session",
								links: [linkToSession(runManifest.replay.sessionId)],
							},
						];
					}
					manifest.rawManifest = runManifest;
				}
			} else if (kind === "tool_call") {
				const db = sqlDbFor(c.env);
				const toolCallRow = await db
					.prepare(
						`SELECT action_id, tool_name FROM tool_calls WHERE project_id = ? AND id = ? LIMIT 1`,
					)
					.bind(projectId, id)
					.first<{ action_id: string; tool_name: string }>();

				if (toolCallRow) {
					const actionManifest = await index.byAction(
						projectId,
						toolCallRow.action_id,
					);
					const toolCall = actionManifest.toolCalls.find((t) => t.id === id);
					if (toolCall) {
						manifest.up = [
							{
								label: "Causal Action",
								links: [linkToAction(toolCall.actionId)],
							},
						];

						manifest.across = [
							linksFromToolCalls(
								actionManifest.toolCalls.filter((t) => t.id !== id),
								"Other tool calls in this action",
							),
						];

						manifest.down = [
							{
								label: "Tool Details",
								links: [],
								emptyReason: `Tool: ${toolCall.toolName} (hash: ${toolCall.argsHash.slice(0, 8)})`,
							},
						];
						manifest.rawManifest = actionManifest;
					}
				}
			} else if (kind === "alert" || kind === "analysis") {
				// Alerts and Analyses are topic-related, not identity-related.
				// Their connections come from the alert_rules.analysis_id and
				// analysis_results join, not from the identity graph.
				// For now, return empty-explanatory sections. A follow-up
				// can route through AlertsStore + AnalysesStore for the
				// topic links.
				manifest.related = [
					{
						label: "Topic neighbors",
						links: [],
						emptyReason:
							"Alert/Analysis topic links are surfaced inside their detail views directly — the connected rail focuses on identity-graph neighbors here.",
					},
				];
			}

			// Always at least set placeholder labels so the rail renders
			// section headers consistently across kinds.
			if (manifest.up.length === 0) {
				manifest.up = [
					{
						label: "Up",
						links: [],
						emptyReason: "No parent context for this entity.",
					},
				];
			}
			if (manifest.across.length === 0) {
				manifest.across = [
					{
						label: "Across",
						links: [],
						emptyReason: "No identity-graph peers under this entity.",
					},
				];
			}
			if (manifest.down.length === 0) {
				manifest.down = [
					{
						label: "Down",
						links: [],
						emptyReason:
							"No child entities yet (profiles + kernel events arrive with later RFCs).",
					},
				];
			}
			if (manifest.related.length === 0) {
				manifest.related = [
					{
						label: "Related",
						links: [],
						emptyReason: "No topic neighbors found.",
					},
				];
			}

			return c.json(manifest);
		});
	},
};
