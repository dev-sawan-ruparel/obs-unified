/**
 * Vendor pricing table for computing llm.cost.total_usd from token counts
 * when a span didn't report cost directly. Conservative — only covers the
 * models we see most often; unknown models get $0 and we log once per model.
 *
 * Prices are USD per 1M tokens. Keep in sync with vendor rate cards.
 * Values as of mid-2026; when stale, bump and add a migration note.
 */

export interface ModelPricing {
	inputPer1M: number;
	outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
	// OpenAI
	"gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
	"gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
	"gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
	"gpt-4": { inputPer1M: 30, outputPer1M: 60 },
	"gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
	o1: { inputPer1M: 15, outputPer1M: 60 },
	"o1-mini": { inputPer1M: 3, outputPer1M: 12 },

	// Anthropic
	"claude-3-5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
	"claude-3-5-haiku": { inputPer1M: 0.8, outputPer1M: 4 },
	"claude-3-opus": { inputPer1M: 15, outputPer1M: 75 },
	"claude-3-sonnet": { inputPer1M: 3, outputPer1M: 15 },
	"claude-3-haiku": { inputPer1M: 0.25, outputPer1M: 1.25 },
	"claude-opus-4": { inputPer1M: 15, outputPer1M: 75 },
	"claude-sonnet-4": { inputPer1M: 3, outputPer1M: 15 },

	// Google
	"gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5 },
	"gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
	"gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

// Resolve a model identifier to its pricing by longest-prefix match so
// `gpt-4o-2024-11-20` hits `gpt-4o`, `claude-3-5-sonnet-20240620` hits
// `claude-3-5-sonnet`, etc.
const lookupCache = new Map<string, ModelPricing | null>();

export function getModelPricing(
	model: string | null | undefined,
): ModelPricing | null {
	if (!model) return null;
	const normalized = model.toLowerCase();
	const cached = lookupCache.get(normalized);
	if (cached !== undefined) return cached;

	let best: { key: string; pricing: ModelPricing } | null = null;
	for (const [key, pricing] of Object.entries(PRICING)) {
		if (normalized.startsWith(key) && (!best || key.length > best.key.length)) {
			best = { key, pricing };
		}
	}
	const result = best?.pricing ?? null;
	lookupCache.set(normalized, result);
	return result;
}

/**
 * Compute USD cost from token counts using the pricing table. Returns null
 * when the model is unknown — caller should fall back to the cost attribute
 * on the span (if any) rather than reporting $0.
 */
export function computeCost(
	model: string | null | undefined,
	promptTokens: number | null | undefined,
	completionTokens: number | null | undefined,
): number | null {
	const pricing = getModelPricing(model);
	if (!pricing) return null;
	const input = ((promptTokens ?? 0) * pricing.inputPer1M) / 1_000_000;
	const output = ((completionTokens ?? 0) * pricing.outputPer1M) / 1_000_000;
	return input + output;
}
