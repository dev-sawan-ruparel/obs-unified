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
} from "@obs/types";

import { parseJsonArray, parseJsonRecord } from "./json";

/** Map D1 snake_case row to camelCase StoredSpan */
const rowToSpan = (row: Record<string, unknown>): StoredSpan => ({
	projectId: (row.project_id as string) ?? "default",
	traceId: row.trace_id as string,
	spanId: row.span_id as string,
	parentSpanId: (row.parent_span_id as string) ?? null,
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
	resourceAttributesJson: (row.resource_attributes_json as string) ?? "{}",
	eventsJson: (row.events_json as string) ?? "[]",
	linksJson: (row.links_json as string) ?? "[]",
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
	constructor(private readonly db: D1Database) {}

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
          project_id, trace_id, span_id, parent_span_id, service_name, scope_name,
          scope_version, span_name, span_kind, status_code, status_message,
          start_time, end_time, duration_ms, attributes_json,
          resource_attributes_json, events_json, links_json,
          received_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
				.bind(
					span.projectId,
					span.traceId,
					span.spanId,
					span.parentSpanId,
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
					span.resourceAttributesJson,
					span.eventsJson,
					span.linksJson,
					span.receivedAt,
					span.expiresAt,
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
			issue.traces.forEach((trace) => entry.affectedTraces.add(trace.traceId));
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
		let whereClause = "WHERE project_id = ? AND received_at > ? AND expires_at > ?";
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
