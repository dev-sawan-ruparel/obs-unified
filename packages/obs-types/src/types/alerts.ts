import type { EvidenceReference, EvidenceReferenceContract } from "./evidence";
import type { LogSeverity } from "./logs";

export type AlertSignal = "spans" | "logs" | "usage" | "ai" | "metrics";
export type AlertComparison = ">" | ">=" | "<" | "<=" | "==" | "!=";
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

/**
 * How a `metrics` rule reduces the points of one series inside the window.
 * Each matching series is reduced on its own; the per-series results are
 * then summed. See docs/ops/production.md section 8.
 *
 * - `last` / `min` / `max` / `avg` / `sum`: over the points received in the
 *   window.
 * - `increase`: counter growth in the window. Cumulative series sum the
 *   positive differences between consecutive points, treating a drop (or a
 *   new start time) as a counter reset; delta series sum their values.
 * - `rate`: `increase` divided by the window in seconds.
 * - `age_seconds`: seconds since the newest point of any matching series,
 *   regardless of the window. With no points at all it is the seconds since
 *   the rule was created, so "never reported" fires once the threshold has
 *   passed.
 */
export type AlertMetricAggregation =
	| "last"
	| "min"
	| "max"
	| "avg"
	| "sum"
	| "increase"
	| "rate"
	| "age_seconds";

/**
 * Which stored number of a point is read: `value` for gauges and sums,
 * `count` or `sum` for histograms, exponential histograms and summaries.
 */
export type AlertMetricField = "value" | "count" | "sum";

export type AlertMetricAttributeValue = string | number | boolean;

/** Selects metric series by name and exact attribute values. */
export interface AlertMetricSelector {
	/** Metric name, or several names whose results are summed. */
	metric: string | string[];
	/** Data point attributes that must equal these values. */
	attributes?: Record<string, AlertMetricAttributeValue>;
	/** Resource attributes that must equal these values. */
	resourceAttributes?: Record<string, AlertMetricAttributeValue>;
	/** `service.name` of the reporting resource. */
	serviceName?: string;
	/** Defaults to `value`. */
	field?: AlertMetricField;
}

export interface AlertMetricDenominator extends AlertMetricSelector {
	/** Defaults to the numerator's aggregation. `age_seconds` is not allowed. */
	aggregation?: Exclude<AlertMetricAggregation, "age_seconds">;
}

export interface AlertQueryMetrics extends AlertMetricSelector {
	aggregation: AlertMetricAggregation;
	/**
	 * Turns the value into a ratio: numerator / denominator when the denominator
	 * is > 0 and at least `minDenominator`, otherwise 0.
	 */
	denominator?: AlertMetricDenominator;
	/** Defaults to 0. Only valid with `denominator`. */
	minDenominator?: number;
	/**
	 * For `last`, `min`, `max`, `avg` and `sum`: a series takes part only
	 * when its newest point is at most this many seconds old. Default 300,
	 * at most 86400. Not used by `increase`, `rate` or `age_seconds`.
	 */
	staleSecs?: number;
	/**
	 * What a window with no fresh series means. `zero` (default): the value
	 * is 0 and is compared as usual. `keep`: the alert state is left as it
	 * is (no firing, no resolving) and the evaluation is recorded with
	 * outcome `no_data`. Ignored by `age_seconds`, which always has a value.
	 */
	noData?: AlertMetricNoData;
}

export type AlertMetricNoData = "zero" | "keep";

/**
 * `value`: a value was computed and compared. `no_data`: a metrics rule
 * with `noData: "keep"` found no fresh series, so the state was left as it
 * was. `error`: the evaluation failed (timeout, a query over its series or
 * point cap, a database error); the state was left as it was.
 */
export type AlertEvaluationOutcome = "value" | "no_data" | "error";

export type AlertQuery =
	| AlertQuerySpans
	| AlertQueryLogs
	| AlertQueryUsage
	| AlertQueryAI
	| AlertQueryMetrics;

export interface AlertWebhookChannel {
	type: "webhook";
	url: string;
	headers?: Record<string, string>;
}

/**
 * Email through the collector's SMTP settings (`ALERT_SMTP_*` on the Node
 * collector). The server, sender and credentials never live in the rule.
 * Refused on a collector with no SMTP transport (including Cloudflare
 * Workers, which cannot open SMTP connections).
 */
export interface AlertEmailChannel {
	type: "email";
	to: string[];
}

export type AlertChannel = AlertWebhookChannel | AlertEmailChannel;

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
	/**
	 * Seconds the condition must hold on consecutive evaluations before the
	 * rule fires (Prometheus `for`). 0 fires on the first matching
	 * evaluation. Resolution is immediate.
	 */
	pendingSecs?: number;
	/** When the condition started holding while not yet firing (derived). */
	pendingSince?: string | null;
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
	/** Migration 054; absent before it is applied. */
	pending_secs?: number | null;
}

export interface AlertEvaluation {
	id: string;
	ruleId: string;
	projectId: string;
	evaluatedAt: string;
	value: number;
	state: AlertState;
	notified: boolean;
	/** Migration 057; absent rows read as `value`. */
	outcome?: AlertEvaluationOutcome;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export interface AlertEvaluationsListResponse {
	evaluations: AlertEvaluation[];
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
}

export interface AlertEvaluationRow {
	id: string;
	rule_id: string;
	project_id: string;
	evaluated_at: string;
	value: number;
	state: AlertState;
	notified: number;
	/** Migration 057. */
	outcome?: AlertEvaluationOutcome | null;
}

export interface AlertStateRow {
	rule_id: string;
	project_id: string;
	current_state: AlertState;
	last_state_change: string;
	/**
	 * 1 once the channels accepted the notification for `current_state`,
	 * 0 while it is still owed (migration 049). Absent on a database that
	 * has not applied 049 yet; readers treat that as delivered.
	 */
	notified?: number;
	/**
	 * Migration 054: when the rule's condition started holding while its
	 * pending duration had not yet elapsed. NULL when not pending.
	 */
	pending_since?: string | null;
	/**
	 * Migration 058: the last evaluation that saw the pending condition
	 * hold. A later evaluation more than the allowed gap after it starts a
	 * new pending period instead of continuing this one.
	 */
	pending_seen_at?: string | null;
}

export interface AlertTestResponse {
	value: number;
	/** A metrics rule found no fresh series (see `AlertQueryMetrics.noData`). */
	noData?: boolean;
	wouldFire: boolean;
	comparison: AlertComparison;
	threshold: number;
	evidenceReferences?: EvidenceReference[];
	evidenceContract?: EvidenceReferenceContract;
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
	/** Defaults to 0. Integer seconds, at most 86400. */
	pendingSecs?: number;
}

// ── Application-aware Analyses (RFC 0002, Stage 1) ──────────────────────────
//
// An Analysis is a unit of "answer" — a fetch + optional analyze + optional
// narrate, produced on a schedule or on demand. Stage 1 covers SQL-only
// analyses driven by the existing scheduled handler. analyze/narrate layers
// arrive in later stages.
