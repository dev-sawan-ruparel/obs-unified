import type { Context, Hono } from "hono";

// ── Primitives ──

export type Primitive = string | number | boolean | null | undefined;
export type JsonValue = Primitive | JsonValue[] | { [key: string]: JsonValue };

// ── Collector Environment ──

export interface CollectorEnv {
	DB: D1Database;
	REPLAYS_BUCKET: R2Bucket;
	TELEMETRY_INGEST_TOKEN?: string;
	USAGE_INGEST_TOKEN?: string;
	TELEMETRY_QUERY_TOKEN?: string;
	TELEMETRY_REDACT_FIELDS?: string;
	RETENTION_HOURS?: string;
}

export interface TelemetryProxyEnv {
	TELEMETRY_COLLECTOR_URL: string;
	TELEMETRY_COLLECTOR_TOKEN: string;
	USAGE_COLLECTOR_INGEST_TOKEN?: string;
}

// ── Collector Context (Hono) ──

export interface CollectorRouteContext {
	hono: Context<{ Bindings: CollectorEnv }>;
	env: CollectorEnv;
	now: Date;
}

export type CollectorApp = Hono<{ Bindings: CollectorEnv }>;

// ── OTLP Wire Types ──

export interface OtlpAnyValue {
	stringValue?: string;
	boolValue?: boolean;
	intValue?: string | number;
	doubleValue?: number;
	arrayValue?: { values: OtlpAnyValue[] };
	kvlistValue?: { values: OtlpKeyValue[] };
}

export interface OtlpKeyValue {
	key: string;
	value?: OtlpAnyValue;
}

export interface OtlpEvent {
	name: string;
	timeUnixNano?: string;
	attributes?: OtlpKeyValue[];
}

export interface OtlpLink {
	traceId: string;
	spanId: string;
	attributes?: OtlpKeyValue[];
}

export interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	kind?: number;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes?: OtlpKeyValue[];
	events?: OtlpEvent[];
	links?: OtlpLink[];
	status?: { code?: number; message?: string };
}

export interface OtlpScopeSpans {
	scope?: { name?: string; version?: string };
	spans?: OtlpSpan[];
}

export interface OtlpResourceSpans {
	resource?: { attributes?: OtlpKeyValue[] };
	scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpTraceExportRequest {
	resourceSpans?: OtlpResourceSpans[];
}

// ── Stored Span ──

export interface StoredSpan {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	scopeName: string | null;
	scopeVersion: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	attributesJson: string;
	resourceAttributesJson: string;
	eventsJson: string;
	linksJson: string;
	receivedAt: string;
	expiresAt: string;
}

// ── Database Row Types ──

export interface TraceRow {
	trace_id: string;
	span_count: number;
	error_span_count: number;
	service_name: string | null;
	root_span_name: string | null;
	root_status_code: number | null;
	root_status_message: string | null;
	root_start_time: string | null;
	root_end_time: string | null;
	root_duration_ms: number | null;
	root_received_at: string | null;
}

export interface ServiceSummaryRow {
	service_name: string;
	trace_count: number;
	error_trace_count: number;
}

export interface SpanDetailRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	scope_name: string | null;
	scope_version: string | null;
	span_name: string;
	span_kind: number;
	status_code: number;
	status_message: string | null;
	start_time: string;
	end_time: string;
	duration_ms: number;
	attributes_json: string | null;
	resource_attributes_json: string | null;
	events_json: string | null;
	links_json: string | null;
	received_at: string;
}

// ── Telemetry Overview ──

export interface TelemetryOverviewOptions {
	hours: number;
	service?: string;
	status?: "all" | "ok" | "error";
	limit?: number;
	/** Fuzzy search on span_name, status_message, attributes, events (from D) */
	search?: string;
}

export interface TelemetryTraceSummary {
	traceId: string;
	serviceName: string;
	spanName: string;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	receivedAt: string;
	spanCount: number;
	errorSpanCount: number;
}

export interface TelemetryServiceSummary {
	serviceName: string;
	traceCount: number;
	errorTraceCount: number;
	errorRate: number;
	averageDurationMs: number;
	maxDurationMs: number;
}

export interface TelemetryOverviewResponse {
	summary: {
		totalTraces: number;
		errorTraces: number;
		successTraces: number;
		errorRate: number;
		averageDurationMs: number;
		p95DurationMs: number;
	};
	services: TelemetryServiceSummary[];
	traces: TelemetryTraceSummary[];
	windowHours: number;
	filters: {
		service: string;
		status: string;
	};
	timestamp: string;
}

// ── Telemetry Trace Detail ──

export interface TelemetrySpanDetail {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string;
	scopeName: string | null;
	scopeVersion: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	attributes: Record<string, JsonValue>;
	resourceAttributes: Record<string, JsonValue>;
	events: unknown[];
	links: unknown[];
}

export interface TelemetryTraceDetailResponse {
	trace: TelemetryTraceSummary;
	spans: TelemetrySpanDetail[];
	timestamp: string;
}

// ── Telemetry Issues ──

export type TelemetryIssueCategory = "error" | "latency" | "dependency";
export type TelemetryIssueSeverity = "critical" | "high" | "medium" | "low";

export interface TelemetryIssueOptions {
	hours: number;
	service?: string;
	category?: TelemetryIssueCategory | "all";
	includeInternal?: boolean;
	limit?: number;
}

export interface TelemetryIssueSummary {
	issueId: string;
	category: TelemetryIssueCategory;
	severity: TelemetryIssueSeverity;
	title: string;
	serviceName: string;
	routeLabel: string;
	occurrenceCount: number;
	affectedTraceCount: number;
	firstSeen: string;
	lastSeen: string;
	latestStatusMessage: string | null;
	culpritSpanName: string;
	dependencyTarget: string | null;
	averageDurationMs: number;
	maxDurationMs: number;
	sampleTraceId: string;
}

