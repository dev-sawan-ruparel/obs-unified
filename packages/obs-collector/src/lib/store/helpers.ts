import type {
	JsonValue,
	StoredSpan,
	TelemetryIssueCategory,
	TelemetryIssueOptions,
	TelemetryIssueSeverity,
	TelemetryIssueSpanSummary,
	TelemetryIssueSummary,
} from "@obsunified/types";
import { parseJsonArray, parseJsonRecord } from "../json";

/** Map D1 snake_case row to camelCase StoredSpan */
export const rowToSpan = (row: Record<string, unknown>): StoredSpan => ({
	projectId: (row.project_id as string) ?? "default",
	traceId: row.trace_id as string,
	spanId: row.span_id as string,
	parentSpanId: (row.parent_span_id as string) ?? null,
	traceState: (row.trace_state as string) ?? null,
	serviceName: (row.service_name as string) ?? null,
	scopeName: (row.scope_name as string) ?? null,
	scopeVersion: (row.scope_version as string) ?? null,
	spanName: row.span_name as string,
	spanKind: (row.span_kind as number) ?? 0,
	statusCode: (row.status_code as number) ?? 0,
	statusMessage: (row.status_message as string) ?? null,
	startTime: row.start_time as string,
	endTime: row.end_time as string,
	durationMs: (row.duration_ms as number) ?? 0,
	attributesJson: (row.attributes_json as string) ?? "{}",
	droppedAttributesCount: (row.dropped_attributes_count as number) ?? 0,
	resourceAttributesJson: (row.resource_attributes_json as string) ?? "{}",
	eventsJson: (row.events_json as string) ?? "[]",
	droppedEventsCount: (row.dropped_events_count as number) ?? 0,
	linksJson: (row.links_json as string) ?? "[]",
	droppedLinksCount: (row.dropped_links_count as number) ?? 0,
	receivedAt: row.received_at as string,
	expiresAt: row.expires_at as string,
});

export type NormalizedIssue = TelemetryIssueSummary & {
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
};

export type ParsedSpan = StoredSpan & {
	attributes: Record<string, JsonValue>;
	resourceAttributes: Record<string, JsonValue>;
	events: unknown[];
	links: unknown[];
};

export interface TraceCandidateRow {
	trace_id: string;
	latest_received_at: string;
	error_span_count: number;
}

// ── Helpers ──

export const cutoffIso = (hours: number): string =>
	new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

export const percentile = (values: number[], fraction: number): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * fraction) - 1),
	);
	return sorted[index];
};

export const average = (values: number[]): number =>
	values.length > 0
		? values.reduce((sum, value) => sum + value, 0) / values.length
		: 0;

export const normalizeService = (value: string | null | undefined): string =>
	value?.trim() || "unknown";

export const toParsedSpan = (row: StoredSpan): ParsedSpan => ({
	...row,
	attributes: parseJsonRecord(row.attributesJson),
	resourceAttributes: parseJsonRecord(row.resourceAttributesJson),
	events: parseJsonArray(row.eventsJson),
	links: parseJsonArray(row.linksJson),
});

export const spanSelectColumns = `
	project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
	scope_version, span_name, span_kind, status_code, status_message,
	start_time, end_time, duration_ms, attributes_json,
	resource_attributes_json, events_json, links_json,
	received_at, expires_at
`;

export const placeholders = (count: number): string =>
	Array.from({ length: count }, () => "?").join(",");

export const getRouteLabel = (span: ParsedSpan): string => {
	const collectorRoute = span.attributes["collector.route_label"];
	if (typeof collectorRoute === "string" && collectorRoute.trim())
		return collectorRoute.trim();
	const method = span.attributes["http.request.method"];
	const path = span.attributes["url.path"];
	if (typeof method === "string" && typeof path === "string")
		return `${method} ${path}`;
	return span.spanName;
};

export const isInternalTrace = (span: ParsedSpan): boolean =>
	span.attributes["collector.is_internal"] === true;

export const getDependencyTarget = (span: ParsedSpan): string | null => {
	const collectorTarget = span.attributes["collector.dependency_target"];
	if (typeof collectorTarget === "string" && collectorTarget.trim())
		return collectorTarget.trim();
	return null;
};

export const getSeverity = (
	category: TelemetryIssueCategory,
	count: number,
	durationMs: number,
	statusCode: number,
): TelemetryIssueSeverity => {
	if (category === "error" && (count >= 10 || statusCode === 2))
		return "critical";
	if (category === "dependency" && (statusCode === 2 || durationMs >= 2_000))
		return "high";
	if (durationMs >= 3_000 || count >= 5) return "high";
	if (durationMs >= 1_000 || count >= 2) return "medium";
	return "low";
};

export const buildIssueTitle = (
	category: TelemetryIssueCategory,
	routeLabel: string,
	dependencyTarget: string | null,
): string => {
	switch (category) {
		case "error":
			return `Errors on ${routeLabel}`;
		case "dependency":
			return dependencyTarget
				? `Dependency failures talking to ${dependencyTarget}`
				: `Dependency failures on ${routeLabel}`;
		case "latency":
			return `Latency spike on ${routeLabel}`;
	}
};

export const buildIssueId = (
	category: TelemetryIssueCategory,
	serviceName: string,
	routeLabel: string,
	culpritSpanName: string,
	dependencyTarget: string | null,
): string =>
	[
		category,
		serviceName,
		routeLabel,
		culpritSpanName,
		dependencyTarget ?? "",
	].join("|");

