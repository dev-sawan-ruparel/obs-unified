import type { AICallInput, AICallPayload } from "@obs/types";
import { getActiveSpan } from "./span";

export interface AILoggerConfig {
	collectorUrl: string;
	authToken?: string;
	serviceName: string;
	/**
	 * Additional HTTP headers attached to every `/v1/ai` POST. Mirrors
	 * `LoggerConfig.extraHeaders` — used by the collector for self-emit
	 * loop prevention. See apps/collector/SELF_INSTRUMENTATION.md.
	 */
	extraHeaders?: Record<string, string>;
}

const MAX_BUFFER_SIZE = 200;

let aiConfig: AILoggerConfig | null = null;
let aiBuffer: AICallInput[] = [];
let flushInProgress = false;

export function initAI(config: AILoggerConfig) {
	aiConfig = config;
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

	const fullCall: AICallInput = {
		...call,
		traceId: span?.traceId,
		spanId: span?.spanId,
		serviceName: aiConfig?.serviceName || "unknown-service",
		occurredAt: new Date().toISOString(),
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
			headers["Authorization"] = `Bearer ${aiConfig.authToken}`;
		}

		await fetch(`${aiConfig.collectorUrl}/v1/ai`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000),
		});
	} catch (err) {
		console.error("Failed to flush AI calls:", err);
	} finally {
		flushInProgress = false;
	}
}
