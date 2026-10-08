// ── OTLP Wire Types ──

export interface OtlpAnyValue {
	stringValue?: string;
	boolValue?: boolean;
	intValue?: string | number;
	doubleValue?: number;
	arrayValue?: { values: OtlpAnyValue[] };
	kvlistValue?: { values: OtlpKeyValue[] };
}

export interface OtlpKeyValue {
	key: string;
	value?: OtlpAnyValue;
}

export interface OtlpEvent {
	name: string;
	timeUnixNano?: string;
	attributes?: OtlpKeyValue[];
	droppedAttributesCount?: number;
}

export interface OtlpLink {
	traceId: string;
	spanId: string;
	traceState?: string;
	attributes?: OtlpKeyValue[];
	droppedAttributesCount?: number;
}

export interface OtlpSpan {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	traceState?: string;
	name: string;
	kind?: number;
	startTimeUnixNano?: string;
	endTimeUnixNano?: string;
	attributes?: OtlpKeyValue[];
	droppedAttributesCount?: number;
	events?: OtlpEvent[];
	droppedEventsCount?: number;
	links?: OtlpLink[];
	droppedLinksCount?: number;
	status?: { code?: number; message?: string };
}

export interface OtlpScopeSpans {
	scope?: { name?: string; version?: string };
	spans?: OtlpSpan[];
}

export interface OtlpResourceSpans {
	resource?: { attributes?: OtlpKeyValue[] };
	scopeSpans?: OtlpScopeSpans[];
}

export interface OtlpTraceExportRequest {
	resourceSpans?: OtlpResourceSpans[];
}
