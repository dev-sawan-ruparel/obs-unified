import type { AICallInput, AICallPayload } from "@obs/types";
import { getActiveSpan } from "./span";

export interface AILoggerConfig {
	collectorUrl: string;
	authToken?: string;
	serviceName: string;
}

let aiConfig: AILoggerConfig | null = null;
let aiBuffer: AICallInput[] = [];

export function initAI(config: AILoggerConfig) {
	aiConfig = config;
}

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

	aiBuffer.push(fullCall);

	if (aiBuffer.length >= 10) {
		flushAICalls().catch(console.error);
	}
}

export async function flushAICalls() {
	if (!aiConfig || aiBuffer.length === 0) return;

	const payload: AICallPayload = { calls: [...aiBuffer] };
	aiBuffer = [];

	try {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (aiConfig.authToken) {
			headers["Authorization"] = `Bearer ${aiConfig.authToken}`;
		}

		await fetch(`${aiConfig.collectorUrl}/v1/ai`, {
			method: "POST",
			headers,
			body: JSON.stringify(payload),
		});
	} catch (err) {
		console.error("Failed to flush AI calls:", err);
	}
}
