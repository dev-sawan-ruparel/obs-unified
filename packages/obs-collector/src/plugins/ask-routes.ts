/**
 * RFC 0002 Stage 5 — Ask box HTTP surface.
 *
 *   POST /internal/ask  { question }  → AskResponse
 *
 * The dashboard's top-bar AskBox calls this once per question. Single-turn
 * for v1; the conversational `/ask` thread (with follow-ups + "Save as
 * panel") lands in a follow-up commit.
 *
 * The route does no SQL itself — it composes runAsk() from the catalog
 * lookups (AnalysesStore + getAllAnalysesForProject) and the LLM config.
 * If ANTHROPIC_API_KEY is unset we return a structured error rather than
 * 500-ing, so the dashboard can render a "set ANTHROPIC_API_KEY to
 * enable Ask" hint instead of a generic failure.
 */

import type { AskRequest, AskResponse } from "@obs/types";
import { getAllAnalysesForProject } from "../analyses/index";
import type { CollectorPlugin } from "../framework/collector";
import { AnalysesStore } from "../lib/analyses-store";
import { runAsk } from "../lib/ask";
import type { LlmConfig } from "../lib/llm";
import { getProjectId } from "./_context";

const MAX_QUESTION_CHARS = 1000;

export const askRoutesPlugin: CollectorPlugin = {
	name: "ask-routes",
	register(app, runtime) {
		app.post("/internal/ask", async (c) => {
			let body: Partial<AskRequest> = {};
			try {
				body = (await c.req.json()) as Partial<AskRequest>;
			} catch {
				return c.json(
					{ error: "Bad Request", message: "body must be JSON" },
					400,
				);
			}
			const question = (body.question ?? "").trim();
			if (!question) {
				return c.json(
					{ error: "Bad Request", message: "question is required" },
					400,
				);
			}
			if (question.length > MAX_QUESTION_CHARS) {
				return c.json(
					{
						error: "Bad Request",
						message: `question exceeds ${MAX_QUESTION_CHARS} chars`,
					},
					400,
				);
			}

			const projectId = getProjectId(c);
			// OpenAI wins if both keys are set.
			// Empty strings in .dev.vars come through as "" (not undefined),
			// so coerce to undefined explicitly — otherwise an empty
			// OPENAI_BASE_URL clobbers the default and we end up POSTing
			// to a relative URL.
			const openaiBase = c.env.OPENAI_BASE_URL?.trim()
				? c.env.OPENAI_BASE_URL
				: undefined;
			const narrativeModel = c.env.NARRATIVE_MODEL?.trim()
				? c.env.NARRATIVE_MODEL
				: undefined;
			const llm: LlmConfig | null = c.env.OPENAI_API_KEY?.trim()
				? {
						provider: "openai",
						apiKey: c.env.OPENAI_API_KEY,
						model: narrativeModel ?? "gpt-4o-mini",
						apiUrl: openaiBase,
						tracer: runtime.withChildSpan,
					}
				: c.env.ANTHROPIC_API_KEY?.trim()
					? {
							provider: "anthropic",
							apiKey: c.env.ANTHROPIC_API_KEY,
							model: narrativeModel ?? "claude-haiku-4-5",
							tracer: runtime.withChildSpan,
						}
					: null;
			if (!llm) {
				const response: AskResponse = {
					answer: null,
					evidence: [],
					queries: [],
					error:
						"Ask is not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY on the collector to enable it.",
					timestamp: new Date().toISOString(),
				};
				return c.json(response, 503);
			}

			const store = new AnalysesStore(c.env.DB);

			try {
				const startedAt = Date.now();
				runtime.logger.info("[ask] llm call starting", {
					project_id: projectId,
					provider: llm.provider,
					model: llm.model,
					question_chars: question.length,
				});
				const result = await runtime.withChildSpan(
					"ask.runAsk",
					() =>
						runAsk(question, {
							llm,
							listAnalyses: async (filters) => {
								// Pull from the live registry so the model sees Tier 1
								// panels derived this tick, not stale ones in
								// `analysis_definitions`.
								const all = await getAllAnalysesForProject(projectId, {
									db: c.env.DB,
								});
								return all.filter((d) => {
									if (filters?.group && d.group !== filters.group)
										return false;
									if (filters?.view && d.view !== filters.view) return false;
									return true;
								});
							},
							getLatestResult: async (id) => {
								const definitions = await store.listDefinitions(projectId);
								const definition = definitions.find((d) => d.id === id);
								if (!definition) return null;
								const r = await store.getLatestResult(projectId, id);
								return { definition, result: r };
							},
						}),
					{
						"llm.provider": llm.provider,
						"llm.model": llm.model,
						"openinference.span.kind": "LLM",
					},
				);
				runtime.logger.info("[ask] llm call finished", {
					project_id: projectId,
					provider: llm.provider,
					model: llm.model,
					latency_ms: Date.now() - startedAt,
					evidence_count: result.evidence.length,
					query_count: result.queries.length,
					answered: Boolean(result.answer),
				});

				// Stage 6 — log evidence citations for the auto-pin derivation.
				// Only on successful answers; failed loops would skew the signal
				// (the model often calls every tool it has on the way to giving
				// up). Best-effort: a write failure here doesn't fail the ask.
				if (result.answer && result.evidence.length > 0) {
					await store
						.recordAskEvidence(
							projectId,
							result.evidence.map((e) => e.analysisId),
						)
						.catch((err) =>
							runtime.logger.warn("[ask] recordAskEvidence failed", {
								error: err instanceof Error ? err.message : String(err),
							}),
						);
				}

				return c.json(result);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				runtime.logger.error("[ask] failed", { error: message });
				const response: AskResponse = {
					answer: null,
					evidence: [],
					queries: [],
					error: message,
					timestamp: new Date().toISOString(),
				};
				return c.json(response, 500);
			}
		});
	},
};
