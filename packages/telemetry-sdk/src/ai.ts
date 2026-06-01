import type { AICallInput, AICallPayload } from "@obs-unified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_ID_KEY,
	ACTION_ROOT_ID_KEY,
} from "@obs-unified/types/constants";
import { type FlushLifecycle, installFlushLifecycle } from "./flush-lifecycle";
import { getActiveActionContext, getActiveSpan } from "./span";

export interface AILoggerConfig {
	collectorUrl: string;
	authToken?: string;
	serviceName: string;
	/** Periodic flush interval in milliseconds. Set to 0 to disable. */
	flushIntervalMs?: number;
	/**
	 * Additional HTTP headers attached to every `/v1/ai` POST. Mirrors
	 * `LoggerConfig.extraHeaders` — used by the collector for self-emit
	 * loop prevention. See apps/collector/SELF_INSTRUMENTATION.md.
	 */
	extraHeaders?: Record<string, string>;
}

const MAX_BUFFER_SIZE = 200;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
type BufferedAICall = AICallInput & Record<string, unknown>;

let aiConfig: AILoggerConfig | null = null;
const aiBuffer: BufferedAICall[] = [];
let flushInProgress = false;
let flushLifecycle: FlushLifecycle | null = null;

export function initAI(config: AILoggerConfig) {
	aiConfig = config;
	flushLifecycle?.stop();
	flushLifecycle = installFlushLifecycle({
		name: "AI telemetry",
		flush: flushAICalls,
		intervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
	});
}

export function shutdownAI() {
	flushLifecycle?.stop();
	flushLifecycle = null;
	return flushAICalls();
}

/**
 * @deprecated Use typed span helpers from `./ai-spans` instead —
 * `startLLMSpan`, `startToolSpan`, `startRetrieverSpan`, etc. They emit
 * OpenInference-compatible spans into the trace tree, which unlocks
 * tool-call / RAG / agent-loop debugging and parity with Arize Phoenix.
 *
 * `trackAICall` will continue to work against the legacy `/v1/ai` endpoint
 * and `ai_calls` table during the migration, but is scheduled for removal
 * once the dashboard reads exclusively from `/internal/ai/spans`.
 */
export function trackAICall(
	call: Omit<AICallInput, "traceId" | "spanId" | "serviceName" | "occurredAt">,
) {
	const span = getActiveSpan();
	const actionContext = getActiveActionContext();

	const fullCall: BufferedAICall = {
		...call,
		traceId: span?.traceId,
		spanId: span?.spanId,
		serviceName: aiConfig?.serviceName || "unknown-service",
		occurredAt: new Date().toISOString(),
		...(actionContext
			? {
					[ACTION_ID_KEY]: actionContext.actionId,
					[ACTION_ROOT_ID_KEY]: actionContext.rootActionId,
					...(actionContext.causedByActionId
						? {
								[ACTION_CAUSED_BY_ID_KEY]: actionContext.causedByActionId,
							}
						: {}),
				}
			: {}),
	};

	// Drop oldest entries if buffer is at hard cap (collector unreachable)
	if (aiBuffer.length >= MAX_BUFFER_SIZE) {
		aiBuffer.splice(0, aiBuffer.length - MAX_BUFFER_SIZE + 1);
	}
	aiBuffer.push(fullCall);

	if (aiBuffer.length >= 10 && !flushInProgress) {
		flushAICalls().catch(console.error);
	}
}

export async function flushAICalls() {
	if (!aiConfig || aiBuffer.length === 0 || flushInProgress) return;

	flushInProgress = true;
	const batch = aiBuffer.splice(0, aiBuffer.length);
	const payload: AICallPayload = { calls: batch };

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...(aiConfig.extraHeaders ?? {}),
		};
		if (aiConfig.authToken) {
			headers.Authorization = `Bearer ${aiConfig.authToken}`;
		}

		await fetch(`${aiConfig.collectorUrl}/v1/ai`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		console.error("Failed to flush AI calls:", err);
		requeueAICalls(batch);
	} finally {
		flushInProgress = false;
	}
}

function requeueAICalls(batch: BufferedAICall[]): void {
	if (batch.length === 0) return;
	aiBuffer.unshift(...batch);
	if (aiBuffer.length > MAX_BUFFER_SIZE) {
		aiBuffer.splice(0, aiBuffer.length - MAX_BUFFER_SIZE);
	}
}
