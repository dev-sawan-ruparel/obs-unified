/**
 * RFC 0002 Stage 3 — narrative LLM adapter.
 *
 * Single-provider for v1 (Anthropic). The shape is "stuff in a system
 * prompt that bakes the rendering rules, ask for one declarative
 * sentence, return text" — a different provider plugs in here without
 * changing callers.
 *
 * Rendering rules from the RFC's UX section, enforced at the system
 * prompt layer so the model can't accidentally drift:
 *
 *   1. Never start with "I" or "Here's" — declarative, not chatbot.
 *   2. Always cite — if the prompt mentions "the trace", a trace_id
 *      must follow inline.
 *   3. Include a time anchor ("starting 8 min ago", "since 14:32").
 *   4. ≤2 sentences. We're labelling tiles, not writing essays.
 */

import type { AnalysisDefinition, AnalysisResult } from "@obs/types";

export interface NarrativeRequest {
	definition: AnalysisDefinition;
	current: AnalysisResult;
	previous: AnalysisResult | null;
}

export interface LlmConfig {
	apiKey: string;
	model: string; // e.g. "claude-haiku-4-5"
	apiUrl?: string; // default https://api.anthropic.com/v1/messages
}

const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You write one-sentence operational narratives for a self-hosted observability dashboard.

Hard rules — violations are unusable:
1. Never start with "I", "Here's", "We", "It looks", or any first-person/chatbot framing. Write declarative statements about the system.
2. If you reference a trace, span, log, or service, include the supplied identifier inline (e.g. "trace abc12345").
3. Include a time anchor: "starting Nm ago", "for the last Nm", "since HH:MM" — pull from the inputs.
4. ≤ 2 sentences total, ≤ 220 characters. Numbers belong in the sentence, not in a separate label.
5. If the inputs are insufficient to write a useful sentence, output exactly the string NO_NARRATIVE (no quotes).

Tone: like a senior on-call writing a Slack message. Specific, blunt, no hedging, no advice ("you should..."), no questions.`;

const renderTemplate = (
	template: string,
	def: AnalysisDefinition,
	r: AnalysisResult,
): string => {
	const scope = (def.scope ?? {}) as Record<string, unknown>;
	const traceIds = Array.isArray(r.payload?.trace_ids)
		? (r.payload.trace_ids as unknown[])
				.filter((x): x is string => typeof x === "string")
				.slice(0, 5)
				.join(", ")
		: "";
	const subs: Record<string, string> = {
		title: def.title,
		status: r.status,
		primary:
			r.primaryValue === null ? "n/a" : String(r.primaryValue),
		baseline:
			r.baselineValue === null ? "n/a" : String(r.baselineValue),
		delta_pct:
			r.deltaPct === null ? "n/a" : `${r.deltaPct.toFixed(1)}%`,
		service: typeof scope.service === "string" ? scope.service : "",
		trace_ids: traceIds,
	};
	return template.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? "");
};

const buildUserPrompt = ({
	definition,
	current,
	previous,
}: NarrativeRequest): string => {
	const lines: string[] = [];
	const tmplRendered = renderTemplate(
		definition.narrate?.prompt ?? "",
		definition,
		current,
	).trim();
	if (tmplRendered) lines.push(tmplRendered);

	lines.push("");
	lines.push("Current state:");
	lines.push(`- panel: ${definition.title}`);
	lines.push(`- status: ${current.status}`);
	if (current.primaryValue !== null)
		lines.push(`- primary: ${current.primaryValue}`);
	if (current.baselineValue !== null)
		lines.push(`- baseline (1h): ${current.baselineValue}`);
	if (current.deltaPct !== null)
		lines.push(`- delta vs baseline: ${current.deltaPct.toFixed(1)}%`);

	const since = previous
		? Math.max(
				1,
				Math.round(
					(new Date(current.generatedAt).getTime() -
						new Date(previous.generatedAt).getTime()) /
						60000,
				),
			)
		: null;
	if (since !== null) {
		lines.push(
			`- previous run was ${since} minute${since === 1 ? "" : "s"} ago, status=${previous?.status ?? "n/a"}`,
		);
	}

	const payloadKeys = Object.keys(current.payload ?? {}).filter(
		(k) => k !== "sparkline",
	);
	if (payloadKeys.length > 0) {
		lines.push("");
		lines.push("Payload details:");
		for (const k of payloadKeys) {
			const v = current.payload[k];
			const rendered =
				typeof v === "string" || typeof v === "number" || typeof v === "boolean"
					? String(v)
					: JSON.stringify(v);
			if (rendered.length <= 200) lines.push(`- ${k}: ${rendered}`);
		}
	}

	lines.push("");
	lines.push(
		"Output: a single sentence (max two), no preamble, no quotes, no Markdown.",
	);
	return lines.join("\n");
};

export class LlmCallError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null = null) {
		super(message);
		this.name = "LlmCallError";
		this.status = status;
	}
}

/**
 * Call Anthropic's /messages endpoint and return a one-line narrative.
 *
 * Returns `null` when:
 *   - the model returns the sentinel NO_NARRATIVE
 *   - the response is empty
 * Throws `LlmCallError` on non-2xx HTTP responses so the runner can
 * count the failure against the budget without writing a bogus narrative.
 */
export async function generateNarrative(
	req: NarrativeRequest,
	config: LlmConfig,
): Promise<string | null> {
	const url = config.apiUrl ?? DEFAULT_API_URL;
	const userPrompt = buildUserPrompt(req);

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"x-api-key": config.apiKey,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: config.model,
			max_tokens: 200,
			system: SYSTEM_PROMPT,
			messages: [{ role: "user", content: userPrompt }],
		}),
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new LlmCallError(
			`anthropic ${response.status}: ${text.slice(0, 200)}`,
			response.status,
		);
	}

	const body = (await response.json()) as {
		content?: Array<{ type?: string; text?: string }>;
	};
	const text = (body.content ?? [])
		.filter((block) => block?.type === "text")
		.map((block) => block?.text ?? "")
		.join("")
		.trim();

	if (!text || text === "NO_NARRATIVE") return null;
	// Strip any accidental wrapping quotes the model might add despite the
	// system prompt.
	return text.replace(/^["']|["']$/g, "").trim();
}
