/**
 * Structured logger (from DecisionOps).
 * JSON-line output with OTEL severity numbers.
 * WARN/ERROR auto-attach to active span as events.
 * Now also forwards logs to the observability collector.
 */

import type { JsonValue, LogInput, LogPayload } from "@obs/types";
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
}

let logConfig: LoggerConfig | null = null;
let logBuffer: LogInput[] = [];

export function initLogger(config: LoggerConfig) {
	logConfig = config;
}

export async function flushLogs() {
	if (!logConfig || logBuffer.length === 0) return;

	const payload: LogPayload = { logs: [...logBuffer] };
	logBuffer = [];

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (logConfig.authToken) {
			headers["Authorization"] = `Bearer ${logConfig.authToken}`;
		}

		await fetch(`${logConfig.collectorUrl}/v1/logs`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
	} catch (err) {
		console.error("Failed to flush logs:", err);
	}
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

		// Add to remote collector buffer
		const logObj: LogInput = {
			severity,
			loggerName: name,
			message,
			attributes: (attributes as Record<string, JsonValue>) || undefined,
			occurredAt: record.ts,
			traceId: span?.traceId,
			spanId: span?.spanId,
			serviceName: logConfig?.serviceName,
		};
		logBuffer.push(logObj);
		if (logBuffer.length >= 20) {
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
