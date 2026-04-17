import type {
	AICallRecord,
	AICallsOverviewOptions,
	AICallsOverviewResponse,
} from "@obs/types";

/** Clamp an integer to a safe range */
const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
	const n = typeof value === "number" ? value : parseInt(String(value), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

export class AIStore {
	constructor(private readonly db: D1Database) {}

	async ingestBatch(calls: AICallRecord[]): Promise<void> {
		if (calls.length === 0) return;

		const stmt = this.db.prepare(`
      INSERT INTO ai_calls (
        project_id, call_id, trace_id, span_id, service_name, model_name, provider, call_type,
        request_json, response_json, prompt_tokens, completion_tokens, total_cost_usd,
        latency_ms, is_error, error_message, occurred_at, received_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

		const batch = calls.map((c) => {
			if (!c.projectId)
				throw new Error("AIStore.ingestBatch: call.projectId is required");
			return stmt.bind(
				c.projectId,
				c.callId,
				c.traceId,
				c.spanId,
				c.serviceName,
				c.modelName,
				c.provider,
				c.callType,
				c.requestJson,
				c.responseJson,
				c.promptTokens,
				c.completionTokens,
				c.totalCostUsd,
				c.latencyMs,
				c.isError ? 1 : 0,
				c.errorMessage,
				c.occurredAt,
				c.receivedAt,
				c.expiresAt,
			);
		});

		await this.db.batch(batch);
	}

	async getAICalls(
		options: AICallsOverviewOptions,
	): Promise<AICallsOverviewResponse> {
		if (!options.projectId)
			throw new Error("AIStore.getAICalls: projectId is required");
		const hours = clampInt(options.hours, 1, 720, 24);
		const limit = clampInt(options.limit, 1, 1000, 100);

		let sql = `SELECT * FROM ai_calls WHERE project_id = ? AND received_at >= datetime('now', '-' || ? || ' hours')`;
		const params: unknown[] = [options.projectId, hours];

		if (options.service) {
			sql += ` AND service_name = ?`;
			params.push(options.service);
		}
		if (options.model) {
			sql += ` AND model_name = ?`;
			params.push(options.model);
		}
		if (options.isError !== undefined) {
			sql += ` AND is_error = ?`;
			params.push(options.isError ? 1 : 0);
		}
		if (options.traceId) {
			sql += ` AND trace_id = ?`;
			params.push(options.traceId);
		}

		sql += ` ORDER BY received_at DESC LIMIT ?`;
		params.push(limit);

		const results = await this.db
			.prepare(sql)
			.bind(...params)
			.all<any>();

		const summarySql = `
      SELECT
        COUNT(*) as totalCalls,
        SUM(total_cost_usd) as totalCostUsd,
        SUM(prompt_tokens) as totalPromptTokens,
        SUM(completion_tokens) as totalCompletionTokens,
        SUM(is_error) as errorCalls
      FROM ai_calls WHERE project_id = ? AND received_at >= datetime('now', '-' || ? || ' hours')
      ${options.service ? "AND service_name = ?" : ""}
    `;
		const summaryParams: unknown[] = [options.projectId, hours];
		if (options.service) summaryParams.push(options.service);
		const summaryResult =
			(await this.db
				.prepare(summarySql)
				.bind(...summaryParams)
				.first<any>()) || {};

		const calls: AICallRecord[] = (results.results || []).map((r) => ({
			projectId: r.project_id ?? "default",
			callId: r.call_id,
			traceId: r.trace_id,
			spanId: r.span_id,
			serviceName: r.service_name,
			modelName: r.model_name,
			provider: r.provider,
			callType: r.call_type,
			requestJson: r.request_json,
			responseJson: r.response_json,
			promptTokens: r.prompt_tokens,
			completionTokens: r.completion_tokens,
			totalCostUsd: r.total_cost_usd,
			latencyMs: r.latency_ms,
			isError: r.is_error === 1,
			errorMessage: r.error_message,
			occurredAt: r.occurred_at,
			receivedAt: r.received_at,
			expiresAt: r.expires_at,
		}));

		return {
			calls,
			summary: {
				totalCalls: summaryResult.totalCalls || 0,
				totalCostUsd: summaryResult.totalCostUsd || 0,
				totalPromptTokens: summaryResult.totalPromptTokens || 0,
				totalCompletionTokens: summaryResult.totalCompletionTokens || 0,
				errorCalls: summaryResult.errorCalls || 0,
			},
			windowHours: hours,
			timestamp: new Date().toISOString(),
		};
	}

	async purgeExpired(): Promise<number> {
		const { meta } = await this.db
			.prepare(`DELETE FROM ai_calls WHERE expires_at < datetime('now')`)
			.run();
		return meta.changes;
	}
}
