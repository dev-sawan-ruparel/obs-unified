import type { LogPayload, LogRecord } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { LogsStore } from "../lib/logs-store";

export const logsReceiverPlugin: CollectorPlugin = {
	name: "logs-receiver",
	register(app, runtime) {
		app.post("/v1/logs", async (c) => {
			let payload: LogPayload;
			try {
				payload = await c.req.json<LogPayload>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			if (!payload.logs || !Array.isArray(payload.logs)) {
				return c.json({ error: "Missing logs array" }, 400);
			}
			if (payload.logs.length > 1000) {
				return c.json({ error: `Too many logs: ${payload.logs.length} (max 1000)` }, 413);
			}
			const store = new LogsStore(c.env.DB);

			const retentionHours = parseInt(c.env.RETENTION_HOURS || "72", 10);
			const now = new Date();
			const nowStr = now.toISOString();
			const expires = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			const records: LogRecord[] = payload.logs.map((log) => ({
				logId: crypto.randomUUID(),
				traceId: log.traceId || null,
				spanId: log.spanId || null,
				serviceName: log.serviceName || null,
				severity: log.severity,
				severityNumber: getSeverityNumber(log.severity),
				loggerName: log.loggerName || null,
				message: log.message,
				attributesJson: log.attributes ? JSON.stringify(log.attributes) : null,
				occurredAt: log.occurredAt || nowStr,
				receivedAt: nowStr,
				expiresAt: expires,
			}));

			await store.ingestBatch(records);

			return c.json({ accepted: records.length }, 202);
		});

		app.get("/internal/logs/overview", async (c) => {
			const store = new LogsStore(c.env.DB);
			const query = c.req.query();
			const hours = parseInt(query.hours || "24", 10);

			const response = await store.getLogs({
				hours,
				service: query.service,
				severity: query.severity as any,
				traceId: query.traceId,
				limit: parseInt(query.limit || "100", 10),
				search: query.search,
			});

			return c.json(response);
		});
	},
};

function getSeverityNumber(severity: string): number {
	switch (severity) {
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
		default:
			return 9;
	}
}
