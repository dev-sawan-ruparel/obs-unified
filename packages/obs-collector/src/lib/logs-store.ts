import type {
	LogRecord,
	LogsOverviewOptions,
	LogsOverviewResponse,
} from "@obs/types";

export class LogsStore {
	constructor(private readonly db: D1Database) {}

	async ingestBatch(logs: LogRecord[]): Promise<void> {
		if (logs.length === 0) return;

		const stmt = this.db.prepare(`
      INSERT INTO logs (
        log_id, trace_id, span_id, service_name, severity, severity_number,
        logger_name, message, attributes_json, occurred_at, received_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const batch = logs.map((l) =>
			stmt.bind(
				l.logId,
				l.traceId,
				l.spanId,
				l.serviceName,
				l.severity,
				l.severityNumber,
				l.loggerName,
				l.message,
				l.attributesJson,
				l.occurredAt,
				l.receivedAt,
				l.expiresAt,
			),
		);

		await this.db.batch(batch);
	}

	async getLogs(options: LogsOverviewOptions): Promise<LogsOverviewResponse> {
		let sql = `SELECT * FROM logs WHERE received_at >= datetime('now', '-${options.hours} hours')`;
		const params: any[] = [];

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

		sql += ` ORDER BY received_at DESC LIMIT ${options.limit || 100}`;

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
      FROM logs WHERE received_at >= datetime('now', '-${options.hours} hours')
      ${options.service ? "AND service_name = ?" : ""}
    `;
		const summaryParams = options.service ? [options.service] : [];
		const summaryResult =
			(await this.db
				.prepare(summarySql)
				.bind(...summaryParams)
				.first<any>()) || {};

		const logs = (results.results || []).map((r) => ({
			logId: r.log_id,
			traceId: r.trace_id,
			spanId: r.span_id,
			serviceName: r.service_name,
			severity: r.severity,
			severityNumber: r.severity_number,
			loggerName: r.logger_name,
			message: r.message,
			attributesJson: r.attributes_json,
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
			windowHours: options.hours,
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
