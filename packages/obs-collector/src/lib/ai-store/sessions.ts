import type {
	AISessionDetailResponse,
	AISessionSummary,
	AISessionsListOptions,
	AISessionsListResponse,
	AISpanRecord,
	JsonValue,
} from "@obs-unified/types";
import { parseJsonRecord } from "../json";
import { dialectFor, type SqlDb } from "../sql-db";
import { mapEvaluationRows } from "./evaluations";
import { attrNum, enrichCost } from "./helpers";
import type {
	AIEvaluationRow,
	AISessionPreviewRow,
	AISessionRow,
	AISpanRow,
} from "./types";
import { clampInt } from "./types";

export async function listAISessions(
	db: SqlDb,
	options: AISessionsListOptions,
): Promise<AISessionsListResponse> {
	if (!options.projectId)
		throw new Error("AIStore.listSessions: projectId is required");
	const dialect = dialectFor(db);
	const hours = clampInt(options.hours, 1, 720, 24);
	const limit = clampInt(options.limit, 1, 1000, 100);

	let sql = `
      SELECT
        p.session_id          AS session_id,
        MAX(p.user_id)        AS user_id,
        COUNT(*)              AS span_count,
        SUM(CASE WHEN p.span_kind = 'LLM' THEN 1 ELSE 0 END) AS llm_span_count,
        SUM(CASE WHEN s.status_code = 2 THEN 1 ELSE 0 END)   AS error_count,
        SUM(CAST(${dialect.jsonText("s.attributes_json", '$."llm.token_count.prompt"')} AS REAL))     AS prompt_tokens,
        SUM(CAST(${dialect.jsonText("s.attributes_json", '$."llm.token_count.completion"')} AS REAL)) AS completion_tokens,
        SUM(CAST(${dialect.jsonText("s.attributes_json", '$."llm.cost.total_usd"')} AS REAL))         AS cost_usd,
        MIN(s.start_time)     AS first_span_at,
        MAX(s.start_time)     AS last_span_at,
        COUNT(DISTINCT s.trace_id) AS trace_count
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.session_id IS NOT NULL
        AND p.received_at >= ${dialect.sinceHours("?")}
    `;
	const params: unknown[] = [options.projectId, hours];
	if (options.userId) {
		sql += ` AND p.user_id = ?`;
		params.push(options.userId);
	}
	sql += ` GROUP BY p.session_id ORDER BY last_span_at DESC LIMIT ?`;
	params.push(limit);

	const results = await db
		.prepare(sql)
		.bind(...params)
		.all<AISessionRow>();
	const sessionRows = results.results || [];
	const previewBySession = await loadSessionPreviews(
		db,
		dialect,
		options.projectId,
		hours,
		sessionRows.map((row) => row.session_id),
	);

	const sessions: AISessionSummary[] = sessionRows.map((row) => ({
		sessionId: row.session_id,
		userId: row.user_id ?? null,
		spanCount: row.span_count ?? 0,
		llmSpanCount: row.llm_span_count ?? 0,
		errorCount: row.error_count ?? 0,
		totalPromptTokens: row.prompt_tokens ?? 0,
		totalCompletionTokens: row.completion_tokens ?? 0,
		totalCostUsd: row.cost_usd ?? 0,
		firstSpanAt: row.first_span_at,
		lastSpanAt: row.last_span_at,
		traceCount: row.trace_count ?? 0,
		lastInputPreview: previewBySession.get(row.session_id) ?? null,
	}));

	return {
		sessions,
		windowHours: hours,
		timestamp: new Date().toISOString(),
	};
}

