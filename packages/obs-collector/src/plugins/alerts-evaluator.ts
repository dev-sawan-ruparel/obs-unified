import type {
	AlertChannel,
	AlertRule,
	AlertState,
	AlertWebhookChannel,
} from "@obs-unified/types";
import type { CollectorEnv } from "../framework/env";
import {
	type ChildSpanRunner,
	consoleLogger,
	type Logger,
} from "../framework/logger";
import { AlertsStore, compareValue } from "../lib/alerts-store";
import { sqlDbFor } from "../lib/sql-db";

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

async function fireWebhook(
	channel: AlertWebhookChannel,
	payload: WebhookPayload,
	logger: Logger,
	tracer?: ChildSpanRunner,
): Promise<boolean> {
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
				signal: AbortSignal.timeout(5000),
			});
			if (span)
				span.setAttribute("http.response.status_code", response.status);
			return response.ok;
		} catch (err) {
			logger.error("[alerts-evaluator] webhook delivery failed", {
				url: channel.url,
				error: err instanceof Error ? err.message : String(err),
			});
			return false;
		}
	};
	if (!tracer) return exec(null);
	return tracer(
		"webhook.alert",
		async (span) => exec(span),
		{
			"http.method": "POST",
			"http.url": channel.url,
			"alert.state": payload.state,
		},
	);
}

async function fireChannels(
	channels: AlertChannel[],
	payload: WebhookPayload,
	logger: Logger,
	tracer?: ChildSpanRunner,
): Promise<boolean> {
	if (channels.length === 0) return true;
	const results = await Promise.all(
		channels
			.filter((ch): ch is AlertWebhookChannel => ch.type === "webhook")
			.map((ch) => fireWebhook(ch, payload, logger, tracer)),
	);
	return results.every(Boolean);
}

export async function evaluateAllRules(
	env: CollectorEnv,
	options?: { logger?: Logger; tracer?: ChildSpanRunner },
): Promise<{
	evaluated: number;
	fired: number;
	resolved: number;
}> {
	const logger = options?.logger ?? consoleLogger;
	const tracer = options?.tracer;
	const store = new AlertsStore(sqlDbFor(env));
	const rules = await store.listEnabledRules();

	let fired = 0;
	let resolved = 0;

	for (const rule of rules) {
		try {
			const value = await store.evaluateRule(rule);
			const shouldFire = compareValue(value, rule.threshold, rule.comparison);
			const priorState = await store.getState(rule.id);
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

			if (previous === "ok" && next === "firing") {
				const ok = await fireChannels(
					rule.channels,
					{
						rule: { id: rule.id, name: rule.name, signal: rule.signal },
						value,
						threshold: rule.threshold,
						comparison: rule.comparison,
						state: "firing",
						evaluatedAt: now,
						projectId: rule.projectId,
						analysis: analysisAttachment,
					},
					logger,
					tracer,
				);
				await store.transitionState(rule.id, rule.projectId, "firing", now);
				await store.recordEvaluation(
					rule.id,
					rule.projectId,
					value,
					"firing",
					ok,
				);
				fired += 1;
			} else if (previous === "firing" && next === "ok") {
				const ok = await fireChannels(
					rule.channels,
					{
						rule: { id: rule.id, name: rule.name, signal: rule.signal },
						value,
						threshold: rule.threshold,
						comparison: rule.comparison,
						state: "ok",
						evaluatedAt: now,
						projectId: rule.projectId,
						analysis: analysisAttachment,
					},
					logger,
					tracer,
				);
				await store.transitionState(rule.id, rule.projectId, "ok", now);
				await store.recordEvaluation(rule.id, rule.projectId, value, "ok", ok);
				resolved += 1;
			} else {
				// Same state — write an evaluation but do not fire channels.
				await store.recordEvaluation(
					rule.id,
					rule.projectId,
					value,
					next,
					false,
				);
			}
		} catch (err) {
			logger.error("[alerts-evaluator] rule evaluation failed", {
				rule_id: rule.id,
				project_id: rule.projectId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	return { evaluated: rules.length, fired, resolved };
}

/**
 * Scheduled handler suitable for wrangler cron triggers. Dispatches on the
 * cron expression so multiple triggers can share this handler.
 */
export function createAlertEvaluatorHandler() {
	return {
		async scheduled(
			event: { cron: string },
			env: CollectorEnv,
			ctx: {
				waitUntil(promise: Promise<unknown>): void;
			},
		) {
			ctx.waitUntil(evaluateAllRules(env));
		},
	};
}
