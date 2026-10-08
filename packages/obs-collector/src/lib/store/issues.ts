import type {
	TelemetryIssueDetailResponse,
	TelemetryIssueOptions,
	TelemetryIssueOverviewResponse,
} from "@obsunified/types";
import type { SqlDb } from "../sql-db";
import { cutoffIso, groupIssues } from "./helpers";
import { fetchSpansForTraceIds, selectTraceCandidates } from "./trace-queries";

export async function getTelemetryIssueOverview(
	db: SqlDb,
	options: TelemetryIssueOptions,
): Promise<TelemetryIssueOverviewResponse> {
	if (!options.projectId)
		throw new Error("TelemetryStore.getIssueOverview: projectId is required");
	const cutoff = cutoffIso(options.hours);
	const issueLimit = options.limit ?? 50;
	const candidateLimit = Math.min(issueLimit * 10, 500);
	const candidates = await selectTraceCandidates(db, {
		projectId: options.projectId,
		cutoff,
		service: options.service,
		limit: candidateLimit,
	});
	const spans = await fetchSpansForTraceIds(
		db,
		options.projectId,
		candidates.map((candidate) => candidate.trace_id),
	);

	const issues = groupIssues(spans, options)
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
			errorIssues: issues.filter((issue) => issue.category === "error").length,
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

export async function getTelemetryIssueDetail(
	db: SqlDb,
	issueId: string,
	options: TelemetryIssueOptions,
): Promise<TelemetryIssueDetailResponse | null> {
	if (!options.projectId)
		throw new Error("TelemetryStore.getIssueDetail: projectId is required");
	const cutoff = cutoffIso(options.hours);
	const candidates = await selectTraceCandidates(db, {
		projectId: options.projectId,
		cutoff,
		service: options.service,
		limit: 500,
	});
	const spans = await fetchSpansForTraceIds(
		db,
		options.projectId,
		candidates.map((candidate) => candidate.trace_id),
	);

	const issue = groupIssues(spans, options).find(
		(candidate) => candidate.issueId === issueId,
	);

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
