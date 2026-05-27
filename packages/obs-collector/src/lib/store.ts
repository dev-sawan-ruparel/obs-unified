/**
 * TelemetryStore — union of all repos.
 * - A's advanced issue grouping (error/dependency/latency with culprit, recommendations)
 * - A's INSERT OR IGNORE (idempotent)
 * - A's helper fns (percentile, average, normalizeService, etc.)
 * - A's purgeExpired()
 * - D's search param in getOverview
 * - D's getExportRows() for NDJSON export
 */

import type {
	JsonValue,
	SpanDetailRow,
	StoredSpan,
	TelemetryIssueCategory,
	TelemetryIssueDetailResponse,
	TelemetryIssueOptions,
	TelemetryIssueOverviewResponse,
	TelemetryIssueSeverity,
	TelemetryIssueSpanSummary,
	TelemetryIssueSummary,
	TelemetryOverviewOptions,
	TelemetryOverviewResponse,
	TelemetrySpanDetail,
	TelemetryTraceDetailResponse,
} from "@obs-unified/types";

import { parseJsonArray, parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";

/** Map D1 snake_case row to camelCase StoredSpan */
const rowToSpan = (row: Record<string, unknown>): StoredSpan => ({
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

type NormalizedIssue = TelemetryIssueSummary & {
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

type ParsedSpan = StoredSpan & {
	attributes: Record<string, JsonValue>;
	resourceAttributes: Record<string, JsonValue>;
	events: unknown[];
	links: unknown[];
};

// ── Helpers ──

const cutoffIso = (hours: number): string =>
	new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const percentile = (values: number[], fraction: number): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(sorted.length * fraction) - 1),
	);
	return sorted[index];
};

const average = (values: number[]): number =>
	values.length > 0
		? values.reduce((sum, value) => sum + value, 0) / values.length
		: 0;

const normalizeService = (value: string | null | undefined): string =>
	value?.trim() || "unknown";

const toParsedSpan = (row: StoredSpan): ParsedSpan => ({
	...row,
	attributes: parseJsonRecord(row.attributesJson),
	resourceAttributes: parseJsonRecord(row.resourceAttributesJson),
	events: parseJsonArray(row.eventsJson),
	links: parseJsonArray(row.linksJson),
});

const getRouteLabel = (span: ParsedSpan): string => {
	const collectorRoute = span.attributes["collector.route_label"];
	if (typeof collectorRoute === "string" && collectorRoute.trim())
		return collectorRoute.trim();
	const method = span.attributes["http.request.method"];
	const path = span.attributes["url.path"];
	if (typeof method === "string" && typeof path === "string")
		return `${method} ${path}`;
	return span.spanName;
};

const isInternalTrace = (span: ParsedSpan): boolean =>
	span.attributes["collector.is_internal"] === true;

const getDependencyTarget = (span: ParsedSpan): string | null => {
	const collectorTarget = span.attributes["collector.dependency_target"];
	if (typeof collectorTarget === "string" && collectorTarget.trim())
		return collectorTarget.trim();
	return null;
};

const getSeverity = (
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

const buildIssueTitle = (
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

const buildIssueId = (
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

const groupIssues = (
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

// ── Store ──

export class TelemetryStore {
	constructor(private readonly db: SqlDb) {}

	async ingest(
		spans: StoredSpan[],
	): Promise<{ inserted: number; traceCount: number }> {
		if (spans.length === 0) return { inserted: 0, traceCount: 0 };

		const statements = spans.map((span) => {
			if (!span.projectId)
				throw new Error("TelemetryStore.ingest: span.projectId is required");
			return this.db
				.prepare(`
        INSERT OR IGNORE INTO telemetry_spans (
          project_id, trace_id, span_id, parent_span_id, trace_state,
          service_name, scope_name, scope_version, span_name, span_kind,
          status_code, status_message, start_time, end_time, duration_ms,
          attributes_json, dropped_attributes_count,
          resource_attributes_json, events_json, dropped_events_count,
          links_json, dropped_links_count, received_at, expires_at,
          session_id, interaction_id, telemetry_sdk_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
				.bind(
					span.projectId,
					span.traceId,
					span.spanId,
					span.parentSpanId,
					span.traceState,
					span.serviceName,
					span.scopeName,
					span.scopeVersion,
					span.spanName,
					span.spanKind,
					span.statusCode,
					span.statusMessage,
					span.startTime,
					span.endTime,
					span.durationMs,
					span.attributesJson,
					span.droppedAttributesCount,
					span.resourceAttributesJson,
					span.eventsJson,
					span.droppedEventsCount,
					span.linksJson,
					span.droppedLinksCount,
					span.receivedAt,
					span.expiresAt,
					span.sessionId ?? null,
					span.interactionId ?? null,
					span.telemetrySdkName ?? null,
				);
		});

		await this.db.batch(statements);
		return {
			inserted: spans.length,
			traceCount: new Set(spans.map((span) => span.traceId)).size,
		};
	}

	async getOverview(
		options: TelemetryOverviewOptions,
	): Promise<TelemetryOverviewResponse> {
		if (!options.projectId)
			throw new Error("TelemetryStore.getOverview: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const traceLimit = options.limit ?? 30;
		let whereClause = "WHERE project_id = ? AND received_at >= ?";
		const binds: unknown[] = [options.projectId, cutoff];

		if (options.service) {
			whereClause += " AND service_name = ?";
			binds.push(options.service);
		}
		// Search (from D)
		if (options.search) {
			const term = `%${options.search}%`;
			whereClause +=
				" AND (span_name LIKE ? OR status_message LIKE ? OR attributes_json LIKE ? OR events_json LIKE ?)";
			binds.push(term, term, term, term);
		}

		binds.push(traceLimit * 50);
		const result = await this.db
			.prepare(`
      SELECT project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
             scope_version, span_name, span_kind, status_code, status_message,
             start_time, end_time, duration_ms, attributes_json,
             resource_attributes_json, events_json, links_json,
             received_at, expires_at
      FROM telemetry_spans
      ${whereClause}
      ORDER BY received_at DESC
      LIMIT ?
    `)
			.bind(...binds)
			.all<Record<string, unknown>>();

		const grouped = new Map<string, ParsedSpan[]>();
		for (const row of result.results ?? []) {
			const parsed = toParsedSpan(rowToSpan(row));
			const traceSpans = grouped.get(parsed.traceId) ?? [];
			traceSpans.push(parsed);
			grouped.set(parsed.traceId, traceSpans);
		}

		const traces = Array.from(grouped.values())
			.map((traceSpans) => {
				const sorted = traceSpans.sort((left, right) =>
					left.startTime.localeCompare(right.startTime),
				);
				const root = sorted.find((span) => !span.parentSpanId) ?? sorted[0];
				return {
					traceId: root.traceId,
					serviceName: normalizeService(root.serviceName),
					spanName: root.spanName,
					statusCode: traceSpans.some((span) => span.statusCode === 2)
						? 2
						: root.statusCode,
					statusMessage:
						traceSpans.find((span) => span.statusCode === 2)?.statusMessage ??
						root.statusMessage,
					startTime: root.startTime,
					endTime: root.endTime,
					durationMs: root.durationMs,
					receivedAt: root.receivedAt,
					spanCount: traceSpans.length,
					errorSpanCount: traceSpans.filter((span) => span.statusCode === 2)
						.length,
				};
			})
			.filter(
				(trace) =>
					options.status === "all" ||
					!options.status ||
					(options.status === "error"
						? trace.errorSpanCount > 0
						: trace.errorSpanCount === 0),
			)
			.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));

		const durations = traces.map((trace) => trace.durationMs);
		const errorTraces = traces.filter((trace) => trace.errorSpanCount > 0);
		const serviceMap = new Map<
			string,
			{ traceCount: number; errorTraceCount: number; durations: number[] }
		>();
		for (const trace of traces) {
			const entry = serviceMap.get(trace.serviceName) ?? {
				traceCount: 0,
				errorTraceCount: 0,
				durations: [],
			};
			entry.traceCount += 1;
			entry.errorTraceCount += trace.errorSpanCount > 0 ? 1 : 0;
			entry.durations.push(trace.durationMs);
			serviceMap.set(trace.serviceName, entry);
		}

		return {
			summary: {
				totalTraces: traces.length,
				errorTraces: errorTraces.length,
				successTraces: traces.length - errorTraces.length,
				errorRate: traces.length > 0 ? errorTraces.length / traces.length : 0,
				averageDurationMs: Math.round(average(durations)),
				p95DurationMs: Math.round(percentile(durations, 0.95)),
			},
			services: Array.from(serviceMap.entries())
				.map(([serviceName, entry]) => ({
					serviceName,
					traceCount: entry.traceCount,
					errorTraceCount: entry.errorTraceCount,
					errorRate:
						entry.traceCount > 0 ? entry.errorTraceCount / entry.traceCount : 0,
					averageDurationMs: Math.round(average(entry.durations)),
					maxDurationMs: Math.max(...entry.durations, 0),
				}))
				.sort(
					(left, right) =>
						right.traceCount - left.traceCount ||
						left.serviceName.localeCompare(right.serviceName),
				),
			traces: traces.slice(0, options.limit ?? 30),
			windowHours: options.hours,
			filters: {
				service: options.service ?? "all",
				status: options.status ?? "all",
			},
			timestamp: new Date().toISOString(),
		};
	}

	async getTraceDetail(
		traceId: string,
		projectId: string,
	): Promise<TelemetryTraceDetailResponse | null> {
		if (!projectId)
			throw new Error("TelemetryStore.getTraceDetail: projectId is required");
		const result = await this.db
			.prepare(`
      SELECT project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
             scope_version, span_name, span_kind, status_code, status_message,
             start_time, end_time, duration_ms, attributes_json,
             resource_attributes_json, events_json, links_json,
             received_at, expires_at
      FROM telemetry_spans
      WHERE project_id = ? AND trace_id = ?
      ORDER BY start_time ASC, span_id ASC
    `)
			.bind(projectId, traceId)
			.all<SpanDetailRow>();

		const rows = result.results ?? [];
		if (rows.length === 0) return null;

		const spans: TelemetrySpanDetail[] = rows.map((row) => ({
			traceId: row.trace_id,
			spanId: row.span_id,
			parentSpanId: row.parent_span_id,
			serviceName: normalizeService(row.service_name),
			scopeName: row.scope_name,
			scopeVersion: row.scope_version,
			spanName: row.span_name,
			spanKind: row.span_kind,
			statusCode: row.status_code,
			statusMessage: row.status_message,
			startTime: row.start_time,
			endTime: row.end_time,
			durationMs: row.duration_ms,
			attributes: parseJsonRecord(row.attributes_json),
			resourceAttributes: parseJsonRecord(row.resource_attributes_json),
			events: parseJsonArray(row.events_json),
			links: parseJsonArray(row.links_json),
		}));

		const root = spans.find((span) => !span.parentSpanId) ?? spans[0];

		return {
			trace: {
				traceId,
				serviceName: root.serviceName,
				spanName: root.spanName,
				statusCode: spans.some((span) => span.statusCode === 2)
					? 2
					: root.statusCode,
				statusMessage:
					spans.find((span) => span.statusCode === 2)?.statusMessage ??
					root.statusMessage,
				startTime: root.startTime,
				endTime: root.endTime,
				durationMs: root.durationMs,
				receivedAt: rows[0]?.received_at ?? root.startTime,
				spanCount: spans.length,
				errorSpanCount: spans.filter((span) => span.statusCode === 2).length,
			},
			spans,
			timestamp: new Date().toISOString(),
		};
	}

	async getIssueOverview(
		options: TelemetryIssueOptions,
	): Promise<TelemetryIssueOverviewResponse> {
		if (!options.projectId)
			throw new Error("TelemetryStore.getIssueOverview: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const issueLimit = options.limit ?? 50;
		let whereClause = "WHERE project_id = ? AND received_at >= ?";
		const binds: unknown[] = [options.projectId, cutoff];
		if (options.service) {
			whereClause += " AND service_name = ?";
			binds.push(options.service);
		}
		binds.push(issueLimit * 100);

		const result = await this.db
			.prepare(`
      SELECT project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
             scope_version, span_name, span_kind, status_code, status_message,
             start_time, end_time, duration_ms, attributes_json,
             resource_attributes_json, events_json, links_json,
             received_at, expires_at
      FROM telemetry_spans
      ${whereClause}
      ORDER BY received_at DESC
      LIMIT ?
    `)
			.bind(...binds)
			.all<Record<string, unknown>>();

		const issues = groupIssues(
			(result.results ?? []).map(rowToSpan).map(toParsedSpan),
			options,
		)
			.sort(
				(left, right) =>
					right.occurrenceCount - left.occurrenceCount ||
					right.lastSeen.localeCompare(left.lastSeen),
			)
			.slice(0, options.limit ?? 50);

		const services = new Map<
			string,
			{
				issueCount: number;
				affectedTraces: Set<string>;
				error: number;
				latency: number;
				dependency: number;
			}
		>();

		for (const issue of issues) {
			const entry = services.get(issue.serviceName) ?? {
				issueCount: 0,
				affectedTraces: new Set<string>(),
				error: 0,
				latency: 0,
				dependency: 0,
			};
			entry.issueCount += 1;
			for (const trace of issue.traces) {
				entry.affectedTraces.add(trace.traceId);
			}
			entry[issue.category] += 1;
			services.set(issue.serviceName, entry);
		}

		return {
			summary: {
				totalIssues: issues.length,
				criticalIssues: issues.filter((issue) => issue.severity === "critical")
					.length,
				highIssues: issues.filter((issue) => issue.severity === "high").length,
				affectedTraces: new Set(
					issues.flatMap((issue) => issue.traces.map((trace) => trace.traceId)),
				).size,
				errorIssues: issues.filter((issue) => issue.category === "error")
					.length,
				latencyIssues: issues.filter((issue) => issue.category === "latency")
					.length,
				dependencyIssues: issues.filter(
					(issue) => issue.category === "dependency",
				).length,
			},
			services: Array.from(services.entries())
				.map(([serviceName, entry]) => ({
					serviceName,
					issueCount: entry.issueCount,
					affectedTraceCount: entry.affectedTraces.size,
					errorIssueCount: entry.error,
					latencyIssueCount: entry.latency,
					dependencyIssueCount: entry.dependency,
				}))
				.sort(
					(left, right) =>
						right.issueCount - left.issueCount ||
						left.serviceName.localeCompare(right.serviceName),
				),
			issues: issues.map(
				({ traces: _t, culpritSpans: _c, ...summary }) => summary,
			),
			windowHours: options.hours,
			filters: {
				service: options.service ?? "all",
				category: options.category ?? "all",
				includeInternal: options.includeInternal ?? false,
			},
			timestamp: new Date().toISOString(),
		};
	}

	async getIssueDetail(
		issueId: string,
		options: TelemetryIssueOptions,
	): Promise<TelemetryIssueDetailResponse | null> {
		if (!options.projectId)
			throw new Error("TelemetryStore.getIssueDetail: projectId is required");
		const cutoff = cutoffIso(options.hours);
		let whereClause = "WHERE project_id = ? AND received_at >= ?";
		const binds: unknown[] = [options.projectId, cutoff];
		if (options.service) {
			whereClause += " AND service_name = ?";
			binds.push(options.service);
		}
		binds.push(5000);

		const result = await this.db
			.prepare(`
      SELECT project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
             scope_version, span_name, span_kind, status_code, status_message,
             start_time, end_time, duration_ms, attributes_json,
             resource_attributes_json, events_json, links_json,
             received_at, expires_at
      FROM telemetry_spans
      ${whereClause}
      ORDER BY received_at DESC
      LIMIT ?
    `)
			.bind(...binds)
			.all<Record<string, unknown>>();

		const issue = groupIssues(
			(result.results ?? []).map(rowToSpan).map(toParsedSpan),
			options,
		).find((candidate) => candidate.issueId === issueId);

		if (!issue) return null;

		return {
			issue: {
				issueId: issue.issueId,
				category: issue.category,
				severity: issue.severity,
				title: issue.title,
				serviceName: issue.serviceName,
				routeLabel: issue.routeLabel,
				occurrenceCount: issue.occurrenceCount,
				affectedTraceCount: issue.affectedTraceCount,
				firstSeen: issue.firstSeen,
				lastSeen: issue.lastSeen,
				latestStatusMessage: issue.latestStatusMessage,
				culpritSpanName: issue.culpritSpanName,
				dependencyTarget: issue.dependencyTarget,
				averageDurationMs: issue.averageDurationMs,
				maxDurationMs: issue.maxDurationMs,
				sampleTraceId: issue.sampleTraceId,
			},
			traces: issue.traces,
			culpritSpans: issue.culpritSpans,
			timestamp: new Date().toISOString(),
		};
	}

	/** NDJSON export (from D) */
	async getExportRows(options: TelemetryOverviewOptions): Promise<string> {
		if (!options.projectId)
			throw new Error("TelemetryStore.getExportRows: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const now = new Date().toISOString();
		let whereClause =
			"WHERE project_id = ? AND received_at > ? AND expires_at > ?";
		const params: unknown[] = [options.projectId, cutoff, now];

		if (options.service) {
			whereClause += " AND service_name = ?";
			params.push(options.service);
		}
		if (options.status === "error") {
			whereClause += " AND status_code = 2";
		} else if (options.status === "ok") {
			whereClause += " AND status_code != 2";
		}
		if (options.search) {
			const term = `%${options.search}%`;
			whereClause +=
				" AND (span_name LIKE ? OR status_message LIKE ? OR attributes_json LIKE ? OR events_json LIKE ?)";
			params.push(term, term, term, term);
		}

		const rows = await this.db
			.prepare(`
        SELECT trace_id, span_id, parent_span_id, service_name, span_name,
               status_code, status_message, start_time, end_time, duration_ms,
               attributes_json, events_json, received_at
        FROM telemetry_spans
        ${whereClause}
        ORDER BY received_at DESC
        LIMIT 1000
      `)
			.bind(...params)
			.all<Record<string, unknown>>();

		return (rows.results || [])
			.map((row) =>
				JSON.stringify({
					trace_id: row.trace_id,
					span_id: row.span_id,
					parent_span_id: row.parent_span_id,
					service: row.service_name,
					span_name: row.span_name,
					status_code: row.status_code,
					status_message: row.status_message,
					start_time: row.start_time,
					end_time: row.end_time,
					duration_ms: row.duration_ms,
					attributes: JSON.parse((row.attributes_json as string) || "{}"),
					events: JSON.parse((row.events_json as string) || "[]"),
					received_at: row.received_at,
				}),
			)
			.join("\n");
	}

	/**
	 * Service dependency map for the window. Nodes are aggregated per service;
	 * edges are derived from cross-service parent→child span relationships
	 * (self-join on trace_id + parent_span_id). Latency percentiles are
	 * computed in-JS from up to 50k edge rows per window.
	 */
	async getServiceMap(options: {
		projectId: string;
		hours: number;
		/**
		 * RFC 0009 Phase 5.3 — restrict to a span source.
		 *   "all"  (default) — every span counts.
		 *   "sdk"            — only SDK-instrumented spans (telemetry_sdk_name
		 *                      not in the eBPF set, or null).
		 *   "ebpf"           — only kernel-derived spans (Beyla and friends).
		 */
		source?: "all" | "sdk" | "ebpf";
	}): Promise<{
		nodes: Array<{
			service: string;
			spanCount: number;
			errorCount: number;
			traceCount: number;
			errorRate: number;
		}>;
		edges: Array<{
			source: string;
			target: string;
			calls: number;
			errors: number;
			errorRate: number;
			p50DurationMs: number;
			p95DurationMs: number;
			rps: number;
		}>;
	}> {
		if (!options.projectId)
			throw new Error("TelemetryStore.getServiceMap: projectId is required");
		const cutoff = cutoffIso(options.hours);
		const source = options.source ?? "all";

		// RFC 0009 — eBPF-derived agents identify themselves via
		// resource_attribute `telemetry.sdk.name`. The set is small and
		// stable enough to inline; expand as new agents land.
		const EBPF_SDK_NAMES = new Set(["beyla", "otel-ebpf-profiler"]);
		const sourceClause =
			source === "ebpf"
				? ` AND telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
						.map(() => "?")
						.join(",")})`
				: source === "sdk"
					? ` AND (telemetry_sdk_name IS NULL OR telemetry_sdk_name NOT IN (${Array.from(
							EBPF_SDK_NAMES,
						)
							.map(() => "?")
							.join(",")}))`
					: "";
		const sourceBinds: unknown[] =
			source === "all" ? [] : Array.from(EBPF_SDK_NAMES);

		const nodesResult = await this.db
			.prepare(
				`SELECT
					service_name,
					COUNT(*) AS span_count,
					SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS error_count,
					COUNT(DISTINCT trace_id) AS trace_count
				FROM telemetry_spans
				WHERE project_id = ? AND received_at >= ? AND service_name IS NOT NULL${sourceClause}
				GROUP BY service_name`,
			)
			.bind(options.projectId, cutoff, ...sourceBinds)
			.all<{
				service_name: string;
				span_count: number;
				error_count: number;
				trace_count: number;
			}>();

		// Edges come from two relationships:
		//   1. Synchronous: child span's parent_span_id points at the parent's
		//      span_id within the same trace, and they're in different services.
		//   2. Asynchronous: child span carries a `link` (in links_json) back
		//      to a producer span in another service — this is how OpenTelemetry
		//      represents Kafka / RabbitMQ / SQS / Pub/Sub dispatch, because
		//      consumers can process messages long after producers close their
		//      span and a single consume can correspond to many produces.
		// We UNION ALL both — duplicates are accumulated as separate calls,
		// which matches the synchronous semantics (each child = one call).
		// RFC 0009 — applying the source filter to *child* spans for sync
		// edges and to *consumer* spans for async edges. The producer
		// side is left unfiltered (an SDK-instrumented service that
		// publishes to a Kafka topic still belongs in the eBPF view if
		// the consumer is Beyla-instrumented; the edge represents the
		// kernel-observed call, not the producer's instrumentation).
		const childSourceClause =
			source === "ebpf"
				? ` AND c.telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
						.map(() => "?")
						.join(",")})`
				: source === "sdk"
					? ` AND (c.telemetry_sdk_name IS NULL OR c.telemetry_sdk_name NOT IN (${Array.from(
							EBPF_SDK_NAMES,
						)
							.map(() => "?")
							.join(",")}))`
					: "";
		const consumerSourceClause =
			source === "ebpf"
				? ` AND telemetry_sdk_name IN (${Array.from(EBPF_SDK_NAMES)
						.map(() => "?")
						.join(",")})`
				: source === "sdk"
					? ` AND (telemetry_sdk_name IS NULL OR telemetry_sdk_name NOT IN (${Array.from(
							EBPF_SDK_NAMES,
						)
							.map(() => "?")
							.join(",")}))`
					: "";

		const edgeRowsResult = await this.db
			.prepare(
				`WITH parent_child_edges AS (
					SELECT
						p.service_name AS source,
						c.service_name AS target,
						c.status_code AS status_code,
						c.duration_ms AS duration_ms,
						c.received_at AS received_at
					FROM telemetry_spans p
					JOIN telemetry_spans c
						ON c.parent_span_id = p.span_id
						AND c.trace_id = p.trace_id
						AND c.project_id = p.project_id
					WHERE p.project_id = ?
						AND p.received_at >= ?
						AND c.received_at >= ?
						AND p.service_name IS NOT NULL
						AND c.service_name IS NOT NULL
						AND p.service_name != c.service_name${childSourceClause}
				),
				link_edges AS (
					SELECT
						producer.service_name AS source,
						consumer.service_name AS target,
						consumer.status_code AS status_code,
						consumer.duration_ms AS duration_ms,
						consumer.received_at AS received_at
					-- Pre-filter consumers in a subquery so json_each is only
					-- invoked on spans that actually carry links. Without this
					-- gate the cross product fans out across every span in the
					-- window and the query times out on tens of thousands of
					-- rows.
					FROM (
						SELECT trace_id, span_id, project_id, service_name,
							status_code, duration_ms, received_at, links_json
						FROM telemetry_spans
						WHERE project_id = ?
							AND received_at >= ?
							AND links_json IS NOT NULL
							AND links_json != '[]'${consumerSourceClause}
					) consumer,
						json_each(consumer.links_json) link
					-- Match on (trace_id, span_id) so the lookup hits the
					-- composite PRIMARY KEY index. span_id alone has no index
					-- (only the composite PK), so a span_id-only join would
					-- full-scan per link.
					JOIN telemetry_spans producer
						ON producer.trace_id = json_extract(link.value, '$.traceId')
						AND producer.span_id = json_extract(link.value, '$.spanId')
						AND producer.project_id = consumer.project_id
					WHERE producer.received_at >= ?
						AND consumer.service_name IS NOT NULL
						AND producer.service_name IS NOT NULL
						AND producer.service_name != consumer.service_name
				)
				SELECT * FROM parent_child_edges
				UNION ALL
				SELECT * FROM link_edges
				ORDER BY received_at DESC
				LIMIT 50000`,
			)
			.bind(
				options.projectId,
				cutoff,
				cutoff,
				...sourceBinds,
				options.projectId,
				cutoff,
				...sourceBinds,
				cutoff,
			)
			.all<{
				source: string;
				target: string;
				status_code: number;
				duration_ms: number;
			}>();

		interface EdgeAcc {
			source: string;
			target: string;
			calls: number;
			errors: number;
			durations: number[];
		}
		const edgeMap = new Map<string, EdgeAcc>();
		for (const row of edgeRowsResult.results ?? []) {
			const key = `${row.source}|${row.target}`;
			let acc = edgeMap.get(key);
			if (!acc) {
				acc = {
					source: row.source,
					target: row.target,
					calls: 0,
					errors: 0,
					durations: [],
				};
				edgeMap.set(key, acc);
			}
			acc.calls += 1;
			if (row.status_code === 2) acc.errors += 1;
			acc.durations.push(row.duration_ms ?? 0);
		}

		const windowSeconds = Math.max(1, options.hours * 3600);
		const edges = Array.from(edgeMap.values()).map((e) => ({
			source: e.source,
			target: e.target,
			calls: e.calls,
			errors: e.errors,
			errorRate: e.calls > 0 ? e.errors / e.calls : 0,
			p50DurationMs: percentile(e.durations, 0.5),
			p95DurationMs: percentile(e.durations, 0.95),
			rps: e.calls / windowSeconds,
		}));

		const nodes = (nodesResult.results ?? []).map((r) => ({
			service: r.service_name,
			spanCount: r.span_count,
			errorCount: r.error_count,
			traceCount: r.trace_count,
			errorRate: r.span_count > 0 ? r.error_count / r.span_count : 0,
		}));

		return { nodes, edges };
	}

	/**
	 * Operations breakdown for a single service — used by the service-map's
	 * click-through drawer. Returns top operations by traffic, plus recent
	 * error spans for quick triage.
	 */
	async getServiceOperations(options: {
		projectId: string;
		service: string;
		hours: number;
	}): Promise<{
		service: string;
		spanCount: number;
		traceCount: number;
		errorCount: number;
		operations: Array<{
			spanName: string;
			calls: number;
			errors: number;
			errorRate: number;
			p50DurationMs: number;
			p95DurationMs: number;
		}>;
		recentErrors: Array<{
			traceId: string;
			spanId: string;
			spanName: string;
			statusMessage: string | null;
			durationMs: number;
			startTime: string;
		}>;
	}> {
		if (!options.projectId)
			throw new Error(
				"TelemetryStore.getServiceOperations: projectId is required",
			);
		const cutoff = cutoffIso(options.hours);

		// Top operations — group by span_name, accumulate durations in JS.
		const opsResult = await this.db
			.prepare(
				`SELECT
					span_name,
					COUNT(*) AS calls,
					SUM(CASE WHEN status_code = 2 THEN 1 ELSE 0 END) AS errors,
					duration_ms
				FROM telemetry_spans
				WHERE project_id = ?
					AND service_name = ?
					AND received_at >= ?
				ORDER BY received_at DESC
				LIMIT 20000`,
			)
			.bind(options.projectId, options.service, cutoff)
			.all<{
				span_name: string;
				calls: number;
				errors: number;
				duration_ms: number;
			}>();

		interface OpAcc {
			calls: number;
			errors: number;
			durations: number[];
		}
		const opMap = new Map<string, OpAcc>();
		let totalSpans = 0;
		let totalErrors = 0;
		const _traceIds = new Set<string>();
		for (const row of opsResult.results ?? []) {
			totalSpans += 1;
			if (row.errors > 0) totalErrors += 1;
			let acc = opMap.get(row.span_name);
			if (!acc) {
				acc = { calls: 0, errors: 0, durations: [] };
				opMap.set(row.span_name, acc);
			}
			acc.calls += 1;
			if (row.errors > 0) acc.errors += 1;
			acc.durations.push(row.duration_ms ?? 0);
		}
		const operations = Array.from(opMap.entries())
			.map(([spanName, acc]) => ({
				spanName,
				calls: acc.calls,
				errors: acc.errors,
				errorRate: acc.calls > 0 ? acc.errors / acc.calls : 0,
				p50DurationMs: percentile(acc.durations, 0.5),
				p95DurationMs: percentile(acc.durations, 0.95),
			}))
			.sort((l, r) => r.calls - l.calls)
			.slice(0, 12);

		// Recent error spans for triage.
		const errorRows = await this.db
			.prepare(
				`SELECT trace_id, span_id, span_name, status_message, duration_ms, start_time
				FROM telemetry_spans
				WHERE project_id = ?
					AND service_name = ?
					AND received_at >= ?
					AND status_code = 2
				ORDER BY received_at DESC
				LIMIT 10`,
			)
			.bind(options.projectId, options.service, cutoff)
			.all<{
				trace_id: string;
				span_id: string;
				span_name: string;
				status_message: string | null;
				duration_ms: number;
				start_time: string;
			}>();

		// Distinct trace count for this service.
		const traceCountRow = await this.db
			.prepare(
				`SELECT COUNT(DISTINCT trace_id) AS trace_count
				FROM telemetry_spans
				WHERE project_id = ? AND service_name = ? AND received_at >= ?`,
			)
			.bind(options.projectId, options.service, cutoff)
			.first<{ trace_count: number }>();

		return {
			service: options.service,
			spanCount: totalSpans,
			traceCount: traceCountRow?.trace_count ?? 0,
			errorCount: totalErrors,
			operations,
			recentErrors: (errorRows.results ?? []).map((r) => ({
				traceId: r.trace_id,
				spanId: r.span_id,
				spanName: r.span_name,
				statusMessage: r.status_message,
				durationMs: r.duration_ms,
				startTime: r.start_time,
			})),
		};
	}

	/** Purge expired rows (from A) */
	async purgeExpired(): Promise<number> {
		const now = new Date().toISOString();
		const result = await this.db
			.prepare("DELETE FROM telemetry_spans WHERE expires_at <= ?")
			.bind(now)
			.run();
		return result.meta?.changes ?? 0;
	}
}
