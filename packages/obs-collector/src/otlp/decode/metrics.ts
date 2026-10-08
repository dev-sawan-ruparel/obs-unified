import { fromBinary, fromJson } from "@bufbuild/protobuf";
import {
	type ExportMetricsServiceRequest,
	ExportMetricsServiceRequestSchema,
} from "../gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import type { KeyValue } from "../gen/opentelemetry/proto/common/v1/common_pb.js";
import type {
	Exemplar,
	ExponentialHistogramDataPoint,
	HistogramDataPoint,
	Metric,
	NumberDataPoint,
	ResourceMetrics,
	ScopeMetrics,
	SummaryDataPoint,
} from "../gen/opentelemetry/proto/metrics/v1/metrics_pb.js";
import { decodeJsonBody, OtlpDecodeError, type ReadBodyResult } from "./body";
import { bytesToHex, extractServiceName, keyValuesToRecord } from "./values";

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