export const groupIssues = (
	spans: ParsedSpan[],
	options: TelemetryIssueOptions,
): NormalizedIssue[] => {
	const traces = new Map<string, ParsedSpan[]>();
	for (const span of spans) {
		const traceSpans = traces.get(span.traceId) ?? [];
		traceSpans.push(span);
		traces.set(span.traceId, traceSpans);
	}

	const grouped = new Map<
		string,
		{
			category: TelemetryIssueCategory;
			serviceName: string;
			routeLabel: string;
			dependencyTarget: string | null;
			culpritSpanName: string;
			title: string;
			traces: NormalizedIssue["traces"];
		}
	>();

	for (const traceSpans of traces.values()) {
		const sorted = [...traceSpans].sort((left, right) =>
			left.startTime.localeCompare(right.startTime),
		);
		const root = sorted.find((span) => !span.parentSpanId) ?? sorted[0];
		if (!options.includeInternal && isInternalTrace(root)) continue;

		const serviceName = normalizeService(root.serviceName);
		if (options.service && options.service !== serviceName) continue;

		const routeLabel = getRouteLabel(root);
		const errorSpan = sorted.find((span) => span.statusCode === 2);
		const dependencySpan = sorted.find(
			(span) =>
				span.attributes["collector.span_role"] === "dependency" &&
				(span.statusCode === 2 || span.durationMs >= 1_000),
		);

		const candidates: Array<{
			category: TelemetryIssueCategory;
			culprit: ParsedSpan;
			dependencyTarget: string | null;
		}> = [];

		if (errorSpan) {
			candidates.push({
				category: "error",
				culprit: errorSpan,
				dependencyTarget: getDependencyTarget(errorSpan),
			});
		}
		if (dependencySpan) {
			candidates.push({
				category: "dependency",
				culprit: dependencySpan,
				dependencyTarget: getDependencyTarget(dependencySpan),
			});
		}
		if (root.durationMs >= 1_000) {
			candidates.push({
				category: "latency",
				culprit: dependencySpan ?? root,
				dependencyTarget: dependencySpan
					? getDependencyTarget(dependencySpan)
					: null,
			});
		}

		for (const candidate of candidates) {
			if (
				options.category &&
				options.category !== "all" &&
				candidate.category !== options.category
			)
				continue;

			const issueId = buildIssueId(
				candidate.category,
				serviceName,
				routeLabel,
				candidate.culprit.spanName,
				candidate.dependencyTarget,
			);
			const entry = grouped.get(issueId) ?? {
				category: candidate.category,
				serviceName,
				routeLabel,
				dependencyTarget: candidate.dependencyTarget,
				culpritSpanName: candidate.culprit.spanName,
				title: buildIssueTitle(
					candidate.category,
					routeLabel,
					candidate.dependencyTarget,
				),
				traces: [],
			};

			entry.traces.push({
				traceId: root.traceId,
				serviceName,
				routeLabel,
				startTime: root.startTime,
				durationMs: root.durationMs,
				statusCode: root.statusCode,
				statusMessage: root.statusMessage,
				rootSpanName: root.spanName,
				culpritSpanName: candidate.culprit.spanName,
				dependencyTarget: candidate.dependencyTarget,
			});
			grouped.set(issueId, entry);
		}
	}

	return Array.from(grouped.entries()).map(
		([issueId, entry]): NormalizedIssue => {
			const occurrenceCount = entry.traces.length;
			const durations = entry.traces.map((trace) => trace.durationMs);
			const latest = [...entry.traces].sort((left, right) =>
				right.startTime.localeCompare(left.startTime),
			)[0];
			const culpritCounts = new Map<string, TelemetryIssueSpanSummary>();

			for (const trace of entry.traces) {
				const culpritKey = `${trace.culpritSpanName}|${trace.dependencyTarget ?? ""}|${trace.statusCode}`;
				const existing = culpritCounts.get(culpritKey) ?? {
					spanName: trace.culpritSpanName,
					dependencyTarget: trace.dependencyTarget,
					statusCode: trace.statusCode,
					occurrenceCount: 0,
					averageDurationMs: 0,
					maxDurationMs: 0,
				};
				existing.occurrenceCount += 1;
				existing.averageDurationMs += trace.durationMs;
				existing.maxDurationMs = Math.max(
					existing.maxDurationMs,
					trace.durationMs,
				);
				culpritCounts.set(culpritKey, existing);
			}

			for (const culprit of culpritCounts.values()) {
				culprit.averageDurationMs = Math.round(
					culprit.averageDurationMs / culprit.occurrenceCount,
				);
			}

			return {
				issueId,
				category: entry.category,
				severity: getSeverity(
					entry.category,
					occurrenceCount,
					average(durations),
					latest.statusCode,
				),
				title: entry.title,
				serviceName: entry.serviceName,
				routeLabel: entry.routeLabel,
				occurrenceCount,
				affectedTraceCount: new Set(entry.traces.map((trace) => trace.traceId))
					.size,
				firstSeen:
					[...entry.traces].sort((left, right) =>
						left.startTime.localeCompare(right.startTime),
					)[0]?.startTime ?? latest.startTime,
				lastSeen: latest.startTime,
				latestStatusMessage: latest.statusMessage,
				culpritSpanName: entry.culpritSpanName,
				dependencyTarget: entry.dependencyTarget,
				averageDurationMs: Math.round(average(durations)),
				maxDurationMs: Math.max(...durations, 0),
				sampleTraceId: latest.traceId,
				traces: entry.traces
					.sort((left, right) => right.startTime.localeCompare(left.startTime))
					.slice(0, 20),
				culpritSpans: Array.from(culpritCounts.values()).sort(
					(left, right) =>
						right.occurrenceCount - left.occurrenceCount ||
						left.spanName.localeCompare(right.spanName),
				),
			};
		},
	);
};
