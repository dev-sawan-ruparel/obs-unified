import type { StoredSpan } from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { parseJsonRecord } from "../lib/json";
import { sqlDbFor } from "../lib/sql-db";
import { sha256Hex } from "../lib/hash";

export interface RedactionContext {
	projectId: string;
	actionId: string;
	traceId: string;
	spanId: string;
	kind: "tool_call" | "retrieval" | "eval" | "artifact" | "agent_run";
	fieldName: "args" | "result" | "query" | "documents" | "content";
}

export interface PayloadRedactorPlugin {
	name: string;
	redact(
		value: unknown,
		context: RedactionContext,
	): unknown | Promise<unknown> | undefined;
}

const redactionPlugins: PayloadRedactorPlugin[] = [];

export function registerRedactionPlugin(plugin: PayloadRedactorPlugin) {
	redactionPlugins.push(plugin);
}

export function clearRedactionPlugins() {
	redactionPlugins.length = 0;
}

export interface ActionEnricherPlugin {
	name: string;
	enrichActionRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichAgentRunRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichToolCallRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichRetrievalRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichEvalRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
	enrichArtifactRecord?(
		record: any,
		span: StoredSpan,
		attributes: Record<string, unknown>,
	): void | Promise<void>;
}

const enricherPlugins: ActionEnricherPlugin[] = [];

export function registerActionEnricherPlugin(plugin: ActionEnricherPlugin) {
	enricherPlugins.push(plugin);
}

export function clearActionEnricherPlugins() {
	enricherPlugins.length = 0;
}

// Default redactor that performs sensitive key scrubbing.
const DEFAULT_REDACT_KEYS = new Set([
	"authorization",
	"cookie",
	"set-cookie",
	"password",
	"passwd",
	"secret",
	"token",
	"api-key",
	"x-api-key",
	"email",
	"enduser.id",
]);

function shouldRedactKey(key: string): boolean {
	const normalized = key.toLowerCase();
	if (DEFAULT_REDACT_KEYS.has(normalized)) return true;
	for (const k of DEFAULT_REDACT_KEYS) {
		if (normalized.endsWith(k)) return true;
	}
	return false;
}

function redactObj(val: unknown): unknown {
	if (Array.isArray(val)) {
		return val.map(redactObj);
	}
	if (val && typeof val === "object") {
		const nextEntries = Object.entries(val).map(([key, nestedValue]) => {
			if (shouldRedactKey(key)) {
				return [key, "[REDACTED]"] as const;
			}
			return [key, redactObj(nestedValue)] as const;
		});
		return Object.fromEntries(nextEntries);
	}
	return val;
}

export async function runRedaction(
	value: unknown,
	context: RedactionContext,
): Promise<unknown> {
	for (const plugin of redactionPlugins) {
		try {
			const res = await plugin.redact(value, context);
			if (res !== undefined) {
				return res;
			}
		} catch (err) {
			console.error(`[redaction-plugin:${plugin.name}] failed`, err);
		}
	}

	return redactObj(value);
}

