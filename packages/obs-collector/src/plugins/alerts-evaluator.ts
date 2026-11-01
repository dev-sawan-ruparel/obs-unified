import type {
	AlertChannel,
	AlertEmailChannel,
	AlertEvaluationOutcome,
	AlertQueryMetrics,
	AlertRule,
	AlertState,
	AlertWebhookChannel,
} from "@obsunified/types";
import type { CollectorEnv } from "../framework/env";
import {
	type ChildSpanRunner,
	consoleLogger,
	type Logger,
} from "../framework/logger";
import {
	type AlertEmailTransport,
	type AlertNotificationPayload,
	formatAlertEmail,
} from "../lib/alert-email";
import {
	type AlertRuleEvaluation,
	AlertsStore,
	compareValue,
} from "../lib/alerts-store";
import {
	openOrDeduplicateIncident,
	resolveServiceIncidentTarget,
} from "../lib/autosre-remediation-gate";
import { sqlDbFor } from "../lib/sql-db";
import {
	assertSafeWebhookUrl,
	type HostLookup,
	redactWebhookUrl,
	resolveWebhookHost,
} from "../lib/webhook-url";

const DEFAULT_RULE_CONCURRENCY = 5;
const DEFAULT_RULE_TIMEOUT_MS = 10_000;

interface AlertEvaluatorStore {
	listEnabledRules(): Promise<AlertRule[]>;
	evaluateRule(rule: AlertRule): Promise<number>;
	/** Preferred when present: also says whether a metrics rule had no data. */
	evaluateRuleWithStatus?(rule: AlertRule): Promise<AlertRuleEvaluation>;
	getState(
		ruleId: string,
		projectId: string,
	): Promise<{
		current_state: AlertState;
		last_state_change: string;
		/** 0 while the transition's notification is owed; absent pre-049 (= delivered). */
		notified?: number;
		/** Start of the current pending period (migration 055); null/absent when not pending. */
		pending_since?: string | null;
		/** Last evaluation that saw the pending condition hold (migration 058). */
		pending_seen_at?: string | null;
	} | null>;
	/** Record (`{ since, seenAt }`) or clear (null) the rule's pending period. */
	setPending(
		ruleId: string,
		projectId: string,
		pending: { since: string; seenAt: string } | null,
		ruleCreatedAt: string,
	): Promise<void>;
	/** Flip the exact transition `(state, lastStateChange)` to delivered. */
	markNotified(
		ruleId: string,
		projectId: string,
		state: AlertState,
		lastStateChange: string,
	): Promise<boolean>;
	getAnalysisNarrative(
		projectId: string,
		analysisId: string,
	): Promise<{ narrative: string | null; status: string | null } | null>;
	transitionState(
		ruleId: string,
		projectId: string,
		newState: AlertState,
		now: string,
	): Promise<void>;
	recordEvaluation(
		ruleId: string,
		projectId: string,
		value: number,
		state: AlertState,
		notified: boolean,
		outcome?: AlertEvaluationOutcome,
		/** With outcome `error`: why (the store sanitizes it). */
		errorMessage?: string,
	): Promise<void>;
}

/**
 * Default `maxEvaluationGapMs`: two of the default 5-minute evaluation
 * ticks. Hosts with another cadence pass their own (twice the interval).
 */
export const DEFAULT_MAX_EVALUATION_GAP_MS = 2 * 5 * 60_000;

type WebhookPayload = AlertNotificationPayload;

export interface WebhookDeliveryOptions {
	/** Permit targets on loopback / private / link-local hosts. */
	allowPrivateWebhookTargets?: boolean;
	/**
	 * Resolver used to refuse public names that point at private addresses.
	 * Hosts that can resolve (Node: `dns.lookup`) pass one; Workers cannot
	 * reach private networks from `fetch` and leave it unset.
	 */
	hostLookup?: HostLookup;
	/**
	 * SMTP transport for email channels (`env.ALERT_EMAIL`). Unset on hosts
	 * that cannot send mail: an email channel then fails delivery (logged,
	 * retried next tick) instead of being skipped.
	 */
	email?: AlertEmailTransport;
}

