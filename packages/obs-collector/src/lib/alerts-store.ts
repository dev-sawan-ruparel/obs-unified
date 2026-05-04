import type {
	AlertChannel,
	AlertComparison,
	AlertEvaluation,
	AlertEvaluationRow,
	AlertQuery,
	AlertQueryAI,
	AlertQueryLogs,
	AlertQuerySpans,
	AlertQueryUsage,
	AlertRule,
	AlertRuleInput,
	AlertRuleRow,
	AlertSignal,
	AlertState,
	AlertStateRow,
	LogSeverity,
} from "@obs/types";
import { randomHex } from "./hash";
import type { SqlDb } from "./sql-db";

const rowToRule = (row: AlertRuleRow, state?: AlertStateRow): AlertRule => ({
	id: row.id,
	projectId: row.project_id,
	name: row.name,
	signal: row.signal,
	query: JSON.parse(row.query_json) as AlertQuery,
	threshold: row.threshold,
	windowMins: row.window_mins,
	comparison: row.comparison,
	channels: JSON.parse(row.channels_json) as AlertChannel[],
	enabled: row.enabled === 1,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	analysisId: row.analysis_id ?? null,
	currentState: state?.current_state,
	lastStateChange: state?.last_state_change ?? null,
});

const rowToEvaluation = (row: AlertEvaluationRow): AlertEvaluation => ({
	id: row.id,
	ruleId: row.rule_id,
	projectId: row.project_id,
	evaluatedAt: row.evaluated_at,
	value: row.value,
	state: row.state,
	notified: row.notified === 1,
});

const windowCutoffIso = (windowMins: number): string =>
	new Date(Date.now() - windowMins * 60 * 1000).toISOString();

const SIGNALS: AlertSignal[] = ["spans", "logs", "usage", "ai"];
const COMPARISONS: AlertComparison[] = [">", ">=", "<", "<="];

export function compareValue(
	value: number,
	threshold: number,
	comparison: AlertComparison,
): boolean {
	switch (comparison) {
		case ">":
			return value > threshold;
		case ">=":
			return value >= threshold;
		case "<":
			return value < threshold;
		case "<=":
			return value <= threshold;
	}
}

export class AlertsStore {
	constructor(private readonly db: SqlDb) {}

