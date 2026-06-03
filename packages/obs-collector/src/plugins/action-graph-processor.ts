import type { JsonValue, StoredSpan } from "@obs-unified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ACTION_ID_RE,
	ACTION_KIND_KEY,
	ACTION_MODEL_NAME_KEY,
	ACTION_NAME_KEY,
	ACTION_PROMPT_VERSION_KEY,
	ACTION_PROVIDER_KEY,
	ACTION_ROOT_ID_KEY,
	ACTION_TOTAL_COST_USD_KEY,
	ACTOR_ID_KEY,
	ACTOR_TYPE_KEY,
	ActionConfidence,
	AGENT_AUTONOMY_LEVEL_KEY,
	AGENT_GOAL_KEY,
	AGENT_ID_KEY,
	AGENT_NAME_KEY,
	AGENT_OUTCOME_KEY,
	AGENT_RUN_ID_KEY,
	AGENT_STEP_ID_KEY,
	AGENT_VERSION_KEY,
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	ARTIFACT_CONTENT_KEY,
	ARTIFACT_NAME_KEY,
	ARTIFACT_SHA256_HASH_KEY,
	ARTIFACT_SIZE_BYTES_KEY,
	ARTIFACT_STORAGE_REF_KEY,
	ARTIFACT_TYPE_KEY,
	EVAL_EVALUATOR_NAME_KEY,
	EVAL_EVALUATOR_VERSION_KEY,
	EVAL_PASSED_KEY,
	EVAL_REASONING_KEY,
	EVAL_RUBRIC_KEY,
	EVAL_SCORE_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	RETRIEVAL_DOCUMENTS_KEY,
	RETRIEVAL_MAX_RELEVANCE_SCORE_KEY,
	RETRIEVAL_NAME_KEY,
	RETRIEVAL_QUERY_KEY,
	RETRIEVAL_TOTAL_RESULTS_KEY,
	TOOL_APPROVAL_STATE_KEY,
	TOOL_ARGS_KEY,
	TOOL_CALL_ID_KEY,
	TOOL_ERROR_TYPE_KEY,
	TOOL_NAME_KEY,
	TOOL_RESULT_KEY,
	TOOL_SIDE_EFFECT_KEY,
} from "@obs-unified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { sha256Hex } from "../lib/hash";
import { parseJsonRecord } from "../lib/json";
import { isPayloadCaptureEnabled } from "../lib/payload-capture";
import { type SqlStatement, sqlDbFor } from "../lib/sql-db";

import { enricherPlugins } from "./action-graph-processor/enrichers";
import { runRedaction } from "./action-graph-processor/redaction";
import { deriveActionId } from "./gen-ai-normalizer";

const firstAttr = (
	attrs: Record<string, JsonValue>,
	...keys: string[]
): JsonValue | undefined => {
	for (const key of keys) {
		const value = attrs[key];
		if (value !== undefined && value !== null) return value;
	}
	return undefined;
};

const firstStringAttr = (
	attrs: Record<string, JsonValue>,
	...keys: string[]
): string | undefined => {
	const value = firstAttr(attrs, ...keys);
	return typeof value === "string" ? value : undefined;
};

const firstActionIdAttr = (
	attrs: Record<string, JsonValue>,
	...keys: string[]
): string | undefined => {
	const value = firstStringAttr(attrs, ...keys);
	if (value === undefined) return undefined;
	const trimmed = value.trim();
	return ACTION_ID_RE.test(trimmed) ? trimmed : undefined;
};

const firstNumberAttr = (
	attrs: Record<string, JsonValue>,
	...keys: string[]
): number | null => {
	const value = firstAttr(attrs, ...keys);
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
};

