/**
 * OTLP request decoding: content-type dispatch (JSON vs protobuf) with
 * gzip support. The Go reference receiver accepts either encoding on any
 * `/v1/*` endpoint; the SDK default is protobuf, so this path is load-bearing.
 *
 * Output shapes match the legacy `@obs-unified/types` interfaces (`OtlpTraceExportRequest`
 * et al.) so the existing `toStoredSpans` / log transform code keeps working
 * unchanged. IDs are normalized to lowercase hex; uint64 nanoseconds are kept
 * as strings to avoid precision loss.
 */

import { fromBinary, fromJson, type JsonValue } from "@bufbuild/protobuf";
import type {
	LogSeverity,
	JsonValue as ObsJsonValue,
	OtlpAnyValue,
	OtlpKeyValue,
	OtlpResourceSpans,
	OtlpTraceExportRequest,
} from "@obs-unified/types";
import type { Context } from "hono";
import {
	type ExportLogsServiceRequest,
	ExportLogsServiceRequestSchema,
} from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import {
	type ExportMetricsServiceRequest,
	ExportMetricsServiceRequestSchema,
} from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import {
	type ExportTraceServiceRequest,
	ExportTraceServiceRequestSchema,
} from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import type {
	AnyValue,
	KeyValue,
} from "./gen/opentelemetry/proto/common/v1/common_pb.js";
import type { LogRecord as OtlpLogRecord } from "./gen/opentelemetry/proto/logs/v1/logs_pb.js";
import type {
	Exemplar,
	ExponentialHistogramDataPoint,
	HistogramDataPoint,
	Metric,
	NumberDataPoint,
	ResourceMetrics,
	ScopeMetrics,
	SummaryDataPoint,
} from "./gen/opentelemetry/proto/metrics/v1/metrics_pb.js";
import type { ResourceSpans } from "./gen/opentelemetry/proto/trace/v1/trace_pb.js";

export type OtlpWireFormat = "json" | "protobuf";

export interface ReadBodyResult {
	bytes: Uint8Array;
	wireFormat: OtlpWireFormat;
}

export class OtlpDecodeError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 415,
	) {
		super(message);
	}
}

/**
 * Reads and decompresses an OTLP request body, returning the raw bytes plus
 * the inferred wire format. Throws `OtlpDecodeError` for unsupported content-
 * types or malformed gzip.
 */
export const readOtlpBody = async (c: Context): Promise<ReadBodyResult> => {
	const contentType = (c.req.header("content-type") ?? "").toLowerCase();
	const wireFormat = detectWireFormat(contentType);

	let body = await c.req.arrayBuffer();
	const encoding = (c.req.header("content-encoding") ?? "").toLowerCase();
	if (encoding === "gzip") {
		body = await gunzip(body);
	} else if (encoding && encoding !== "identity") {
		throw new OtlpDecodeError(`Unsupported content-encoding: ${encoding}`, 415);
	}

	return { bytes: new Uint8Array(body), wireFormat };
};

const detectWireFormat = (contentType: string): OtlpWireFormat => {
	if (contentType.includes("application/x-protobuf")) return "protobuf";
	if (contentType.includes("application/json")) return "json";
	throw new OtlpDecodeError(
		`Unsupported content-type: ${contentType || "(missing)"}`,
		415,
	);
};

const gunzip = async (input: ArrayBuffer): Promise<ArrayBuffer> => {
	const stream = new Response(input).body?.pipeThrough(
		new DecompressionStream("gzip"),
	);
	if (!stream) throw new OtlpDecodeError("Empty gzip body", 400);
	return new Response(stream).arrayBuffer();
};

/**
 * Decode an OTLP trace export request from wire bytes into the legacy
 * `@obs-unified/types` shape consumed by `toStoredSpans`.
 */
export const decodeTraceRequest = (
	body: ReadBodyResult,
): OtlpTraceExportRequest => {
	let msg: ExportTraceServiceRequest;
	try {
		msg =
			body.wireFormat === "protobuf"
				? fromBinary(ExportTraceServiceRequestSchema, body.bytes)
				: fromJson(ExportTraceServiceRequestSchema, decodeJsonBody(body.bytes));
	} catch (err) {
		throw new OtlpDecodeError(
			`Malformed OTLP body: ${(err as Error).message}`,
			400,
		);
	}
	return { resourceSpans: msg.resourceSpans.map(adaptResourceSpans) };
};

