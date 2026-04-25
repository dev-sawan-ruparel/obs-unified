import type { LogRecord, StoredSpan } from "@obs/types";
import type { CollectorEnv } from "../framework/env";
import type { TailEvent } from "../durable-objects/tail-hub";

/**
 * Fire-and-forget publish to the TailHub DO. Swallows errors — tail is a
 * best-effort UX feature; a broadcast failure must never break ingest.
 */
export async function publishTail(
	env: CollectorEnv,
	events: TailEvent[],
): Promise<void> {
	if (!env.TAIL_HUB || events.length === 0) return;
	try {
		const id = env.TAIL_HUB.idFromName("singleton");
		const stub = env.TAIL_HUB.get(id);
		await stub.fetch("https://hub/publish", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(events),
		});
	} catch (err) {
		console.error("[tail-publisher] publish failed:", err);
	}
}

export function spanToTailEvent(span: StoredSpan): TailEvent {
	return {
		kind: "span",
		projectId: span.projectId,
		row: {
			traceId: span.traceId,
			spanId: span.spanId,
			parentSpanId: span.parentSpanId,
			serviceName: span.serviceName,
			spanName: span.spanName,
			spanKind: span.spanKind,
			statusCode: span.statusCode,
			statusMessage: span.statusMessage,
			startTime: span.startTime,
			endTime: span.endTime,
			durationMs: span.durationMs,
		},
		t: span.receivedAt,
	};
}

export function logToTailEvent(log: LogRecord): TailEvent {
	return {
		kind: "log",
		projectId: log.projectId,
		row: {
			logId: log.logId,
			traceId: log.traceId,
			spanId: log.spanId,
			serviceName: log.serviceName,
			severity: log.severity,
			loggerName: log.loggerName,
			message: log.message,
			occurredAt: log.occurredAt,
		},
		t: log.receivedAt,
	};
}
