import type { JsonValue } from "./primitives";

export type UsageEventType =
	| "page_view"
	| "interaction"
	| "frontend_error"
	| "performance";
export type UsageEventSeverity = "info" | "warn" | "error";

export interface UsageEventInput {
	type: UsageEventType;
	name: string;
	sessionId: string;
	visitorId: string;
	path?: string;
	title?: string;
	referrer?: string;
	occurredAt?: string;
	severity?: UsageEventSeverity;
	properties?: Record<string, unknown>;
	context?: Record<string, unknown>;
	/**
	 * RFC 0004 — set by @obs-unified/analytics-sdk when the event is emitted while
	 * a click/submit/keydown interaction is active. Optional on the wire;
	 * the receiver denormalizes into usage_events.interaction_id.
	 */
	interactionId?: string;
}

export interface UsageEventPayload {
	events: UsageEventInput[];
}

export interface UsageEventRecord {
	projectId: string;
	eventId: string;
	sessionId: string;
	visitorId: string;
	eventType: UsageEventType;
	eventName: string;
	pagePath: string | null;
	pageTitle: string | null;
	referrer: string | null;
	severity: UsageEventSeverity;
	source: string;
	contextJson: string;
	propertiesJson: string;
	userAgent: string | null;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string;
	country: string | null;
	browser: string | null;
	os: string | null;
	deviceType: string | null;
	isBot: boolean;
	utmSource: string | null;
	utmMedium: string | null;
	utmCampaign: string | null;
	/**
	 * RFC 0004 — click-scoped correlation ID. Set on usage events emitted
	 * while a click/submit/keydown handler is active (or wrapped in
	 * `withInteractionContext`). Null otherwise (e.g. page_view fired
	 * outside any user interaction).
	 */
	interactionId?: string | null;
}

export interface UsageEventRow {
	project_id: string;
	event_id: string;
	session_id: string;
	visitor_id: string;
	event_type: UsageEventType;
	event_name: string;
	page_path: string | null;
	page_title: string | null;
	referrer: string | null;
	severity: UsageEventSeverity | null;
	source: string | null;
	context_json: string | null;
	properties_json: string | null;
	user_agent: string | null;
	occurred_at: string;
	received_at: string;
	country: string | null;
	browser: string | null;
	os: string | null;
	device_type: string | null;
	is_bot: number;
	utm_source: string | null;
	utm_medium: string | null;
	utm_campaign: string | null;
	interaction_id?: string | null;
}

export interface UsageOverviewOptions {
	projectId: string;
	hours: number;
	path?: string;
	includeAdmin?: boolean;
	limit?: number;
}

// ── Usage Summary Types ──

export interface UsagePageSummary {
	path: string;
	title: string | null;
	views: number;
	uniqueSessions: number;
	averageLoadTimeMs: number;
	errorCount: number;
}

export interface UsageEventSummary {
	eventName: string;
	eventType: UsageEventType;
	totalEvents: number;
	uniqueSessions: number;
}

export interface UsageSessionSummary {
	sessionId: string;
	visitorId: string;
	firstSeen: string;
	lastSeen: string;
	eventCount: number;
	pageViewCount: number;
	errorCount: number;
	lastPath: string | null;
	referrer: string | null;
}

export interface UsageErrorSummary {
	eventId: string;
	sessionId: string;
	pagePath: string | null;
	errorName: string | null;
	errorMessage: string | null;
	component: string | null;
	occurredAt: string;
}

export interface UsageBrowserSummary {
	browser: string;
	count: number;
}
export interface UsageOSSummary {
	os: string;
	count: number;
}
export interface UsageDeviceSummary {
	device: string;
	count: number;
}
export interface UsageCountrySummary {
	country: string;
	count: number;
}
export interface UsageUtmSourceSummary {
	source: string;
	count: number;
}
export interface UsageUtmMediumSummary {
	medium: string;
	count: number;
}
export interface UsageUtmCampaignSummary {
	campaign: string;
	count: number;
}
export interface UsageHourlyPageViews {
	hour: string;
	count: number;
}

export interface UsageOverviewResponse {
	summary: {
		totalEvents: number;
		uniqueSessions: number;
		uniqueVisitors: number;
		pageViews: number;
		frontendErrors: number;
		interactions: number;
	};
	pages: UsagePageSummary[];
	events: UsageEventSummary[];
	recentSessions: UsageSessionSummary[];
	frontendErrors: UsageErrorSummary[];
	browsers: UsageBrowserSummary[];
	operatingSystems: UsageOSSummary[];
	devices: UsageDeviceSummary[];
	countries: UsageCountrySummary[];
	utmSources: UsageUtmSourceSummary[];
	utmMediums: UsageUtmMediumSummary[];
	utmCampaigns: UsageUtmCampaignSummary[];
	hourlyPageViews: UsageHourlyPageViews[];
	botsFiltered: number;
	filters: {
		path: string;
		includeAdmin: boolean;
	};
	windowHours: number;
	timestamp: string;
}

export interface UsageSessionDetailResponse {
	session: UsageSessionSummary;
	events: Array<{
		eventId: string;
		eventType: UsageEventType;
		eventName: string;
		pagePath: string | null;
		pageTitle: string | null;
		severity: UsageEventSeverity;
		occurredAt: string;
		properties: Record<string, JsonValue>;
		context: Record<string, JsonValue>;
		interactionId?: string | null;
	}>;
	timestamp: string;
}

// ── Logs Types ──
