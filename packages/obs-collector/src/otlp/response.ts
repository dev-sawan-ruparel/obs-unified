/**
 * OTLP response envelope encoders.
 *
 * Per the OTLP/HTTP spec, successful responses are always `200 OK` — whether
 * fully accepted or partial — with a serialized `Export{Signal}ServiceResponse`
 * body. Wire format mirrors the request (JSON in → JSON out; protobuf in →
 * protobuf out). `partial_success` is set only when records were actually
 * rejected; an empty partial_success block is semantically identical to a
 * fully-accepted response and wastes bytes.
 *
 * See: https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/otlp.md#failures
 */

import { create, type DescMessage, toBinary, toJson } from "@bufbuild/protobuf";
import type { Context } from "hono";
import type { OtlpWireFormat } from "./decode";
import {
	ExportLogsPartialSuccessSchema,
	ExportLogsServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import {
	ExportMetricsPartialSuccessSchema,
	ExportMetricsServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import {
	ExportTracePartialSuccessSchema,
	ExportTraceServiceResponseSchema,
} from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";

export interface PartialSuccess {
	rejected: number;
	errorMessage: string;
}

/**
 * Return a retryable error response per the OTLP/HTTP spec. Sets the
 * `Retry-After` header which OTel SDKs respect for exponential backoff.
 *
 *   429 Too Many Requests — per-client throttling
 *   503 Service Unavailable — server-side overload or transient failure
 *
 * The body is a plain JSON error, not an OTLP envelope — the spec permits
 * any body (or empty) for failure cases. `Retry-After` uses integer seconds.
 */
export const otlpRetryableError = (
	c: Context,
	status: 429 | 503,
	message: string,
	retryAfterSec = 5,
) =>
	c.body(JSON.stringify({ error: message }), status, {
		"Content-Type": "application/json",
		"Retry-After": String(retryAfterSec),
	});

export const traceResponse = (
	c: Context,
	wireFormat: OtlpWireFormat,
	partial?: PartialSuccess,
) => {
	const msg = create(
		ExportTraceServiceResponseSchema,
		partial
			? {
					partialSuccess: create(ExportTracePartialSuccessSchema, {
						rejectedSpans: BigInt(partial.rejected),
						errorMessage: partial.errorMessage,
					}),
				}
			: {},
	);
	return encode(c, wireFormat, ExportTraceServiceResponseSchema, msg);
};

export const logsResponse = (
	c: Context,
	wireFormat: OtlpWireFormat,
	partial?: PartialSuccess,
) => {
	const msg = create(
		ExportLogsServiceResponseSchema,
		partial
			? {
					partialSuccess: create(ExportLogsPartialSuccessSchema, {
						rejectedLogRecords: BigInt(partial.rejected),
						errorMessage: partial.errorMessage,
					}),
				}
			: {},
	);
	return encode(c, wireFormat, ExportLogsServiceResponseSchema, msg);
};

export const metricsResponse = (
	c: Context,
	wireFormat: OtlpWireFormat,
	partial?: PartialSuccess,
) => {
	const msg = create(
		ExportMetricsServiceResponseSchema,
		partial
			? {
					partialSuccess: create(ExportMetricsPartialSuccessSchema, {
						rejectedDataPoints: BigInt(partial.rejected),
						errorMessage: partial.errorMessage,
					}),
				}
			: {},
	);
	return encode(c, wireFormat, ExportMetricsServiceResponseSchema, msg);
};

const encode = <T extends DescMessage>(
	c: Context,
	wireFormat: OtlpWireFormat,
	schema: T,
	msg: Parameters<typeof toBinary<T>>[1],
) => {
	if (wireFormat === "protobuf") {
		const bytes = toBinary(schema, msg);
		return c.body(bytes, 200, {
			"Content-Type": "application/x-protobuf",
		});
	}
	const json = toJson(schema, msg);
	return c.body(JSON.stringify(json), 200, {
		"Content-Type": "application/json",
	});
};
