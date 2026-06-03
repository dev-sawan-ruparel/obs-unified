import type {
	JsonValue,
	SpanDetailRow,
	TelemetryCodeReference,
	TelemetryInstrumentationGap,
	TelemetryInstrumentationGapsResponse,
	TelemetrySpanDetail,
	TelemetryTraceDetailResponse,
} from "@obs-unified/types";
import { parseJsonArray, parseJsonRecord } from "../json";
import type { SqlDb } from "../sql-db";
import { normalizeService } from "./helpers";

export async function getTelemetryTraceDetail(
	db: SqlDb,
	traceId: string,
	projectId: string,
): Promise<TelemetryTraceDetailResponse | null> {
	if (!projectId)
		throw new Error("TelemetryStore.getTraceDetail: projectId is required");
	const result = await db
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
	for (const span of spans) {
		const codeReference = extractCodeReference(span.attributes);
		if (codeReference) span.codeReference = codeReference;
	}

	const root = spans.find((span) => !span.parentSpanId) ?? spans[0];
	const timestamp = new Date().toISOString();
	const instrumentationGaps =
		(await getTelemetryTraceGaps(db, traceId, projectId, spans)) ?? undefined;

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
		instrumentationGaps,
		timestamp,
	};
}

export async function getTelemetryTraceGaps(
	db: SqlDb,
	traceId: string,
	projectId: string,
	spans?: TelemetrySpanDetail[],
): Promise<TelemetryInstrumentationGapsResponse | null> {
	if (!projectId)
		throw new Error("TelemetryStore.getTraceGaps: projectId is required");

	// Gaps are derived data: compute them lazily from the trace's spans on
	// read, rather than materializing them on the ingest hot path. The
	// `spans` arg is passed by `getTelemetryTraceDetail` (which has already
	// loaded them); the standalone `/gaps` endpoint omits it, so we load
	// them here. The span query is project-scoped, so this avoids the
	// `trace_instrumentation_gaps` table's lack of project scoping entirely.
	const timestamp = new Date().toISOString();

	let localSpans = spans;
	if (!localSpans) {
		const result = await db
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
		const spanRows = result.results ?? [];
		if (spanRows.length === 0) return null;

		localSpans = spanRows.map((row) => ({
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
	}

	if (localSpans.length === 0) return null;
	const root = localSpans.find((span) => !span.parentSpanId) ?? localSpans[0];
	return buildTraceInstrumentationGaps(
		traceId,
		localSpans,
		root.durationMs,
		timestamp,
	);
}

export function buildTraceInstrumentationGaps(
	traceId: string,
	spans: TelemetrySpanDetail[],
	totalDurationMs: number,
	timestamp = new Date().toISOString(),
): TelemetryInstrumentationGapsResponse {
	const children = new Map<string | null, TelemetrySpanDetail[]>();
	for (const span of spans) {
		const parentKey = span.parentSpanId ?? null;
		const bucket = children.get(parentKey) ?? [];
		bucket.push(span);
		children.set(parentKey, bucket);
	}

	const blindspots: TelemetryInstrumentationGap[] = [];
	for (const span of spans) {
		const childSpans = children.get(span.spanId) ?? [];
		const childDurationMs = childSpans.reduce(
			(acc, child) => acc + child.durationMs,
			0,
		);
		const rawSelfMs = span.durationMs - childDurationMs;
		const asyncParent = rawSelfMs < 0;
		const selfMs = Math.max(0, rawSelfMs);
		const ratioOfParent =
			span.durationMs > 0 ? Math.min(1, selfMs / span.durationMs) : 0;
		if (
			asyncParent ||
			span.durationMs <= 100 ||
			ratioOfParent <= 0.7 ||
			childSpans.length >= 2
		) {
			continue;
		}
		blindspots.push({
			traceId,
			parentSpanId: span.spanId,
			parentServiceName: span.serviceName,
			parentSpanName: span.spanName,
			offsetMs: 0,
			durationMs: Math.round(selfMs),
			ratioOfParent,
			childSpanCount: childSpans.length,
			asyncParent,
			recommendation: `Add tracing inside ${span.spanName} or attach a profile for ${span.serviceName}.`,
		});
	}

	const uninstrumentedTimeMs = blindspots.reduce(
		(acc, gap) => acc + gap.durationMs,
		0,
	);
	return {
		traceId,
		totalDurationMs,
		uninstrumentedTimeMs,
		ratio: totalDurationMs > 0 ? uninstrumentedTimeMs / totalDurationMs : 0,
		blindspots,
		timestamp,
	};
}

export function extractCodeReference(
	attributes: Record<string, JsonValue>,
): TelemetryCodeReference | undefined {
	const originalPath = firstString(attributes, [
		"code.filepath",
		"code.file.path",
		"code.path",
		"source.file",
	]);
	const symbolName = firstString(attributes, [
		"code.function",
		"code.function.name",
		"code.namespace",
	]);
	const lineNumber = firstPositiveInteger(attributes, [
		"code.lineno",
		"code.line_number",
		"code.line",
	]);
	const columnNumber = firstPositiveInteger(attributes, [
		"code.column",
		"code.column_number",
	]);
	const repoName = firstString(attributes, ["code.repository", "repo.name"]);

	if (!originalPath && !symbolName && lineNumber === undefined)
		return undefined;

	const reference: TelemetryCodeReference = {};
	if (repoName) reference.repoName = repoName;
	if (originalPath) {
		reference.originalPath = originalPath;
		if (isAbsolutePath(originalPath)) {
			reference.absolutePath = originalPath;
		} else {
			reference.relativePath = normalizeRelativePath(originalPath);
		}
	}
	if (symbolName) reference.symbolName = symbolName;
	if (lineNumber !== undefined) reference.lineNumber = lineNumber;
	if (columnNumber !== undefined) reference.columnNumber = columnNumber;

	return reference;
}

function firstString(
	attributes: Record<string, JsonValue>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = attributes[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function firstPositiveInteger(
	attributes: Record<string, JsonValue>,
	keys: string[],
): number | undefined {
	for (const key of keys) {
		const value = attributes[key];
		if (typeof value === "number" && Number.isInteger(value) && value > 0) {
			return value;
		}
		if (typeof value === "string") {
			const parsed = Number.parseInt(value, 10);
			if (Number.isInteger(parsed) && parsed > 0) return parsed;
		}
	}
	return undefined;
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function normalizeRelativePath(value: string): string {
	return value.replace(/^\.\/+/, "");
}
