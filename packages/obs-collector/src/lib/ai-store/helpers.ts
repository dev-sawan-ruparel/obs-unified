import type { JsonValue } from "@obsunified/types";
import { computeCost } from "../ai-pricing";

export const attrNum = (
	attrs: Record<string, JsonValue>,
	key: string,
): number | null => {
	const v = attrs[key];
	return typeof v === "number" && Number.isFinite(v) ? v : null;
};

export const attrStr = (
	attrs: Record<string, JsonValue>,
	key: string,
): string | null => {
	const v = attrs[key];
	return typeof v === "string" && v.length > 0 ? v : null;
};

/**
 * Enrich a span's attributes with a computed `llm.cost.total_usd` when the
 * span has token counts but no reported cost. Mutates the passed attrs
 * object and returns the final cost (or null).
 */
export const enrichCost = (attrs: Record<string, JsonValue>): number | null => {
	const existing = attrNum(attrs, "llm.cost.total_usd");
	if (existing !== null) return existing;
	const model = attrStr(attrs, "llm.model_name");
	const prompt = attrNum(attrs, "llm.token_count.prompt");
	const completion = attrNum(attrs, "llm.token_count.completion");
	if (prompt === null && completion === null) return null;
	const cost = computeCost(model, prompt, completion);
	if (cost === null) return null;
	attrs["llm.cost.total_usd"] = cost;
	attrs["llm.cost.computed"] = true;
	return cost;
};
