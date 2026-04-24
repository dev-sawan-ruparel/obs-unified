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
	payload: Record<string, unknown>;
}

export interface TimelineReplayMetadata {
	firstChunkAt: string;
	lastChunkAt: string;
	chunkCount: number;
	eventsCount: number;
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
						status_code, status_message, start_time, end_time, duration_ms
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
					}>(),
				c.env.DB.prepare(
					`SELECT log_id, trace_id, span_id, service_name, severity, logger_name, message, occurred_at
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
					}>(),
				c.env.DB.prepare(
					`SELECT event_id, event_type, event_name, page_path, severity, occurred_at
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

			for (const s of spansRes.results ?? []) {
				events.push({
					t: s.start_time,
					kind: "span",
					id: `${s.trace_id}:${s.span_id}`,
					title: `${s.service_name ?? "unknown"} · ${s.span_name}`,
					subtitle: s.status_message ?? undefined,
					severity: severityFromStatus(s.status_code),
					durationMs: s.duration_ms,
					payload: {
						traceId: s.trace_id,
						spanId: s.span_id,
						parentSpanId: s.parent_span_id,
						statusCode: s.status_code,
					},
				});
			}

			for (const l of logsRes.results ?? []) {
				events.push({
					t: l.occurred_at,
					kind: "log",
					id: l.log_id,
					title: l.message.slice(0, 160),
					subtitle: `${l.service_name ?? ""}${l.logger_name ? ` · ${l.logger_name}` : ""}`.trim(),
					severity: severityFromLog(l.severity),
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
					payload: {
						eventType: u.event_type,
						eventName: u.event_name,
						pagePath: u.page_path,
					},
				});
			}

			events.sort((a, b) => a.t.localeCompare(b.t));

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
				timestamp: new Date().toISOString(),
			};

			return c.json(response);
		});
	},
};
