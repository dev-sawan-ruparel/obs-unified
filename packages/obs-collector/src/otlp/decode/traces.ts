import { fromBinary, fromJson } from "@bufbuild/protobuf";
import type {
	OtlpResourceSpans,
	OtlpTraceExportRequest,
} from "@obsunified/types";
import {
	type ExportTraceServiceRequest,
	ExportTraceServiceRequestSchema,
} from "../gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import type { ResourceSpans } from "../gen/opentelemetry/proto/trace/v1/trace_pb.js";
import { decodeJsonBody, OtlpDecodeError, type ReadBodyResult } from "./body";
import { adaptKeyValue, bigintToString, bytesToHex } from "./values";

/**
 * Decode an OTLP trace export request from wire bytes into the legacy
 * `@obsunified/types` shape consumed by `toStoredSpans`.
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

// ── proto-native → legacy shape adapters ─────────────────────────────

const adaptResourceSpans = (rs: ResourceSpans): OtlpResourceSpans => ({
	resource: rs.resource
		? { attributes: rs.resource.attributes.map(adaptKeyValue) }
		: undefined,
	scopeSpans: rs.scopeSpans.map((ss) => ({
		scope: ss.scope
			? { name: ss.scope.name, version: ss.scope.version }
			: undefined,
		spans: ss.spans.flatMap((s) => {
			if (s.traceId.length !== 16 || s.spanId.length !== 8) return [];
			return [
				{
					traceId: bytesToHex(s.traceId),
					spanId: bytesToHex(s.spanId),
					parentSpanId:
						s.parentSpanId.length === 8
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
					links: s.links.flatMap((l) =>
						l.traceId.length === 16 && l.spanId.length === 8
							? [
									{
										traceId: bytesToHex(l.traceId),
										spanId: bytesToHex(l.spanId),
										traceState: l.traceState || undefined,
										attributes: l.attributes.map(adaptKeyValue),
										droppedAttributesCount:
											l.droppedAttributesCount || undefined,
									},
								]
							: [],
					),
					droppedLinksCount: s.droppedLinksCount || undefined,
					status: s.status
						? { code: s.status.code, message: s.status.message }
						: undefined,
				},
			];
		}),
	})),
});