export interface TelemetryIssueServiceSummary {
	serviceName: string;
	issueCount: number;
	affectedTraceCount: number;
	errorIssueCount: number;
	latencyIssueCount: number;
	dependencyIssueCount: number;
}

export interface TelemetryIssueSpanSummary {
	spanName: string;
	dependencyTarget: string | null;
	statusCode: number;
	occurrenceCount: number;
	averageDurationMs: number;
	maxDurationMs: number;
}

export interface TelemetryIssueOverviewResponse {
	summary: {
		totalIssues: number;
		criticalIssues: number;
		highIssues: number;
		affectedTraces: number;
		errorIssues: number;
		latencyIssues: number;
		dependencyIssues: number;
	};
	services: TelemetryIssueServiceSummary[];
	issues: TelemetryIssueSummary[];
	windowHours: number;
	filters: {
		service: string;
		category: string;
		includeInternal: boolean;
	};
	timestamp: string;
}

export interface TelemetryIssueDetailResponse {
	issue: TelemetryIssueSummary;
	traces: Array<{
		traceId: string;
		serviceName: string;
		routeLabel: string;
		startTime: string;
		durationMs: number;
		statusCode: number;
		statusMessage: string | null;
		rootSpanName: string;
		culpritSpanName: string;
		dependencyTarget: string | null;
	}>;
	culpritSpans: TelemetryIssueSpanSummary[];
	timestamp: string;
}

// ── Usage Event Types ──

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
}

export interface UsageEventPayload {
	events: UsageEventInput[];
}

export interface UsageEventRecord {
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
}

export interface UsageEventRow {
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
}

export interface UsageOverviewOptions {
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
	}>;
	timestamp: string;
}

// ── Logs Types ──

export type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface LogInput {
	traceId?: string;
	spanId?: string;
	serviceName?: string;
	severity: LogSeverity;
	loggerName?: string;
	message: string;
	attributes?: Record<string, JsonValue>;
	occurredAt?: string;
}

export interface LogPayload {
	logs: LogInput[];
}

export interface LogRecord {
	logId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	severity: LogSeverity;
	severityNumber: number;
	loggerName: string | null;
	message: string;
	attributesJson: string | null;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string;
}

export interface LogRow {
	log_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	severity: string;
	severity_number: number;
	logger_name: string | null;
	message: string;
	attributes_json: string | null;
	occurred_at: string;
	received_at: string;
}

export interface LogsOverviewOptions {
	hours: number;
	service?: string;
	severity?: LogSeverity;
	traceId?: string;
	limit?: number;
	search?: string;
}

export interface LogsOverviewResponse {
	logs: LogRecord[];
	summary: {
		totalLogs: number;
		errorLogs: number;
		warnLogs: number;
	};
	windowHours: number;
	timestamp: string;
}

// ── AI Call Types ──

export type AICallType =
	| "text_completion"
	| "chat"
	| "prompt_to_image"
	| "embedding";

export interface AICallInput {
	traceId?: string;
	spanId?: string;
	serviceName?: string;
	modelName: string;
	provider: string;
	callType: AICallType;
	request?: Record<string, JsonValue>;
	response?: Record<string, JsonValue>;
	promptTokens?: number;
	completionTokens?: number;
	totalCostUsd?: number;
	latencyMs?: number;
	isError?: boolean;
	errorMessage?: string;
	occurredAt?: string;
}

export interface AICallPayload {
	calls: AICallInput[];
}

export interface AICallRecord {
	callId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	modelName: string;
	provider: string;
	callType: AICallType;
	requestJson: string | null;
	responseJson: string | null;
	promptTokens: number | null;
	completionTokens: number | null;
	totalCostUsd: number | null;
	latencyMs: number | null;
	isError: boolean;
	errorMessage: string | null;
	occurredAt: string;
	receivedAt: string;
	expiresAt: string;
}

export interface AICallRow {
	call_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	model_name: string;
	provider: string;
	call_type: string;
	request_json: string | null;
	response_json: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_cost_usd: number | null;
	latency_ms: number | null;
	is_error: number;
	error_message: string | null;
	occurred_at: string;
	received_at: string;
}

export interface AICallsOverviewOptions {
	hours: number;
	service?: string;
	model?: string;
	isError?: boolean;
	traceId?: string;
	limit?: number;
}

export interface AICallsOverviewResponse {
	calls: AICallRecord[];
	summary: {
		totalCalls: number;
		totalCostUsd: number;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		errorCalls: number;
	};
	windowHours: number;
	timestamp: string;
}

// ── User Profiles Types ──

export interface IdentifyInput {
	visitorId: string;
	userId: string;
	email?: string;
	name?: string;
	properties?: Record<string, JsonValue>;
}

export interface UserProfileRow {
	user_id: string;
	visitor_id: string;
	email: string | null;
	name: string | null;
	properties_json: string | null;
	first_seen_at: string;
	last_seen_at: string;
}

export interface UserProfileDetail {
	userId: string;
	visitorId: string;
	email: string | null;
	name: string | null;
	properties: Record<string, JsonValue>;
	firstSeenAt: string;
	lastSeenAt: string;
}

// ── Session Replay Types ──

export interface ReplayChunkInput {
	sessionId: string;
	visitorId: string;
	sequenceNumber: number;
	events: Record<string, any>[]; // rrweb event objects
}

export interface SessionReplayMetadataRow {
	session_id: string;
	visitor_id: string;
	first_chunk_at: string;
	last_chunk_at: string;
	chunk_count: number;
	events_count: number;
	storage_bytes: number;
}