const decodeJsonBody = (bytes: Uint8Array): JsonValue => {
	const text = new TextDecoder().decode(bytes);
	if (!text.length) return {};
	const parsed = JSON.parse(text) as JsonValue;
	rewriteHexIdsToBase64(parsed);
	return parsed;
};

/**
 * The OTLP JSON encoding spec requires `trace_id` (16 bytes) and `span_id`
 * (8 bytes) to be lowercase hex strings — but proto-JSON's default encoding
 * for `bytes` fields is base64, which is what protobuf-es's `fromJson`
 * expects. The Go reference receiver accepts both; we do too, by walking
 * the parsed JSON and converting any hex-shaped ID field to base64 before
 * handing it to the schema decoder.
 *
 * Mutates the input in-place. Recognized field names cover every place a
 * trace/span ID appears in OTLP: span, link, log record, exemplar.
 */
const rewriteHexIdsToBase64 = (node: JsonValue): void => {
	if (Array.isArray(node)) {
		for (const item of node) rewriteHexIdsToBase64(item);
		return;
	}
	if (!node || typeof node !== "object") return;
	const obj = node as Record<string, JsonValue>;
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (typeof value === "string") {
			if ((key === "traceId" || key === "trace_id") && isHex(value, 32)) {
				obj[key] = hexToBase64(value);
			} else if (
				(key === "spanId" ||
					key === "span_id" ||
					key === "parentSpanId" ||
					key === "parent_span_id") &&
				isHex(value, 16)
			) {
				obj[key] = hexToBase64(value);
			}
		} else {
			rewriteHexIdsToBase64(value);
		}
	}
};

const isHex = (s: string, length: number): boolean =>
	s.length === length && /^[0-9a-f]+$/i.test(s);

const hexToBase64 = (hex: string): string => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++)
		binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
};

// ── Logs ─────────────────────────────────────────────────────────────

/**
 * A log record normalized for storage. One per emitted OTLP `LogRecord`,
 * with resource / scope context flattened into the fields the `LogsStore`
 * expects. Receiver adds storage-level fields (projectId, logId, receivedAt,
 * expiresAt) at ingest time.
 */
export interface DecodedLogRecord {
	serviceName: string | null;
	loggerName: string | null;
	traceId: string | null;
	spanId: string | null;
	severity: LogSeverity;
	severityNumber: number;
	message: string;
	attributes: Record<string, ObsJsonValue> | null;
	flags: number;
	droppedAttributesCount: number;
	occurredAt: string;
}

/**
 * Decode an OTLP logs export request into a flat list of records ready for
 * storage. Resource `service.name` and scope name are denormalized onto each
 * record so downstream code doesn't need to traverse the hierarchy.
 */
export const decodeLogsRequest = (body: ReadBodyResult): DecodedLogRecord[] => {
	let msg: ExportLogsServiceRequest;
	try {
		msg =
			body.wireFormat === "protobuf"
				? fromBinary(ExportLogsServiceRequestSchema, body.bytes)
				: fromJson(ExportLogsServiceRequestSchema, decodeJsonBody(body.bytes));
	} catch (err) {
		throw new OtlpDecodeError(
			`Malformed OTLP body: ${(err as Error).message}`,
			400,
		);
	}

	const out: DecodedLogRecord[] = [];
	for (const rl of msg.resourceLogs) {
		const serviceName = extractServiceName(rl.resource?.attributes);
		for (const sl of rl.scopeLogs) {
			const loggerName = sl.scope?.name || null;
			for (const log of sl.logRecords) {
				out.push(adaptLogRecord(log, serviceName, loggerName));
			}
		}
	}
	return out;
};

const adaptLogRecord = (
	log: OtlpLogRecord,
	serviceName: string | null,
	loggerName: string | null,
): DecodedLogRecord => {
	const ts = log.timeUnixNano || log.observedTimeUnixNano;
	const occurredAt =
		ts > 0n
			? new Date(Number(ts / 1_000_000n)).toISOString()
			: new Date().toISOString();
	return {
		serviceName,
		loggerName,
		traceId: log.traceId.length === 16 ? bytesToHex(log.traceId) : null,
		spanId: log.spanId.length === 8 ? bytesToHex(log.spanId) : null,
		severity: severityFromNumber(log.severityNumber, log.severityText),
		severityNumber: log.severityNumber || 0,
		message: anyValueToString(log.body),
		attributes: log.attributes.length
			? keyValuesToRecord(log.attributes)
			: null,
		flags: log.flags || 0,
		droppedAttributesCount: log.droppedAttributesCount || 0,
		occurredAt,
	};
};