export async function getAISessionDetail(
	db: SqlDb,
	projectId: string,
	sessionId: string,
): Promise<AISessionDetailResponse> {
	if (!projectId) throw new Error("AIStore.getSession: projectId is required");
	if (!sessionId) throw new Error("AIStore.getSession: sessionId is required");

	const sql = `
      SELECT
        s.trace_id            AS trace_id,
        s.span_id             AS span_id,
        s.parent_span_id      AS parent_span_id,
        s.service_name        AS service_name,
        s.span_name           AS span_name,
        s.status_code         AS status_code,
        s.status_message      AS status_message,
        s.start_time          AS start_time,
        s.end_time            AS end_time,
        s.duration_ms         AS duration_ms,
        s.attributes_json     AS attributes_json,
        p.span_kind           AS span_kind,
        p.input_json          AS input_json,
        p.output_json         AS output_json,
        p.user_id             AS user_id
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ? AND p.session_id = ?
      ORDER BY s.start_time ASC
      LIMIT 1000
    `;
	const results = await db
		.prepare(sql)
		.bind(projectId, sessionId)
		.all<AISpanRow>();

	const state = {
		userId: null as string | null,
		totalPromptTokens: 0,
		totalCompletionTokens: 0,
		totalCostUsd: 0,
		errorCount: 0,
		firstSpanAt: null as string | null,
		lastSpanAt: null as string | null,
	};

	const spans: AISpanRecord[] = (results.results || []).map((row) =>
		mapSessionSpan(row, state),
	);
	const evaluations = await loadSessionEvaluations(db, projectId, spans);

	return {
		sessionId,
		userId: state.userId,
		spans,
		evaluations,
		summary: {
			spanCount: spans.length,
			totalPromptTokens: state.totalPromptTokens,
			totalCompletionTokens: state.totalCompletionTokens,
			totalCostUsd: state.totalCostUsd,
			errorCount: state.errorCount,
			firstSpanAt: state.firstSpanAt,
			lastSpanAt: state.lastSpanAt,
		},
		timestamp: new Date().toISOString(),
	};
}

async function loadSessionPreviews(
	db: SqlDb,
	dialect: ReturnType<typeof dialectFor>,
	projectId: string,
	hours: number,
	sessionIds: string[],
) {
	const previewBySession = new Map<string, string>();
	if (sessionIds.length === 0) return previewBySession;

	const previewRows = await db
		.prepare(
			`
      SELECT p.session_id, p.input_json, s.start_time
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.session_id IS NOT NULL
        AND p.session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND p.received_at >= ${dialect.sinceHours("?")}
        AND p.input_json IS NOT NULL
      ORDER BY s.start_time DESC
      LIMIT ?
    `,
		)
		.bind(projectId, ...sessionIds, hours, sessionIds.length * 5)
		.all<AISessionPreviewRow>();

	for (const row of previewRows.results || []) {
		if (!previewBySession.has(row.session_id)) {
			const raw = typeof row.input_json === "string" ? row.input_json : "";
			previewBySession.set(
				row.session_id,
				raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
			);
		}
	}

	return previewBySession;
}

function mapSessionSpan(
	row: AISpanRow,
	state: {
		userId: string | null;
		totalPromptTokens: number;
		totalCompletionTokens: number;
		totalCostUsd: number;
		errorCount: number;
		firstSpanAt: string | null;
		lastSpanAt: string | null;
	},
): AISpanRecord {
	const attrs = parseJsonRecord(row.attributes_json) as Record<
		string,
		JsonValue
	>;
	const cost = enrichCost(attrs);
	if (!state.userId && row.user_id) state.userId = row.user_id;
	state.totalPromptTokens += attrNum(attrs, "llm.token_count.prompt") ?? 0;
	state.totalCompletionTokens +=
		attrNum(attrs, "llm.token_count.completion") ?? 0;
	if (cost !== null) state.totalCostUsd += cost;
	if (row.status_code === 2) state.errorCount++;
	if (!state.firstSpanAt || row.start_time < state.firstSpanAt) {
		state.firstSpanAt = row.start_time;
	}
	if (!state.lastSpanAt || row.start_time > state.lastSpanAt) {
		state.lastSpanAt = row.start_time;
	}

	return {
		traceId: row.trace_id,
		spanId: row.span_id,
		parentSpanId: row.parent_span_id,
		serviceName: row.service_name,
		spanName: row.span_name,
		spanKind: row.span_kind,
		statusCode: row.status_code ?? 0,
		statusMessage: row.status_message,
		startTime: row.start_time,
		endTime: row.end_time ?? row.start_time,
		durationMs: row.duration_ms ?? 0,
		attributes: attrs,
		inputJson: row.input_json,
		outputJson: row.output_json,
	};
}

async function loadSessionEvaluations(
	db: SqlDb,
	projectId: string,
	spans: AISpanRecord[],
) {
	if (spans.length === 0) return [];

	const placeholders = spans.map(() => "(?, ?)").join(", ");
	const bindings: unknown[] = [projectId];
	for (const span of spans) {
		bindings.push(span.traceId, span.spanId);
	}
	const sql = `
        SELECT * FROM ai_span_evaluations
        WHERE project_id = ?
          AND (trace_id, span_id) IN (${placeholders})
        ORDER BY created_at DESC
      `;
	const results = await db
		.prepare(sql)
		.bind(...bindings)
		.all<AIEvaluationRow>();
	return mapEvaluationRows(results.results || []);
}
