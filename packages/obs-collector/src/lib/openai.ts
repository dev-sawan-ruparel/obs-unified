/**
 * RFC 0002 Stage 3 + 5 — OpenAI provider adapter.
 *
 * Mirrors `lib/llm.ts` (Anthropic) and the tool-use loop in `lib/ask.ts`,
 * but talks to OpenAI's /chat/completions (function-calling) shape:
 *
 *   - Auth: `Authorization: Bearer <key>`
 *   - Messages: { role: "system" | "user" | "assistant" | "tool", content }
 *   - Tools: top-level `tools: [{ type: "function", function: { name, description, parameters } }]`
 *   - Model emits `message.tool_calls: [{ id, type: "function", function: { name, arguments: "<json string>" } }]`
 *   - Tool results: `{ role: "tool", tool_call_id, content }`
 *   - Stop: `finish_reason === "stop"` for end_turn, `"tool_calls"` for tool use
 *
 * Same system prompts as Anthropic — the rendering rules don't change.
 * Same NarrativeRequest / AskRunDeps inputs so the dispatcher in
 * `lib/llm.ts` and `lib/ask.ts` is one-line.
 */

import type {
	AnalysisDefinition,
	AnalysisResult,
	AskEvidence,
	AskQuery,
	AskResponse,
} from "@obs-unified/types";
import { EVIDENCE_REFERENCE_CONTRACT } from "@obs-unified/types";
import type { AskRunDeps } from "./ask";
import { askEvidenceReferences } from "./evidence-references";
import type { LlmConfig, NarrativeRequest } from "./llm";
import { LlmCallError } from "./llm";

const DEFAULT_API_URL = "https://api.openai.com/v1";

const NARRATIVE_SYSTEM_PROMPT = `You write one-sentence operational narratives for a self-hosted observability dashboard.

Hard rules — violations are unusable:
1. Never start with "I", "Here's", "We", "It looks", or any first-person/chatbot framing. Write declarative statements about the system.
2. If you reference a trace, span, log, or service, include the supplied identifier inline (e.g. "trace abc12345").
3. Include a time anchor: "starting Nm ago", "for the last Nm", "since HH:MM" — pull from the inputs.
4. ≤ 2 sentences total, ≤ 220 characters. Numbers belong in the sentence, not in a separate label.
5. If the inputs are insufficient to write a useful sentence, output exactly the string NO_NARRATIVE (no quotes).

Tone: like a senior on-call writing a Slack message. Specific, blunt, no hedging, no advice ("you should..."), no questions.`;

const ASK_SYSTEM_PROMPT = `You answer operational questions about a self-hosted observability dashboard's telemetry. Use the supplied tools — do not invent numbers.

Workflow:
1. Use list_analyses to see what's available. Filter by group when it helps.
2. Pick the analyses most likely to answer the question. Call run_analysis on each (typically 1–3, max 5).
3. Read the results. Synthesize a 1–2 sentence answer.

Hard rules — violations are unusable:
1. Never start with "I", "Here's", "We", or any chatbot framing. Write declarative statements about the system.
2. Cite the analyses you consulted by id, e.g. "(latency_p95_overall)".
3. Include a time anchor when describing a number ("in the last 5 minutes", "vs the prior hour", "for the past 24h").
4. ≤ 2 sentences, ≤ 280 characters total. Numbers belong in the sentence.
5. If the available analyses don't cover the question, say exactly that and name the closest analysis you found.

Output: write only the final answer text. No preamble, no JSON.`;

const OPENAI_TOOLS = [
	{
		type: "function" as const,
		function: {
			name: "list_analyses",
			description:
				"List registered analyses for the current project. Optionally filter by group (Health, Services, Dependencies, Async, AI, Frontend, Custom). Returns id, title, group, source, view, and scope (when set).",
			parameters: {
				type: "object",
				properties: {
					group: { type: "string" },
					view: { type: "string" },
				},
			},
		},
	},
	{
		type: "function" as const,
		function: {
			name: "run_analysis",
			description:
				"Read the latest result for one analysis by id. Returns status, primary value, baseline, delta_pct, and the analysis-specific payload.",
			parameters: {
				type: "object",
				properties: {
					id: { type: "string" },
				},
				required: ["id"],
			},
		},
	},
];

interface OpenAiToolCall {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
}

interface OpenAiMessage {
	role: "system" | "user" | "assistant" | "tool";
	content?: string | null;
	tool_calls?: OpenAiToolCall[];
	tool_call_id?: string;
}

interface OpenAiChoice {
	index?: number;
	message?: OpenAiMessage;
	finish_reason?: string;
}

interface OpenAiResponse {
	choices?: OpenAiChoice[];
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
}