const extractServiceName = (attrs: KeyValue[] | undefined): string | null => {
	if (!attrs) return null;
	const match = attrs.find((a) => a.key === "service.name");
	if (!match?.value) return null;
	return match.value.value.case === "stringValue"
		? match.value.value.value
		: null;
};

const severityFromNumber = (n: number, text: string): LogSeverity => {
	if (n >= 21) return "FATAL";
	if (n >= 17) return "ERROR";
	if (n >= 13) return "WARN";
	if (n >= 9) return "INFO";
	if (n >= 5) return "DEBUG";
	if (n >= 1) return "DEBUG"; // TRACE collapsed to DEBUG
	// severityNumber unset — fall back to text, then INFO default.
	const upper = text.toUpperCase();
	if (
		upper === "FATAL" ||
		upper === "ERROR" ||
		upper === "WARN" ||
		upper === "INFO" ||
		upper === "DEBUG"
	)
		return upper;
	return "INFO";
};

const anyValueToString = (v: AnyValue | undefined): string => {
	if (!v) return "";
	switch (v.value.case) {
		case "stringValue":
			return v.value.value;
		case "boolValue":
			return String(v.value.value);
		case "intValue":
			return v.value.value.toString();
		case "doubleValue":
			return String(v.value.value);
		case "bytesValue":
			return bytesToBase64(v.value.value);
		case "arrayValue":
		case "kvlistValue":
			return JSON.stringify(adaptAnyValue(v));
		default:
			return "";
	}
};

const keyValuesToRecord = (kvs: KeyValue[]): Record<string, ObsJsonValue> => {
	const out: Record<string, ObsJsonValue> = {};
	for (const kv of kvs) {
		out[kv.key] = anyValueToJson(kv.value);
	}
	return out;
};

// ── Metrics ───────────────────────────────────────────────────────────

export type MetricType =
	| "gauge"
	| "sum"
	| "histogram"
	| "exp_histogram"
	| "summary";

export interface DecodedExemplar {
	value: number;
	traceId: string | null;
	spanId: string | null;
	tsNs: string;
}

/**
 * A metric data point normalized for storage. Series-identifying fields
 * (name, resource/scope context, attributes) are repeated on each point so
 * the store can do series upsert in a single pass.
 */
export interface DecodedMetricPoint {
	// Series identity
	name: string;
	description: string | null;
	unit: string | null;
	type: MetricType;
	isMonotonic: boolean | null;
	temporality: number | null;
	scopeName: string | null;
	scopeVersion: string | null;
	serviceName: string | null;
	resourceAttrsJson: string | null;
	attributesJson: string | null;
	identity: string;

	// Point
	tsNs: string;
	startTsNs: string | null;
	value: number | null;

	// Histogram-only
	count: number | null;
	sum: number | null;
	min: number | null;
	max: number | null;
	boundsJson: string | null;
	bucketCountsJson: string | null;

	/**
	 * Type-specific fields that don't fit the column schema:
	 *   - exp_histogram: { scale, zeroCount, zeroThreshold, positive: {offset, bucketCounts}, negative: {offset, bucketCounts} }
	 *   - summary: { quantileValues: [{quantile, value}, ...] }
	 */
	extraJson: string | null;

	exemplarsJson: string | null;
}

export const decodeMetricsRequest = (
	body: ReadBodyResult,
): DecodedMetricPoint[] => {
	let msg: ExportMetricsServiceRequest;
	try {
		msg =
			body.wireFormat === "protobuf"
				? fromBinary(ExportMetricsServiceRequestSchema, body.bytes)
				: fromJson(
						ExportMetricsServiceRequestSchema,
						decodeJsonBody(body.bytes),
					);
	} catch (err) {
		throw new OtlpDecodeError(
			`Malformed OTLP body: ${(err as Error).message}`,
			400,
		);
	}

	const out: DecodedMetricPoint[] = [];
	for (const rm of msg.resourceMetrics) {
		const resourceAttrs = rm.resource?.attributes ?? [];
		const resourceAttrsJson = resourceAttrs.length
			? JSON.stringify(keyValuesToRecord(resourceAttrs))
			: null;
		const serviceName = extractServiceName(resourceAttrs);
		for (const sm of rm.scopeMetrics) {
			addMetrics(out, rm, sm, serviceName, resourceAttrsJson);
		}
	}
	return out;
};

