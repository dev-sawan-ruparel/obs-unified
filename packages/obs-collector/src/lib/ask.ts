/**
 * RFC 0002 Stage 5 — Ask box tool-use loop.
 *
 * The user asks "is checkout slow?", we hand it to an LLM with two
 * tools that look at the analyses catalog:
 *
 *   list_analyses(group?)       → AnalysisDefinition[]
 *   run_analysis(id)            → { definition, result }
 *
 * The loop runs until the model emits a final assistant message or we
 * hit the iteration cap. Why two tools and not one big "ask anything"
 * prompt: the analyses we've already derived (60+ panels on the OTel
 * demo) cover most "is X slow / errors / unhealthy?" questions, and
 * pointing the model at structured data with known shape is far more
 * reliable than asking it to write SQL from scratch. Ad-hoc SQL lands
 * later as a third tool with SELECT-only validation.
 *
 * The model is instructed to cite analysis ids inline so the UI can
 * link the cited evidence; we surface a flat `queries` audit log so
 * users can verify what was actually consulted.
 */

import type {
	AnalysisDefinition,
	AnalysisResult,
	AskEvidence,
	AskQuery,
	AskResponse,
} from "@obsunified/types";
import { EVIDENCE_REFERENCE_CONTRACT } from "@obsunified/types";
import { askEvidenceReferences } from "./evidence-references";
import type { LlmConfig } from "./llm";

const DEFAULT_API_URL = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You answer operational questions about a self-hosted observability dashboard's telemetry. Use the supplied tools — do not invent numbers.

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

const TOOLS = [
	{
		name: "list_analyses",
		description:
			"List registered analyses for the current project. Optionally filter by group (Health, Services, Dependencies, Async, AI, Frontend, Custom). Returns id, title, group, source, view, and scope (when set).",
		input_schema: {
			type: "object" as const,
			properties: {
				group: {
					type: "string",
					description: "Filter by group. Omit to see all.",
				},
				view: {
					type: "string",
					description:
						"Filter by view: 'tile' for fast panels, 'page' for investigations.",
				},
			},
		},
	},
	{
		name: "run_analysis",
		description:
			"Read the latest result for one analysis by id. Returns status, primary value, baseline, delta_pct, and the analysis-specific payload (which often contains the most useful data — top services, span names, etc).",
		input_schema: {
			type: "object" as const,
			properties: {
				id: {
					type: "string",
					description: "Analysis id, e.g. 'overall_error_rate'.",
				},
			},
			required: ["id"],
		},
	},
];

const MAX_ITERATIONS = 5;

interface AnthropicContentBlock {
	type: "text" | "tool_use" | "tool_result";
	text?: string;
	id?: string;
	name?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: string;
}

interface AnthropicResponse {
	content?: AnthropicContentBlock[];
	stop_reason?: string;
}

export interface AskRunDeps {
	listAnalyses: (filters?: {
		group?: string;
		view?: string;
	}) => Promise<AnalysisDefinition[]>;
	getLatestResult: (id: string) => Promise<{
		definition: AnalysisDefinition;
		result: AnalysisResult | null;
	} | null>;
	llm: LlmConfig;
}

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

export async function runAsk(
	question: string,
	deps: AskRunDeps,
): Promise<AskResponse> {
	if (deps.llm.provider === "openai") {
		// Lazy import to keep Anthropic-only paths zero-cost.
		const { runAskOpenAI } = await import("./openai");
		return runAskOpenAI(question, deps);
	}
	return runAskAnthropic(question, deps);
}

