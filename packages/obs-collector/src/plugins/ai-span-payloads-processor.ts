/**
 * Span processor that routes large AI payloads to the ai_span_payloads
 * side table.
 *
 * For every span that has an `openinference.span.kind` attribute, we look
 * for `ai.payload.input` / `ai.payload.output`, write them (plus the kind)
 * to `ai_span_payloads`, and strip them from the span's attributes_json
 * before it hits `telemetry_spans`.
 *
 * This keeps the hot spans table lean while preserving full replay data
 * for AI calls.
 */

import {
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	SESSION_ID_KEY,
	USER_ID_KEY,
	isOpenInferenceSpanKind,
} from "@obs/types/constants";
import type { JsonValue, StoredSpan } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

interface PayloadRow {
	projectId: string;
	traceId: string;
	spanId: string;
	spanKind: string;
	inputJson: string | null;
	outputJson: string | null;
	sessionId: string | null;
	userId: string | null;
	receivedAt: string;
	expiresAt: string;
}

const asString = (value: JsonValue | undefined): string | null =>
	typeof value === "string" && value.length > 0 ? value : null;

const toJsonString = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

export const aiSpanPayloadsProcessorPlugin: CollectorPlugin = {
	name: "ai-span-payloads-processor",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "ai-span-payloads-processor",
			async process(spans, context) {
				const rows: PayloadRow[] = [];

				const transformed = spans.map((span): StoredSpan => {
					const attrs = parseJsonRecord(span.attributesJson);
					const kind = attrs[OPENINFERENCE_SPAN_KIND_KEY];
					if (!isOpenInferenceSpanKind(kind)) return span;

					const rawInput = attrs[AI_PAYLOAD_INPUT_KEY];
					const rawOutput = attrs[AI_PAYLOAD_OUTPUT_KEY];
					const hasInput = rawInput !== undefined;
					const hasOutput = rawOutput !== undefined;

					// Always record the row for OpenInference spans so callers can
					// join on (trace_id, span_id) even when payloads are absent.
					rows.push({
						projectId: span.projectId,
						traceId: span.traceId,
						spanId: span.spanId,
						spanKind: kind,
						inputJson: hasInput ? toJsonString(rawInput) : null,
						outputJson: hasOutput ? toJsonString(rawOutput) : null,
						sessionId: asString(attrs[SESSION_ID_KEY]),
						userId: asString(attrs[USER_ID_KEY]),
						receivedAt: span.receivedAt,
						expiresAt: span.expiresAt,
					});

					if (!hasInput && !hasOutput) return span;

					// Strip payload attrs — they live in ai_span_payloads now.
					const stripped = { ...attrs };
					delete stripped[AI_PAYLOAD_INPUT_KEY];
					delete stripped[AI_PAYLOAD_OUTPUT_KEY];
					return { ...span, attributesJson: JSON.stringify(stripped) };
				});

				if (rows.length > 0) {
					try {
						const db = context.env.DB;
						const stmt = db.prepare(
							`INSERT OR REPLACE INTO ai_span_payloads (
								project_id, trace_id, span_id, span_kind,
								input_json, output_json, session_id, user_id,
								received_at, expires_at
							) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						);
						await db.batch(
							rows.map((r) =>
								stmt.bind(
									r.projectId,
									r.traceId,
									r.spanId,
									r.spanKind,
									r.inputJson,
									r.outputJson,
									r.sessionId,
									r.userId,
									r.receivedAt,
									r.expiresAt,
								),
							),
						);
					} catch (err) {
						// Don't fail the whole ingest on payload side-table issues —
						// the spans themselves are still useful.
						console.error("[ai-span-payloads-processor] write failed:", err);
					}
				}

				return transformed;
			},
		});
	},
};
