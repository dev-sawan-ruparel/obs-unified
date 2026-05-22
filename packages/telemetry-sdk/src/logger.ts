/**
 * Structured logger.
 * JSON-line output with OTEL severity numbers.
 * WARN/ERROR auto-attach to active span as events.
 * Forwards logs to the collector as OTLP/HTTP+JSON
 * (`ExportLogsServiceRequest`, proto-JSON encoded).
 */

import type { JsonValue } from "@obs-unified/types";
import { getActiveSpan } from "./span";

const SEVERITY_DEBUG = 5;
const SEVERITY_INFO = 9;
const SEVERITY_WARN = 13;
const SEVERITY_ERROR = 17;

export type LogSeverity = "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

export interface Logger {
	debug(message: string, attributes?: Record<string, unknown>): void;
	info(message: string, attributes?: Record<string, unknown>): void;
	warn(message: string, attributes?: Record<string, unknown>): void;
	error(message: string, attributes?: Record<string, unknown>): void;
}

export interface LoggerConfig {
	collectorUrl: string;
	authToken?: string;
	serviceName: string;
	/**
	 * Additional HTTP headers attached to every `/v1/logs` POST. Used by the
	 * collector to mark its own self-emitted telemetry with `X-Telemetry-Self`
	 * so the request middleware can short-circuit and avoid an export loop.
	 * See apps/collector/SELF_INSTRUMENTATION.md.
	 */
	extraHeaders?: Record<string, string>;
}

interface BufferedLog {
	severity: LogSeverity;
	severityNumber: number;
	loggerName: string;
	message: string;
	attributes?: Record<string, JsonValue>;
	occurredAtNs: string; // uint64 nanoseconds as decimal string
	traceId?: string;
	spanId?: string;
}

const MAX_BUFFER_SIZE = 500;

let logConfig: LoggerConfig | null = null;
const logBuffer: BufferedLog[] = [];
let flushInProgress = false;

export function initLogger(config: LoggerConfig) {
	logConfig = config;
}

export async function flushLogs() {
	if (!logConfig || logBuffer.length === 0 || flushInProgress) return;

	flushInProgress = true;
	const batch = logBuffer.splice(0, logBuffer.length);
	const payload = buildOtlpLogsPayload(batch, logConfig.serviceName);

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(logConfig.extraHeaders ?? {}),
		};
		if (logConfig.authToken) {
			headers["Authorization"] = `Bearer ${logConfig.authToken}`;
		}

		await fetch(`${logConfig.collectorUrl}/v1/logs`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		console.error("Failed to flush logs:", err);
	} finally {
		flushInProgress = false;
	}
}

/**
 * Build an OTLP `ExportLogsServiceRequest` in proto-JSON form. Groups by
 * logger name (InstrumentationScope) under a single resource bearing
 * `service.name`. uint64 timestamps are encoded as decimal strings per the
 * proto-JSON spec.
 */
function buildOtlpLogsPayload(batch: BufferedLog[], serviceName: string) {
	const byLogger = new Map<string, BufferedLog[]>();
	for (const log of batch) {
		const existing = byLogger.get(log.loggerName);
		if (existing) existing.push(log);
		else byLogger.set(log.loggerName, [log]);
	}

	const scopeLogs = Array.from(byLogger.entries()).map(([name, logs]) => ({
		scope: { name },
		logRecords: logs.map(toOtlpLogRecord),
	}));

	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: serviceName } },
					],
				},
				scopeLogs,
			},
		],
	};
}

function toOtlpLogRecord(log: BufferedLog) {
	const record: Record<string, unknown> = {
		timeUnixNano: log.occurredAtNs,
		observedTimeUnixNano: log.occurredAtNs,
		severityNumber: log.severityNumber,
		severityText: log.severity,
		body: { stringValue: log.message },
	};
	if (log.attributes && Object.keys(log.attributes).length > 0) {
		record.attributes = Object.entries(log.attributes).map(([k, v]) => ({
			key: k,
			value: toOtlpAnyValue(v),
		}));
	}
	if (log.traceId) record.traceId = log.traceId;
	if (log.spanId) record.spanId = log.spanId;
	return record;
}

function toOtlpAnyValue(v: JsonValue): Record<string, unknown> {
	if (v === null || v === undefined) return {};
	if (typeof v === "string") return { stringValue: v };
	if (typeof v === "boolean") return { boolValue: v };
	if (typeof v === "number") {
		return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
	}
	if (Array.isArray(v)) {
		return { arrayValue: { values: v.map((x) => toOtlpAnyValue(x)) } };
	}
	return {
		kvlistValue: {
			values: Object.entries(v).map(([k, val]) => ({
				key: k,
				value: toOtlpAnyValue(val as JsonValue),
			})),
		},
	};
}

function isoToNanoString(iso: string): string {
	return `${new Date(iso).getTime()}000000`;
}

interface StructuredLogRecord {
	severity: LogSeverity;
	severityNumber: number;
	logger: string;
	message: string;
	ts: string;
	attributes?: Record<string, unknown>;
}

const emitConsole = (record: StructuredLogRecord): void => {
	const line = JSON.stringify(record);
	switch (record.severity) {
		case "FATAL":
		case "ERROR":
			console.error(line);
			break;
		case "WARN":
			console.warn(line);
			break;
		case "DEBUG":
			console.debug(line);
			break;
		default:
			console.log(line);
	}
};

export const errorMessage = (error: unknown): string => {
	if (error instanceof Error) return error.message;
	return String(error);
};

export function createLogger(name: string): Logger {
	const log = (
		severity: LogSeverity,
		severityNumber: number,
		message: string,
		attributes?: Record<string, unknown>,
	): void => {
		const record: StructuredLogRecord = {
			severity,
			severityNumber,
			logger: name,
			message,
			ts: new Date().toISOString(),
		};
		if (attributes && Object.keys(attributes).length > 0) {
			record.attributes = attributes;
		}
		emitConsole(record);

		const span = getActiveSpan();

		const logObj: BufferedLog = {
			severity,
			severityNumber,
			loggerName: name,
			message,
			attributes: (attributes as Record<string, JsonValue>) || undefined,
			occurredAtNs: isoToNanoString(record.ts),
			traceId: span?.traceId,
			spanId: span?.spanId,
		};

		// Drop oldest entries if buffer is at hard cap (collector unreachable)
		if (logBuffer.length >= MAX_BUFFER_SIZE) {
			logBuffer.splice(0, logBuffer.length - MAX_BUFFER_SIZE + 1);
		}
		logBuffer.push(logObj);

		if (logBuffer.length >= 20 && !flushInProgress) {
			flushLogs().catch(console.error);
		}

		if (severity === "ERROR" || severity === "FATAL" || severity === "WARN") {
			if (span) {
				span.addEvent(`log.${severity.toLowerCase()}`, {
					logger: name,
					message,
					...attributes,
				});
				if (
					(severity === "ERROR" || severity === "FATAL") &&
					span.statusCode !== 2
				) {
					span.setStatus(2, message);
				}
			}
		}
	};

	return {
		debug: (message, attributes) =>
			log("DEBUG", SEVERITY_DEBUG, message, attributes),
		info: (message, attributes) =>
			log("INFO", SEVERITY_INFO, message, attributes),
		warn: (message, attributes) =>
			log("WARN", SEVERITY_WARN, message, attributes),
		error: (message, attributes) =>
			log("ERROR", SEVERITY_ERROR, message, attributes),
	};
}
