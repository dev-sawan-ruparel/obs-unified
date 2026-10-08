import type {
	TelemetryOverviewOptions,
	TelemetryOverviewResponse,
} from "@obsunified/types";
import type { SqlDb } from "../sql-db";
import {
	average,
	cutoffIso,
	normalizeService,
	type ParsedSpan,
	percentile,
} from "./helpers";
import { fetchSpansForTraceIds, selectTraceCandidates } from "./trace-queries";

export async function getTelemetryOverview(
	db: SqlDb,
	options: TelemetryOverviewOptions,
): Promise<TelemetryOverviewResponse> {
	if (!options.projectId)
		throw new Error("TelemetryStore.getOverview: projectId is required");
	const cutoff = cutoffIso(options.hours);
	const traceLimit = options.limit ?? 30;
	const candidates = await selectTraceCandidates(db, {
		projectId: options.projectId,
		cutoff,
		service: options.service,
		search: options.search,
		status: options.status,
		limit: traceLimit,
	});
	const candidateOrder = new Map(
		candidates.map((candidate, index) => [candidate.trace_id, index]),
	);
	const grouped = new Map<string, ParsedSpan[]>();
	for (const parsed of await fetchSpansForTraceIds(
		db,
		options.projectId,
		candidates.map((candidate) => candidate.trace_id),
	)) {
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
		.sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));
	traces.sort(
		(left, right) =>
			(candidateOrder.get(left.traceId) ?? Number.MAX_SAFE_INTEGER) -
			(candidateOrder.get(right.traceId) ?? Number.MAX_SAFE_INTEGER),
	);

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