const toFiniteNumber = (value: unknown): number | null => {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const firstBoolLikeAttr = (
	attrs: Record<string, JsonValue>,
	...keys: string[]
): boolean => {
	const value = firstAttr(attrs, ...keys);
	return value === true || value === 1 || value === "1" || value === "true";
};

const PAYLOAD_ATTR_KEYS = [
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	AGENT_GOAL_KEY,
	"obs.agent_run.goal",
	AGENT_OUTCOME_KEY,
	"obs.agent_run.outcome",
	TOOL_ARGS_KEY,
	"obs.tool_call.args",
	TOOL_RESULT_KEY,
	"obs.tool_call.result",
	RETRIEVAL_QUERY_KEY,
	RETRIEVAL_DOCUMENTS_KEY,
	ARTIFACT_CONTENT_KEY,
	EVAL_REASONING_KEY,
	EVAL_RUBRIC_KEY,
];

const stripPayloadAttrs = (
	attrs: Record<string, JsonValue>,
): Record<string, JsonValue> => {
	const next = { ...attrs };
	for (const key of PAYLOAD_ATTR_KEYS) {
		delete next[key];
	}
	return next;
};

export type { ActionEnricherPlugin } from "./action-graph-processor/enrichers";
export {
	clearActionEnricherPlugins,
	registerActionEnricherPlugin,
} from "./action-graph-processor/enrichers";
export type {
	PayloadRedactorPlugin,
	RedactionContext,
} from "./action-graph-processor/redaction";
export {
	clearRedactionPlugins,
	registerRedactionPlugin,
	runRedaction,
} from "./action-graph-processor/redaction";

export const actionGraphProcessorPlugin: CollectorPlugin = {
	name: "action-graph-processor",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "action-graph-processor",
			async process(spans, context) {
				const db = sqlDbFor(context.env);
				const captureByProject = new Map<string, boolean>();
				const projectCaptureEnabled = async (projectId: string) => {
					const cached = captureByProject.get(projectId);
					if (cached !== undefined) return cached;
					const enabled = await isPayloadCaptureEnabled(
						db,
						projectId,
						context.env,
					);
					captureByProject.set(projectId, enabled);
					return enabled;
				};

				const actionsToInsert: Record<string, unknown>[] = [];
				const agentRunsToInsert: Record<string, unknown>[] = [];
				const toolCallsToInsert: Record<string, unknown>[] = [];
				const retrievalsToInsert: Record<string, unknown>[] = [];
				const evalsToInsert: Record<string, unknown>[] = [];
				const artifactsToInsert: Record<string, unknown>[] = [];

				const transformed = await Promise.all(
					spans.map(async (span): Promise<StoredSpan> => {
						const attrs = parseJsonRecord(span.attributesJson);
						const capturePayloads = await projectCaptureEnabled(span.projectId);

						const obsActionId = attrs[ACTION_ID_KEY];
						const openInferenceKind = attrs[OPENINFERENCE_SPAN_KIND_KEY];
						const genAiAgentId = attrs["gen_ai.agent.id"];

						const isActionSpan =
							obsActionId !== undefined ||
							openInferenceKind !== undefined ||
							genAiAgentId !== undefined;
						if (!isActionSpan) return span;

						const actionKind =
							firstStringAttr(attrs, ACTION_KIND_KEY) ??
							(openInferenceKind as string) ??
							"agent.step";
						const explicitActionId = firstActionIdAttr(attrs, ACTION_ID_KEY);
						const actionId =
							explicitActionId ??
							(await deriveActionId(span.projectId, span.traceId, span.spanId));
						const actionConfidence = explicitActionId
							? ActionConfidence.Explicit
							: ActionConfidence.Fallback;
						const rootActionId =
							firstActionIdAttr(
								attrs,
								ACTION_ROOT_ID_KEY,
								AGENT_RUN_ID_KEY,
								"obs.action.agent_run_id",
								"obs.agent_run.id",
							) ??
							(actionKind === "agent.run" || actionKind === "agent"
								? actionId
								: await deriveActionId(
										span.projectId,
										span.traceId,
										span.traceId.substring(0, 16),
									));
						const causedByActionId =
							firstActionIdAttr(attrs, ACTION_CAUSED_BY_ID_KEY) ??
							(span.parentSpanId
								? await deriveActionId(
										span.projectId,
										span.traceId,
										span.parentSpanId,
									)
								: null);
						const trustedAttrs: Record<string, JsonValue> = {
							...attrs,
							[ACTION_ID_KEY]: actionId,
							[ACTION_ROOT_ID_KEY]: rootActionId,
							[ACTION_CONFIDENCE_KEY]: actionConfidence,
						};
						delete trustedAttrs["obs.action.agent_run_id"];
						delete trustedAttrs["obs.agent_run.id"];
						if (causedByActionId !== undefined) {
							trustedAttrs[ACTION_CAUSED_BY_ID_KEY] = causedByActionId;
						}
						const actorType =
							firstStringAttr(attrs, ACTOR_TYPE_KEY, "obs.action.actor_type") ??
							"agent";
						const actorId =
							firstStringAttr(attrs, ACTOR_ID_KEY, "obs.action.actor_id") ??
							(genAiAgentId as string) ??
							null;
						const name =
							firstStringAttr(attrs, ACTION_NAME_KEY) ?? span.spanName;
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
							firstActionIdAttr(
								attrs,
								AGENT_RUN_ID_KEY,
								"obs.action.agent_run_id",
								"obs.agent_run.id",
							) ??
							(actionKind === "agent.run" || actionKind === "agent"
								? actionId
								: null);
						if (agentRunId !== null) {
							trustedAttrs[AGENT_RUN_ID_KEY] = agentRunId;
						} else {
							delete trustedAttrs[AGENT_RUN_ID_KEY];
						}

						const stepId =
							firstStringAttr(attrs, AGENT_STEP_ID_KEY, "obs.action.step_id") ??
							null;
						const toolCallId =
							firstStringAttr(
								attrs,
								TOOL_CALL_ID_KEY,
								"obs.action.tool_call_id",
							) ?? null;
						const promptVersion =
							firstStringAttr(attrs, ACTION_PROMPT_VERSION_KEY) ?? null;
						const modelName =
							firstStringAttr(attrs, ACTION_MODEL_NAME_KEY) ??
							(attrs["llm.model_name"] as string) ??
							null;
						const provider =
							firstStringAttr(attrs, ACTION_PROVIDER_KEY) ??
							(attrs["llm.provider"] as string) ??
							null;
						const totalCostUsd =
							firstNumberAttr(attrs, ACTION_TOTAL_COST_USD_KEY) ??
							firstNumberAttr(
								attrs,
								"llm.cost.total_usd",
								"gen_ai.usage.cost_usd",
								"llm.total_cost_usd",
							);

						const persistedAttrs = capturePayloads
							? trustedAttrs
							: stripPayloadAttrs(trustedAttrs);
						const attrsJson = JSON.stringify(persistedAttrs);

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
									console.error(
										`[action-enricher-plugin:${plugin.name}] enrichActionRecord failed`,
										err,
									);
								}
							}
						}

						actionsToInsert.push(actionRecord);

						// 1. Agent Runs
						const isAgentRun =
							actionKind === "agent.run" ||
							actionKind === "agent" ||
							firstAttr(attrs, AGENT_ID_KEY, "obs.agent_run.agent_id") !==
								undefined;
						if (isAgentRun) {
							const agentRunRecord = {
								id: actionId,
								projectId: span.projectId,
								agentId:
									firstStringAttr(
										attrs,
										AGENT_ID_KEY,
										"obs.agent_run.agent_id",
									) ??
									(genAiAgentId as string) ??
									"default-agent",
								agentName:
									firstStringAttr(
										attrs,
										AGENT_NAME_KEY,
										"obs.agent_run.agent_name",
									) ?? span.spanName,
								agentVersion:
									firstStringAttr(
										attrs,
										AGENT_VERSION_KEY,
										"obs.agent_run.agent_version",
									) ?? "1.0.0",
								goal: capturePayloads
									? (firstStringAttr(
											attrs,
											AGENT_GOAL_KEY,
											"obs.agent_run.goal",
										) ??
										(attrs[AI_PAYLOAD_INPUT_KEY] as string) ??
										null)
									: null,
								outcome: capturePayloads
									? (firstStringAttr(
											attrs,
											AGENT_OUTCOME_KEY,
											"obs.agent_run.outcome",
										) ??
										(attrs[AI_PAYLOAD_OUTPUT_KEY] as string) ??
										null)
									: null,
								autonomyLevel:
									firstStringAttr(
										attrs,
										AGENT_AUTONOMY_LEVEL_KEY,
										"obs.agent_run.autonomy_level",
									) ?? "autonomous_write",
								status: span.statusCode === 2 ? "failed" : "success",
								errorMessage: span.statusMessage ?? null,
								totalCostUsd: totalCostUsd ?? 0.0,
								totalDurationMs: span.durationMs,
								metadataJson: attrsJson,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichAgentRunRecord) {
									try {
										await plugin.enrichAgentRunRecord(
											agentRunRecord,
											span,
											attrs,
										);
									} catch (err) {
										console.error(
											`[action-enricher-plugin:${plugin.name}] enrichAgentRunRecord failed`,
											err,
										);
									}
								}
							}

							agentRunsToInsert.push(agentRunRecord);
						}

						// 2. Tool Calls
						const isToolCall =
							actionKind === "tool" ||
							actionKind === "tool.call" ||
							firstAttr(attrs, TOOL_NAME_KEY, "obs.tool_call.tool_name") !==
								undefined;
						if (isToolCall) {
							const rawArgs =
								firstStringAttr(attrs, TOOL_ARGS_KEY, "obs.tool_call.args") ??
								(attrs[AI_PAYLOAD_INPUT_KEY] as string) ??
								"{}";
							const rawResult =
								firstStringAttr(
									attrs,
									TOOL_RESULT_KEY,
									"obs.tool_call.result",
								) ??
								(attrs[AI_PAYLOAD_OUTPUT_KEY] as string) ??
								"{}";

							const argsHash = await sha256Hex(rawArgs);
							const resultHash = await sha256Hex(rawResult);

							const redactedArgs = capturePayloads
								? await runRedaction(rawArgs, {
										projectId: span.projectId,
										actionId,
										traceId: span.traceId,
										spanId: span.spanId,
										kind: "tool_call",
										fieldName: "args",
									})
								: null;
							const redactedResult = capturePayloads
								? await runRedaction(rawResult, {
										projectId: span.projectId,
										actionId,
										traceId: span.traceId,
										spanId: span.spanId,
										kind: "tool_call",
										fieldName: "result",
									})
								: null;

							const toolCallRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								toolName:
									firstStringAttr(
										attrs,
										TOOL_NAME_KEY,
										"obs.tool_call.tool_name",
									) ?? span.spanName,
								argsHash,
								resultHash,
								errorType:
									firstStringAttr(
										attrs,
										TOOL_ERROR_TYPE_KEY,
										"obs.tool_call.error_type",
									) ??
									span.statusMessage ??
									null,
								sideEffect: firstBoolLikeAttr(
									attrs,
									TOOL_SIDE_EFFECT_KEY,
									"obs.tool_call.side_effect",
								)
									? 1
									: 0,
								approvalState:
									firstStringAttr(
										attrs,
										TOOL_APPROVAL_STATE_KEY,
										"obs.tool_call.approval_state",
									) ?? "suggested",
								argsRedacted:
									redactedArgs === null
										? null
										: typeof redactedArgs === "string"
											? redactedArgs
											: JSON.stringify(redactedArgs),
								resultRedacted:
									redactedResult === null
										? null
										: typeof redactedResult === "string"
											? redactedResult
											: JSON.stringify(redactedResult),
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichToolCallRecord) {
									try {
										await plugin.enrichToolCallRecord(
											toolCallRecord,
											span,
											attrs,
										);
									} catch (err) {
										console.error(
											`[action-enricher-plugin:${plugin.name}] enrichToolCallRecord failed`,
											err,
										);
									}
								}
							}

							toolCallsToInsert.push(toolCallRecord);
						}

						// 3. Retrieval Events
						const isRetrieval =
							actionKind === "retriever" ||
							actionKind === "retrieval" ||
							attrs[RETRIEVAL_NAME_KEY] !== undefined;
						if (isRetrieval) {
							const rawQuery =
								firstStringAttr(attrs, RETRIEVAL_QUERY_KEY) ??
								(attrs[AI_PAYLOAD_INPUT_KEY] as string) ??
								"";
							const rawDocs =
								firstStringAttr(attrs, RETRIEVAL_DOCUMENTS_KEY) ??
								(attrs[AI_PAYLOAD_OUTPUT_KEY] as string) ??
								"[]";

							const queryHash = await sha256Hex(rawQuery);
							const redactedDocs = capturePayloads
								? await runRedaction(rawDocs, {
										projectId: span.projectId,
										actionId,
										traceId: span.traceId,
										spanId: span.spanId,
										kind: "retrieval",
										fieldName: "documents",
									})
								: null;

							const retrievalRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								retrieverName:
									firstStringAttr(attrs, RETRIEVAL_NAME_KEY) ?? span.spanName,
								queryHash,
								documentsJson:
									redactedDocs === null
										? null
										: typeof redactedDocs === "string"
											? redactedDocs
											: JSON.stringify(redactedDocs),
								totalResults:
									firstNumberAttr(attrs, RETRIEVAL_TOTAL_RESULTS_KEY) ?? 0,
								maxRelevanceScore: firstNumberAttr(
									attrs,
									RETRIEVAL_MAX_RELEVANCE_SCORE_KEY,
								),
								durationMs: span.durationMs,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichRetrievalRecord) {
									try {
										await plugin.enrichRetrievalRecord(
											retrievalRecord,
											span,
											attrs,
										);
									} catch (err) {
										console.error(
											`[action-enricher-plugin:${plugin.name}] enrichRetrievalRecord failed`,
											err,
										);
									}
								}
							}

							retrievalsToInsert.push(retrievalRecord);
						}

						// 4. Evaluation Results
						const isEval =
							actionKind === "evaluator" ||
							actionKind === "eval" ||
							attrs[EVAL_EVALUATOR_NAME_KEY] !== undefined;
						if (isEval) {
							const evalRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								evaluatorName:
									firstStringAttr(attrs, EVAL_EVALUATOR_NAME_KEY) ??
									span.spanName,
								evaluatorVersion:
									firstStringAttr(attrs, EVAL_EVALUATOR_VERSION_KEY) ?? "1.0.0",
								score: firstNumberAttr(attrs, EVAL_SCORE_KEY),
								passed:
									attrs[EVAL_PASSED_KEY] !== undefined
										? firstBoolLikeAttr(attrs, EVAL_PASSED_KEY)
											? 1
											: 0
										: 1,
								reasoning: firstStringAttr(attrs, EVAL_REASONING_KEY) ?? null,
								rubricJson: firstStringAttr(attrs, EVAL_RUBRIC_KEY) ?? null,
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichEvalRecord) {
									try {
										await plugin.enrichEvalRecord(evalRecord, span, attrs);
									} catch (err) {
										console.error(
											`[action-enricher-plugin:${plugin.name}] enrichEvalRecord failed`,
											err,
										);
									}
								}
							}

							evalsToInsert.push(evalRecord);
						}

						// 5. Generated Artifacts
						const hasArtifact = attrs[ARTIFACT_NAME_KEY] !== undefined;
						if (hasArtifact) {
							const content =
								firstStringAttr(attrs, ARTIFACT_CONTENT_KEY) ?? "";
							const redactedContent = capturePayloads
								? await runRedaction(content, {
										projectId: span.projectId,
										actionId,
										traceId: span.traceId,
										spanId: span.spanId,
										kind: "artifact",
										fieldName: "content",
									})
								: null;

							const artifactRecord = {
								id: span.spanId,
								actionId,
								projectId: span.projectId,
								artifactName: attrs[ARTIFACT_NAME_KEY] as string,
								artifactType:
									firstStringAttr(attrs, ARTIFACT_TYPE_KEY) ?? "text",
								storageRef:
									firstStringAttr(attrs, ARTIFACT_STORAGE_REF_KEY) ?? null,
								sizeBytes: firstNumberAttr(attrs, ARTIFACT_SIZE_BYTES_KEY),
								sha256Hash:
									firstStringAttr(attrs, ARTIFACT_SHA256_HASH_KEY) ??
									(await sha256Hex(content)),
								contentPreview:
									redactedContent === null
										? null
										: typeof redactedContent === "string"
											? redactedContent
											: JSON.stringify(redactedContent),
							};

							for (const plugin of enricherPlugins) {
								if (plugin.enrichArtifactRecord) {
									try {
										await plugin.enrichArtifactRecord(
											artifactRecord,
											span,
											attrs,
										);
									} catch (err) {
										console.error(
											`[action-enricher-plugin:${plugin.name}] enrichArtifactRecord failed`,
											err,
										);
									}
								}
							}

							artifactsToInsert.push(artifactRecord);
						}

						// Downstream compatibility: ensure payload routing can join action_id.
						return {
							...span,
							attributesJson: JSON.stringify(trustedAttrs),
						};
					}),
				);

				const statements: SqlStatement[] = [];

				if (agentRunsToInsert.length > 0 && actionsToInsert.length > 0) {
					for (const run of agentRunsToInsert) {
						const runId = String(run.id);
						const childActions = actionsToInsert.filter(
							(action) =>
								action.rootActionId === runId ||
								action.agentRunId === runId ||
								action.id === runId,
						);
						const childCost = childActions
							.filter((action) => action.id !== runId)
							.reduce(
								(sum, action) =>
									sum + (toFiniteNumber(action.totalCostUsd) ?? 0),
								0,
							);
						const runOwnCost = toFiniteNumber(run.totalCostUsd) ?? 0;
						run.totalCostUsd = Math.max(runOwnCost, childCost);

						const starts = childActions
							.map((action) =>
								typeof action.startedAt === "string"
									? Date.parse(action.startedAt)
									: NaN,
							)
							.filter(Number.isFinite);
						const ends = childActions
							.map((action) =>
								typeof action.endedAt === "string"
									? Date.parse(action.endedAt)
									: NaN,
							)
							.filter(Number.isFinite);
						const wallClockMs =
							starts.length > 0 && ends.length > 0
								? Math.max(...ends) - Math.min(...starts)
								: null;
						const maxActionDuration = childActions.reduce(
							(max, action) =>
								Math.max(max, toFiniteNumber(action.durationMs) ?? 0),
							0,
						);
						const existingDuration = toFiniteNumber(run.totalDurationMs) ?? 0;
						run.totalDurationMs = Math.max(
							existingDuration,
							wallClockMs ?? 0,
							maxActionDuration,
						);
					}
				}

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
