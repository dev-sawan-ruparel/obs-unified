import type {
	AlertChannel,
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
import { AlertsStore, compareValue } from "../lib/alerts-store";
import { openOrDeduplicateIncident } from "../lib/autosre-remediation-gate";
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
	getState(
		ruleId: string,
		projectId: string,
	): Promise<{
		current_state: AlertState;
		last_state_change: string;
		/** 0 while the transition's notification is owed; absent pre-049 (= delivered). */
		notified?: number;
	} | null>;
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
	): Promise<void>;
}

interface WebhookPayload {
	rule: {
		id: string;
		name: string;
		signal: string;
	};
	value: number;
	threshold: number;
	comparison: string;
	state: AlertState;
	evaluatedAt: string;
	projectId: string;
	/**
	 * RFC 0002 Stage 6 — populated when the rule is bound to an Analysis
	 * (`rule.analysisId` set). The narrative is the gated, LLM-generated
	 * sentence the dashboard panel was last showing — what's actually
	 * happening, in plain English. Webhooks consuming this can put the
	 * narrative in the Slack/PagerDuty body directly.
	 */
	analysis?: {
		id: string;
		narrative: string | null;
		status: string | null;
	};
}

export interface WebhookDeliveryOptions {
	/** Permit targets on loopback / private / link-local hosts. */
	allowPrivateWebhookTargets?: boolean;
	/**
	 * Resolver used to refuse public names that point at private addresses.
	 * Hosts that can resolve (Node: `dns.lookup`) pass one; Workers cannot
	 * reach private networks from `fetch` and leave it unset.
	 */
	hostLookup?: HostLookup;
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
		channels
			.filter((ch): ch is AlertWebhookChannel => ch.type === "webhook")
			.map((ch) => fireWebhook(ch, payload, logger, tracer, delivery)),
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

async function evaluateOneRule(
	store: AlertEvaluatorStore,
	rule: AlertRule,
	logger: Logger,
	tracer: ChildSpanRunner | undefined,
	ruleTimeoutMs: number,
	delivery: WebhookDeliveryOptions,
	onAlertFiring?: (rule: AlertRule) => Promise<void>,
): Promise<{ fired: number; resolved: number; redelivered: number }> {
	const none = { fired: 0, resolved: 0, redelivered: 0 };
	try {
		const value = await withTimeout(
			store.evaluateRule(rule),
			ruleTimeoutMs,
			`rule evaluation timed out after ${ruleTimeoutMs}ms`,
		);
		const shouldFire = compareValue(value, rule.threshold, rule.comparison);
		const priorState = await store.getState(rule.id, rule.projectId);
		const previous: AlertState = priorState?.current_state ?? "ok";
		const next: AlertState = shouldFire ? "firing" : "ok";
		const now = new Date().toISOString();

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
			await store.recordEvaluation(rule.id, rule.projectId, value, next, ok);
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

		// Same state. While the transition into it is still marked undelivered,
		// retry the notification; the state itself is already correct. A row
		// without the flag (schema before migration 049) counts as delivered.
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
			await store.recordEvaluation(rule.id, rule.projectId, value, next, ok);
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
		await store.recordEvaluation(rule.id, rule.projectId, value, next, false);
	} catch (err) {
		logger.error("[alerts-evaluator] rule evaluation failed", {
			rule_id: rule.id,
			project_id: rule.projectId,
			error: err instanceof Error ? err.message : String(err),
		});
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
		onAlertFiring?: (rule: AlertRule) => Promise<void>;
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
	const store = new AlertsStore(db, { allowPrivateWebhookTargets });
	const rules = await store.listEnabledRules();
	return evaluateRuleBatch(store, rules, {
		logger,
		tracer,
		concurrency: options?.concurrency,
		ruleTimeoutMs: options?.ruleTimeoutMs,
		allowPrivateWebhookTargets,
		hostLookup: options?.hostLookup,
		onAlertFiring: async (rule) => {
			await openOrDeduplicateIncident(db, rule.projectId, {
				environment: "default",
				targetNodeId: `alert:${rule.id}`,
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