const baseUrl = (cfg: LlmConfig) =>
	(cfg.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");

interface PostMeta {
	maxTokens?: number;
	turnIndex?: number;
}

const post = async <T extends { usage?: OpenAiResponse["usage"] }>(
	cfg: LlmConfig,
	path: string,
	body: unknown,
	meta: PostMeta = {},
): Promise<T> => {
	const url = `${baseUrl(cfg)}${path}`;
	const exec = async (
		span: { setAttribute(k: string, v: unknown): void } | null,
	): Promise<T> => {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${cfg.apiKey}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			signal: cfg.signal,
		});
		if (span) span.setAttribute("http.response.status_code", response.status);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new LlmCallError(
				`openai ${response.status}: ${text.slice(0, 200)}`,
				response.status,
			);
		}
		const json = (await response.json()) as T;
		if (span && json.usage) {
			if (typeof json.usage.prompt_tokens === "number")
				span.setAttribute(
					"gen_ai.usage.input_tokens",
					json.usage.prompt_tokens,
				);
			if (typeof json.usage.completion_tokens === "number")
				span.setAttribute(
					"gen_ai.usage.output_tokens",
					json.usage.completion_tokens,
				);
			if (typeof json.usage.total_tokens === "number")
				span.setAttribute("gen_ai.usage.total_tokens", json.usage.total_tokens);
		}
		return json;
	};

	if (!cfg.tracer) return exec(null);
	const attrs: Record<string, unknown> = {
		"openinference.span.kind": "LLM",
		"gen_ai.system": "openai",
		"gen_ai.request.model": cfg.model,
		"http.url": url,
	};
	if (typeof meta.maxTokens === "number")
		attrs["gen_ai.request.max_tokens"] = meta.maxTokens;
	if (typeof meta.turnIndex === "number") attrs["llm.turn"] = meta.turnIndex;
	return cfg.tracer("llm.openai.chat", async (span) => exec(span), attrs);
};

// ── narrative (single-shot) ────────────────────────────────────────────────

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
		primary: r.primaryValue === null ? "n/a" : String(r.primaryValue),
		baseline: r.baselineValue === null ? "n/a" : String(r.baselineValue),
		delta_pct: r.deltaPct === null ? "n/a" : `${r.deltaPct.toFixed(1)}%`,
		service: typeof scope.service === "string" ? scope.service : "",
		trace_ids: traceIds,
	};
	return template.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? "");
};

const buildNarrativeUserPrompt = ({
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

	lines.push("", "Current state:");
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
		lines.push("", "Payload details:");
		for (const k of payloadKeys) {
			const v = current.payload[k];
			const rendered =
				typeof v === "string" || typeof v === "number" || typeof v === "boolean"
					? String(v)
					: JSON.stringify(v);
			if (rendered.length <= 200) lines.push(`- ${k}: ${rendered}`);
		}
	}
	lines.push(
		"",
		"Output: a single sentence (max two), no preamble, no quotes, no Markdown.",
	);
	return lines.join("\n");
};

