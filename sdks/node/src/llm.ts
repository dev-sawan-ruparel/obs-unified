/**
 * OpenInference-shaped LLM and tool span helpers.
 *
 * The OpenInference convention is what Arize Phoenix, Datadog LLM
 * Observability, and (importantly) the obs-unified dashboard's AI tab
 * all read. Stamping the right attributes here lets your traces render
 * as proper LLM call cards rather than generic spans.
 *
 * Usage:
 *
 *   const json = await withLLMSpan(
 *     { provider: "openai", model: "gpt-4o-mini" },
 *     async (span) => {
 *       const response = await fetch(url, { ... });
 *       const json = await response.json();
 *       span.setUsage({
 *         inputTokens: json.usage.prompt_tokens,
 *         outputTokens: json.usage.completion_tokens,
 *       });
 *       return json;
 *     },
 *   );
 *
 *   const result = await withToolSpan(
 *     { name: "list_analyses", args: { group: "Health" } },
 *     async (span) => {
 *       const out = await dispatch(...);
 *       span.setOutcome(out.error ? "error" : "ok");
 *       span.setResultCount(out.length);
 *       return out;
 *     },
 *   );
 */

import { type Span, SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

const TRACER_NAME = "@obs-unified/sdk";

const tracer = () => trace.getTracer(TRACER_NAME);

// ── LLM spans ────────────────────────────────────────────────────────────────

export interface LLMOptions {
	/** "openai" / "anthropic" / "google" / etc. Stamped as `gen_ai.system`. */
	provider: string;
	/** Model id, e.g. "gpt-4o-mini" / "claude-haiku-4-5". Stamped as `gen_ai.request.model`. */
	model: string;
	/** Optional max-tokens hint, stamped as `gen_ai.request.max_tokens`. */
	maxTokens?: number;
	/** Optional system message (truncated). For trace replay. */
	systemMessage?: string;
	/** Optional turn index for agent loops. Stamped as `llm.turn`. */
	turnIndex?: number;
	/** Free-form attributes merged onto the span before fn runs. */
	attributes?: Record<string, string | number | boolean>;
}

export interface LLMSpanHandle {
	/** Underlying OTel span — use for advanced cases. */
	readonly otel: Span;
	/** Stamps `gen_ai.usage.input_tokens` / `output_tokens` / `total_tokens`. */
	setUsage(usage: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	}): void;
	/** Stamps `gen_ai.response.finish_reason`. */
	setFinishReason(reason: string): void;
	/** Stamps `gen_ai.response.model` (set when the response model differs from request). */
	setResponseModel(model: string): void;
	/** Forward to the underlying span. */
	setAttribute(key: string, value: string | number | boolean): void;
}

const truncate = (s: string, max = 1024): string =>
	s.length > max ? `${s.slice(0, max)}…` : s;

export const withLLMSpan = async <T>(
	opts: LLMOptions,
	fn: (span: LLMSpanHandle) => Promise<T>,
): Promise<T> => {
	return tracer().startActiveSpan(
		`llm.${opts.provider}.chat`,
		{ kind: SpanKind.CLIENT },
		async (otelSpan) => {
			otelSpan.setAttribute("openinference.span.kind", "LLM");
			otelSpan.setAttribute("gen_ai.system", opts.provider);
			otelSpan.setAttribute("gen_ai.request.model", opts.model);
			if (opts.maxTokens !== undefined)
				otelSpan.setAttribute("gen_ai.request.max_tokens", opts.maxTokens);
			if (opts.systemMessage)
				otelSpan.setAttribute(
					"gen_ai.system_message",
					truncate(opts.systemMessage),
				);
			if (opts.turnIndex !== undefined)
				otelSpan.setAttribute("llm.turn", opts.turnIndex);
			if (opts.attributes) {
				for (const [k, v] of Object.entries(opts.attributes))
					otelSpan.setAttribute(k, v);
			}

			const handle: LLMSpanHandle = {
				otel: otelSpan,
				setUsage: (usage) => {
					if (usage.inputTokens !== undefined)
						otelSpan.setAttribute(
							"gen_ai.usage.input_tokens",
							usage.inputTokens,
						);
					if (usage.outputTokens !== undefined)
						otelSpan.setAttribute(
							"gen_ai.usage.output_tokens",
							usage.outputTokens,
						);
					if (usage.totalTokens !== undefined)
						otelSpan.setAttribute(
							"gen_ai.usage.total_tokens",
							usage.totalTokens,
						);
				},
				setFinishReason: (reason) =>
					otelSpan.setAttribute("gen_ai.response.finish_reason", reason),
				setResponseModel: (model) =>
					otelSpan.setAttribute("gen_ai.response.model", model),
				setAttribute: (k, v) => otelSpan.setAttribute(k, v),
			};

			try {
				const result = await fn(handle);
				otelSpan.setStatus({ code: SpanStatusCode.OK });
				return result;
			} catch (err) {
				otelSpan.recordException(err as Error);
				otelSpan.setStatus({
					code: SpanStatusCode.ERROR,
					message: err instanceof Error ? err.message : String(err),
				});
				throw err;
			} finally {
				otelSpan.end();
			}
		},
	);
};

// ── Tool spans (agent loop dispatch) ─────────────────────────────────────────

export interface ToolOptions {
	/** Tool name, e.g. "list_analyses". Stamped as `tool.name` and span name `tool.<name>`. */
	name: string;
	/** Tool arguments. JSON-stringified and truncated to 512 chars. */
	args?: unknown;
	/** Free-form attributes merged onto the span before fn runs. */
	attributes?: Record<string, string | number | boolean>;
}

export interface ToolSpanHandle {
	readonly otel: Span;
	/** Outcome: "ok", "error", "not_found", "missing_arg", etc. */
	setOutcome(outcome: string): void;
	/** Number of items returned, when the tool is list-shaped. */
	setResultCount(count: number): void;
	setAttribute(key: string, value: string | number | boolean): void;
}

const safeStringify = (value: unknown): string => {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

export const withToolSpan = async <T>(
	opts: ToolOptions,
	fn: (span: ToolSpanHandle) => Promise<T>,
): Promise<T> => {
	return tracer().startActiveSpan(
		`tool.${opts.name}`,
		{ kind: SpanKind.INTERNAL },
		async (otelSpan) => {
			otelSpan.setAttribute("openinference.span.kind", "TOOL");
			otelSpan.setAttribute("tool.name", opts.name);
			if (opts.args !== undefined)
				otelSpan.setAttribute(
					"tool.args",
					safeStringify(opts.args).slice(0, 512),
				);
			if (opts.attributes) {
				for (const [k, v] of Object.entries(opts.attributes))
					otelSpan.setAttribute(k, v);
			}

			const handle: ToolSpanHandle = {
				otel: otelSpan,
				setOutcome: (outcome) => otelSpan.setAttribute("tool.outcome", outcome),
				setResultCount: (count) =>
					otelSpan.setAttribute("tool.result_count", count),
				setAttribute: (k, v) => otelSpan.setAttribute(k, v),
			};

			try {
				const result = await fn(handle);
				otelSpan.setStatus({ code: SpanStatusCode.OK });
				return result;
			} catch (err) {
				otelSpan.recordException(err as Error);
				otelSpan.setStatus({
					code: SpanStatusCode.ERROR,
					message: err instanceof Error ? err.message : String(err),
				});
				throw err;
			} finally {
				otelSpan.end();
			}
		},
	);
};
