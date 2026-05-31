import type { JsonValue } from "./primitives";

// ── Stored Span ──

export interface StoredSpan {
	projectId: string;
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	traceState: string | null;
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
	droppedAttributesCount: number;
	resourceAttributesJson: string;
	eventsJson: string;
	droppedEventsCount: number;
	linksJson: string;
	droppedLinksCount: number;
	receivedAt: string;
	expiresAt: string;
	/** Denormalized from attributes["session.id"] at ingest; null when absent. */
	sessionId?: string | null;
	/**
	 * RFC 0004 — click-scoped correlation ID minted by @obs-unified/analytics-sdk and
	 * propagated to backends via the x-obs-interaction header. Persisted as a
	 * top-level column (not a span attribute) on telemetry_spans by ingest.
	 * Null on server-originated work (cron, queue consumers) and on requests
	 * where the SDK couldn't propagate (Mode B not used).
	 */
	interactionId?: string | null;
	/**
	 * RFC 0009 — denormalized from resource_attributes["telemetry.sdk.name"]
	 * at ingest. Drives the service map's source filter: spans with
	 * `telemetry_sdk_name = "beyla"` are considered eBPF-derived; anything
	 * else (including null) is treated as SDK-derived. Lets users isolate
	 * kernel-observed traffic without re-parsing JSON on every map render.
	 */
	telemetrySdkName?: string | null;
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
	project_id: string;
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
	projectId: string;
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

// ── Service Map ──

export interface ServiceMapNode {
	service: string;
	spanCount: number;
	errorCount: number;
	traceCount: number;
	errorRate: number;
}

export interface ServiceMapEdge {
	source: string;
	target: string;
	calls: number;
	errors: number;
	errorRate: number;
	p50DurationMs: number;
	p95DurationMs: number;
	rps: number;
}

export interface ServiceMapResponse {
	nodes: ServiceMapNode[];
	edges: ServiceMapEdge[];
	windowHours: number;
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
	projectId: string;
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
