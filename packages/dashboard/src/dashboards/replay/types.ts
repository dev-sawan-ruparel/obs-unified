import type rrwebPlayer from "rrweb-player";

export type RrwebEvent = ConstructorParameters<
	typeof rrwebPlayer
>[0]["props"]["events"][number];

export interface ReplayChunkPage {
	events?: RrwebEvent[];
	chunks?: {
		nextChunkOffset: number | null;
	};
}

export interface ReplayRow {
	session_id: string;
	visitor_id: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
	starting_link?: string;
	storage_bytes?: number;
}

export interface SessionDetail {
	session: {
		sessionId: string;
		visitorId: string;
		firstSeen: string;
		lastSeen: string;
		eventCount: number;
		pageViewCount: number;
		errorCount: number;
	};
	events: Array<{
		eventId: string;
		eventType: string;
		eventName: string;
		pagePath: string | null;
		severity: string;
		occurredAt: string;
		properties: Record<string, unknown>;
		context: Record<string, unknown>;
	}>;
}

export interface TraceEvent {
	eventId?: string;
	traceId: string;
	spanName: string;
	serviceName: string | null;
	statusMessage?: string | null;
	durationMs: number;
	statusCode: number;
	startTime: string;
	spanCount: number;
}

export interface TimelineGroup {
	interactionId: string;
	clickEvent: {
		t: string;
		title: string;
		subtitle?: string;
		payload: Record<string, unknown>;
	} | null;
	causedTraces: Array<{
		traceId: string;
		rootSpanId: string;
		rootSpanName: string;
		serviceName: string | null;
		durationMs: number;
		status: "ok" | "error";
	}>;
	relatedEvents: Array<{ kind: string; id: string }>;
}

export interface ReplayTimelineEntry {
	timelineKey: string;
	eventType: string;
	eventName: string;
	pagePath: string | null;
	severity: string;
	occurredAt: string;
	properties: Record<string, unknown>;
	isTrace: boolean;
	interactionId?: string | null;
}
