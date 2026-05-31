import type {
	AICallRecord,
	AICallsOverviewOptions,
	AICallsOverviewResponse,
	AIEvaluationRecord,
	AIEvaluationSource,
	AIEvaluationsListOptions,
	AIEvaluationsListResponse,
	AISessionDetailResponse,
	AISessionSummary,
	AISessionsListOptions,
	AISessionsListResponse,
	AISpanRecord,
	AISpansOverviewOptions,
	AISpansOverviewResponse,
	JsonValue,
} from "@obs-unified/types";
import { computeCost } from "./ai-pricing";
import { parseJsonRecord } from "./json";
import type { SqlDb } from "./sql-db";

const attrNum = (
	attrs: Record<string, JsonValue>,
	key: string,
): number | null => {
	const v = attrs[key];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
};

const attrStr = (
	attrs: Record<string, JsonValue>,
	key: string,
): string | null => {
	const v = attrs[key];
	return typeof v === "string" && v.length > 0 ? v : null;
};

/**
 * Enrich a span's attributes with a computed `llm.cost.total_usd` when the
 * span has token counts but no reported cost. Mutates the passed attrs
 * object and returns the final cost (or null).
 */
const enrichCost = (attrs: Record<string, JsonValue>): number | null => {
	const existing = attrNum(attrs, "llm.cost.total_usd");
	if (existing !== null) return existing;
	const model = attrStr(attrs, "llm.model_name");
	const prompt = attrNum(attrs, "llm.token_count.prompt");
	const completion = attrNum(attrs, "llm.token_count.completion");
	if (prompt === null && completion === null) return null;
	const cost = computeCost(model, prompt, completion);
	if (cost === null) return null;
	attrs["llm.cost.total_usd"] = cost;
	attrs["llm.cost.computed"] = true;
	return cost;
};

export interface IngestEvaluation {
	projectId: string;
	evaluationId: string;
	traceId: string;
	spanId: string;
	name: string;
	score: number | null;
	label: string | null;
	explanation: string | null;
	source: AIEvaluationSource;
	metadataJson: string | null;
	createdAt: string;
	expiresAt: string;
}

/** Clamp an integer to a safe range */
const clampInt = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	const n = typeof value === "number" ? value : parseInt(String(value), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.max(min, Math.min(max, n));
};

interface AICallRow {
	project_id?: string;
	call_id: string;
	trace_id: string | null;
	span_id: string | null;
	service_name: string | null;
	model_name: string;
	provider: string;
	call_type: AICallRecord["callType"];
	request_json: string | null;
	response_json: string | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	total_cost_usd: number | null;
	latency_ms: number | null;
	is_error: number;
	error_message: string | null;
	occurred_at: string;
	received_at: string;
	expires_at: string;
	session_id: string | null;
	interaction_id: string | null;
}

interface AICallSummaryRow {
	totalCalls?: number;
	totalCostUsd?: number;
	totalPromptTokens?: number;
	totalCompletionTokens?: number;
	errorCalls?: number;
}

interface AISpanRow {
	trace_id: string;
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	span_name: string;
	span_kind: string;
	status_code: number | null;
	status_message: string | null;
	start_time: string;
	end_time: string | null;
	duration_ms: number | null;
	attributes_json: string | null;
	input_json: string | null;
	output_json: string | null;
	user_id?: string | null;
}

interface AISessionRow {
	session_id: string;
	user_id: string | null;
	span_count: number | null;
	llm_span_count: number | null;
	error_count: number | null;
	prompt_tokens: number | null;
	completion_tokens: number | null;
	cost_usd: number | null;
	first_span_at: string;
	last_span_at: string;
	trace_count: number | null;
}

interface AISessionPreviewRow {
	session_id: string;
	input_json: string | null;
}

interface AIEvaluationRow {
	evaluation_id: string;
	project_id: string;
	trace_id: string;
	span_id: string;
	name: string;
	score: number | null;
	label: string | null;
	explanation: string | null;
	source: AIEvaluationSource;
	metadata_json: string | null;
	created_at: string;
	expires_at: string;
}

export class AIStore {
	constructor(private readonly db: SqlDb) {}