export const actionGraphProcessorPlugin: CollectorPlugin = {
	name: "action-graph-processor",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "action-graph-processor",
			async process(spans, context) {
				const db = sqlDbFor(context.env);

				const actionsToInsert: any[] = [];
				const agentRunsToInsert: any[] = [];
				const toolCallsToInsert: any[] = [];
				const retrievalsToInsert: any[] = [];
				const evalsToInsert: any[] = [];
				const artifactsToInsert: any[] = [];

				const transformed = await Promise.all(
					spans.map(async (span): Promise<StoredSpan> => {
						const attrs = parseJsonRecord(span.attributesJson);

						const obsActionId = attrs["obs.action.id"];
						const openInferenceKind = attrs["openinference.span.kind"];
						const genAiAgentId = attrs["gen_ai.agent.id"];

						const isActionSpan =
							obsActionId !== undefined ||
							openInferenceKind !== undefined ||
							genAiAgentId !== undefined;
						if (!isActionSpan) return span;

						const actionId = (obsActionId as string) ?? span.spanId;
						const rootActionId =
							(attrs["obs.action.root_id"] as string) ??
							(attrs["obs.agent_run.id"] as string) ??
							actionId;
						const causedByActionId =
							(attrs["obs.action.caused_by_id"] as string) ??
							span.parentSpanId ??
							null;
						const actorType = (attrs["obs.action.actor_type"] as string) ?? "agent";
						const actorId =
							(attrs["obs.action.actor_id"] as string) ??
							(genAiAgentId as string) ??
							null;
						const actionKind =
							(attrs["obs.action.kind"] as string) ??
							(openInferenceKind as string) ??
							"agent.step";
						const name = (attrs["obs.action.name"] as string) ?? span.spanName;
						const status = span.statusCode === 2 ? "error" : "ok";
						const startedAt = span.startTime;
						const endedAt = span.endTime;
						const durationMs = span.durationMs;
						const traceId = span.traceId;
						const spanId = span.spanId;
						const sessionId =
							span.sessionId ?? (attrs["session.id"] as string) ?? null;
						const interactionId =
							span.interactionId ?? (attrs["interaction.id"] as string) ?? null;
						const userId =
							(attrs["user.id"] as string) ??
							(attrs["enduser.id"] as string) ??
							(attrs["obs.user.id"] as string) ??
							null;

						const agentRunId =
							(attrs["obs.action.agent_run_id"] as string) ??
							(attrs["obs.agent_run.id"] as string) ??
							(actionKind === "agent.run" || actionKind === "agent"
								? actionId
								: null);

						const stepId = (attrs["obs.action.step_id"] as string) ?? null;
						const toolCallId = (attrs["obs.action.tool_call_id"] as string) ?? null;
						const promptVersion =
							(attrs["obs.action.prompt_version"] as string) ?? null;
						const modelName =
							(attrs["obs.action.model_name"] as string) ??
							(attrs["llm.model_name"] as string) ??
							null;
						const provider =
							(attrs["obs.action.provider"] as string) ??
							(attrs["llm.provider"] as string) ??
							null;
						const totalCostUsd =
							attrs["obs.action.total_cost_usd"] !== undefined
								? Number(attrs["obs.action.total_cost_usd"])
								: attrs["llm.total_cost_usd"] !== undefined
									? Number(attrs["llm.total_cost_usd"])
									: null;

						const attrsJson = JSON.stringify(attrs);

						const actionRecord = {
							id: actionId,
							projectId: span.projectId,
							rootActionId,
							causedByActionId,
							actorType,
							actorId,
							actionKind,
							name,
							status,
							startedAt,
							endedAt,
							durationMs,
							traceId,
							spanId,
							sessionId,
							interactionId,
							userId,
							agentRunId,
							stepId,
							toolCallId,
							promptVersion,
							modelName,
							provider,
							totalCostUsd,
							attrsJson,
						};

						for (const plugin of enricherPlugins) {
							if (plugin.enrichActionRecord) {
								try {
									await plugin.enrichActionRecord(actionRecord, span, attrs);
								} catch (err) {
									console.error(`[action-enricher-plugin:${plugin.name}] enrichActionRecord failed`, err);
								}
							}
						}

						actionsToInsert.push(actionRecord);

						// 1. Agent Runs
						const isAgentRun =
							actionKind === "agent.run" ||
							actionKind === "agent" ||
							attrs["obs.agent_run.agent_id"] !== undefined;
						if (isAgentRun) {
							const agentRunRecord = {
								id: actionId,
								projectId: span.projectId,
								agentId:
									(attrs["obs.agent_run.agent_id"] as string) ??
									(genAiAgentId as string) ??
									"default-agent",
								agentName: (attrs["obs.agent_run.agent_name"] as string) ?? span.spanName,
								agentVersion:
									(attrs["obs.agent_run.agent_version"] as string) ?? "1.0.0",
								goal:
									(attrs["obs.agent_run.goal"] as string) ??
									(attrs["ai.payload.input"] as string) ??
									null,
								outcome:
									(attrs["obs.agent_run.outcome"] as string) ??
									(attrs["ai.payload.output"] as string) ??
									null,
								autonomyLevel:
									(attrs["obs.agent_run.autonomy_level"] as string) ??
									"autonomous_write",
								status: span.statusCode === 2 ? "failed" : "success",
								errorMessage: span.statusMessage ?? null,
								totalCostUsd: totalCostUsd ?? 0.0,
								totalDurationMs: span.durationMs,
								metadataJson: attrsJson,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichAgentRunRecord) {
									try {
										await plugin.enrichAgentRunRecord(agentRunRecord, span, attrs);
									} catch (err) {
										console.error(`[action-enricher-plugin:${plugin.name}] enrichAgentRunRecord failed`, err);
									}
								}
							}

							agentRunsToInsert.push(agentRunRecord);
						}

						// 2. Tool Calls
						const isToolCall =
							actionKind === "tool" ||
							actionKind === "tool.call" ||
							attrs["obs.tool_call.tool_name"] !== undefined;
						if (isToolCall) {
							const rawArgs =
								(attrs["obs.tool_call.args"] as string) ??
								(attrs["ai.payload.input"] as string) ??
								"{}";
							const rawResult =
								(attrs["obs.tool_call.result"] as string) ??
								(attrs["ai.payload.output"] as string) ??
								"{}";

							const argsHash = await sha256Hex(rawArgs);
							const resultHash = await sha256Hex(rawResult);

							const redactedArgs = await runRedaction(rawArgs, {
								projectId: span.projectId,
								actionId,
								traceId: span.traceId,
								spanId: span.spanId,
								kind: "tool_call",
								fieldName: "args",
							});
							const redactedResult = await runRedaction(rawResult, {
								projectId: span.projectId,
								actionId,
								traceId: span.traceId,
								spanId: span.spanId,
								kind: "tool_call",
								fieldName: "result",
							});

							const toolCallRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								toolName: (attrs["obs.tool_call.tool_name"] as string) ?? span.spanName,
								argsHash,
								resultHash,
								errorType:
									(attrs["obs.tool_call.error_type"] as string) ??
									span.statusMessage ??
									null,
								sideEffect: attrs["obs.tool_call.side_effect"] ? 1 : 0,
								approvalState:
									(attrs["obs.tool_call.approval_state"] as string) ?? "suggested",
								argsRedacted:
									typeof redactedArgs === "string"
										? redactedArgs
										: JSON.stringify(redactedArgs),
								resultRedacted:
									typeof redactedResult === "string"
										? redactedResult
										: JSON.stringify(redactedResult),
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichToolCallRecord) {
									try {
										await plugin.enrichToolCallRecord(toolCallRecord, span, attrs);
									} catch (err) {
										console.error(`[action-enricher-plugin:${plugin.name}] enrichToolCallRecord failed`, err);
									}
								}
							}

							toolCallsToInsert.push(toolCallRecord);
						}

						// 3. Retrieval Events
						const isRetrieval =
							actionKind === "retriever" ||
							actionKind === "retrieval" ||
							attrs["obs.retrieval.retriever_name"] !== undefined;
						if (isRetrieval) {
							const rawQuery =
								(attrs["obs.retrieval.query"] as string) ??
								(attrs["ai.payload.input"] as string) ??
								"";
							const rawDocs =
								(attrs["obs.retrieval.documents"] as string) ??
								(attrs["ai.payload.output"] as string) ??
								"[]";

							const queryHash = await sha256Hex(rawQuery);
							const redactedQuery = await runRedaction(rawQuery, {
								projectId: span.projectId,
								actionId,
								traceId: span.traceId,
								spanId: span.spanId,
								kind: "retrieval",
								fieldName: "query",
							});
							const redactedDocs = await runRedaction(rawDocs, {
								projectId: span.projectId,
								actionId,
								traceId: span.traceId,
								spanId: span.spanId,
								kind: "retrieval",
								fieldName: "documents",
							});

							const retrievalRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								retrieverName:
									(attrs["obs.retrieval.retriever_name"] as string) ?? span.spanName,
								queryHash,
								documentsJson:
									typeof redactedDocs === "string"
										? redactedDocs
										: JSON.stringify(redactedDocs),
								totalResults:
									attrs["obs.retrieval.total_results"] !== undefined
										? Number(attrs["obs.retrieval.total_results"])
										: 0,
								maxRelevanceScore:
									attrs["obs.retrieval.max_relevance_score"] !== undefined
										? Number(attrs["obs.retrieval.max_relevance_score"])
										: null,
								durationMs: span.durationMs,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichRetrievalRecord) {
									try {
										await plugin.enrichRetrievalRecord(retrievalRecord, span, attrs);
									} catch (err) {
										console.error(`[action-enricher-plugin:${plugin.name}] enrichRetrievalRecord failed`, err);
									}
								}
							}

							retrievalsToInsert.push(retrievalRecord);
						}

						// 4. Evaluation Results
						const isEval =
							actionKind === "evaluator" ||
							actionKind === "eval" ||
							attrs["obs.eval.evaluator_name"] !== undefined;
						if (isEval) {
							const evalRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								evaluatorName: (attrs["obs.eval.evaluator_name"] as string) ?? span.spanName,
								evaluatorVersion:
									(attrs["obs.eval.evaluator_version"] as string) ?? "1.0.0",
								score:
									attrs["obs.eval.score"] !== undefined
										? Number(attrs["obs.eval.score"])
										: null,
								passed:
									attrs["obs.eval.passed"] !== undefined
										? attrs["obs.eval.passed"]
											? 1
											: 0
										: 1,
								reasoning: (attrs["obs.eval.reasoning"] as string) ?? null,
								rubricJson: (attrs["obs.eval.rubric"] as string) ?? null,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichEvalRecord) {
									try {
										await plugin.enrichEvalRecord(evalRecord, span, attrs);
									} catch (err) {
										console.error(`[action-enricher-plugin:${plugin.name}] enrichEvalRecord failed`, err);
									}
								}
							}

							evalsToInsert.push(evalRecord);
						}

						// 5. Generated Artifacts
						const hasArtifact = attrs["obs.artifact.name"] !== undefined;
						if (hasArtifact) {
							const content = (attrs["obs.artifact.content"] as string) ?? "";
							const redactedContent = await runRedaction(content, {
								projectId: span.projectId,
								actionId,
								traceId: span.traceId,
								spanId: span.spanId,
								kind: "artifact",
								fieldName: "content",
							});

							const artifactRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								artifactName: attrs["obs.artifact.name"] as string,
								artifactType: (attrs["obs.artifact.type"] as string) ?? "text",
								storageRef: (attrs["obs.artifact.storage_ref"] as string) ?? null,
								sizeBytes:
									attrs["obs.artifact.size_bytes"] !== undefined
										? Number(attrs["obs.artifact.size_bytes"])
										: null,
								sha256Hash:
									(attrs["obs.artifact.sha256_hash"] as string) ??
									(await sha256Hex(content)),
								contentPreview:
									typeof redactedContent === "string"
										? redactedContent
										: JSON.stringify(redactedContent),
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichArtifactRecord) {
									try {
										await plugin.enrichArtifactRecord(artifactRecord, span, attrs);
									} catch (err) {
										console.error(`[action-enricher-plugin:${plugin.name}] enrichArtifactRecord failed`, err);
									}
								}
							}

							artifactsToInsert.push(artifactRecord);
						}

						// Downstream compatibility: set obs.action.id ontransformed attributes
						const updatedAttrs = { ...attrs, "obs.action.id": actionId };
						return {
							...span,
							attributesJson: JSON.stringify(updatedAttrs),
						};
					}),
				);

				const statements: any[] = [];

				if (actionsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO actions (
							id, project_id, root_action_id, caused_by_action_id, actor_type, actor_id,
							action_kind, name, status, started_at, ended_at, duration_ms, trace_id,
							span_id, session_id, interaction_id, user_id, agent_run_id, step_id,
							tool_call_id, prompt_version, model_name, provider, total_cost_usd, attrs_json
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							project_id = excluded.project_id,
							root_action_id = excluded.root_action_id,
							caused_by_action_id = excluded.caused_by_action_id,
							actor_type = excluded.actor_type,
							actor_id = excluded.actor_id,
							action_kind = excluded.action_kind,
							name = excluded.name,
							status = excluded.status,
							started_at = excluded.started_at,
							ended_at = excluded.ended_at,
							duration_ms = excluded.duration_ms,
							trace_id = excluded.trace_id,
							span_id = excluded.span_id,
							session_id = excluded.session_id,
							interaction_id = excluded.interaction_id,
							user_id = excluded.user_id,
							agent_run_id = excluded.agent_run_id,
							step_id = excluded.step_id,
							tool_call_id = excluded.tool_call_id,
							prompt_version = excluded.prompt_version,
							model_name = excluded.model_name,
							provider = excluded.provider,
							total_cost_usd = excluded.total_cost_usd,
							attrs_json = excluded.attrs_json
					`);
					for (const r of actionsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.projectId,
								r.rootActionId,
								r.causedByActionId,
								r.actorType,
								r.actorId,
								r.actionKind,
								r.name,
								r.status,
								r.startedAt,
								r.endedAt,
								r.durationMs,
								r.traceId,
								r.spanId,
								r.sessionId,
								r.interactionId,
								r.userId,
								r.agentRunId,
								r.stepId,
								r.toolCallId,
								r.promptVersion,
								r.modelName,
								r.provider,
								r.totalCostUsd,
								r.attrsJson,
							),
						);
					}
				}

				if (agentRunsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO agent_runs (
							id, project_id, agent_id, agent_name, agent_version, goal, outcome,
							autonomy_level, status, error_message, total_cost_usd, total_duration_ms, metadata_json
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							project_id = excluded.project_id,
							agent_id = excluded.agent_id,
							agent_name = excluded.agent_name,
							agent_version = excluded.agent_version,
							goal = excluded.goal,
							outcome = excluded.outcome,
							autonomy_level = excluded.autonomy_level,
							status = excluded.status,
							error_message = excluded.error_message,
							total_cost_usd = excluded.total_cost_usd,
							total_duration_ms = excluded.total_duration_ms,
							metadata_json = excluded.metadata_json
					`);
					for (const r of agentRunsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.projectId,
								r.agentId,
								r.agentName,
								r.agentVersion,
								r.goal,
								r.outcome,
								r.autonomyLevel,
								r.status,
								r.errorMessage,
								r.totalCostUsd,
								r.totalDurationMs,
								r.metadataJson,
							),
						);
					}
				}

				if (toolCallsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO tool_calls (
							id, action_id, project_id, tool_name, args_hash, result_hash,
							error_type, side_effect, approval_state, args_redacted, result_redacted
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							action_id = excluded.action_id,
							project_id = excluded.project_id,
							tool_name = excluded.tool_name,
							args_hash = excluded.args_hash,
							result_hash = excluded.result_hash,
							error_type = excluded.error_type,
							side_effect = excluded.side_effect,
							approval_state = excluded.approval_state,
							args_redacted = excluded.args_redacted,
							result_redacted = excluded.result_redacted
					`);
					for (const r of toolCallsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.actionId,
								r.projectId,
								r.toolName,
								r.argsHash,
								r.resultHash,
								r.errorType,
								r.sideEffect,
								r.approvalState,
								r.argsRedacted,
								r.resultRedacted,
							),
						);
					}
				}

				if (retrievalsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO retrieval_events (
							id, action_id, project_id, retriever_name, query_hash, documents_json,
							total_results, max_relevance_score, duration_ms
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							action_id = excluded.action_id,
							project_id = excluded.project_id,
							retriever_name = excluded.retriever_name,
							query_hash = excluded.query_hash,
							documents_json = excluded.documents_json,
							total_results = excluded.total_results,
							max_relevance_score = excluded.max_relevance_score,
							duration_ms = excluded.duration_ms
					`);
					for (const r of retrievalsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.actionId,
								r.projectId,
								r.retrieverName,
								r.queryHash,
								r.documentsJson,
								r.totalResults,
								r.maxRelevanceScore,
								r.durationMs,
							),
						);
					}
				}

				if (evalsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO eval_results (
							id, action_id, project_id, evaluator_name, evaluator_version,
							score, passed, reasoning, rubric_json
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							action_id = excluded.action_id,
							project_id = excluded.project_id,
							evaluator_name = excluded.evaluator_name,
							evaluator_version = excluded.evaluator_version,
							score = excluded.score,
							passed = excluded.passed,
							reasoning = excluded.reasoning,
							rubric_json = excluded.rubric_json
					`);
					for (const r of evalsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.actionId,
								r.projectId,
								r.evaluatorName,
								r.evaluatorVersion,
								r.score,
								r.passed,
								r.reasoning,
								r.rubricJson,
							),
						);
					}
				}

				if (artifactsToInsert.length > 0) {
					const stmt = db.prepare(`
						INSERT INTO artifacts (
							id, action_id, project_id, artifact_name, artifact_type,
							storage_ref, size_bytes, sha256_hash, content_preview
						) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT (id) DO UPDATE SET
							action_id = excluded.action_id,
							project_id = excluded.project_id,
							artifact_name = excluded.artifact_name,
							artifact_type = excluded.artifact_type,
							storage_ref = excluded.storage_ref,
							size_bytes = excluded.size_bytes,
							sha256_hash = excluded.sha256_hash,
							content_preview = excluded.content_preview
					`);
					for (const r of artifactsToInsert) {
						statements.push(
							stmt.bind(
								r.id,
								r.actionId,
								r.projectId,
								r.artifactName,
								r.artifactType,
								r.storageRef,
								r.sizeBytes,
								r.sha256Hash,
								r.contentPreview,
							),
						);
					}
				}

				if (statements.length > 0) {
					try {
						await db.batch(statements);
					} catch (err) {
						context.logger.error("[action-graph-processor] write failed", {
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				return transformed;
			},
		});
	},
};
