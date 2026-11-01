import type {
	AlertChannel,
	AlertComparison,
	AlertEvaluation,
	AlertEvaluationOutcome,
	AlertEvaluationRow,
	AlertEvaluationsListResponse,
	AlertLastEvaluation,
	AlertQuery,
	AlertQueryAI,
	AlertQueryLogs,
	AlertQueryMetrics,
	AlertQuerySpans,
	AlertQueryUsage,
	AlertRule,
	AlertRuleInput,
	AlertRuleRow,
	AlertSignal,
	AlertState,
	AlertStateRow,
	LogSeverity,
} from "@obsunified/types";
import { EVIDENCE_REFERENCE_CONTRACT } from "@obsunified/types";
import { isValidEmailAddress, MAX_EMAIL_RECIPIENTS } from "./alert-email";
import { alertEvidenceReferences } from "./evidence-references";
import { randomHex } from "./hash";
import {
	evaluateMetricQuery,
	MAX_METRIC_WINDOW_MINS,
	validateMetricQuery,
} from "./metric-alerts";

/** A rule's value, and whether a metrics rule found no fresh data. */
export interface AlertRuleEvaluation {
	value: number;
	noData: boolean;
}

import type { SqlDb } from "./sql-db";
import { assertSafeWebhookUrl, WebhookUrlError } from "./webhook-url";

export interface AlertsStoreOptions {
	/** Permit webhook targets on loopback / private / link-local hosts. */
	allowPrivateWebhookTargets?: boolean;
	/**
	 * Whether this collector can send email (a transport is bound as
	 * `env.ALERT_EMAIL`). Rules with an email channel are refused otherwise.
	 */
	emailDeliveryAvailable?: boolean;
}

/** Upper bound for `pendingSecs` (one day). */
export const MAX_PENDING_SECS = 86_400;

export const EMAIL_UNAVAILABLE_MESSAGE =
	"email channels need SMTP configured on the collector (ALERT_SMTP_HOST and ALERT_SMTP_FROM on the Node collector); the Cloudflare Worker collector cannot send email";

const parseJsonField = <T>(value: unknown): T => {
	if (typeof value === "string") return JSON.parse(value) as T;
	return value as T;
};

const rowToRule = (row: AlertRuleRow, state?: AlertStateRow): AlertRule => ({
	id: row.id,
	projectId: row.project_id,
	name: row.name,
	signal: row.signal,
	query: parseJsonField<AlertQuery>(row.query_json),
	threshold: row.threshold,
	windowMins: row.window_mins,
	comparison: row.comparison,
	channels: parseJsonField<AlertChannel[]>(row.channels_json),
	enabled: row.enabled === 1,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	analysisId: row.analysis_id ?? null,
	pendingSecs: Number(row.pending_secs ?? 0),
	pendingSince: state?.pending_since ?? null,
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
	outcome: row.outcome ?? "value",
	error: row.error_message ?? null,
});

const MAX_ERROR_MESSAGE = 500;

/**
 * What an `error` evaluation keeps of the failure: URLs (which can carry
 * credentials or secret hook paths) replaced, one line, truncated.
 */
export const sanitizeEvaluationError = (message: string): string => {
	const cleaned = message
		.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, "<url>")
		.replace(/\s+/g, " ")
		.trim();
	return cleaned.length > MAX_ERROR_MESSAGE
		? `${cleaned.slice(0, MAX_ERROR_MESSAGE - 1)}…`
		: cleaned;
};

interface LastEvaluationRow {
	rule_id: string;
	evaluated_at: string;
	value: number;
	outcome?: AlertEvaluationOutcome | null;
	error_message?: string | null;
}

const windowCutoffIso = (windowMins: number): string =>
	new Date(Date.now() - windowMins * 60 * 1000).toISOString();

const SIGNALS: AlertSignal[] = ["spans", "logs", "usage", "ai", "metrics"];
const COMPARISONS: AlertComparison[] = [">", ">=", "<", "<=", "==", "!="];

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
		case "==":
			return value === threshold;
		case "!=":
			return value !== threshold;
	}
}

