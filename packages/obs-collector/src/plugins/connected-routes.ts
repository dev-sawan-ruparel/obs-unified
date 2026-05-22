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
import {
	type AICallRef,
	IdentityIndex,
	type LogRef,
	type SpanRef,
	type UsageEventRef,
	type ActionRef,
	type AgentRunRef,
	type ToolCallRef,
	type RetrievalEventRef,
	type EvalResultRef,
	type ArtifactRef,
} from "../lib/identity-index";
import { type SqlDb, sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export type ConnectedEntityKind =
	| "span"
	| "log"
	| "usage"
	| "ai_call"
	| "replay"
	| "alert"
	| "analysis"
	| "user"
	| "action"
	| "agent_run"
	| "tool_call";

const KNOWN_KINDS: ReadonlySet<string> = new Set<ConnectedEntityKind>([
	"span",
	"log",
	"usage",
	"ai_call",
	"replay",
	"alert",
	"analysis",
	"user",
	"action",
	"agent_run",
	"tool_call",
]);

export interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
	sample?: string;
}

export interface ConnectedSection {
	label: string;
	links: ConnectedLink[];
	emptyReason?: string;
}

export interface ConnectedManifest {
	entity: { kind: ConnectedEntityKind; id: string; projectId: string };
	up: ConnectedSection[];
	across: ConnectedSection[];
	down: ConnectedSection[];
	related: ConnectedSection[];
}

const MAX_LINKS_INLINE = 5;

const truncate = (s: string, n = 80): string =>
	s.length > n ? s.slice(0, n - 1) + "…" : s;

const linkToTrace = (traceId: string, label?: string): ConnectedLink => ({
	label: label ?? `trace ${traceId.slice(0, 12)}`,
	href: `#/traces/${traceId}`,
});

// Show the LAST 12 characters of the session id. ULIDs / UUIDs have most
// of their entropy in the tail; the prefix is timestamp- or cohort-shared
// across sessions in the same window. Slicing the head means every link
// in a busy session looks identical ("session seed-mp27eaj" × 4).
const linkToSession = (sessionId: string): ConnectedLink => ({
	label:
		sessionId.length > 12
			? `session …${sessionId.slice(-12)}`
			: `session ${sessionId}`,
	href: `#/replay?session=${encodeURIComponent(sessionId)}`,
	sample: sessionId,
});

const linksFromSpans = (spans: SpanRef[], prefix: string): ConnectedSection => {
	if (spans.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No spans matched.",
		};
	}
	if (spans.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${spans.length} spans`,
					href: `#/traces?q=${encodeURIComponent(spans[0].traceId)}`,
					count: spans.length,
					sample: truncate(
						`${spans[0].serviceName ?? "?"} · ${spans[0].spanName}`,
					),
				},
			],
		};
	}
	return {
		label: prefix,
		links: spans.map((s) => ({
			label: `${s.serviceName ?? "?"} · ${truncate(s.spanName, 40)}`,
			href: `#/traces/${s.traceId}#span=${s.spanId}`,
		})),
	};
};

const linksFromLogs = (logs: LogRef[], prefix: string): ConnectedSection => {
	if (logs.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No logs share this identity key.",
		};
	}
	if (logs.length > MAX_LINKS_INLINE) {
		const sample = logs[0];
		return {
			label: prefix,
			links: [
				{
					label: `${logs.length} logs`,
					href: `#/logs?q=${encodeURIComponent(sample.traceId ?? "")}`,
					count: logs.length,
					sample: truncate(sample.message),
				},
			],
		};
	}
	return {
		label: prefix,
		links: logs.map((l) => ({
			label: `[${l.severity}] ${truncate(l.message, 60)}`,
			href: `#/logs?id=${l.logId}`,
		})),
	};
};

const linksFromUsage = (
	events: UsageEventRef[],
	prefix: string,
): ConnectedSection => {
	if (events.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No usage events share this identity key.",
		};
	}
	if (events.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${events.length} usage events`,
					href: `#/usage`,
					count: events.length,
					sample: truncate(`${events[0].eventType} · ${events[0].eventName}`),
				},
			],
		};
	}
	return {
		label: prefix,
		links: events.map((e) => ({
			label: `${e.eventType} · ${truncate(e.eventName, 50)}`,
			href: `#/usage?id=${e.eventId}`,
		})),
	};
};

/**
 * RFC 0009 acceptance #5 — query profile_blobs joined with
 * profile_trace_index to find profiles covering a trace, group by
 * profile_type so CPU and off-CPU render as distinct sections.
 * Returns a list of ConnectedSections (one per profile_type) for the
 * Down field of a span manifest.
 */
