import type { LogRecord, LogSeverity } from "@obsunified/types";
import { getConfiguredRetentionHours } from "@obsunified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { LogsStore } from "../lib/logs-store";
import { sqlDbFor } from "../lib/sql-db";
import { logToTailEvent, publishTail } from "../lib/tail-publisher";
import {
	type DecodedLogRecord,
	decodeLogsRequest,
	OtlpDecodeError,
	type ReadBodyResult,
	readOtlpBody,
} from "../otlp/decode";
import { logsResponse, otlpRetryableError } from "../otlp/response";
import { getProjectId } from "./_context";

const MAX_LOGS_PER_REQUEST = 1000;

export const logsReceiverPlugin: CollectorPlugin = {
	name: "logs-receiver",
	register(app, runtime) {
		app.post("/v1/logs", async (c) => {
			const projectId = getProjectId(c);

			let body: ReadBodyResult;
			try {
				body = await readOtlpBody(c);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			let decoded: DecodedLogRecord[];
			try {
				decoded = decodeLogsRequest(body);
			} catch (err) {
				if (err instanceof OtlpDecodeError) {
					return c.json({ error: err.message }, err.status);
				}
				throw err;
			}

			let rejected = 0;
			if (decoded.length > MAX_LOGS_PER_REQUEST) {
				rejected = decoded.length - MAX_LOGS_PER_REQUEST;
				decoded = decoded.slice(0, MAX_LOGS_PER_REQUEST);
			}

			const store = new LogsStore(sqlDbFor(c.env));
			const retentionHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const now = new Date();
			const nowStr = now.toISOString();
			const expires = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			const records: LogRecord[] = decoded.map((d) => {
				const sessionId =
					d.attributes &&
					typeof d.attributes["session.id"] === "string" &&
					(d.attributes["session.id"] as string).length > 0
						? (d.attributes["session.id"] as string)
						: null;
				// RFC 0004 — denormalize obs.interaction.id from log
				// attributes when the producer stamped it (telemetry-sdk's
				// logger inherits the active span's attribute).
				const interactionId =
					d.attributes &&
					typeof d.attributes["obs.interaction.id"] === "string" &&
					(d.attributes["obs.interaction.id"] as string).length > 0
						? (d.attributes["obs.interaction.id"] as string)
						: null;
				return {
					projectId,
					logId: crypto.randomUUID(),
					traceId: d.traceId,
					spanId: d.spanId,
					serviceName: d.serviceName,
					severity: d.severity,
					severityNumber: d.severityNumber || severityToNumber(d.severity),
					loggerName: d.loggerName,
					message: d.message,
					attributesJson: d.attributes ? JSON.stringify(d.attributes) : null,
					flags: d.flags,
					droppedAttributesCount: d.droppedAttributesCount,
					occurredAt: d.occurredAt,
					receivedAt: nowStr,
					expiresAt: expires,
					sessionId,
					interactionId,
				};
			});

			try {
				await runtime.withChildSpan("logs.ingest", async (span) => {
					span.setAttribute("logs.records_received", decoded.length + rejected);
					span.setAttribute("logs.records_rejected", rejected);
					span.setAttribute("logs.records_inserted", records.length);
					span.setAttribute("project.id", projectId);
					await store.ingestBatch(records);
				});
			} catch (err) {
				runtime.logger.error("[/v1/logs] storage error", {
					project_id: projectId,
					error: err instanceof Error ? err.message : String(err),
				});
				return otlpRetryableError(c, 503, "Storage temporarily unavailable");
			}

			if (records.length > 0 && c.env.TAIL_HUB) {
				const events = records.map(logToTailEvent);
				c.executionCtx.waitUntil(publishTail(c.env, events));
			}

			if (rejected > 0) {
				return logsResponse(c, body.wireFormat, {
					rejected,
					errorMessage: `Batch exceeded ${MAX_LOGS_PER_REQUEST}-record cap; ${rejected} record(s) dropped`,
				});
			}
			return logsResponse(c, body.wireFormat);
		});

		app.get("/internal/logs/overview", async (c) => {
			const projectId = getProjectId(c);
			const store = new LogsStore(sqlDbFor(c.env));
			const query = c.req.query();
			const hours = parseInt(query.hours || "24", 10);

			const response = await store.getLogs({
				projectId,
				hours,
				service: query.service,
				severity: query.severity as LogSeverity | undefined,
				traceId: query.traceId,
				limit: parseInt(query.limit || "100", 10),
				search: query.search,
			});

			return c.json(response);
		});
	},
};

const severityToNumber = (s: LogSeverity): number => {
	switch (s) {
		case "DEBUG":
			return 5;
		case "INFO":
			return 9;
		case "WARN":
			return 13;
		case "ERROR":
			return 17;
		case "FATAL":
			return 21;
	}
};
