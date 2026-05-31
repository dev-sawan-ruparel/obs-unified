export interface LiveSpanRow {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
}

export interface TraceSummary {
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

export interface Overview {
	summary: {
		totalTraces: number;
		errorTraces: number;
		successTraces: number;
		errorRate: number;
		averageDurationMs: number;
		p95DurationMs: number;
	};
	services: Array<{
		serviceName: string;
		traceCount: number;
		errorTraceCount: number;
	}>;
	traces: TraceSummary[];
	timestamp: string;
}

export interface SpanDetail {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string;
	scopeName: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	attributes: Record<string, unknown>;
	resourceAttributes: Record<string, unknown>;
	events: Array<{
		name: string;
		timeUnixNano?: string;
		attributes?: Record<string, unknown>;
	}>;
	links: unknown[];
}

export interface TraceDetail {
	trace: TraceSummary;
	spans: SpanDetail[];
}

export interface IssueSummary {
	issueId: string;
	category: "error" | "latency" | "dependency";
	severity: "critical" | "high" | "medium" | "low";
	title: string;
	serviceName: string;
	routeLabel: string;
	occurrenceCount: number;
	affectedTraceCount: number;
	lastSeen: string;
	latestStatusMessage: string | null;
	culpritSpanName: string;
	dependencyTarget: string | null;
	sampleTraceId: string;
}

export interface IssueOverview {
	summary: {
		totalIssues: number;
		criticalIssues: number;
		highIssues: number;
		affectedTraces: number;
		errorIssues: number;
		latencyIssues: number;
		dependencyIssues: number;
	};
	services: Array<{ serviceName: string; issueCount: number }>;
	issues: IssueSummary[];
	timestamp: string;
}

export interface IssueDetail {
	issue: IssueSummary;
	traces: Array<{
		traceId: string;
		routeLabel: string;
		statusCode: number;
		durationMs: number;
		startTime: string;
		culpritSpanName: string;
		dependencyTarget: string | null;
		statusMessage: string | null;
	}>;
	culpritSpans: Array<{
		spanName: string;
		dependencyTarget: string | null;
		occurrenceCount: number;
		averageDurationMs: number;
		maxDurationMs: number;
	}>;
}
