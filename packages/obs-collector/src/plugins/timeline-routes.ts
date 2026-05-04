import type { CollectorPlugin } from "../framework/collector";
import { getProjectId } from "./_context";

export interface TimelineEvent {
	t: string;
	kind: "span" | "log" | "usage";
	id: string;
	title: string;
	subtitle?: string;
	severity?: "info" | "warn" | "error";
	durationMs?: number;
	/**
	 * RFC 0004 — click-scoped correlation key. Present on every event that
	 * was emitted while an interaction was active. The {@link TimelineResponse.groups}
	 * field groups events by this id so the dashboard can render
	 * "click → traces it caused" without a second round-trip.
	 */
	interactionId?: string;
	payload: Record<string, unknown>;
}

export interface TimelineReplayMetadata {
	firstChunkAt: string;
	lastChunkAt: string;
	chunkCount: number;
	eventsCount: number;
}

/**
 * RFC 0004 — a click and the traces it caused, bundled. The dashboard's
 * session timeline collapses an interaction's events under its
 * originating click; this is the precomputed shape the dashboard reads.
 */
export interface TimelineGroup {
	interactionId: string;
	/** The originating user-originated event (usage event, kind="interaction" or "page_view"). */
	clickEvent: TimelineEvent | null;
	/** Root spans (parent_span_id IS NULL) carrying this interaction_id. */
	causedTraces: Array<{
		traceId: string;
		rootSpanId: string;
		rootSpanName: string;
		serviceName: string | null;
		durationMs: number;
		status: "ok" | "error";
	}>;
	/** Logs + non-click usage events sharing this interaction_id. */
	relatedEvents: TimelineEvent[];
}

export interface TimelineResponse {
	sessionId: string;
	firstSeen: string | null;
	lastSeen: string | null;
	counts: {
		spans: number;
		logs: number;
		usage: number;
	};
	replay: TimelineReplayMetadata | null;
	events: TimelineEvent[];
	/**
	 * RFC 0004 — derived view keyed by interaction_id. Empty object when
	 * no events in the session carry one (sessions ingested before
	 * @obs/analytics-sdk's autoCorrelate landed). Events without an
	 * interaction_id appear in `events` but never under `groups`.
	 */
	groups: Record<string, TimelineGroup>;
	timestamp: string;
}

const severityFromStatus = (code: number): "info" | "warn" | "error" =>
	code === 2 ? "error" : "info";

const severityFromLog = (
	severity: string | null,
): "info" | "warn" | "error" => {
	if (severity === "ERROR" || severity === "FATAL") return "error";
	if (severity === "WARN") return "warn";
	return "info";
};

const severityFromUsage = (type: string, severity: string | null): "info" | "warn" | "error" => {
	if (type === "frontend_error" || severity === "error") return "error";
	if (severity === "warning") return "warn";
	return "info";
};

