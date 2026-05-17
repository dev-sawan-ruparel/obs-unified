/**
 * Typed AI span helpers that emit OpenInference-compatible child spans.
 *
 * These replace ad-hoc `trackAICall()` with a tree of spans:
 *   agent → chain → retriever → llm → tool
 * Each helper wraps the active RequestSpan's createChildSpan() and stamps
 * OpenInference attributes (`openinference.span.kind`, `llm.*`, `tool.*`,
 * `retrieval.documents.*`, `embedding.*`).
 *
 * Large payloads (input/output) are attached via the `ai.payload.input` /
 * `ai.payload.output` attrs. The collector strips those off the span on
 * ingest and routes them to the ai_span_payloads side table so the hot
 * telemetry_spans table stays lean.
 */

import {
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	OpenInferenceSpanKind,
	SESSION_ID_KEY,
	USER_ID_KEY,
} from "@obs-unified/types/constants";
import type { ChildSpan } from "./span";
import { getActiveSpan } from "./span";

// ── Session context ────────────────────────────────────────────────────────
// Module-level session/user context — stamped on every AI span created
// within the context window. Per-span overrides still win via setAttribute.

interface AISessionContext {
	sessionId?: string;
	userId?: string;
}

let currentContext: AISessionContext = {};

/**
 * Set the session / user that subsequent AI spans should be grouped under.
 * Returns a function that restores the previous context — handy for
 * request-scoped patterns where you want the context cleared at the end.
 *
 * @example
 *   const reset = setAISessionContext({ sessionId: req.sessionId, userId: req.userId });
 *   try { await handle(req); } finally { reset(); }
 */
export function setAISessionContext(ctx: AISessionContext): () => void {
	const previous = currentContext;
	currentContext = { ...ctx };
	return () => {
		currentContext = previous;
	};
}

/** Clear the session context. */
export function clearAISessionContext(): void {
	currentContext = {};
}

/** Read the current session context (mostly for testing). */
export function getAISessionContext(): AISessionContext {
	return { ...currentContext };
}

// ── shared shape ────────────────────────────────────────────────────────────

export interface AISpan {
	readonly spanId: string;
	/** Set the output payload (completion, tool result, etc.) */
	setOutput(output: unknown): void;
	/** Mark the span as errored and end it. */
	setError(message: string): void;
	/** Add a custom attribute. */
	setAttribute(key: string, value: unknown): void;
	/** Finalize the span. Safe to call multiple times. */
	end(): void;
}

const NOOP_SPAN: AISpan = {
	spanId: "",
	setOutput() {},
	setError() {},
	setAttribute() {},
	end() {},
};

