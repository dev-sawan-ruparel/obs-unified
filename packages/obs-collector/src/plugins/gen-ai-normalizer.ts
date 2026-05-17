/**
 * Normalize OpenTelemetry `gen_ai.*` semantic-convention attributes into
 * OpenInference equivalents, so spans emitted by vendor auto-instrumentation
 * (OpenAI SDK, Anthropic SDK, Vercel AI SDK, LangChain, …) flow through the
 * same AI pipeline as spans from our typed SDK helpers.
 *
 * References:
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   https://github.com/Arize-ai/openinference/blob/main/spec/
 *
 * Must run BEFORE ai-span-payloads-processor — that processor assumes
 * `openinference.span.kind` and `ai.payload.*` are already set.
 */

import {
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	OpenInferenceSpanKind,
} from "@obs-unified/types/constants";
import type { JsonValue, StoredSpan } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";

const GEN_AI_PREFIX = "gen_ai.";

// Map gen_ai operation.name → OpenInference span kind.
const operationToKind = (op: unknown): string => {
	if (typeof op !== "string") return OpenInferenceSpanKind.LLM;
	const lower = op.toLowerCase();
	if (lower.includes("embed")) return OpenInferenceSpanKind.EMBEDDING;
	if (lower.includes("tool")) return OpenInferenceSpanKind.TOOL;
	if (lower.includes("agent")) return OpenInferenceSpanKind.AGENT;
	// chat, text_completion, completion, responses — all LLM
	return OpenInferenceSpanKind.LLM;
};

const asNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
};

const toJsonString = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

/**
 * Collect prompt/completion blobs emitted under various `gen_ai.prompt*` or
 * `gen_ai.completion*` keys. Different vendors serialize differently:
 *  - `gen_ai.prompt` (single string or JSON)
 *  - `gen_ai.prompt.0.role` + `gen_ai.prompt.0.content` (indexed messages)
 *  - `gen_ai.completion` (single string)
 *  - `gen_ai.completion.0.role` + `gen_ai.completion.0.content`
 */
const collectIndexed = (
	attrs: Record<string, JsonValue>,
	prefix: string,
): unknown | undefined => {
	const scalar = attrs[prefix];
	if (scalar !== undefined) return scalar;

	const messages: Array<Record<string, JsonValue>> = [];
	const indexed = Object.keys(attrs).filter((k) => k.startsWith(`${prefix}.`));
	if (indexed.length === 0) return undefined;

	for (const key of indexed) {
		// prefix.<index>.<field>
		const rest = key.slice(prefix.length + 1);
		const dot = rest.indexOf(".");
		if (dot < 0) continue;
		const idx = Number.parseInt(rest.slice(0, dot), 10);
		if (!Number.isFinite(idx)) continue;
		const field = rest.slice(dot + 1);
		messages[idx] = messages[idx] ?? {};
		messages[idx][field] = attrs[key];
	}

	const compact = messages.filter(
		(m): m is Record<string, JsonValue> => m !== undefined,
	);
	return compact.length > 0 ? compact : undefined;
};

export const genAiNormalizerPlugin: CollectorPlugin = {
	name: "gen-ai-normalizer",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "gen-ai-normalizer",
			process(spans) {
				return spans.map((span): StoredSpan => {
					const attrs = parseJsonRecord(span.attributesJson);

					// Skip spans that already carry OpenInference metadata.
					if (attrs[OPENINFERENCE_SPAN_KIND_KEY] !== undefined) return span;

					// Only normalize if at least one gen_ai.* attribute is present.
					const hasGenAi = Object.keys(attrs).some((k) =>
						k.startsWith(GEN_AI_PREFIX),
					);
					if (!hasGenAi) return span;

					const normalized: Record<string, JsonValue> = { ...attrs };
					const kind = operationToKind(attrs["gen_ai.operation.name"]);
					normalized[OPENINFERENCE_SPAN_KIND_KEY] = kind;

					// Model + provider
					const model =
						(attrs["gen_ai.response.model"] as string | undefined) ||
						(attrs["gen_ai.request.model"] as string | undefined);
					const provider = attrs["gen_ai.system"];
					if (kind === OpenInferenceSpanKind.LLM) {
						if (typeof model === "string")
							normalized["llm.model_name"] = model;
						if (typeof provider === "string")
							normalized["llm.provider"] = provider;
					} else if (kind === OpenInferenceSpanKind.EMBEDDING) {
						if (typeof model === "string")
							normalized["embedding.model_name"] = model;
						if (typeof provider === "string")
							normalized["embedding.provider"] = provider;
					}

					// Token usage (both singular + plural variants seen in the wild).
					const promptTokens =
						asNumber(attrs["gen_ai.usage.input_tokens"]) ??
						asNumber(attrs["gen_ai.usage.prompt_tokens"]);
					const completionTokens =
						asNumber(attrs["gen_ai.usage.output_tokens"]) ??
						asNumber(attrs["gen_ai.usage.completion_tokens"]);
					if (promptTokens !== undefined)
						normalized["llm.token_count.prompt"] = promptTokens;
					if (completionTokens !== undefined)
						normalized["llm.token_count.completion"] = completionTokens;
					if (promptTokens !== undefined && completionTokens !== undefined) {
						normalized["llm.token_count.total"] =
							promptTokens + completionTokens;
					}

					// Payloads — let ai-span-payloads-processor route these to the
					// side table. We only set the keys if we find prompts/completions.
					if (normalized[AI_PAYLOAD_INPUT_KEY] === undefined) {
						const input = collectIndexed(attrs, "gen_ai.prompt");
						if (input !== undefined) {
							normalized[AI_PAYLOAD_INPUT_KEY] = toJsonString(input) ?? "";
						}
					}
					if (normalized[AI_PAYLOAD_OUTPUT_KEY] === undefined) {
						const output = collectIndexed(attrs, "gen_ai.completion");
						if (output !== undefined) {
							normalized[AI_PAYLOAD_OUTPUT_KEY] = toJsonString(output) ?? "";
						}
					}

					return {
						...span,
						attributesJson: JSON.stringify(normalized),
					};
				});
			},
		});
	},
};