async function fireEmail(
	channel: AlertEmailChannel,
	payload: WebhookPayload,
	logger: Logger,
	tracer?: ChildSpanRunner,
	delivery: WebhookDeliveryOptions = {},
): Promise<boolean> {
	const transport = delivery.email;
	if (!transport) {
		logger.error(
			"[alerts-evaluator] email channel has no SMTP transport on this collector",
			{ rule_id: payload.rule.id, recipients: channel.to.length },
		);
		return false;
	}
	const exec = async (
		span: { setAttribute(k: string, v: unknown): void } | null,
	): Promise<boolean> => {
		try {
			await transport.send({ to: channel.to, ...formatAlertEmail(payload) });
			if (span) span.setAttribute("alert.email.sent", true);
			return true;
		} catch (err) {
			if (span) span.setAttribute("alert.email.sent", false);
			logger.error("[alerts-evaluator] email delivery failed", {
				rule_id: payload.rule.id,
				recipients: channel.to.length,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	};
	if (!tracer) return exec(null);
	return tracer("email.alert", async (span) => exec(span), {
		"alert.state": payload.state,
		"alert.email.recipients": channel.to.length,
	});
}

async function fireWebhook(
	channel: AlertWebhookChannel,
	payload: WebhookPayload,
	logger: Logger,
	tracer?: ChildSpanRunner,
	delivery: WebhookDeliveryOptions = {},
): Promise<boolean> {
	// Hook URLs carry secrets in the path (Slack, PagerDuty…): logs and span
	// attributes only ever see the redacted form.
	const target = redactWebhookUrl(channel.url);
	// Re-check at fire time: rules created before the host guard existed
	// (or with the opt-in later removed) must not reach internal addresses.
	try {
		const url = assertSafeWebhookUrl(channel.url, {
			allowPrivateNetworks: delivery.allowPrivateWebhookTargets,
		});
		if (!delivery.allowPrivateWebhookTargets && delivery.hostLookup) {
			const resolution = await resolveWebhookHost(
				url.hostname,
				delivery.hostLookup,
			);
			if (resolution === "private") {
				throw new Error(
					`channel.url host "${url.hostname}" resolves to a private address`,
				);
			}
			if (resolution === "unresolvable") {
				throw new Error(
					`channel.url host "${url.hostname}" could not be resolved; refusing to deliver blind`,
				);
			}
		}
	} catch (err) {
		logger.error("[alerts-evaluator] webhook target refused", {
			url: target,
			error: err instanceof Error ? err.message : String(err),
		});
		return false;
	}
	const exec = async (
		span: { setAttribute(k: string, v: unknown): void } | null,
	): Promise<boolean> => {
		try {
			const response = await fetch(channel.url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...(channel.headers ?? {}),
				},
				body: JSON.stringify(payload),
				// Never follow redirects: a 3xx could re-aim the POST (and its
				// headers) at an arbitrary host. A redirecting hook is a
				// misconfiguration and counts as a failed delivery.
				redirect: "manual",
				signal: AbortSignal.timeout(5000),
			});
			if (span) span.setAttribute("http.response.status_code", response.status);
			if (response.status >= 300 && response.status < 400) {
				logger.error("[alerts-evaluator] webhook responded with a redirect", {
					url: target,
					status: response.status,
				});
				return false;
			}
			return response.ok;
		} catch (err) {
			logger.error("[alerts-evaluator] webhook delivery failed", {
				url: target,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	};
	if (!tracer) return exec(null);
	return tracer("webhook.alert", async (span) => exec(span), {
		"http.method": "POST",
		"http.url": target,
		"alert.state": payload.state,
	});
}

async function fireChannels(
	channels: AlertChannel[],
	payload: WebhookPayload,
	logger: Logger,
	tracer?: ChildSpanRunner,
	delivery: WebhookDeliveryOptions = {},
): Promise<boolean> {
	if (channels.length === 0) return true;
	const results = await Promise.all(
		channels.map((ch) => {
			if (ch.type === "webhook")
				return fireWebhook(
					ch as AlertWebhookChannel,
					payload,
					logger,
					tracer,
					delivery,
				);
			if (ch.type === "email")
				return fireEmail(ch, payload, logger, tracer, delivery);
			logger.error("[alerts-evaluator] unknown channel type", {
				rule_id: payload.rule.id,
				type: String((ch as { type?: unknown }).type),
			});
			return Promise.resolve(false);
		}),
	);
	return results.every(Boolean);
}

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), ms);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function mapWithConcurrency<T, R>(
	items: T[],
	concurrency: number,
	mapper: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;
	const workerCount = Math.min(concurrency, items.length);
	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			while (nextIndex < items.length) {
				const current = nextIndex++;
				results[current] = await mapper(items[current]);
			}
		}),
	);
	return results;
}