const addMetrics = (
	out: DecodedMetricPoint[],
	rm: ResourceMetrics,
	sm: ScopeMetrics,
	serviceName: string | null,
	resourceAttrsJson: string | null,
) => {
	const scopeName = sm.scope?.name || null;
	const scopeVersion = sm.scope?.version || null;
	const resourceIdentityFragment = canonicalKeyValues(
		rm.resource?.attributes ?? [],
	);

	for (const metric of sm.metrics) {
		const common = {
			name: metric.name,
			description: metric.description || null,
			unit: metric.unit || null,
			scopeName,
			scopeVersion,
			serviceName,
			resourceAttrsJson,
		};
		switch (metric.data.case) {
			case "gauge":
				for (const p of metric.data.value.dataPoints) {
					out.push(
						numberPoint(metric, p, "gauge", common, resourceIdentityFragment),
					);
				}
				break;
			case "sum":
				for (const p of metric.data.value.dataPoints) {
					out.push({
						...numberPoint(metric, p, "sum", common, resourceIdentityFragment),
						isMonotonic: metric.data.value.isMonotonic,
						temporality: metric.data.value.aggregationTemporality,
					});
				}
				break;
			case "histogram":
				for (const p of metric.data.value.dataPoints) {
					out.push({
						...histogramPoint(metric, p, common, resourceIdentityFragment),
						temporality: metric.data.value.aggregationTemporality,
					});
				}
				break;
			case "exponentialHistogram":
				for (const p of metric.data.value.dataPoints) {
					out.push({
						...expHistogramPoint(metric, p, common, resourceIdentityFragment),
						temporality: metric.data.value.aggregationTemporality,
					});
				}
				break;
			case "summary":
				for (const p of metric.data.value.dataPoints) {
					out.push(summaryPoint(metric, p, common, resourceIdentityFragment));
				}
				break;
			default:
				break;
		}
	}
};

type SeriesCommon = {
	name: string;
	description: string | null;
	unit: string | null;
	scopeName: string | null;
	scopeVersion: string | null;
	serviceName: string | null;
	resourceAttrsJson: string | null;
};

const numberPoint = (
	metric: Metric,
	p: NumberDataPoint,
	type: MetricType,
	common: SeriesCommon,
	resourceIdentityFragment: string,
): DecodedMetricPoint => {
	const value =
		p.value.case === "asDouble"
			? p.value.value
			: p.value.case === "asInt"
				? Number(p.value.value)
				: null;
	const attrsRecord = p.attributes.length
		? keyValuesToRecord(p.attributes)
		: null;
	return {
		...common,
		type,
		isMonotonic: null,
		temporality: null,
		attributesJson: attrsRecord ? JSON.stringify(attrsRecord) : null,
		identity: buildIdentity(
			resourceIdentityFragment,
			common.scopeName,
			metric.name,
			p.attributes,
		),
		tsNs: p.timeUnixNano.toString(),
		startTsNs: p.startTimeUnixNano > 0n ? p.startTimeUnixNano.toString() : null,
		value,
		count: null,
		sum: null,
		min: null,
		max: null,
		boundsJson: null,
		bucketCountsJson: null,
		extraJson: null,
		exemplarsJson: encodeExemplars(p.exemplars),
	};
};

const histogramPoint = (
	metric: Metric,
	p: HistogramDataPoint,
	common: SeriesCommon,
	resourceIdentityFragment: string,
): DecodedMetricPoint => {
	const attrsRecord = p.attributes.length
		? keyValuesToRecord(p.attributes)
		: null;
	return {
		...common,
		type: "histogram",
		isMonotonic: null,
		temporality: null,
		attributesJson: attrsRecord ? JSON.stringify(attrsRecord) : null,
		identity: buildIdentity(
			resourceIdentityFragment,
			common.scopeName,
			metric.name,
			p.attributes,
		),
		tsNs: p.timeUnixNano.toString(),
		startTsNs: p.startTimeUnixNano > 0n ? p.startTimeUnixNano.toString() : null,
		value: null,
		count: Number(p.count),
		sum: p.sum ?? null,
		min: p.min ?? null,
		max: p.max ?? null,
		boundsJson: p.explicitBounds.length
			? JSON.stringify(p.explicitBounds)
			: null,
		bucketCountsJson: p.bucketCounts.length
			? JSON.stringify(p.bucketCounts.map((b) => Number(b)))
			: null,
		extraJson: null,
		exemplarsJson: encodeExemplars(p.exemplars),
	};
};

