/**
 * OTLP wire format → StoredSpan conversion.
 * Union of all repos: A's advanced value conversion, hex validation,
 * service name fallback, safe BigInt handling.
 */

import type {
	JsonValue,
	OtlpAnyValue,
	OtlpKeyValue,
	OtlpResourceSpans,
	OtlpScopeSpans,
	OtlpSpan,
	OtlpTraceExportRequest,
	StoredSpan,
} from "@obs/types";
import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obs/types/constants";

const EMPTY_ARRAY_JSON = "[]";
const EMPTY_OBJECT_JSON = "{}";

/** Recursive OTLP value → JSON (from A: handles arrayValue, kvlistValue) */
const anyValueToJson = (value?: OtlpAnyValue): JsonValue => {
	if (!value) return null;
	if (typeof value.stringValue === "string") return value.stringValue;
	if (typeof value.boolValue === "boolean") return value.boolValue;
	if (typeof value.doubleValue === "number") return value.doubleValue;
	if (
		typeof value.intValue === "string" ||
		typeof value.intValue === "number"
	) {
		const parsed = Number(value.intValue);
		return Number.isFinite(parsed) ? parsed : String(value.intValue);
	}
	if (value.arrayValue?.values) {
		return value.arrayValue.values.map((item) => anyValueToJson(item));
	}
	if (value.kvlistValue?.values) {
		return keyValuesToRecord(value.kvlistValue.values);
	}
	return null;
};

const keyValuesToRecord = (
	values?: OtlpKeyValue[],
): Record<string, JsonValue> => {
	if (!values?.length) return {};
	return Object.fromEntries(
		values.map((entry) => [entry.key, anyValueToJson(entry.value)]),
	);
};

/** Validates hex string length (from A) */
const normalizeHex = (
	value: string | undefined,
	length: number,
): string | null => {
	if (!value) return null;
	const normalized = value.trim().toLowerCase();
	if (!/^[0-9a-f]+$/i.test(normalized) || normalized.length !== length)
		return null;
	return normalized;
};

/** Safe BigInt nanosecond → millisecond duration (from A) */
const nanosToMs = (start?: string, end?: string): number => {
	try {
		const startNs = BigInt(start ?? 0);
		const endNs = BigInt(end ?? 0);
		if (endNs < startNs) return 0;
		return Number((endNs - startNs) / 1_000_000n);
	} catch {
		return 0;
	}
};

/** Safe BigInt nanosecond → ISO string (from A) */
const nanosToIso = (value?: string, fallback?: Date): string => {
	if (!value) return fallback?.toISOString() ?? new Date().toISOString();
	try {
		const ns = BigInt(value);
		if (ns <= 0n) return fallback?.toISOString() ?? new Date().toISOString();
		return new Date(Number(ns / 1_000_000n)).toISOString();
	} catch {
		return fallback?.toISOString() ?? new Date().toISOString();
	}
};

const serializeJson = (value: unknown, fallback: string): string => {
	try {
		return JSON.stringify(value ?? JSON.parse(fallback));
	} catch {
		return fallback;
	}
};

/** Service name with fallback to server.address (from A) */
const getServiceName = (
	resourceAttributes: Record<string, JsonValue>,
	spanAttributes: Record<string, JsonValue>,
): string | null => {
	const resourceName = resourceAttributes["service.name"];
	if (typeof resourceName === "string" && resourceName.trim())
		return resourceName.trim();
	const serverAddress = spanAttributes["server.address"];
	if (typeof serverAddress === "string" && serverAddress.trim())
		return serverAddress.trim();
	return null;
};

const scopeToStoredSpans = (
	resourceSpans: OtlpResourceSpans,
	scopeSpans: OtlpScopeSpans,
	receivedAt: Date,
	retentionHours: number,
	projectId: string,
): StoredSpan[] => {
	const resourceAttributes = keyValuesToRecord(
		resourceSpans.resource?.attributes,
	);
	const scopeName = scopeSpans.scope?.name ?? null;
	const scopeVersion = scopeSpans.scope?.version ?? null;

	return (scopeSpans.spans ?? []).flatMap((span: OtlpSpan): StoredSpan[] => {
		const traceId = normalizeHex(span.traceId, 32);
		const spanId = normalizeHex(span.spanId, 16);
		if (!traceId || !spanId) return [];

		const attributes = keyValuesToRecord(span.attributes);
		const serviceName = getServiceName(resourceAttributes, attributes);

		return [
			{
				projectId,
				traceId,
				spanId,
				parentSpanId: normalizeHex(span.parentSpanId, 16),
				traceState: span.traceState ?? null,
				serviceName,
				scopeName,
				scopeVersion,
				spanName: span.name || "unnamed-span",
				spanKind: span.kind ?? 0,
				statusCode: span.status?.code ?? 0,
				statusMessage: span.status?.message ?? null,
				startTime: nanosToIso(span.startTimeUnixNano, receivedAt),
				endTime: nanosToIso(span.endTimeUnixNano, receivedAt),
				durationMs: nanosToMs(span.startTimeUnixNano, span.endTimeUnixNano),
				attributesJson: serializeJson(attributes, EMPTY_OBJECT_JSON),
				droppedAttributesCount: span.droppedAttributesCount ?? 0,
				resourceAttributesJson: serializeJson(
					resourceAttributes,
					EMPTY_OBJECT_JSON,
				),
				eventsJson: serializeJson(
					(span.events ?? []).map((event) => ({
						name: event.name,
						timeUnixNano: event.timeUnixNano ?? null,
						attributes: keyValuesToRecord(event.attributes),
						droppedAttributesCount: event.droppedAttributesCount ?? 0,
					})),
					EMPTY_ARRAY_JSON,
				),
				droppedEventsCount: span.droppedEventsCount ?? 0,
				linksJson: serializeJson(
					(span.links ?? []).map((link) => ({
						traceId: normalizeHex(link.traceId, 32),
						spanId: normalizeHex(link.spanId, 16),
						traceState: link.traceState ?? null,
						attributes: keyValuesToRecord(link.attributes),
						droppedAttributesCount: link.droppedAttributesCount ?? 0,
					})),
					EMPTY_ARRAY_JSON,
				),
				droppedLinksCount: span.droppedLinksCount ?? 0,
				receivedAt: receivedAt.toISOString(),
				expiresAt: retentionExpiry(receivedAt, retentionHours),
			},
		];
	});
};

export const retentionExpiry = (
	receivedAt: Date,
	retentionHours = DEFAULT_WINDOW_HOURS,
): string => {
	const expiry = new Date(
		receivedAt.getTime() + retentionHours * 60 * 60 * 1000,
	);
	return expiry.toISOString();
};

export const toStoredSpans = (
	payload: OtlpTraceExportRequest,
	projectId: string,
	receivedAt = new Date(),
	retentionHours = getConfiguredRetentionHours(undefined),
): StoredSpan[] =>
	(payload.resourceSpans ?? []).flatMap((resourceSpans) =>
		(resourceSpans.scopeSpans ?? []).flatMap((scopeSpans) =>
			scopeToStoredSpans(
				resourceSpans,
				scopeSpans,
				receivedAt,
				retentionHours,
				projectId,
			),
		),
	);