export const timelineRoutesPlugin: CollectorPlugin = {
	name: "timeline-routes",
	register(app) {
		app.get("/internal/timeline/:sessionId", async (c) => {
			const projectId = getProjectId(c);
			const sessionId = c.req.param("sessionId");
			if (!sessionId) {
				return c.json({ error: "sessionId required" }, 400);
			}

			const [spansRes, logsRes, usageRes, replayRes] = await Promise.all([
				c.env.DB.prepare(
					`SELECT trace_id, span_id, parent_span_id, service_name, span_name,
						status_code, status_message, start_time, end_time, duration_ms,
						interaction_id
					FROM telemetry_spans
					WHERE project_id = ? AND session_id = ?
					ORDER BY start_time ASC
					LIMIT 2000`,
				)
					.bind(projectId, sessionId)
					.all<{
						trace_id: string;
						span_id: string;
						parent_span_id: string | null;
						service_name: string | null;
						span_name: string;
						status_code: number;
						status_message: string | null;
						start_time: string;
						end_time: string;
						duration_ms: number;
						interaction_id: string | null;
					}>(),
				c.env.DB.prepare(
					`SELECT log_id, trace_id, span_id, service_name, severity, logger_name, message, occurred_at,
						interaction_id
					FROM logs
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC
					LIMIT 2000`,
				)
					.bind(projectId, sessionId)
					.all<{
						log_id: string;
						trace_id: string | null;
						span_id: string | null;
						service_name: string | null;
						severity: string;
						logger_name: string | null;
						message: string;
						occurred_at: string;
						interaction_id: string | null;
					}>(),
				c.env.DB.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity, occurred_at,
						interaction_id
					FROM usage_events
					WHERE project_id = ? AND session_id = ?
					ORDER BY occurred_at ASC
					LIMIT 2000`,
				)
					.bind(projectId, sessionId)
					.all<{
						event_id: string;
						event_type: string;
						event_name: string;
						page_path: string | null;
						severity: string | null;
						occurred_at: string;
						interaction_id: string | null;
					}>(),
				c.env.DB.prepare(
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

			const events: TimelineEvent[] = [];
			// Stash root-span shapes for grouping. Indexed by trace_id since a
			// single click can fan out into multiple service-level traces (rare
			// for a normal browser → single backend, but defensible).
			const rootSpansByInteraction = new Map<
				string,
				TimelineGroup["causedTraces"]
			>();

			for (const s of spansRes.results ?? []) {
				const interactionId = s.interaction_id ?? undefined;
				events.push({
					t: s.start_time,
					kind: "span",
					id: `${s.trace_id}:${s.span_id}`,
					title: `${s.service_name ?? "unknown"} · ${s.span_name}`,
					subtitle: s.status_message ?? undefined,
					severity: severityFromStatus(s.status_code),
					durationMs: s.duration_ms,
					interactionId,
					payload: {
						traceId: s.trace_id,
						spanId: s.span_id,
						parentSpanId: s.parent_span_id,
						statusCode: s.status_code,
					},
				});
				// Only root spans count as "the trace this click caused" — child
				// spans are part of the same trace tree, so collecting them
				// would double-count.
				if (interactionId && s.parent_span_id === null) {
					const list = rootSpansByInteraction.get(interactionId) ?? [];
					list.push({
						traceId: s.trace_id,
						rootSpanId: s.span_id,
						rootSpanName: s.span_name,
						serviceName: s.service_name,
						durationMs: s.duration_ms,
						status: s.status_code === 2 ? "error" : "ok",
					});
					rootSpansByInteraction.set(interactionId, list);
				}
			}

			for (const l of logsRes.results ?? []) {
				events.push({
					t: l.occurred_at,
					kind: "log",
					id: l.log_id,
					title: l.message.slice(0, 160),
					subtitle: `${l.service_name ?? ""}${l.logger_name ? ` · ${l.logger_name}` : ""}`.trim(),
					severity: severityFromLog(l.severity),
					interactionId: l.interaction_id ?? undefined,
					payload: {
						severity: l.severity,
						traceId: l.trace_id,
						spanId: l.span_id,
					},
				});
			}

			for (const u of usageRes.results ?? []) {
				events.push({
					t: u.occurred_at,
					kind: "usage",
					id: u.event_id,
					title: `${u.event_type}${u.event_name && u.event_name !== u.event_type ? ` · ${u.event_name}` : ""}`,
					subtitle: u.page_path ?? undefined,
					severity: severityFromUsage(u.event_type, u.severity),
					interactionId: u.interaction_id ?? undefined,
					payload: {
						eventType: u.event_type,
						eventName: u.event_name,
						pagePath: u.page_path,
					},
				});
			}

			events.sort((a, b) => a.t.localeCompare(b.t));

			// RFC 0004 — derive groups keyed by interaction_id.
			const groups: Record<string, TimelineGroup> = {};
			for (const event of events) {
				if (!event.interactionId) continue;
				let group = groups[event.interactionId];
				if (!group) {
					group = {
						interactionId: event.interactionId,
						clickEvent: null,
						causedTraces: rootSpansByInteraction.get(event.interactionId) ?? [],
						relatedEvents: [],
					};
					groups[event.interactionId] = group;
				}
				// Treat the first usage event with this id as the click that
				// originated it. Usage events are minted at addEventListener
				// fire time so they're timestamp-prior to any fetch the
				// handler kicks off.
				if (event.kind === "usage" && group.clickEvent === null) {
					group.clickEvent = event;
				} else {
					group.relatedEvents.push(event);
				}
			}

			const firstSeen = events[0]?.t ?? null;
			const lastSeen = events[events.length - 1]?.t ?? null;

			const response: TimelineResponse = {
				sessionId,
				firstSeen,
				lastSeen,
				counts: {
					spans: spansRes.results?.length ?? 0,
					logs: logsRes.results?.length ?? 0,
					usage: usageRes.results?.length ?? 0,
				},
				replay: replayRes
					? {
						firstChunkAt: replayRes.first_chunk_at,
						lastChunkAt: replayRes.last_chunk_at,
						chunkCount: replayRes.chunk_count,
						eventsCount: replayRes.events_count,
					}
					: null,
				events,
				groups,
				timestamp: new Date().toISOString(),
			};

			return c.json(response);
		});
	},
};
