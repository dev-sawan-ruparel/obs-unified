import type { CollectorPlugin } from "../framework/collector";
import { IdentityIndex } from "../lib/identity-index";
import { sqlDbFor } from "../lib/sql-db";
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
	 * @obs-unified/analytics-sdk's autoCorrelate landed). Events without an
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

			// RFC 0008 — go through the IdentityIndex helper rather than
			// duplicating per-signal SQL. Same indexed lookup, single
			// ownership of the cross-signal join shape.
			const index = new IdentityIndex(sqlDbFor(c.env));
			const manifest = await index.bySession(projectId, sessionId);

			const events: TimelineEvent[] = [];
			// Stash root-span shapes for grouping. Indexed by trace_id since a
			// single click can fan out into multiple service-level traces (rare
			// for a normal browser → single backend, but defensible).
			const rootSpansByInteraction = new Map<
				string,
				TimelineGroup["causedTraces"]
			>();

			for (const s of manifest.spans) {
				const interactionId = s.interactionId ?? undefined;
				events.push({
					t: s.startTime,
					kind: "span",
					id: `${s.traceId}:${s.spanId}`,
					title: `${s.serviceName ?? "unknown"} · ${s.spanName}`,
					subtitle: s.statusMessage ?? undefined,
					severity: severityFromStatus(s.statusCode),
					durationMs: s.durationMs,
					interactionId,
					payload: {
						traceId: s.traceId,
						spanId: s.spanId,
						parentSpanId: s.parentSpanId,
						statusCode: s.statusCode,
					},
				});
				// Only root spans count as "the trace this click caused" — child
				// spans are part of the same trace tree, so collecting them
				// would double-count.
				if (interactionId && s.parentSpanId === null) {
					const list = rootSpansByInteraction.get(interactionId) ?? [];
					list.push({
						traceId: s.traceId,
						rootSpanId: s.spanId,
						rootSpanName: s.spanName,
						serviceName: s.serviceName,
						durationMs: s.durationMs,
						status: s.statusCode === 2 ? "error" : "ok",
					});
					rootSpansByInteraction.set(interactionId, list);
				}
			}

			for (const l of manifest.logs) {
				events.push({
					t: l.occurredAt,
					kind: "log",
					id: l.logId,
					title: l.message.slice(0, 160),
					subtitle: `${l.serviceName ?? ""}${l.loggerName ? ` · ${l.loggerName}` : ""}`.trim(),
					severity: severityFromLog(l.severity),
					interactionId: l.interactionId ?? undefined,
					payload: {
						severity: l.severity,
						traceId: l.traceId,
						spanId: l.spanId,
					},
				});
			}

			for (const u of manifest.usageEvents) {
				events.push({
					t: u.occurredAt,
					kind: "usage",
					id: u.eventId,
					title: `${u.eventType}${u.eventName && u.eventName !== u.eventType ? ` · ${u.eventName}` : ""}`,
					subtitle: u.pagePath ?? undefined,
					severity: severityFromUsage(u.eventType, u.severity),
					interactionId: u.interactionId ?? undefined,
					payload: {
						eventType: u.eventType,
						eventName: u.eventName,
						pagePath: u.pagePath,
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
					spans: manifest.spans.length,
					logs: manifest.logs.length,
					usage: manifest.usageEvents.length,
				},
				replay: manifest.replay
					? {
						firstChunkAt: manifest.replay.firstChunkAt,
						lastChunkAt: manifest.replay.lastChunkAt,
						chunkCount: manifest.replay.chunkCount,
						eventsCount: manifest.replay.eventsCount,
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
