import { fromBinary, fromJson } from "@bufbuild/protobuf";
import type {
	LogSeverity,
	JsonValue as ObsJsonValue,
} from "@obs-unified/types";
import {
	type ExportLogsServiceRequest,
	ExportLogsServiceRequestSchema,
} from "../gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import type { LogRecord as OtlpLogRecord } from "../gen/opentelemetry/proto/logs/v1/logs_pb.js";
import { decodeJsonBody, OtlpDecodeError, type ReadBodyResult } from "./body";
import {
	anyValueToString,
	bytesToHex,
	extractServiceName,
	keyValuesToRecord,
	severityFromNumber,
} from "./values";

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