export async function generateNarrativeOpenAI(
	req: NarrativeRequest,
	config: LlmConfig,
): Promise<string | null> {
	const body = await post<OpenAiResponse>(
		config,
		"/chat/completions",
		{
			model: config.model,
			messages: [
				{ role: "system", content: NARRATIVE_SYSTEM_PROMPT },
				{ role: "user", content: buildNarrativeUserPrompt(req) },
			],
			max_tokens: 200,
		},
		{ maxTokens: 200 },
	);
	const text = (body.choices?.[0]?.message?.content ?? "").trim();
	if (body.choices?.[0]?.finish_reason === "length") {
		throw new LlmCallError("openai response truncated by max_tokens");
	}
	if (!text || text === "NO_NARRATIVE") return null;
	return text.replace(/^["']|["']$/g, "").trim();
}

// ── ask (tool-use loop) ────────────────────────────────────────────────────

const MAX_ITERATIONS = 5;

const summarizeDefinition = (def: AnalysisDefinition) => ({
	id: def.id,
	title: def.title,
	group: def.group,
	source: def.source,
	view: def.view,
	scope: def.scope ?? null,
});

const summarizeResult = (
	def: AnalysisDefinition,
	result: AnalysisResult | null,
) => {
	if (!result) {
		return {
			definition: summarizeDefinition(def),
			result: null,
			note: "No result yet — analysis hasn't run.",
		};
	}
	return {
		definition: summarizeDefinition(def),
		result: {
			generatedAt: result.generatedAt,
			status: result.status,
			primaryValue: result.primaryValue,
			baselineValue: result.baselineValue,
			deltaPct: result.deltaPct,
			payload: result.payload,
			narrative: result.narrative,
		},
	};
};

export async function runAskOpenAI(
	question: string,
	deps: AskRunDeps,
): Promise<AskResponse> {
	const startedAt = new Date().toISOString();
	const queries: AskQuery[] = [];
	const evidence = new Map<string, AskEvidence>();

	const messages: OpenAiMessage[] = [
		{ role: "system", content: ASK_SYSTEM_PROMPT },
		{ role: "user", content: question },
	];

	for (let i = 0; i < MAX_ITERATIONS; i += 1) {
		const body = await post<OpenAiResponse>(
			deps.llm,
			"/chat/completions",
			{
				model: deps.llm.model,
				messages,
				tools: OPENAI_TOOLS,
				max_tokens: 1024,
			},
			{ maxTokens: 1024, turnIndex: i },
		);
		const choice = body.choices?.[0];
		const message = choice?.message;
		const toolCalls = message?.tool_calls ?? [];
		const finishReason = choice?.finish_reason;
		const text = (message?.content ?? "").trim();

		// Final answer.
		if (
			(!toolCalls || toolCalls.length === 0) &&
			(finishReason === "stop" || finishReason === undefined)
		) {
			return {
				answer: text.length > 0 ? text : null,
				evidence: [...evidence.values()],
				evidenceReferences: askEvidenceReferences(evidence.values()),
				evidenceContract: EVIDENCE_REFERENCE_CONTRACT,
				queries,
				error: text.length > 0 ? null : "model returned no text",
				timestamp: startedAt,
			};
		}

		// Append assistant message verbatim — must include tool_calls for the
		// next turn's tool result messages to be valid.
		messages.push({
			role: "assistant",
			content: message?.content ?? null,
			tool_calls: toolCalls,
		});

		// Execute each requested tool.
		for (const call of toolCalls) {
			const t0 = Date.now();
			let resultPayload: unknown;
			let parsedArgs: Record<string, unknown> = {};
			try {
				parsedArgs = call.function.arguments
					? (JSON.parse(call.function.arguments) as Record<string, unknown>)
					: {};
			} catch {
				parsedArgs = {};
			}
			if ((!toolCalls || toolCalls.length === 0) && finishReason === "length") {
				return {
					answer: null,
					evidence: [...evidence.values()],
					evidenceReferences: askEvidenceReferences(evidence.values()),
					evidenceContract: EVIDENCE_REFERENCE_CONTRACT,
					queries,
					error: "model response was truncated by max_tokens",
					timestamp: startedAt,
				};
			}
			const toolName = call.function.name;
			const tracer = deps.llm.tracer;
			const dispatchTool = async (
				span: { setAttribute(k: string, v: unknown): void } | null,
			): Promise<unknown> => {
				if (toolName === "list_analyses") {
					const all = await deps.listAnalyses({
						group:
							typeof parsedArgs.group === "string"
								? parsedArgs.group
								: undefined,
						view:
							typeof parsedArgs.view === "string" ? parsedArgs.view : undefined,
					});
					const out = all.slice(0, 80).map(summarizeDefinition);
					if (span) span.setAttribute("tool.result_count", out.length);
					queries.push({
						tool: "list_analyses",
						args: parsedArgs,
						durationMs: Date.now() - t0,
					});
					return out;
				}
				if (toolName === "run_analysis") {
					const id = typeof parsedArgs.id === "string" ? parsedArgs.id : "";
					if (!id) {
						if (span) span.setAttribute("tool.outcome", "missing_id");
						queries.push({
							tool: "run_analysis",
							args: parsedArgs,
							durationMs: Date.now() - t0,
						});
						return { error: "id is required" };
					}
					const found = await deps.getLatestResult(id);
					queries.push({
						tool: "run_analysis",
						args: parsedArgs,
						durationMs: Date.now() - t0,
					});
					if (!found) {
						if (span) span.setAttribute("tool.outcome", "not_found");
						return { error: `analysis ${id} not found` };
					}
					if (span) {
						span.setAttribute("tool.outcome", "ok");
						span.setAttribute("analysis.id", id);
						if (found.result) {
							span.setAttribute("analysis.status", found.result.status);
						}
					}
					evidence.set(id, {
						analysisId: id,
						definition: found.definition,
						result: found.result,
					});
					return summarizeResult(found.definition, found.result);
				}
				if (span) span.setAttribute("tool.outcome", "unknown_tool");
				return { error: `unknown tool: ${toolName}` };
			};
			try {
				if (tracer) {
					resultPayload = await tracer(
						`tool.${toolName}`,
						async (span) => dispatchTool(span),
						{
							"openinference.span.kind": "TOOL",
							"tool.name": toolName,
							"tool.args": JSON.stringify(parsedArgs).slice(0, 512),
						},
					);
				} else {
					resultPayload = await dispatchTool(null);
				}
			} catch (err) {
				resultPayload = {
					error: err instanceof Error ? err.message : String(err),
				};
			}
			messages.push({
				role: "tool",
				tool_call_id: call.id,
				content: JSON.stringify(resultPayload),
			});
		}
	}

	return {
		answer: null,
		evidence: [...evidence.values()],
		evidenceReferences: askEvidenceReferences(evidence.values()),
		evidenceContract: EVIDENCE_REFERENCE_CONTRACT,
		queries,
		error: `iteration cap (${MAX_ITERATIONS}) reached without final answer`,
		timestamp: startedAt,
	};
}