const expHistogramPoint = (
	metric: Metric,
	p: ExponentialHistogramDataPoint,
	common: SeriesCommon,
	resourceIdentityFragment: string,
): DecodedMetricPoint => {
	const attrsRecord = p.attributes.length
		? keyValuesToRecord(p.attributes)
		: null;
	const extra = {
		scale: p.scale,
		zeroCount: Number(p.zeroCount),
		zeroThreshold: p.zeroThreshold,
		positive: p.positive
			? {
					offset: p.positive.offset,
					bucketCounts: p.positive.bucketCounts.map((b) => Number(b)),
				}
			: null,
		negative: p.negative
			? {
					offset: p.negative.offset,
					bucketCounts: p.negative.bucketCounts.map((b) => Number(b)),
				}
			: null,
	};
	return {
		...common,
		type: "exp_histogram",
		isMonotonic: null,
		temporality: null,
		attributesJson: attrsRecord ? JSON.stringify(attrsRecord) : null,
		identity: buildIdentity(
			resourceIdentityFragment,
			common.scopeName,
			metric.name,
			p.attributes,
		),
		tsNs: p.timeUnixNano.toString(),
		startTsNs: p.startTimeUnixNano > 0n ? p.startTimeUnixNano.toString() : null,
		value: null,
		count: Number(p.count),
		sum: p.sum ?? null,
		min: p.min ?? null,
		max: p.max ?? null,
		boundsJson: null,
		bucketCountsJson: null,
		extraJson: JSON.stringify(extra),
		exemplarsJson: encodeExemplars(p.exemplars),
	};
};

const summaryPoint = (
	metric: Metric,
	p: SummaryDataPoint,
	common: SeriesCommon,
	resourceIdentityFragment: string,
): DecodedMetricPoint => {
	const attrsRecord = p.attributes.length
		? keyValuesToRecord(p.attributes)
		: null;
	const extra = {
		quantileValues: p.quantileValues.map((q) => ({
			quantile: q.quantile,
			value: q.value,
		})),
	};
	return {
		...common,
		type: "summary",
		isMonotonic: null,
		temporality: null,
		attributesJson: attrsRecord ? JSON.stringify(attrsRecord) : null,
		identity: buildIdentity(
			resourceIdentityFragment,
			common.scopeName,
			metric.name,
			p.attributes,
		),
		tsNs: p.timeUnixNano.toString(),
		startTsNs: p.startTimeUnixNano > 0n ? p.startTimeUnixNano.toString() : null,
		value: null,
		count: Number(p.count),
		sum: p.sum,
		min: null,
		max: null,
		boundsJson: null,
		bucketCountsJson: null,
		extraJson: JSON.stringify(extra),
		exemplarsJson: null, // Summary has no exemplars in the spec.
	};
};

const encodeExemplars = (exemplars: Exemplar[]): string | null => {
	if (!exemplars.length) return null;
	return JSON.stringify(
		exemplars.map<DecodedExemplar>((e) => ({
			value:
				e.value.case === "asDouble"
					? e.value.value
					: e.value.case === "asInt"
						? Number(e.value.value)
						: 0,
			traceId: e.traceId.length === 16 ? bytesToHex(e.traceId) : null,
			spanId: e.spanId.length === 8 ? bytesToHex(e.spanId) : null,
			tsNs: e.timeUnixNano.toString(),
		})),
	);
};

/**
 * Canonical series identity. Stable across encodings (JSON/proto) because
 * attributes are sorted and values normalized. Short enough to index.
 */
const buildIdentity = (
	resourceFragment: string,
	scopeName: string | null,
	metricName: string,
	attrs: KeyValue[],
): string =>
	JSON.stringify([
		resourceFragment,
		scopeName ?? "",
		metricName,
		canonicalKeyValues(attrs),
	]);