async function runAskAnthropic(
	question: string,
	deps: AskRunDeps,
): Promise<AskResponse> {
	const startedAt = new Date().toISOString();
	const queries: AskQuery[] = [];
	const evidence = new Map<string, AskEvidence>();

	const messages: Array<{
		role: "user" | "assistant";
		content: string | AnthropicContentBlock[];
	}> = [{ role: "user", content: question }];

	for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
		const response = await callAnthropic(deps.llm, messages, iteration);

		const toolUses = (response.content ?? []).filter(
			(b) => b.type === "tool_use",
		);
		const finalText = (response.content ?? [])
			.filter((b) => b.type === "text")
			.map((b) => b.text ?? "")
			.join("")
			.trim();

		// Model finished — return the answer.
		if (response.stop_reason === "max_tokens") {
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

		if (response.stop_reason === "end_turn" || toolUses.length === 0) {
			return {
				answer: finalText.length > 0 ? finalText : null,
				evidence: [...evidence.values()],
				evidenceReferences: askEvidenceReferences(evidence.values()),
				evidenceContract: EVIDENCE_REFERENCE_CONTRACT,
				queries,
				error: finalText.length > 0 ? null : "model returned no text",
				timestamp: startedAt,
			};
		}

		// Append the assistant's tool_use message verbatim.
		messages.push({
			role: "assistant",
			content: response.content ?? [],
		});

		// Execute every tool_use the assistant requested in this turn.
		const toolResultBlocks: AnthropicContentBlock[] = [];
		for (const block of toolUses) {
			const t0 = Date.now();
			let resultPayload: unknown;
			const tracer = deps.llm.tracer;
			const toolName = block.name;
			const args = block.input ?? {};
			const dispatchTool = async (
				span: { setAttribute(k: string, v: unknown): void } | null,
			): Promise<unknown> => {
				if (toolName === "list_analyses") {
					const all = await deps.listAnalyses({
						group: typeof args.group === "string" ? args.group : undefined,
						view: typeof args.view === "string" ? args.view : undefined,
					});
					const out = all.slice(0, 80).map(summarizeDefinition);
					if (span) span.setAttribute("tool.result_count", out.length);
					queries.push({
						tool: "list_analyses",
						args,
						durationMs: Date.now() - t0,
					});
					return out;
				}
				if (toolName === "run_analysis") {
					const id = typeof args.id === "string" ? args.id : "";
					if (!id) {
						if (span) span.setAttribute("tool.outcome", "missing_id");
						queries.push({
							tool: "run_analysis",
							args,
							durationMs: Date.now() - t0,
						});
						return { error: "id is required" };
					}
					const found = await deps.getLatestResult(id);
					queries.push({
						tool: "run_analysis",
						args,
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
							"tool.args": JSON.stringify(args).slice(0, 512),
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
			toolResultBlocks.push({
				type: "tool_result",
				tool_use_id: block.id,
				content: JSON.stringify(resultPayload),
			});
		}

		messages.push({
			role: "user",
			content: toolResultBlocks,
		});
	}

	// Hit iteration cap — return whatever evidence we accumulated with an error.
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

async function callAnthropic(
	config: LlmConfig,
	messages: Array<{
		role: "user" | "assistant";
		content: string | AnthropicContentBlock[];
	}>,
	turnIndex?: number,
): Promise<AnthropicResponse> {
	const url = config.apiUrl ?? DEFAULT_API_URL;
	const exec = async (
		span: { setAttribute(k: string, v: unknown): void } | null,
	): Promise<AnthropicResponse> => {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"x-api-key": config.apiKey,
				"anthropic-version": "2023-06-01",
				"content-type": "application/json",
			},
			body: JSON.stringify({
				model: config.model,
				max_tokens: 1024,
				system: SYSTEM_PROMPT,
				tools: TOOLS,
				messages,
			}),
		});
		if (span) span.setAttribute("http.response.status_code", response.status);
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`anthropic ${response.status}: ${text.slice(0, 200)}`);
		}
		const json = (await response.json()) as AnthropicResponse & {
			usage?: { input_tokens?: number; output_tokens?: number };
		};
		if (span && json.usage) {
			if (typeof json.usage.input_tokens === "number")
				span.setAttribute("gen_ai.usage.input_tokens", json.usage.input_tokens);
			if (typeof json.usage.output_tokens === "number")
				span.setAttribute(
					"gen_ai.usage.output_tokens",
					json.usage.output_tokens,
				);
		}
		if (span && json.stop_reason)
			span.setAttribute("gen_ai.response.finish_reason", json.stop_reason);
		return json;
	};

	if (!config.tracer) return exec(null);
	const attrs: Record<string, unknown> = {
		"openinference.span.kind": "LLM",
		"gen_ai.system": "anthropic",
		"gen_ai.request.model": config.model,
		"gen_ai.request.max_tokens": 1024,
		"http.url": url,
	};
	if (typeof turnIndex === "number") attrs["llm.turn"] = turnIndex;
	return config.tracer(
		"llm.anthropic.messages",
		async (span) => exec(span),
		attrs,
	);
}