	async ingestBatch(calls: AICallRecord[]): Promise<void> {
		if (calls.length === 0) return;

		const stmt = this.db.prepare(`
      INSERT INTO ai_calls (
        project_id, call_id, trace_id, span_id, service_name, model_name, provider, call_type,
        request_json, response_json, prompt_tokens, completion_tokens, total_cost_usd,
        latency_ms, is_error, error_message, occurred_at, received_at, expires_at,
        session_id, interaction_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
				c.sessionId ?? null,
				c.interactionId ?? null,
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
			.all<AICallRow>();

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
				.first<AICallSummaryRow>()) || {};

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
			// RFC 0006 — the rail's "Latest session" / "Click that caused
			// this trace" pivots both need these denormalized identity
			// columns, so they need to survive the overview projection.
			sessionId: r.session_id ?? null,
			interactionId: r.interaction_id ?? null,
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
		const { meta: payloadMeta } = await this.db
			.prepare(
				`DELETE FROM ai_span_payloads WHERE expires_at < datetime('now')`,
			)
			.run();
		const { meta: evalMeta } = await this.db
			.prepare(
				`DELETE FROM ai_span_evaluations WHERE expires_at < datetime('now')`,
			)
			.run();
		return (
			meta.changes + (payloadMeta?.changes ?? 0) + (evalMeta?.changes ?? 0)
		);
	}

	/**
	 * Query OpenInference-kind spans joined with their side-table payloads.
	 * Spans are identified by the presence of a span_kind row in
	 * ai_span_payloads (written by ai-span-payloads-processor on ingest).
	 */
	async getAISpans(
		options: AISpansOverviewOptions,
	): Promise<AISpansOverviewResponse> {
		if (!options.projectId)
			throw new Error("AIStore.getAISpans: projectId is required");
		const hours = clampInt(options.hours, 1, 720, 24);
		const limit = clampInt(options.limit, 1, 1000, 100);

		let sql = `
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
        p.output_json         AS output_json
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.received_at >= datetime('now', '-' || ? || ' hours')
    `;
		const params: unknown[] = [options.projectId, hours];

		if (options.kind) {
			sql += ` AND p.span_kind = ?`;
			params.push(options.kind);
		}
		if (options.service) {
			sql += ` AND s.service_name = ?`;
			params.push(options.service);
		}
		if (options.traceId) {
			sql += ` AND s.trace_id = ?`;
			params.push(options.traceId);
		}

		sql += ` ORDER BY s.start_time DESC LIMIT ?`;
		params.push(limit);

		const results = await this.db
			.prepare(sql)
			.bind(...params)
			.all<AISpanRow>();

		const spans: AISpanRecord[] = (results.results || []).map((r) => {
			const attrs = parseJsonRecord(r.attributes_json) as Record<
				string,
				JsonValue
			>;
			enrichCost(attrs);
			return {
				traceId: r.trace_id,
				spanId: r.span_id,
				parentSpanId: r.parent_span_id,
				serviceName: r.service_name,
				spanName: r.span_name,
				spanKind: r.span_kind,
				statusCode: r.status_code ?? 0,
				statusMessage: r.status_message,
				startTime: r.start_time,
				endTime: r.end_time ?? r.start_time,
				durationMs: r.duration_ms ?? 0,
				attributes: attrs,
				inputJson: r.input_json,
				outputJson: r.output_json,
			};
		});

		const byKind: Record<string, number> = {};
		let errorSpans = 0;
		for (const span of spans) {
			byKind[span.spanKind] = (byKind[span.spanKind] ?? 0) + 1;
			if (span.statusCode === 2) errorSpans++;
		}

		return {
			spans,
			summary: {
				totalSpans: spans.length,
				byKind,
				errorSpans,
			},
			windowHours: hours,
			timestamp: new Date().toISOString(),
		};
	}

	// ── Sessions ─────────────────────────────────────────────────────────

	/**
	 * List sessions with aggregated stats across all their AI spans. A
	 * "session" is any distinct non-null `session_id` stamped on an
	 * ai_span_payloads row.
	 */
	async listSessions(
		options: AISessionsListOptions,
	): Promise<AISessionsListResponse> {
		if (!options.projectId)
			throw new Error("AIStore.listSessions: projectId is required");
		const hours = clampInt(options.hours, 1, 720, 24);
		const limit = clampInt(options.limit, 1, 1000, 100);

		let sql = `
      SELECT
        p.session_id          AS session_id,
        MAX(p.user_id)        AS user_id,
        COUNT(*)              AS span_count,
        SUM(CASE WHEN p.span_kind = 'LLM' THEN 1 ELSE 0 END) AS llm_span_count,
        SUM(CASE WHEN s.status_code = 2 THEN 1 ELSE 0 END)   AS error_count,
        SUM(CAST(json_extract(s.attributes_json, '$."llm.token_count.prompt"') AS REAL))     AS prompt_tokens,
        SUM(CAST(json_extract(s.attributes_json, '$."llm.token_count.completion"') AS REAL)) AS completion_tokens,
        SUM(CAST(json_extract(s.attributes_json, '$."llm.cost.total_usd"') AS REAL))         AS cost_usd,
        MIN(s.start_time)     AS first_span_at,
        MAX(s.start_time)     AS last_span_at,
        COUNT(DISTINCT s.trace_id) AS trace_count
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.session_id IS NOT NULL
        AND p.received_at >= datetime('now', '-' || ? || ' hours')
    `;
		const params: unknown[] = [options.projectId, hours];
		if (options.userId) {
			sql += ` AND p.user_id = ?`;
			params.push(options.userId);
		}
		sql += ` GROUP BY p.session_id ORDER BY last_span_at DESC LIMIT ?`;
		params.push(limit);

		const results = await this.db
			.prepare(sql)
			.bind(...params)
			.all<AISessionRow>();

		// Second query: most recent input per session, for list preview.
		// Bound to the session IDs we actually display — without the IN-filter
		// this scans every payload row in the window regardless of result size.
		const sessionIds = (results.results ?? []).map((r) => r.session_id);
		const previewRows =
			sessionIds.length === 0
				? { results: [] as AISessionPreviewRow[] }
				: await this.db
						.prepare(
							`
      SELECT p.session_id, p.input_json, s.start_time
      FROM ai_span_payloads p
      INNER JOIN telemetry_spans s
        ON s.trace_id = p.trace_id AND s.span_id = p.span_id
      WHERE p.project_id = ?
        AND p.session_id IS NOT NULL
        AND p.session_id IN (${sessionIds.map(() => "?").join(", ")})
        AND p.received_at >= datetime('now', '-' || ? || ' hours')
        AND p.input_json IS NOT NULL
      ORDER BY s.start_time DESC
    `,
						)
						.bind(options.projectId, ...sessionIds, hours)
						.all<AISessionPreviewRow>();
		const previewBySession = new Map<string, string>();
		for (const row of previewRows.results || []) {
			if (!previewBySession.has(row.session_id)) {
				const raw = typeof row.input_json === "string" ? row.input_json : "";
				previewBySession.set(
					row.session_id,
					raw.length > 200 ? `${raw.slice(0, 200)}…` : raw,
				);
			}
		}

		const sessions: AISessionSummary[] = (results.results || []).map((r) => {
			const promptTokens = r.prompt_tokens ?? 0;
			const completionTokens = r.completion_tokens ?? 0;
			const totalCostUsd = r.cost_usd ?? 0;
			// If no cost was reported, try computing on the fly. We don't have
			// model here cheaply; leave as reported sum and rely on the detail
			// endpoint to recompute per-span.
			return {
				sessionId: r.session_id,
				userId: r.user_id ?? null,
				spanCount: r.span_count ?? 0,
				llmSpanCount: r.llm_span_count ?? 0,
				errorCount: r.error_count ?? 0,
				totalPromptTokens: promptTokens,
				totalCompletionTokens: completionTokens,
				totalCostUsd,
				firstSpanAt: r.first_span_at,
				lastSpanAt: r.last_span_at,
				traceCount: r.trace_count ?? 0,
				lastInputPreview: previewBySession.get(r.session_id) ?? null,
			};
		});

		return {
			sessions,
			windowHours: hours,
			timestamp: new Date().toISOString(),
		};
	}

	/** Full detail for a single session: all spans + all evaluations. */
	async getSession(
		projectId: string,
		sessionId: string,
	): Promise<AISessionDetailResponse> {
		if (!projectId)
			throw new Error("AIStore.getSession: projectId is required");
		if (!sessionId)
			throw new Error("AIStore.getSession: sessionId is required");

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
		const results = await this.db
			.prepare(sql)
			.bind(projectId, sessionId)
			.all<AISpanRow>();

		let userId: string | null = null;
		let totalPromptTokens = 0;
		let totalCompletionTokens = 0;
		let totalCostUsd = 0;
		let errorCount = 0;
		let firstSpanAt: string | null = null;
		let lastSpanAt: string | null = null;

		const spans: AISpanRecord[] = (results.results || []).map((r) => {
			const attrs = parseJsonRecord(r.attributes_json) as Record<
				string,
				JsonValue
			>;
			const cost = enrichCost(attrs);
			if (!userId && r.user_id) userId = r.user_id;
			totalPromptTokens += attrNum(attrs, "llm.token_count.prompt") ?? 0;
			totalCompletionTokens +=
				attrNum(attrs, "llm.token_count.completion") ?? 0;
			if (cost !== null) totalCostUsd += cost;
			if (r.status_code === 2) errorCount++;
			if (!firstSpanAt || r.start_time < firstSpanAt)
				firstSpanAt = r.start_time;
			if (!lastSpanAt || r.start_time > lastSpanAt) lastSpanAt = r.start_time;
			return {
				traceId: r.trace_id,
				spanId: r.span_id,
				parentSpanId: r.parent_span_id,
				serviceName: r.service_name,
				spanName: r.span_name,
				spanKind: r.span_kind,
				statusCode: r.status_code ?? 0,
				statusMessage: r.status_message,
				startTime: r.start_time,
				endTime: r.end_time ?? r.start_time,
				durationMs: r.duration_ms ?? 0,
				attributes: attrs,
				inputJson: r.input_json,
				outputJson: r.output_json,
			};
		});

		// Pull all evaluations for spans in this session.
		let evaluations: AIEvaluationRecord[] = [];
		if (spans.length > 0) {
			const placeholders = spans.map(() => "(?, ?)").join(", ");
			const bindings: unknown[] = [projectId];
			for (const span of spans) {
				bindings.push(span.traceId, span.spanId);
			}
			const evalSql = `
        SELECT * FROM ai_span_evaluations
        WHERE project_id = ?
          AND (trace_id, span_id) IN (${placeholders})
        ORDER BY created_at DESC
      `;
			const evalResults = await this.db
				.prepare(evalSql)
				.bind(...bindings)
				.all<AIEvaluationRow>();
			evaluations = (evalResults.results || []).map((r) => ({
				evaluationId: r.evaluation_id,
				projectId: r.project_id,
				traceId: r.trace_id,
				spanId: r.span_id,
				name: r.name,
				score: r.score,
				label: r.label,
				explanation: r.explanation,
				source: r.source as AIEvaluationSource,
				metadata: parseJsonRecord(r.metadata_json),
				createdAt: r.created_at,
				expiresAt: r.expires_at,
			}));
		}

		return {
			sessionId,
			userId,
			spans,
			evaluations,
			summary: {
				spanCount: spans.length,
				totalPromptTokens,
				totalCompletionTokens,
				totalCostUsd,
				errorCount,
				firstSpanAt,
				lastSpanAt,
			},
			timestamp: new Date().toISOString(),
		};
	}

	// ── Evaluations ──────────────────────────────────────────────────────

	async ingestEvaluations(evaluations: IngestEvaluation[]): Promise<void> {
		if (evaluations.length === 0) return;
		const stmt = this.db.prepare(`
      INSERT INTO ai_span_evaluations (
        evaluation_id, project_id, trace_id, span_id, name,
        score, label, explanation, source, metadata_json,
        created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
		await this.db.batch(
			evaluations.map((e) =>
				stmt.bind(
					e.evaluationId,
					e.projectId,
					e.traceId,
					e.spanId,
					e.name,
					e.score,
					e.label,
					e.explanation,
					e.source,
					e.metadataJson,
					e.createdAt,
					e.expiresAt,
				),
			),
		);
	}

	async listEvaluations(
		options: AIEvaluationsListOptions,
	): Promise<AIEvaluationsListResponse> {
		if (!options.projectId)
			throw new Error("AIStore.listEvaluations: projectId is required");
		const limit = clampInt(options.limit, 1, 1000, 200);

		let sql = `SELECT * FROM ai_span_evaluations WHERE project_id = ?`;
		const params: unknown[] = [options.projectId];

		if (options.traceId) {
			sql += ` AND trace_id = ?`;
			params.push(options.traceId);
		}
		if (options.spanId) {
			sql += ` AND span_id = ?`;
			params.push(options.spanId);
		}
		if (options.name) {
			sql += ` AND name = ?`;
			params.push(options.name);
		}

		sql += ` ORDER BY created_at DESC LIMIT ?`;
		params.push(limit);

		const results = await this.db
			.prepare(sql)
			.bind(...params)
			.all<AIEvaluationRow>();

		const evaluations: AIEvaluationRecord[] = (results.results || []).map(
			(r) => ({
				evaluationId: r.evaluation_id,
				projectId: r.project_id,
				traceId: r.trace_id,
				spanId: r.span_id,
				name: r.name,
				score: r.score,
				label: r.label,
				explanation: r.explanation,
				source: r.source as AIEvaluationSource,
				metadata: parseJsonRecord(r.metadata_json),
				createdAt: r.created_at,
				expiresAt: r.expires_at,
			}),
		);

		return {
			evaluations,
			timestamp: new Date().toISOString(),
		};
	}
}