	validateInput(input: AlertRuleInput): void {
		if (!input.name?.trim()) throw new Error("name is required");
		if (!SIGNALS.includes(input.signal))
			throw new Error(`signal must be one of: ${SIGNALS.join(", ")}`);
		if (!Number.isFinite(input.threshold))
			throw new Error("threshold must be a finite number");
		if (!Number.isFinite(input.windowMins) || input.windowMins < 1)
			throw new Error("windowMins must be >= 1");
		if (!COMPARISONS.includes(input.comparison))
			throw new Error(`comparison must be one of: ${COMPARISONS.join(", ")}`);
		if (!Array.isArray(input.channels) || input.channels.length === 0)
			throw new Error("at least one channel is required");
		for (const ch of input.channels) {
			if (ch.type !== "webhook")
				throw new Error(`unknown channel type: ${ch.type}`);
			if (!ch.url || !/^https?:\/\//.test(ch.url))
				throw new Error("channel.url must be http(s)://");
		}
	}

	async listRules(projectId: string): Promise<AlertRule[]> {
		const rs = await this.db
			.prepare(
				`SELECT * FROM alert_rules WHERE project_id = ? ORDER BY created_at DESC`,
			)
			.bind(projectId)
			.all<AlertRuleRow>();
		const rows = rs.results ?? [];
		if (rows.length === 0) return [];
		const stateRs = await this.db
			.prepare(`SELECT * FROM alert_state WHERE project_id = ?`)
			.bind(projectId)
			.all<AlertStateRow>();
		const stateByRule = new Map<string, AlertStateRow>(
			(stateRs.results ?? []).map((s) => [s.rule_id, s]),
		);
		return rows.map((r) => rowToRule(r, stateByRule.get(r.id)));
	}

	async getRule(id: string, projectId: string): Promise<AlertRule | null> {
		const row = await this.db
			.prepare(`SELECT * FROM alert_rules WHERE id = ? AND project_id = ?`)
			.bind(id, projectId)
			.first<AlertRuleRow>();
		if (!row) return null;
		const state = await this.db
			.prepare(`SELECT * FROM alert_state WHERE rule_id = ?`)
			.bind(id)
			.first<AlertStateRow>();
		return rowToRule(row, state ?? undefined);
	}

	async createRule(
		projectId: string,
		input: AlertRuleInput,
	): Promise<AlertRule> {
		this.validateInput(input);
		const id = randomHex(16);
		const now = new Date().toISOString();
		await this.db
			.prepare(
				`INSERT INTO alert_rules (id, project_id, name, signal, query_json, threshold, window_mins, comparison, channels_json, enabled, created_at, updated_at, analysis_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				id,
				projectId,
				input.name.trim(),
				input.signal,
				JSON.stringify(input.query),
				input.threshold,
				input.windowMins,
				input.comparison,
				JSON.stringify(input.channels),
				input.enabled === false ? 0 : 1,
				now,
				now,
				input.analysisId ?? null,
			)
			.run();

		const created = await this.getRule(id, projectId);
		if (!created) throw new Error("Failed to create rule");
		return created;
	}

	async updateRule(
		id: string,
		projectId: string,
		patch: Partial<AlertRuleInput>,
	): Promise<AlertRule | null> {
		const existing = await this.getRule(id, projectId);
		if (!existing) return null;

		const merged: AlertRuleInput = {
			name: patch.name ?? existing.name,
			signal: patch.signal ?? existing.signal,
			query: patch.query ?? existing.query,
			threshold: patch.threshold ?? existing.threshold,
			windowMins: patch.windowMins ?? existing.windowMins,
			comparison: patch.comparison ?? existing.comparison,
			channels: patch.channels ?? existing.channels,
			enabled: patch.enabled ?? existing.enabled,
			analysisId:
				"analysisId" in patch ? patch.analysisId : existing.analysisId,
		};
		this.validateInput(merged);

		const now = new Date().toISOString();
		await this.db
			.prepare(
				`UPDATE alert_rules SET
           name = ?, signal = ?, query_json = ?, threshold = ?, window_mins = ?,
           comparison = ?, channels_json = ?, enabled = ?, updated_at = ?, analysis_id = ?
         WHERE id = ? AND project_id = ?`,
			)
			.bind(
				merged.name.trim(),
				merged.signal,
				JSON.stringify(merged.query),
				merged.threshold,
				merged.windowMins,
				merged.comparison,
				JSON.stringify(merged.channels),
				merged.enabled === false ? 0 : 1,
				now,
				merged.analysisId ?? null,
				id,
				projectId,
			)
			.run();

		return this.getRule(id, projectId);
	}

	async deleteRule(id: string, projectId: string): Promise<boolean> {
		const result = await this.db
			.prepare(`DELETE FROM alert_rules WHERE id = ? AND project_id = ?`)
			.bind(id, projectId)
			.run();
		// Also clean up state and evaluations for this rule.
		await this.db.prepare(`DELETE FROM alert_state WHERE rule_id = ?`).bind(id).run();
		await this.db
			.prepare(`DELETE FROM alert_evaluations WHERE rule_id = ?`)
			.bind(id)
			.run();
		return (result.meta?.changes ?? 0) > 0;
	}

	async listEnabledRules(): Promise<AlertRule[]> {
		const rs = await this.db
			.prepare(`SELECT * FROM alert_rules WHERE enabled = 1`)
			.all<AlertRuleRow>();
		return (rs.results ?? []).map((r) => rowToRule(r));
	}

	// ── State ──

	async getState(ruleId: string): Promise<AlertStateRow | null> {
		const row = await this.db
			.prepare(`SELECT * FROM alert_state WHERE rule_id = ?`)
			.bind(ruleId)
			.first<AlertStateRow>();
		return row ?? null;
	}

	async transitionState(
		ruleId: string,
		projectId: string,
		newState: AlertState,
		now: string,
	): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO alert_state (rule_id, project_id, current_state, last_state_change)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET current_state = excluded.current_state, last_state_change = excluded.last_state_change`,
			)
			.bind(ruleId, projectId, newState, now)
			.run();
	}

	async recordEvaluation(
		ruleId: string,
		projectId: string,
		value: number,
		state: AlertState,
		notified: boolean,
	): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO alert_evaluations (id, rule_id, project_id, evaluated_at, value, state, notified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				randomHex(16),
				ruleId,
				projectId,
				new Date().toISOString(),
				value,
				state,
				notified ? 1 : 0,
			)
			.run();
	}

	async listEvaluations(params: {
		ruleId: string;
		hours: number;
		limit?: number;
	}): Promise<AlertEvaluation[]> {
		const cutoff = new Date(
			Date.now() - params.hours * 60 * 60 * 1000,
		).toISOString();
		const rs = await this.db
			.prepare(
				`SELECT * FROM alert_evaluations WHERE rule_id = ? AND evaluated_at >= ? ORDER BY evaluated_at DESC LIMIT ?`,
			)
			.bind(params.ruleId, cutoff, Math.min(params.limit ?? 500, 1000))
			.all<AlertEvaluationRow>();
		return (rs.results ?? []).map(rowToEvaluation);
	}

	// ── Evaluators (count-over-window per signal) ──