const profileLinksForTrace = async (
	db: SqlDb,
	projectId: string,
	traceId: string,
): Promise<ConnectedSection[]> => {
	const rows = await db
		.prepare(
			`SELECT b.id, b.service_name, b.profile_type, b.duration_ms
			 FROM profile_trace_index i
			 JOIN profile_blobs b ON b.id = i.profile_id
			 WHERE i.project_id = ? AND i.trace_id = ?
			 ORDER BY b.end_ts DESC LIMIT 50`,
		)
		.bind(projectId, traceId)
		.all<{
			id: string;
			service_name: string | null;
			profile_type: string;
			duration_ms: number;
		}>();

	if (rows.results.length === 0) {
		return [
			{
				label: "Profiles",
				links: [],
				emptyReason:
					"No pprof profile covers this trace's window. Wire @obs-unified/telemetry-sdk's startProfiler() (or run an eBPF agent) on the producing service to populate.",
			},
		];
	}

	// Group by profile_type so CPU and off-CPU surface as distinct rows.
	const byType = new Map<string, typeof rows.results>();
	for (const row of rows.results) {
		const list = byType.get(row.profile_type) ?? [];
		list.push(row);
		byType.set(row.profile_type, list);
	}

	const sections: ConnectedSection[] = [];
	for (const [type, list] of byType) {
		const icon = type === "offcpu" ? "🌊" : "🔥";
		sections.push({
			label: `${icon} ${type === "offcpu" ? "Off-CPU profiles" : `${type[0].toUpperCase()}${type.slice(1)} profiles`}`,
			links: list.map((r) => ({
				label: `${r.service_name ?? "?"} · ${r.duration_ms}ms`,
				href: `#/profiles/${r.id}?trace_id=${encodeURIComponent(traceId)}`,
			})),
		});
	}
	return sections;
};

const linksFromAi = (calls: AICallRef[], prefix: string): ConnectedSection => {
	if (calls.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No AI calls under this identity key.",
		};
	}
	if (calls.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${calls.length} AI calls`,
					href: `#/ai`,
					count: calls.length,
					sample: truncate(`${calls[0].provider} · ${calls[0].modelName}`),
				},
			],
		};
	}
	return {
		label: prefix,
		links: calls.map((c) => ({
			label: `${c.provider} · ${c.modelName}`,
			href: `#/ai?id=${c.callId}`,
		})),
	};
};

const linkToAction = (actionId: string, label?: string): ConnectedLink => ({
	label: label ?? `action ${actionId.slice(0, 12)}`,
	href: `#/actions/${actionId}`,
});

const linkToAgentRun = (runId: string, label?: string): ConnectedLink => ({
	label: label ?? `agent run ${runId.slice(0, 12)}`,
	href: `#/agent-runs/${runId}`,
});

const linksFromActions = (
	actions: ActionRef[],
	prefix: string,
): ConnectedSection => {
	if (actions.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No actions matched.",
		};
	}
	if (actions.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${actions.length} actions`,
					href: `#/actions`,
					count: actions.length,
					sample: truncate(
						`${actions[0].actionKind} · ${actions[0].name ?? "unnamed"}`,
					),
				},
			],
		};
	}
	return {
		label: prefix,
		links: actions.map((a) => ({
			label: `[${a.actionKind}] ${truncate(a.name ?? "unnamed", 40)}`,
			href: `#/actions/${a.id}`,
		})),
	};
};

const linksFromToolCalls = (
	calls: ToolCallRef[],
	prefix: string,
): ConnectedSection => {
	if (calls.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No tool calls matched.",
		};
	}
	if (calls.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${calls.length} tool calls`,
					href: `#/tools`,
					count: calls.length,
					sample: truncate(calls[0].toolName),
				},
			],
		};
	}
	return {
		label: prefix,
		links: calls.map((t) => ({
			label: `tool: ${t.toolName}`,
			href: `#/tool-calls/${t.id}`,
		})),
	};
};

const linksFromRetrievalEvents = (
	events: RetrievalEventRef[],
	prefix: string,
): ConnectedSection => {
	if (events.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No retrievals matched.",
		};
	}
	return {
		label: prefix,
		links: events.map((r) => ({
			label: `retrieve: ${r.retrieverName} (${r.totalResults} docs)`,
			href: `#/retrieval-events/${r.id}`,
		})),
	};
};

const linksFromEvalResults = (
	results: EvalResultRef[],
	prefix: string,
): ConnectedSection => {
	if (results.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No evaluations matched.",
		};
	}
	return {
		label: prefix,
		links: results.map((e) => ({
			label: `eval: ${e.evaluatorName} (${e.passed ? "passed" : "failed"})`,
			href: `#/evals/${e.id}`,
		})),
	};
};

const linksFromArtifacts = (
	arts: ArtifactRef[],
	prefix: string,
): ConnectedSection => {
	if (arts.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No artifacts matched.",
		};
	}
	return {
		label: prefix,
		links: arts.map((a) => ({
			label: `artifact: ${a.artifactName} (${a.artifactType})`,
			href: `#/artifacts/${a.id}`,
		})),
	};
};

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
							emptyReason: "No parent context: this action is the root of its execution tree.",
						});
					}

					manifest.across = [
						linksFromActions(
							actionManifest.actions.filter(
								(a) => a.id !== id && a.causedByActionId === action.causedByActionId,
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
				}
			} else if (kind === "tool_call") {
				const db = sqlDbFor(c.env);
				const toolCallRow = await db
					.prepare(`SELECT action_id, tool_name FROM tool_calls WHERE project_id = ? AND id = ? LIMIT 1`)
					.bind(projectId, id)
					.first<{ action_id: string; tool_name: string }>();

				if (toolCallRow) {
					const actionManifest = await index.byAction(projectId, toolCallRow.action_id);
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
