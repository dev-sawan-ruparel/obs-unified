import type {
	AICallRecord,
	AICallsOverviewOptions,
	AICallsOverviewResponse,
} from "@obsunified/types";
import { dialectFor, type SqlDb } from "../sql-db";
import type { AICallRow, AICallSummaryRow } from "./types";
import { clampInt } from "./types";

export async function ingestAICallBatch(
	db: SqlDb,
	calls: AICallRecord[],
): Promise<void> {
	if (calls.length === 0) return;

	const stmt = db.prepare(`
      INSERT OR IGNORE INTO ai_calls (
        project_id, call_id, trace_id, span_id, service_name, model_name, provider, call_type,
        request_json, response_json, prompt_tokens, completion_tokens, total_cost_usd,
        latency_ms, is_error, error_message, occurred_at, received_at, expires_at,
        session_id, interaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

	const batch = calls.map((call) => {
		if (!call.projectId)
			throw new Error("AIStore.ingestBatch: call.projectId is required");
		return stmt.bind(
			call.projectId,
			call.callId,
			call.traceId,
			call.spanId,
			call.serviceName,
			call.modelName,
			call.provider,
			call.callType,
			call.requestJson,
			call.responseJson,
			call.promptTokens,
			call.completionTokens,
			call.totalCostUsd,
			call.latencyMs,
			call.isError ? 1 : 0,
			call.errorMessage,
			call.occurredAt,
			call.receivedAt,
			call.expiresAt,
			call.sessionId ?? null,
			call.interactionId ?? null,
		);
	});

	await db.batch(batch);
}

function mapAICallRow(row: AICallRow): AICallRecord {
	return {
		projectId: row.project_id ?? "default",
		callId: row.call_id,
		traceId: row.trace_id,
		spanId: row.span_id,
		serviceName: row.service_name,
		modelName: row.model_name,
		provider: row.provider,
		callType: row.call_type,
		requestJson: row.request_json,
		responseJson: row.response_json,
		promptTokens: row.prompt_tokens,
		completionTokens: row.completion_tokens,
		totalCostUsd: row.total_cost_usd,
		latencyMs: row.latency_ms,
		isError: row.is_error === 1 || row.is_error === true,
		errorMessage: row.error_message,
		occurredAt: row.occurred_at,
		receivedAt: row.received_at,
		expiresAt: row.expires_at,
		sessionId: row.session_id ?? null,
		interactionId: row.interaction_id ?? null,
	};
}

/** One call by id, scoped to the project; `null` when absent. */
export async function getAICallById(
	db: SqlDb,
	projectId: string,
	callId: string,
): Promise<AICallRecord | null> {
	if (!projectId) throw new Error("AIStore.getAICall: projectId is required");
	const row = await db
		.prepare(
			`SELECT * FROM ai_calls WHERE project_id = ? AND call_id = ? LIMIT 1`,
		)
		.bind(projectId, callId)
		.first<AICallRow>();
	return row ? mapAICallRow(row) : null;
}

export async function getAICallsOverview(
	db: SqlDb,
	options: AICallsOverviewOptions,
): Promise<AICallsOverviewResponse> {
	if (!options.projectId)
		throw new Error("AIStore.getAICalls: projectId is required");
	const dialect = dialectFor(db);
	const hours = clampInt(options.hours, 1, 720, 24);
	const limit = clampInt(options.limit, 1, 1000, 100);

	let sql = `SELECT * FROM ai_calls WHERE project_id = ? AND received_at >= ${dialect.sinceHours("?")}`;
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

	const results = await db
		.prepare(sql)
		.bind(...params)
		.all<AICallRow>();

	const summarySql = `
      SELECT
        COUNT(*) as totalCalls,
        SUM(total_cost_usd) as totalCostUsd,
        SUM(prompt_tokens) as totalPromptTokens,
        SUM(completion_tokens) as totalCompletionTokens,
        SUM(CASE WHEN is_error THEN 1 ELSE 0 END) as errorCalls
      FROM ai_calls WHERE project_id = ? AND received_at >= ${dialect.sinceHours("?")}
      ${options.service ? "AND service_name = ?" : ""}
    `;
	const summaryParams: unknown[] = [options.projectId, hours];
	if (options.service) summaryParams.push(options.service);
	const summaryResult =
		(await db
			.prepare(summarySql)
			.bind(...summaryParams)
			.first<AICallSummaryRow>()) || {};

	const calls: AICallRecord[] = (results.results || []).map(mapAICallRow);

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