const canonicalKeyValues = (attrs: KeyValue[]): string => {
	if (!attrs.length) return "";
	const rec = keyValuesToRecord(attrs);
	const keys = Object.keys(rec).sort();
	return JSON.stringify(keys.map((k) => [k, rec[k]]));
};

const anyValueToJson = (v: AnyValue | undefined): ObsJsonValue => {
	if (!v) return null;
	switch (v.value.case) {
		case "stringValue":
			return v.value.value;
		case "boolValue":
			return v.value.value;
		case "intValue":
			// OTel int is int64. Downgrade safely; lossy above 2^53 but rare for attrs.
			return Number(v.value.value);
		case "doubleValue":
			return v.value.value;
		case "bytesValue":
			return bytesToBase64(v.value.value);
		case "arrayValue":
			return v.value.value.values.map((x) => anyValueToJson(x));
		case "kvlistValue":
			return keyValuesToRecord(v.value.value.values);
		default:
			return null;
	}
};

// ── proto-native → legacy shape adapters ─────────────────────────────

const adaptResourceSpans = (rs: ResourceSpans): OtlpResourceSpans => ({
	resource: rs.resource
		? { attributes: rs.resource.attributes.map(adaptKeyValue) }
		: undefined,
	scopeSpans: rs.scopeSpans.map((ss) => ({
		scope: ss.scope
			? { name: ss.scope.name, version: ss.scope.version }
			: undefined,
		spans: ss.spans.map((s) => ({
			traceId: bytesToHex(s.traceId),
			spanId: bytesToHex(s.spanId),
			parentSpanId: s.parentSpanId.length
				? bytesToHex(s.parentSpanId)
				: undefined,
			traceState: s.traceState || undefined,
			name: s.name,
			kind: s.kind,
			startTimeUnixNano: bigintToString(s.startTimeUnixNano),
			endTimeUnixNano: bigintToString(s.endTimeUnixNano),
			attributes: s.attributes.map(adaptKeyValue),
			droppedAttributesCount: s.droppedAttributesCount || undefined,
			events: s.events.map((e) => ({
				name: e.name,
				timeUnixNano: bigintToString(e.timeUnixNano),
				attributes: e.attributes.map(adaptKeyValue),
				droppedAttributesCount: e.droppedAttributesCount || undefined,
			})),
			droppedEventsCount: s.droppedEventsCount || undefined,
			links: s.links.map((l) => ({
				traceId: bytesToHex(l.traceId),
				spanId: bytesToHex(l.spanId),
				traceState: l.traceState || undefined,
				attributes: l.attributes.map(adaptKeyValue),
				droppedAttributesCount: l.droppedAttributesCount || undefined,
			})),
			droppedLinksCount: s.droppedLinksCount || undefined,
			status: s.status
				? { code: s.status.code, message: s.status.message }
				: undefined,
		})),
	})),
});

const adaptKeyValue = (kv: KeyValue): OtlpKeyValue => ({
	key: kv.key,
	value: kv.value ? adaptAnyValue(kv.value) : undefined,
});

const adaptAnyValue = (v: AnyValue): OtlpAnyValue => {
	switch (v.value.case) {
		case "stringValue":
			return { stringValue: v.value.value };
		case "boolValue":
			return { boolValue: v.value.value };
		case "intValue":
			return { intValue: v.value.value.toString() };
		case "doubleValue":
			return { doubleValue: v.value.value };
		case "arrayValue":
			return {
				arrayValue: {
					values: v.value.value.values.map((x) => adaptAnyValue(x)),
				},
			};
		case "kvlistValue":
			return {
				kvlistValue: {
					values: v.value.value.values.map(adaptKeyValue),
				},
			};
		case "bytesValue":
			// Surface bytes as base64 string — matches proto-JSON mapping spec.
			return { stringValue: bytesToBase64(v.value.value) };
		default:
			return {};
	}
};

const HEX_CHARS = "0123456789abcdef";
const bytesToHex = (bytes: Uint8Array): string => {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] ?? 0;
		out += HEX_CHARS[b >> 4];
		out += HEX_CHARS[b & 0xf];
	}
	return out;
};

const bigintToString = (n: bigint): string => n.toString();

const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let i = 0; i < bytes.length; i++)
		binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
};