	async evaluateRule(rule: AlertRule): Promise<number> {
		// Stage 6 — analysis-bound rule. Read the analysis's latest
		// primary value instead of running the rule's raw query. Falls
		// through to the legacy path if no result has landed yet so the
		// alert behaves as "metric unknown / 0" rather than throwing.
		if (rule.analysisId) {
			const row = await this.db
				.prepare(
					`SELECT primary_value FROM analysis_results
					WHERE project_id = ? AND analysis_id = ?
					ORDER BY generated_at DESC LIMIT 1`,
				)
				.bind(rule.projectId, rule.analysisId)
				.first<{ primary_value: number | null }>();
			return row?.primary_value ?? 0;
		}
		switch (rule.signal) {
			case "spans":
				return this.evaluateSpanRule(rule);
			case "logs":
				return this.evaluateLogRule(rule);
			case "usage":
				return this.evaluateUsageRule(rule);
			case "ai":
				return this.evaluateAIRule(rule);
		}
	}

	/**
	 * Stage 6 — fetch the latest narrative associated with this rule's
	 * bound analysis. Used by the evaluator when firing an analysis-bound
	 * alert so the webhook payload includes the human-readable
	 * narrative, not just a threshold crossing.
	 */
	async getAnalysisNarrative(
		projectId: string,
		analysisId: string,
	): Promise<{ narrative: string | null; status: string | null } | null> {
		const row = await this.db
			.prepare(
				`SELECT narrative, status FROM analysis_results
				WHERE project_id = ? AND analysis_id = ?
				ORDER BY generated_at DESC LIMIT 1`,
			)
			.bind(projectId, analysisId)
			.first<{ narrative: string | null; status: string | null }>();
		if (!row) return null;
		return { narrative: row.narrative ?? null, status: row.status ?? null };
	}

	private async evaluateSpanRule(rule: AlertRule): Promise<number> {
		const q = rule.query as AlertQuerySpans;
		const cutoff = windowCutoffIso(rule.windowMins);
		let sql = `SELECT COUNT(*) AS c FROM telemetry_spans WHERE project_id = ? AND received_at >= ?`;
		const binds: unknown[] = [rule.projectId, cutoff];
		if (q.serviceName) {
			sql += ` AND service_name = ?`;
			binds.push(q.serviceName);
		}
		if (q.spanName) {
			sql += ` AND span_name = ?`;
			binds.push(q.spanName);
		}
		if (q.statusCode === "error") sql += ` AND status_code = 2`;
		else if (q.statusCode === "ok") sql += ` AND status_code != 2`;
		const row = await this.db
			.prepare(sql)
			.bind(...binds)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}

	private async evaluateLogRule(rule: AlertRule): Promise<number> {
		const q = rule.query as AlertQueryLogs;
		const cutoff = windowCutoffIso(rule.windowMins);
		let sql = `SELECT COUNT(*) AS c FROM logs WHERE project_id = ? AND received_at >= ?`;
		const binds: unknown[] = [rule.projectId, cutoff];
		if (q.serviceName) {
			sql += ` AND service_name = ?`;
			binds.push(q.serviceName);
		}
		if (q.severity) {
			sql += ` AND severity = ?`;
			binds.push(q.severity as LogSeverity);
		}
		const row = await this.db
			.prepare(sql)
			.bind(...binds)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}

	private async evaluateUsageRule(rule: AlertRule): Promise<number> {
		const q = rule.query as AlertQueryUsage;
		const cutoff = windowCutoffIso(rule.windowMins);
		// Usage alerts fire on 'frontend_error' events (the error signal on the frontend).
		let sql = `SELECT COUNT(*) AS c FROM usage_events WHERE project_id = ? AND occurred_at >= ? AND event_type = 'frontend_error'`;
		const binds: unknown[] = [rule.projectId, cutoff];
		if (q.eventName) {
			sql += ` AND event_name = ?`;
			binds.push(q.eventName);
		}
		if (q.pathPattern) {
			sql += ` AND page_path LIKE ?`;
			binds.push(q.pathPattern);
		}
		const row = await this.db
			.prepare(sql)
			.bind(...binds)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}

	private async evaluateAIRule(rule: AlertRule): Promise<number> {
		const q = rule.query as AlertQueryAI;
		const cutoff = windowCutoffIso(rule.windowMins);
		let sql = `SELECT COUNT(*) AS c FROM ai_calls WHERE project_id = ? AND received_at >= ?`;
		const binds: unknown[] = [rule.projectId, cutoff];
		if (q.provider) {
			sql += ` AND provider = ?`;
			binds.push(q.provider);
		}
		if (q.model) {
			sql += ` AND model_name = ?`;
			binds.push(q.model);
		}
		if (q.isError === true) sql += ` AND is_error = 1`;
		const row = await this.db
			.prepare(sql)
			.bind(...binds)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}
}