/** Pending-hold settings for one batch (see `evaluateRuleBatch`). */
interface HoldOptions {
	maxEvaluationGapMs: number;
	holdStartedAt?: string;
}

async function evaluateOneRule(
	store: AlertEvaluatorStore,
	rule: AlertRule,
	logger: Logger,
	tracer: ChildSpanRunner | undefined,
	ruleTimeoutMs: number,
	delivery: WebhookDeliveryOptions,
	hold: HoldOptions,
	onAlertFiring?: (rule: AlertRule) => Promise<void>,
): Promise<{ fired: number; resolved: number; redelivered: number }> {
	const none = { fired: 0, resolved: 0, redelivered: 0 };
	let previousForError: AlertState | null = null;
	try {
		const priorState = await store.getState(rule.id, rule.projectId);
		const previous: AlertState = priorState?.current_state ?? "ok";
		previousForError = previous;
		const raw = await withTimeout<number | AlertRuleEvaluation>(
			store.evaluateRuleWithStatus
				? store.evaluateRuleWithStatus(rule)
				: store.evaluateRule(rule),
			ruleTimeoutMs,
			`rule evaluation timed out after ${ruleTimeoutMs}ms`,
		);
		const { value, noData } =
			typeof raw === "number" ? { value: raw, noData: false } : raw;
		const now = new Date().toISOString();
		const nowMs = Date.parse(now);
		const keepOnNoData =
			noData &&
			rule.signal === "metrics" &&
			(rule.query as AlertQueryMetrics).noData === "keep";
		const matches =
			!keepOnNoData && compareValue(value, rule.threshold, rule.comparison);

		// Pending duration (Prometheus `for`): a rule that is not firing only
		// fires once its condition has held on consecutive evaluations for
		// `pendingSecs`. alert_state keeps when the hold started
		// (pending_since) and when it was last seen (pending_seen_at). The
		// hold is broken by an evaluation that does not match, by a gap
		// between evaluations longer than `maxEvaluationGapMs` (missed ticks,
		// a stopped collector), by a hold last seen before this collector
		// process started (`holdStartedAt`), and by editing the rule.
		// Resolution stays immediate.
		const pendingSecs = rule.pendingSecs ?? 0;
		const pendingSince = priorState?.pending_since ?? null;
		const seenAt = priorState?.pending_seen_at ?? pendingSince;
		const holdBroken =
			pendingSince !== null &&
			(seenAt === null ||
				nowMs - Date.parse(seenAt) > hold.maxEvaluationGapMs ||
				(hold.holdStartedAt !== undefined && seenAt < hold.holdStartedAt));
		let pendingActive = pendingSince !== null;
		let shouldFire = matches;
		if (matches && previous === "ok" && pendingSecs > 0) {
			const since = holdBroken || pendingSince === null ? now : pendingSince;
			await store.setPending(
				rule.id,
				rule.projectId,
				{ since, seenAt: now },
				rule.createdAt,
			);
			pendingActive = true;
			shouldFire = nowMs - Date.parse(since) >= pendingSecs * 1000;
		}
		const next: AlertState = keepOnNoData
			? previous
			: shouldFire
				? "firing"
				: "ok";
		// Cleared once the hold ended or turned into a firing transition.
		const clearPending = async () => {
			if (pendingActive && (!matches || next === "firing")) {
				await store.setPending(rule.id, rule.projectId, null, rule.createdAt);
			}
		};
		const outcome: AlertEvaluationOutcome = keepOnNoData ? "no_data" : "value";

		// Stage 6: when the rule is bound to an analysis, pull the
		// latest narrative + status so the webhook payload describes
		// what's happening, not just "value > threshold".
		const analysisAttachment = rule.analysisId
			? await store
					.getAnalysisNarrative(rule.projectId, rule.analysisId)
					.then((n) =>
						n
							? {
									id: rule.analysisId as string,
									narrative: n.narrative,
									status: n.status,
								}
							: undefined,
					)
					.catch(() => undefined)
			: undefined;

		const deliver = (state: AlertState) =>
			fireChannels(
				rule.channels,
				{
					rule: { id: rule.id, name: rule.name, signal: rule.signal },
					value,
					threshold: rule.threshold,
					comparison: rule.comparison,
					state,
					evaluatedAt: now,
					projectId: rule.projectId,
					analysis: analysisAttachment,
				},
				logger,
				tracer,
				delivery,
			);

		if (previous !== next) {
			// The stored state is what the dashboard shows and must follow the
			// signal, not the webhook: record the transition first (with its
			// notification outstanding, `alert_state.notified = 0`), then
			// notify. On accepted delivery the flag is flipped for exactly this
			// transition; otherwise the same-state branch below retries on the
			// next tick without a second transition.
			await store.transitionState(rule.id, rule.projectId, next, now);
			await clearPending();
			if (next === "firing" && onAlertFiring) {
				await onAlertFiring(rule).catch(() => undefined);
			}
			const ok = await deliver(next);
			// Acknowledge before writing history: if the evaluation insert
			// fails, the delivered flag is already durable and the next tick
			// will not send the same alert again.
			if (ok) {
				await store.markNotified(rule.id, rule.projectId, next, now);
			}
			await store.recordEvaluation(
				rule.id,
				rule.projectId,
				value,
				next,
				ok,
				outcome,
			);
			if (!ok) {
				logger.warn(
					"[alerts-evaluator] state recorded but delivery failed; will retry",
					{ rule_id: rule.id, project_id: rule.projectId, state: next },
				);
			}
			return next === "firing"
				? { fired: 1, resolved: 0, redelivered: 0 }
				: { fired: 0, resolved: 1, redelivered: 0 };
		}

		await clearPending();

		// Same state. While the transition into it is still marked undelivered,
		// retry the notification; the state itself is already correct. A row
		// without the flag (schema before migration 049) counts as delivered.
		// This also runs on a no-data tick: the owed notice is about a past
		// transition.
		const owed = priorState !== null && priorState.notified === 0;
		if (owed) {
			const ok = await deliver(previous);
			if (ok) {
				await store.markNotified(
					rule.id,
					rule.projectId,
					previous,
					priorState.last_state_change,
				);
			}
			await store.recordEvaluation(
				rule.id,
				rule.projectId,
				value,
				next,
				ok,
				outcome,
			);
			if (!ok) {
				logger.warn("[alerts-evaluator] delivery retry failed; will retry", {
					rule_id: rule.id,
					project_id: rule.projectId,
					state: previous,
				});
				return none;
			}
			return { fired: 0, resolved: 0, redelivered: 1 };
		}

		// Same state, already notified — write an evaluation, do not fire.
		await store.recordEvaluation(
			rule.id,
			rule.projectId,
			value,
			next,
			false,
			outcome,
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger.error("[alerts-evaluator] rule evaluation failed", {
			rule_id: rule.id,
			project_id: rule.projectId,
			error: message,
		});
		// Leave a trace in the rule's history: an `error` evaluation in the
		// unchanged state. Best effort; the database may be what failed.
		if (previousForError !== null) {
			await store
				.recordEvaluation(
					rule.id,
					rule.projectId,
					0,
					previousForError,
					false,
					"error",
					message,
				)
				.catch(() => undefined);
		}
	}

	return none;
}

export async function evaluateRuleBatch(
	store: AlertEvaluatorStore,
	rules: AlertRule[],
	options?: {
		logger?: Logger;
		tracer?: ChildSpanRunner;
		concurrency?: number;
		ruleTimeoutMs?: number;
		allowPrivateWebhookTargets?: boolean;
		hostLookup?: HostLookup;
		email?: AlertEmailTransport;
		onAlertFiring?: (rule: AlertRule) => Promise<void>;
		/**
		 * Longest gap between two evaluations that still continues a pending
		 * hold. Default `DEFAULT_MAX_EVALUATION_GAP_MS` (two 5-minute ticks);
		 * pass twice the host's evaluation interval.
		 */
		maxEvaluationGapMs?: number;
		/**
		 * ISO start of this collector process. A hold last seen before it
		 * starts over, as Prometheus resets `for` on restart. Unset on hosts
		 * without a long-lived process (Workers), where the gap rule applies.
		 */
		holdStartedAt?: string;
	},
): Promise<{
	evaluated: number;
	fired: number;
	resolved: number;
	/** Notifications for an earlier transition that were delivered on this tick. */
	redelivered: number;
}> {
	const logger = options?.logger ?? consoleLogger;
	const delivery: WebhookDeliveryOptions = {
		allowPrivateWebhookTargets: options?.allowPrivateWebhookTargets,
		hostLookup: options?.hostLookup,
		email: options?.email,
	};
	const concurrency = Math.max(
		1,
		Math.floor(options?.concurrency ?? DEFAULT_RULE_CONCURRENCY),
	);
	const ruleTimeoutMs = Math.max(
		1,
		Math.floor(options?.ruleTimeoutMs ?? DEFAULT_RULE_TIMEOUT_MS),
	);
	const results = await mapWithConcurrency(rules, concurrency, (rule) =>
		evaluateOneRule(
			store,
			rule,
			logger,
			options?.tracer,
			ruleTimeoutMs,
			delivery,
			{
				maxEvaluationGapMs:
					options?.maxEvaluationGapMs ?? DEFAULT_MAX_EVALUATION_GAP_MS,
				holdStartedAt: options?.holdStartedAt,
			},
			options?.onAlertFiring,
		),
	);
	return {
		evaluated: rules.length,
		fired: results.reduce((sum, result) => sum + result.fired, 0),
		resolved: results.reduce((sum, result) => sum + result.resolved, 0),
		redelivered: results.reduce((sum, result) => sum + result.redelivered, 0),
	};
}

export async function evaluateAllRules(
	env: CollectorEnv,
	options?: {
		logger?: Logger;
		tracer?: ChildSpanRunner;
		concurrency?: number;
		ruleTimeoutMs?: number;
		hostLookup?: HostLookup;
		maxEvaluationGapMs?: number;
		holdStartedAt?: string;
	},
): Promise<{
	evaluated: number;
	fired: number;
	resolved: number;
	redelivered: number;
}> {
	const logger = options?.logger ?? consoleLogger;
	const tracer = options?.tracer;
	const allowPrivateWebhookTargets = env.ALERT_WEBHOOK_ALLOW_PRIVATE === "true";
	const db = sqlDbFor(env);
	const store = new AlertsStore(db, {
		allowPrivateWebhookTargets,
		emailDeliveryAvailable: Boolean(env.ALERT_EMAIL),
	});
	const rules = await store.listEnabledRules();
	return evaluateRuleBatch(store, rules, {
		logger,
		tracer,
		concurrency: options?.concurrency,
		ruleTimeoutMs: options?.ruleTimeoutMs,
		allowPrivateWebhookTargets,
		hostLookup: options?.hostLookup,
		email: env.ALERT_EMAIL,
		maxEvaluationGapMs: options?.maxEvaluationGapMs,
		holdStartedAt: options?.holdStartedAt,
		onAlertFiring: async (rule) => {
			// Target the rule's service when it names one (environment taken from
			// that service's latest spans); otherwise fall back to the rule itself.
			const target = await resolveServiceIncidentTarget(
				db,
				rule.projectId,
				(rule.query as { serviceName?: string }).serviceName,
				`alert:${rule.id}`,
				logger,
			);
			await openOrDeduplicateIncident(db, rule.projectId, {
				environment: target.environment,
				targetNodeId: target.targetNodeId,
				symptomAnchorKind: "alert",
				symptomAnchorId: rule.id,
			});
		},
	});
}

/**
 * Scheduled handler suitable for wrangler cron triggers. Dispatches on the
 * cron expression so multiple triggers can share this handler.
 */
export function createAlertEvaluatorHandler() {
	return {
		async scheduled(
			_event: { cron: string },
			env: CollectorEnv,
			ctx: {
				waitUntil(promise: Promise<unknown>): void;
			},
		) {
			ctx.waitUntil(evaluateAllRules(env));
		},
	};
}
