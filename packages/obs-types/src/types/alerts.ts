import type { LogSeverity } from "./logs";

export type AlertSignal = "spans" | "logs" | "usage" | "ai";
export type AlertComparison = ">" | ">=" | "<" | "<=";
export type AlertState = "ok" | "firing";

export interface AlertQuerySpans {
	serviceName?: string;
	statusCode?: "error" | "ok";
	spanName?: string;
}

export interface AlertQueryLogs {
	serviceName?: string;
	severity?: LogSeverity;
}

export interface AlertQueryUsage {
	eventName?: string;
	pathPattern?: string;
}

export interface AlertQueryAI {
	provider?: string;
	model?: string;
	isError?: true;
}

export type AlertQuery =
	| AlertQuerySpans
	| AlertQueryLogs
	| AlertQueryUsage
	| AlertQueryAI;

export interface AlertWebhookChannel {
	type: "webhook";
	url: string;
	headers?: Record<string, string>;
}

export type AlertChannel = AlertWebhookChannel;

export interface AlertRule {
	id: string;
	projectId: string;
	name: string;
	signal: AlertSignal;
	query: AlertQuery;
	threshold: number;
	windowMins: number;
	comparison: AlertComparison;
	channels: AlertChannel[];
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	/**
	 * RFC 0002 Stage 6: when set, the evaluator reads the rule's value
	 * from the latest result of this Analysis (`primary_value`) instead
	 * of running the rule's `query`. Webhook payloads include the
	 * analysis's narrative so the alert message is about what's
	 * happening, not just a threshold crossing.
	 */
	analysisId?: string | null;
	/** Current state (derived from alert_state table when listed) */
	currentState?: AlertState;
	/** Last state change time (derived) */
	lastStateChange?: string | null;
}

export interface AlertRuleRow {
	id: string;
	project_id: string;
	name: string;
	signal: AlertSignal;
	query_json: string;
	threshold: number;
	window_mins: number;
	comparison: AlertComparison;
	channels_json: string;
	enabled: number;
	created_at: string;
	updated_at: string;
	/** Stage 6 — NULL on legacy rules. */
	analysis_id?: string | null;
}

export interface AlertEvaluation {
	id: string;
	ruleId: string;
	projectId: string;
	evaluatedAt: string;
	value: number;
	state: AlertState;
	notified: boolean;
}

export interface AlertEvaluationRow {
	id: string;
	rule_id: string;
	project_id: string;
	evaluated_at: string;
	value: number;
	state: AlertState;
	notified: number;
}

export interface AlertStateRow {
	rule_id: string;
	project_id: string;
	current_state: AlertState;
	last_state_change: string;
}

export interface AlertTestResponse {
	value: number;
	wouldFire: boolean;
	comparison: AlertComparison;
	threshold: number;
}

/** Input shape for creating/updating an alert rule */
export interface AlertRuleInput {
	name: string;
	signal: AlertSignal;
	query: AlertQuery;
	threshold: number;
	windowMins: number;
	comparison: AlertComparison;
	channels: AlertChannel[];
	enabled?: boolean;
	/** Stage 6 — bind to an Analysis instead of running the raw query. */
	analysisId?: string | null;
}

// ── Application-aware Analyses (RFC 0002, Stage 1) ──────────────────────────
//
// An Analysis is a unit of "answer" — a fetch + optional analyze + optional
// narrate, produced on a schedule or on demand. Stage 1 covers SQL-only
// analyses driven by the existing scheduled handler. analyze/narrate layers
// arrive in later stages.
