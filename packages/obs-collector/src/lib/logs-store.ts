import type {
	LogRecord,
	LogsOverviewOptions,
	LogsOverviewResponse,
} from "@obs/types";

/** Clamp an integer to a safe range */
const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
	const n = typeof value === "number" ? value : parseInt(String(value), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

export class LogsStore {
	constructor(private readonly db: D1Database) {}

	async ingestBatch(logs: LogRecord[]): Promise<void> {
		if (logs.length === 0) return;

		const stmt = this.db.prepare(`
      INSERT INTO logs (
        project_id, log_id, trace_id, span_id, service_name, severity, severity_number,
        logger_name, message, attributes_json, flags, dropped_attributes_count,
        occurred_at, received_at, expires_at, session_id, interaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const batch = logs.map((l) => {
			if (!l.projectId)
				throw new Error("LogsStore.ingestBatch: log.projectId is required");
			return stmt.bind(
				l.projectId,
				l.logId,
				l.traceId,
				l.spanId,
				l.serviceName,
				l.severity,
				l.severityNumber,
				l.loggerName,
				l.message,
				l.attributesJson,
				l.flags,
				l.droppedAttributesCount,
				l.occurredAt,
				l.receivedAt,
				l.expiresAt,
				l.sessionId ?? null,
				l.interactionId ?? null,
			);
		});

		await this.db.batch(batch);
	}

	async getLogs(options: LogsOverviewOptions): Promise<LogsOverviewResponse> {
		if (!options.projectId)
			throw new Error("LogsStore.getLogs: projectId is required");
		const hours = clampInt(options.hours, 1, 720, 24);
		const limit = clampInt(options.limit, 1, 1000, 100);

		let sql = `SELECT * FROM logs WHERE project_id = ? AND received_at >= datetime('now', '-' || ? || ' hours')`;
		const params: unknown[] = [options.projectId, hours];

		if (options.service) {
			sql += ` AND service_name = ?`;
			params.push(options.service);
		}
		if (options.severity) {
			sql += ` AND severity = ?`;
			params.push(options.severity);
		}
		if (options.traceId) {
			sql += ` AND trace_id = ?`;
			params.push(options.traceId);
		}
		if (options.search) {
			sql += ` AND message LIKE ?`;
			params.push(`%${options.search}%`);
		}

		sql += ` ORDER BY received_at DESC LIMIT ?`;
		params.push(limit);

		const results = await this.db
			.prepare(sql)
			.bind(...params)
			.all<any>();

		// Simple summary stats
		const summarySql = `
      SELECT
        COUNT(*) as totalLogs,
        SUM(CASE WHEN severity = 'ERROR' OR severity = 'FATAL' THEN 1 ELSE 0 END) as errorLogs,
        SUM(CASE WHEN severity = 'WARN' THEN 1 ELSE 0 END) as warnLogs
      FROM logs WHERE project_id = ? AND received_at >= datetime('now', '-' || ? || ' hours')
      ${options.service ? "AND service_name = ?" : ""}
    `;
		const summaryParams: unknown[] = [options.projectId, hours];
		if (options.service) summaryParams.push(options.service);
		const summaryResult =
			(await this.db
				.prepare(summarySql)
				.bind(...summaryParams)
				.first<any>()) || {};

		const logs: LogRecord[] = (results.results || []).map((r) => ({
			projectId: r.project_id ?? "default",
			logId: r.log_id,
			traceId: r.trace_id,
			spanId: r.span_id,
			serviceName: r.service_name,
			severity: r.severity,
			severityNumber: r.severity_number,
			loggerName: r.logger_name,
			message: r.message,
			attributesJson: r.attributes_json,
			flags: r.flags ?? 0,
			droppedAttributesCount: r.dropped_attributes_count ?? 0,
			occurredAt: r.occurred_at,
			receivedAt: r.received_at,
			expiresAt: r.expires_at,
		}));

		return {
			logs,
			summary: {
				totalLogs: summaryResult.totalLogs || 0,
				errorLogs: summaryResult.errorLogs || 0,
				warnLogs: summaryResult.warnLogs || 0,
			},
			windowHours: hours,
			timestamp: new Date().toISOString(),
		};
	}

	async purgeExpired(): Promise<number> {
		const { meta } = await this.db
			.prepare(`DELETE FROM logs WHERE expires_at < datetime('now')`)
			.run();
		return meta.changes;
	}
}