export class AlertsStore {
	constructor(
		private readonly db: SqlDb,
		private readonly options: AlertsStoreOptions = {},
	) {}

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
		if (
			input.pendingSecs !== undefined &&
			(!Number.isInteger(input.pendingSecs) ||
				input.pendingSecs < 0 ||
				input.pendingSecs > MAX_PENDING_SECS)
		)
			throw new Error(
				`pendingSecs must be an integer from 0 to ${MAX_PENDING_SECS}`,
			);
		if (input.signal === "metrics") {
			validateMetricQuery(input.query);
			if (input.windowMins > MAX_METRIC_WINDOW_MINS)
				throw new Error(
					`windowMins must be <= ${MAX_METRIC_WINDOW_MINS} for the metrics signal`,
				);
		}
		if (!Array.isArray(input.channels) || input.channels.length === 0)
			throw new Error("at least one channel is required");
		for (const ch of input.channels) {
			if (ch.type === "email") {
				if (!Array.isArray(ch.to) || ch.to.length === 0)
					throw new Error("email channel.to must list at least one address");
				if (ch.to.length > MAX_EMAIL_RECIPIENTS)
					throw new Error(
						`email channel.to may list at most ${MAX_EMAIL_RECIPIENTS} addresses`,
					);
				for (const addr of ch.to) {
					if (typeof addr !== "string" || !isValidEmailAddress(addr))
						throw new Error(
							`email channel.to has an invalid address: ${JSON.stringify(addr)}`,
						);
				}
				const extra = Object.keys(ch).filter((k) => k !== "type" && k !== "to");
				if (extra.length > 0)
					throw new Error(
						`email channel accepts only "type" and "to" (SMTP settings come from the collector environment); got: ${extra.join(", ")}`,
					);
				if (!this.options.emailDeliveryAvailable)
					throw new Error(EMAIL_UNAVAILABLE_MESSAGE);
				continue;
			}
			if (ch.type !== "webhook")
				throw new Error(
					`unknown channel type: ${(ch as { type?: unknown }).type}`,
				);
			if (!ch.url || typeof ch.url !== "string")
				throw new Error("channel.url must be http(s)://");
			try {
				assertSafeWebhookUrl(ch.url, {
					allowPrivateNetworks: this.options.allowPrivateWebhookTargets,
				});
			} catch (err) {
				if (err instanceof WebhookUrlError) throw new Error(err.message);
				throw err;
			}
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
		const lastByRule = await this.lastEvaluations(projectId);
		return rows.map((r) => {
			const state = stateByRule.get(r.id);
			const last = lastByRule.get(r.id);
			return {
				...rowToRule(r, state),
				notificationDelivered: state
					? state.notified === undefined || state.notified === null
						? true
						: Number(state.notified) === 1
					: null,
				lastEvaluation: last
					? {
							evaluatedAt: last.evaluated_at,
							outcome: last.outcome ?? "value",
							value: Number(last.value),
							error:
								(last.outcome ?? "value") === "error"
									? (last.error_message ?? null)
									: null,
						}
					: null,
			};
		});
	}