const stringify = (value: unknown): string => {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const createBaseSpan = (
	name: string,
	kind: OpenInferenceSpanKind,
	input?: unknown,
): { span: AISpan; child: ChildSpan } | null => {
	const parent = getActiveSpan();
	if (!parent) return null;
	const child = parent.createChildSpan(name);
	child.setAttribute(OPENINFERENCE_SPAN_KIND_KEY, kind);
	// Stamp ambient session/user context if set.
	if (currentContext.sessionId) {
		child.setAttribute(SESSION_ID_KEY, currentContext.sessionId);
	}
	if (currentContext.userId) {
		child.setAttribute(USER_ID_KEY, currentContext.userId);
	}
	if (input !== undefined) {
		child.setAttribute(AI_PAYLOAD_INPUT_KEY, stringify(input));
	}
	let ended = false;
	const span: AISpan = {
		get spanId() {
			return child.spanId;
		},
		setOutput(output) {
			child.setAttribute(AI_PAYLOAD_OUTPUT_KEY, stringify(output));
		},
		setError(message) {
			child.setStatus(2, message);
			if (!ended) {
				ended = true;
				child.end();
			}
		},
		setAttribute(key, value) {
			child.setAttribute(key, value);
		},
		end() {
			if (ended) return;
			ended = true;
			child.end();
		},
	};
	return { span, child };
};

// ── LLM ────────────────────────────────────────────────────────────────────

export interface LLMSpanOptions {
	model: string;
	provider: string;
	/** Prompt / messages / raw request body */
	input?: unknown;
	/** Optional custom span name (default: "llm") */
	name?: string;
}

export interface LLMSpan extends AISpan {
	setTokens(tokens: {
		prompt?: number;
		completion?: number;
		total?: number;
	}): void;
	setCost(usd: number): void;
}

export function startLLMSpan(opts: LLMSpanOptions): LLMSpan {
	const built = createBaseSpan(opts.name ?? "llm", OpenInferenceSpanKind.LLM, opts.input);
	if (!built) {
		return { ...NOOP_SPAN, setTokens() {}, setCost() {} };
	}
	const { span, child } = built;
	child.setAttribute("llm.model_name", opts.model);
	child.setAttribute("llm.provider", opts.provider);
	return {
		...span,
		setTokens({ prompt, completion, total }) {
			if (prompt !== undefined) child.setAttribute("llm.token_count.prompt", prompt);
			if (completion !== undefined) {
				child.setAttribute("llm.token_count.completion", completion);
			}
			if (total !== undefined) child.setAttribute("llm.token_count.total", total);
		},
		setCost(usd) {
			child.setAttribute("llm.cost.total_usd", usd);
		},
	};
}

// ── Tool ───────────────────────────────────────────────────────────────────

export interface ToolSpanOptions {
	name: string;
	parameters?: unknown;
	/** Optional description of the tool, for later display. */
	description?: string;
}

export function startToolSpan(opts: ToolSpanOptions): AISpan {
	const built = createBaseSpan(opts.name, OpenInferenceSpanKind.TOOL, opts.parameters);
	if (!built) return NOOP_SPAN;
	const { span, child } = built;
	child.setAttribute("tool.name", opts.name);
	if (opts.description) child.setAttribute("tool.description", opts.description);
	return span;
}

// ── Retriever ──────────────────────────────────────────────────────────────

export interface RetrievedDocument {
	id?: string;
	score?: number;
	content?: string;
	metadata?: Record<string, unknown>;
}

export interface RetrieverSpanOptions {
	query: string;
	name?: string;
}

export interface RetrieverSpan extends AISpan {
	addDocuments(docs: RetrievedDocument[]): void;
}

export function startRetrieverSpan(opts: RetrieverSpanOptions): RetrieverSpan {
	const built = createBaseSpan(
		opts.name ?? "retriever",
		OpenInferenceSpanKind.RETRIEVER,
		opts.query,
	);
	if (!built) return { ...NOOP_SPAN, addDocuments() {} };
	const { span, child } = built;
	child.setAttribute("retrieval.query", opts.query);
	return {
		...span,
		addDocuments(docs) {
			child.setAttribute("retrieval.documents.count", docs.length);
			docs.forEach((doc, i) => {
				if (doc.id !== undefined) {
					child.setAttribute(`retrieval.documents.${i}.document.id`, doc.id);
				}
				if (doc.score !== undefined) {
					child.setAttribute(`retrieval.documents.${i}.document.score`, doc.score);
				}
				if (doc.content !== undefined) {
					child.setAttribute(
						`retrieval.documents.${i}.document.content`,
						doc.content,
					);
				}
				if (doc.metadata !== undefined) {
					child.setAttribute(
						`retrieval.documents.${i}.document.metadata`,
						stringify(doc.metadata),
					);
				}
			});
			// Also attach the full list as the span output for easy replay.
			child.setAttribute(AI_PAYLOAD_OUTPUT_KEY, stringify(docs));
		},
	};
}

// ── Embedding ──────────────────────────────────────────────────────────────

export interface EmbeddingSpanOptions {
	model: string;
	provider?: string;
	input: string | string[];
	name?: string;
}

export function startEmbeddingSpan(opts: EmbeddingSpanOptions): AISpan {
	const built = createBaseSpan(
		opts.name ?? "embedding",
		OpenInferenceSpanKind.EMBEDDING,
		opts.input,
	);
	if (!built) return NOOP_SPAN;
	const { span, child } = built;
	child.setAttribute("embedding.model_name", opts.model);
	if (opts.provider) child.setAttribute("embedding.provider", opts.provider);
	return span;
}

// ── Chain / Agent ──────────────────────────────────────────────────────────

export interface ChainSpanOptions {
	name: string;
	input?: unknown;
}

export function startChainSpan(opts: ChainSpanOptions): AISpan {
	const built = createBaseSpan(opts.name, OpenInferenceSpanKind.CHAIN, opts.input);
	return built ? built.span : NOOP_SPAN;
}

export function startAgentSpan(opts: ChainSpanOptions): AISpan {
	const built = createBaseSpan(opts.name, OpenInferenceSpanKind.AGENT, opts.input);
	return built ? built.span : NOOP_SPAN;
}
