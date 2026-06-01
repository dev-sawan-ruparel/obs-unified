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

import type { CollectorPlugin } from "../framework/collector";
import { IdentityIndex } from "../lib/identity-index";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

import {
	type ConnectedEntityKind,
	type ConnectedManifest,
	KNOWN_KINDS,
	linksFromActions,
	linksFromAi,
	linksFromArtifacts,
	linksFromEvalResults,
	linksFromLogs,
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
					manifest.down = await profileLinksForTrace(
						sqlDbFor(c.env),
						projectId,
						span.traceId,
					);
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
				}
			} else if (kind === "log") {
				// Log: load by trace_id (parent trace) + session.
				// id is the log_id, but we need to resolve the trace_id first.
				// Quick lookup: use the IdentityIndex by trace if we have it
				// in a query string, otherwise note that direct log→neighbor
				// requires upstream knowledge of the trace_id.
				const traceId = c.req.query("trace_id");
				const sessionId = c.req.query("session_id");
				if (traceId) {
					const traceManifest = await index.byTrace(projectId, traceId);
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
				const traceId = c.req.query("trace_id");
				if (traceId) {
					const traceManifest = await index.byTrace(projectId, traceId);
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
					];
				}
				const sessionId = c.req.query("session_id");
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