	/**
	 * The newest evaluation of every rule in the project, one query. Falls
	 * back to the pre-057/059 column set on older databases.
	 */
	private async lastEvaluations(
		projectId: string,
	): Promise<Map<string, LastEvaluationRow>> {
		const run = (columns: string) =>
			this.db
				.prepare(
					`SELECT e.rule_id, e.evaluated_at, e.value${columns}
				 FROM alert_evaluations e
				 WHERE e.project_id = ?
				   AND e.evaluated_at = (
				     SELECT MAX(e2.evaluated_at) FROM alert_evaluations e2
				     WHERE e2.rule_id = e.rule_id
				   )`,
				)
				.bind(projectId)
				.all<LastEvaluationRow>();
		let rs: { results: LastEvaluationRow[] };
		try {
			rs = await run(", e.outcome, e.error_message");
		} catch (err) {
			if (
				!isMissingColumn(err, "error_message") &&
				!isMissingColumn(err, "outcome")
			)
				throw err;
			try {
				rs = await run(", e.outcome");
			} catch (inner) {
				if (!isMissingColumn(inner, "outcome")) throw inner;
				rs = await run("");
			}
		}
		const out = new Map<string, LastEvaluationRow>();
		// Same-millisecond ties: prefer an error, which is the one to surface.
		for (const row of rs.results ?? []) {
			const seen = out.get(row.rule_id);
			if (!seen || row.outcome === "error") out.set(row.rule_id, row);
		}
		return out;
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
		const pendingSecs = input.pendingSecs ?? 0;
		const values = [
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
		];
		await this.withPendingColumnFallback(
			pendingSecs,
			() =>
				this.db
					.prepare(
						`INSERT INTO alert_rules (id, project_id, name, signal, query_json, threshold, window_mins, comparison, channels_json, enabled, created_at, updated_at, analysis_id, pending_secs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(...values, pendingSecs)
					.run(),
			() =>
				this.db
					.prepare(
						`INSERT INTO alert_rules (id, project_id, name, signal, query_json, threshold, window_mins, comparison, channels_json, enabled, created_at, updated_at, analysis_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.bind(...values)
					.run(),
		);

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
			pendingSecs: patch.pendingSecs ?? existing.pendingSecs,
		};
		this.validateInput(merged);

		const now = new Date().toISOString();
		const pendingSecs = merged.pendingSecs ?? 0;
		const values = [
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
		];
		await this.withPendingColumnFallback(
			pendingSecs,
			() =>
				this.db
					.prepare(
						`UPDATE alert_rules SET
           name = ?, signal = ?, query_json = ?, threshold = ?, window_mins = ?,
           comparison = ?, channels_json = ?, enabled = ?, updated_at = ?, analysis_id = ?,
           pending_secs = ?
         WHERE id = ? AND project_id = ?`,
					)
					.bind(...values, pendingSecs, id, projectId)
					.run(),
			() =>
				this.db
					.prepare(
						`UPDATE alert_rules SET
           name = ?, signal = ?, query_json = ?, threshold = ?, window_mins = ?,
           comparison = ?, channels_json = ?, enabled = ?, updated_at = ?, analysis_id = ?
         WHERE id = ? AND project_id = ?`,
					)
					.bind(...values, id, projectId)
					.run(),
		);

		// A pending period was measured against the old definition; after a
		// change to what or whether the rule evaluates, it starts over.
		const evaluationChanged =
			merged.signal !== existing.signal ||
			JSON.stringify(merged.query) !== JSON.stringify(existing.query) ||
			merged.threshold !== existing.threshold ||
			merged.windowMins !== existing.windowMins ||
			merged.comparison !== existing.comparison ||
			(merged.enabled !== false) !== existing.enabled ||
			(merged.analysisId ?? null) !== (existing.analysisId ?? null) ||
			pendingSecs !== (existing.pendingSecs ?? 0);
		if (evaluationChanged) await this.resetPending(id, projectId);

		return this.getRule(id, projectId);
	}

	/**
	 * Clears a rule's pending period. Tolerates databases that have not
	 * applied 055/058 (there is nothing to clear on them).
	 */
	async resetPending(ruleId: string, projectId: string): Promise<void> {
		try {
			await this.db
				.prepare(
					`UPDATE alert_state SET pending_since = NULL, pending_seen_at = NULL
				 WHERE rule_id = ? AND project_id = ?`,
				)
				.bind(ruleId, projectId)
				.run();
		} catch (err) {
			if (!isMissingColumn(err, "pending_seen_at")) {
				if (isMissingColumn(err, "pending_since")) return;
				throw err;
			}
			try {
				await this.db
					.prepare(
						`UPDATE alert_state SET pending_since = NULL
					 WHERE rule_id = ? AND project_id = ?`,
					)
					.bind(ruleId, projectId)
					.run();
			} catch (inner) {
				if (!isMissingColumn(inner, "pending_since")) throw inner;
			}
		}
	}

	/**
	 * Runs `current`; on a database that has not applied migration 054 (no
	 * `alert_rules.pending_secs`) a rule without a pending duration is
	 * written with the legacy statement so rolling deploys keep working. A
	 * rule that needs the column is refused with a clear message instead of
	 * silently losing its pending duration.
	 */
	private async withPendingColumnFallback<T>(
		pendingSecs: number,
		current: () => Promise<T>,
		legacy: () => Promise<T>,
	): Promise<T> {
		try {
			return await current();
		} catch (err) {
			if (!isMissingColumn(err, "pending_secs")) throw err;
			if (pendingSecs > 0)
				throw new Error(
					"pendingSecs needs database migration 054 (alert_rules.pending_secs); apply migrations and retry",
				);
			return legacy();
		}
	}

	async deleteRule(id: string, projectId: string): Promise<boolean> {
		// Only a rule the caller's project owns takes its state and
		// evaluations with it; a miss must not touch another project's rows.
		// Children go first because alert_state / alert_evaluations reference
		// alert_rules(id) and SQLite enforces that on D1 and node:sqlite.
		const owned = await this.db
			.prepare(
				`SELECT 1 AS ok FROM alert_rules WHERE id = ? AND project_id = ?`,
			)
			.bind(id, projectId)
			.first<{ ok: number }>();
		if (!owned) return false;
		await this.db
			.prepare(`DELETE FROM alert_state WHERE rule_id = ? AND project_id = ?`)
			.bind(id, projectId)
			.run();
		await this.db
			.prepare(
				`DELETE FROM alert_evaluations WHERE rule_id = ? AND project_id = ?`,
			)
			.bind(id, projectId)
			.run();
		const result = await this.db
			.prepare(`DELETE FROM alert_rules WHERE id = ? AND project_id = ?`)
			.bind(id, projectId)
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

	async getState(
		ruleId: string,
		projectId: string,
	): Promise<AlertStateRow | null> {
		const row = await this.db
			.prepare(`SELECT * FROM alert_state WHERE rule_id = ? AND project_id = ?`)
			.bind(ruleId, projectId)
			.first<AlertStateRow>();
		return row ?? null;
	}

	/**
	 * Record a state transition with its notification still outstanding
	 * (`notified = 0`); `markNotified` flips it once a channel accepts the
	 * alert. On a database that has not applied migration 049 the column is
	 * missing: the transition is still written (legacy statement) so alerting
	 * keeps working through a rolling deploy, and the evaluator treats a row
	 * without the column as delivered.
	 */
	async transitionState(
		ruleId: string,
		projectId: string,
		newState: AlertState,
		now: string,
	): Promise<void> {
		try {
			await this.db
				.prepare(
					`INSERT INTO alert_state (rule_id, project_id, current_state, last_state_change, notified)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(rule_id) DO UPDATE SET
           current_state = excluded.current_state,
           last_state_change = excluded.last_state_change,
           notified = 0`,
				)
				.bind(ruleId, projectId, newState, now)
				.run();
		} catch (err) {
			if (!isMissingNotifiedColumn(err)) throw err;
			await this.db
				.prepare(
					`INSERT INTO alert_state (rule_id, project_id, current_state, last_state_change)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET
           current_state = excluded.current_state,
           last_state_change = excluded.last_state_change`,
				)
				.bind(ruleId, projectId, newState, now)
				.run();
		}
	}

	/**
	 * Mark the transition `(state, lastStateChange)` as delivered. Scoped to
	 * the exact transition the caller notified for: if the rule changed state
	 * again while the webhook was in flight, the newer transition keeps its
	 * own outstanding flag. Returns false when nothing matched (stale or
	 * already marked). On a pre-049 schema there is nothing to mark.
	 */
	async markNotified(
		ruleId: string,
		projectId: string,
		state: AlertState,
		lastStateChange: string,
	): Promise<boolean> {
		try {
			const result = await this.db
				.prepare(
					`UPDATE alert_state SET notified = 1
				 WHERE rule_id = ? AND project_id = ? AND current_state = ?
				   AND last_state_change = ? AND notified = 0`,
				)
				.bind(ruleId, projectId, state, lastStateChange)
				.run();
			return (result.meta?.changes ?? 0) > 0;
		} catch (err) {
			if (isMissingNotifiedColumn(err)) return false;
			throw err;
		}
	}

	/**
	 * Record (`{ since, seenAt }`) or clear (`null`) the pending period of a
	 * rule that has a pending duration (migrations 055, 058): when the
	 * condition started holding, and the last evaluation that saw it hold.
	 * A rule without a state row gets one in state `ok` since its creation,
	 * already delivered (nothing is owed for a rule that never changed
	 * state).
	 */
	async setPending(
		ruleId: string,
		projectId: string,
		pending: { since: string; seenAt: string } | null,
		ruleCreatedAt: string,
	): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO alert_state (rule_id, project_id, current_state, last_state_change, notified, pending_since, pending_seen_at)
         VALUES (?, ?, 'ok', ?, 1, ?, ?)
         ON CONFLICT(rule_id) DO UPDATE SET
           pending_since = excluded.pending_since,
           pending_seen_at = excluded.pending_seen_at`,
			)
			.bind(
				ruleId,
				projectId,
				ruleCreatedAt,
				pending?.since ?? null,
				pending?.seenAt ?? null,
			)
			.run();
	}

	async recordEvaluation(
		ruleId: string,
		projectId: string,
		value: number,
		state: AlertState,
		notified: boolean,
		outcome: AlertEvaluationOutcome = "value",
		errorMessage?: string,
	): Promise<void> {
		const error =
			outcome === "error" && errorMessage
				? sanitizeEvaluationError(errorMessage)
				: null;
		const values = [
			randomHex(16),
			ruleId,
			projectId,
			new Date().toISOString(),
			value,
			state,
			notified ? 1 : 0,
		];
		try {
			await this.db
				.prepare(
					`INSERT INTO alert_evaluations (id, rule_id, project_id, evaluated_at, value, state, notified, outcome, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(...values, outcome, error)
				.run();
			return;
		} catch (err) {
			if (!isMissingColumn(err, "error_message")) {
				if (!isMissingColumn(err, "outcome")) throw err;
			} else {
				// Pre-059: keep the outcome without the message.
				try {
					await this.db
						.prepare(
							`INSERT INTO alert_evaluations (id, rule_id, project_id, evaluated_at, value, state, notified, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
						)
						.bind(...values, outcome)
						.run();
					return;
				} catch (inner) {
					if (!isMissingColumn(inner, "outcome")) throw inner;
				}
			}
			// Pre-057 database: the row is still worth keeping without its outcome.
			await this.db
				.prepare(
					`INSERT INTO alert_evaluations (id, rule_id, project_id, evaluated_at, value, state, notified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(...values)
				.run();
		}
	}

	async listEvaluations(params: {
		ruleId: string;
		projectId?: string;
		hours: number;
		limit?: number;
	}): Promise<AlertEvaluationsListResponse> {
		const cutoff = new Date(
			Date.now() - params.hours * 60 * 60 * 1000,
		).toISOString();
		const rs = await this.db
			.prepare(
				`SELECT * FROM alert_evaluations WHERE rule_id = ? AND evaluated_at >= ? ORDER BY evaluated_at DESC LIMIT ?`,
			)
			.bind(params.ruleId, cutoff, Math.min(params.limit ?? 500, 1000))
			.all<AlertEvaluationRow>();
		const rows = rs.results ?? [];
		const projectId = params.projectId ?? rows[0]?.project_id;
		const rule = projectId
			? await this.getRule(params.ruleId, projectId)
			: null;
		const response: AlertEvaluationsListResponse = {
			evaluations: rows.map(rowToEvaluation),
		};
		if (rule) {
			response.evidenceReferences = alertEvidenceReferences(rule);
			response.evidenceContract = EVIDENCE_REFERENCE_CONTRACT;
		}
		return response;
	}

	// ── Evaluators (count-over-window per signal) ──

	async evaluateRule(rule: AlertRule, now: Date = new Date()): Promise<number> {
		return (await this.evaluateRuleWithStatus(rule, now)).value;
	}

	/** Like `evaluateRule`, plus whether a metrics rule found no fresh data. */
	async evaluateRuleWithStatus(
		rule: AlertRule,
		now: Date = new Date(),
	): Promise<AlertRuleEvaluation> {
		if (rule.signal === "metrics" && !rule.analysisId)
			return evaluateMetricQuery(this.db, rule.query as AlertQueryMetrics, {
				projectId: rule.projectId,
				windowMins: rule.windowMins,
				ruleCreatedAt: rule.createdAt,
				now,
			});
		return { value: await this.evaluateCountRule(rule), noData: false };
	}

	private async evaluateCountRule(rule: AlertRule): Promise<number> {
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
			case "metrics":
				// Handled by evaluateRuleWithStatus; unreachable here.
				throw new Error(
					"metrics rules evaluate through evaluateRuleWithStatus",
				);
			default:
				// A stored signal this collector does not know must not read as 0.
				throw new Error(`unknown alert signal: ${String(rule.signal)}`);
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
		// Bare boolean test: INTEGER 0/1 on D1, BOOLEAN on Postgres (where
		// `is_error = 1` is a type error).
		if (q.isError === true) sql += ` AND is_error`;
		const row = await this.db
			.prepare(sql)
			.bind(...binds)
			.first<{ c: number }>();
		return row?.c ?? 0;
	}
}

/**
 * SQLite: "table alert_state has no column named notified" / "no such column:
 * notified"; Postgres: `column "notified" of relation "alert_state" does not
 * exist` (42703). Anything else is a real failure.
 */
const isMissingNotifiedColumn = (err: unknown): boolean =>
	isMissingColumn(err, "notified");

const isMissingColumn = (err: unknown, column: string): boolean => {
	const message = err instanceof Error ? err.message : String(err);
	return (
		message.toLowerCase().includes(column) &&
		/no such column|has no column|does not exist/i.test(message)
	);
};
