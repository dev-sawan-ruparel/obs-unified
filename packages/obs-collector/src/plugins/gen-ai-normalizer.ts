/**
 * Normalize OpenTelemetry `gen_ai.*` semantic-convention attributes, OTel MCP attributes,
 * and OpenInference span kinds into the canonical obs-unified Agent Action Graph schema.
 *
 * References:
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   https://github.com/Arize-ai/openinference/blob/main/spec/
 *
 * Must run BEFORE ai-span-payloads-processor — that processor assumes
 * `openinference.span.kind` and `ai.payload.*` are already set.
 */

import type { JsonValue, StoredSpan } from "@obsunified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ACTION_KIND_KEY,
	ACTION_ROOT_ID_KEY,
	ACTOR_TYPE_KEY,
	ActionKind,
	AGENT_RUN_ID_KEY,
	AI_PAYLOAD_INPUT_KEY,
	AI_PAYLOAD_OUTPUT_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	OpenInferenceSpanKind,
	TOOL_ARGS_KEY,
	TOOL_CALL_ID_KEY,
	TOOL_NAME_KEY,
	TOOL_SIDE_EFFECT_KEY,
} from "@obsunified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { deriveActionId, resolveActionIdentity } from "../lib/action-identity";
import { parseJsonRecord } from "../lib/json";

const GEN_AI_PREFIX = "gen_ai.";
const MCP_PREFIX = "mcp.";

export { deriveActionId };

// Map gen_ai operation.name → OpenInference span kind.
const operationToKind = (op: unknown): string => {
	if (typeof op !== "string") return OpenInferenceSpanKind.LLM;
	const lower = op.toLowerCase();
	if (lower.includes("embed")) return OpenInferenceSpanKind.EMBEDDING;
	if (lower.includes("tool")) return OpenInferenceSpanKind.TOOL;
	if (lower.includes("agent")) return OpenInferenceSpanKind.AGENT;
	return OpenInferenceSpanKind.LLM;
};

const asNumber = (value: unknown): number | undefined => {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
};

const toJsonString = (value: unknown): string | null => {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

const SIDE_EFFECT_VERBS = new Set([
	"create",
	"delete",
	"insert",
	"mutate",
	"patch",
	"remove",
	"set",
	"update",
	"upsert",
	"write",
]);

const inferToolSideEffect = (toolName: unknown): 0 | 1 => {
	if (typeof toolName !== "string") return 0;
	const [firstToken] = toolName
		.trim()
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	return firstToken && SIDE_EFFECT_VERBS.has(firstToken) ? 1 : 0;
};

const collectIndexed = (
	attrs: Record<string, JsonValue>,
	prefix: string,
): unknown | undefined => {
	const scalar = attrs[prefix];
	if (scalar !== undefined) return scalar;

	const messages: Array<Record<string, JsonValue>> = [];
	const indexed = Object.keys(attrs).filter((k) => k.startsWith(`${prefix}.`));
	if (indexed.length === 0) return undefined;

	for (const key of indexed) {
		const rest = key.slice(prefix.length + 1);
		const dot = rest.indexOf(".");
		const idx = Number.parseInt(rest.slice(0, dot), 10);
		if (!Number.isFinite(idx)) continue;
		const field = rest.slice(dot + 1);
		messages[idx] = messages[idx] ?? {};
		messages[idx][field] = attrs[key];
	}

	const compact = messages.filter(
		(m): m is Record<string, JsonValue> => m !== undefined,
	);
	return compact.length > 0 ? compact : undefined;
};

export const genAiNormalizerPlugin: CollectorPlugin = {
	name: "gen-ai-normalizer",
	register(_app, runtime) {
		runtime.addSpanProcessor({
			name: "gen-ai-normalizer",
			async process(spans) {
				return Promise.all(
					spans.map(async (span): Promise<StoredSpan> => {
						const attrs = parseJsonRecord(span.attributesJson);

						const mcpMethod = attrs["mcp.method.name"] || attrs["mcp.method"];
						const jsonRpcId =
							attrs["jsonrpc.request.id"] || attrs["jsonrpc.id"];
						const hasMcp =
							mcpMethod !== undefined ||
							jsonRpcId !== undefined ||
							Object.keys(attrs).some((k) => k.startsWith(MCP_PREFIX));

						const hasGenAi = Object.keys(attrs).some((k) =>
							k.startsWith(GEN_AI_PREFIX),
						);

						const openInferenceKind = attrs[OPENINFERENCE_SPAN_KIND_KEY];
						const hasOpenInference = openInferenceKind !== undefined;

						// If it's not a GenAI, MCP, or OpenInference span, keep it as is.
						if (!hasGenAi && !hasMcp && !hasOpenInference) {
							return span;
						}

						const normalized: Record<string, JsonValue> = { ...attrs };

						// 1. Determine OpenInference Span Kind
						let kind = openInferenceKind as string | undefined;
						if (hasMcp && !kind) {
							if (mcpMethod === "tools/call") {
								kind = OpenInferenceSpanKind.TOOL;
							} else if (mcpMethod === "resources/read") {
								kind = OpenInferenceSpanKind.RETRIEVER;
							} else if (mcpMethod === "prompts/get") {
								kind = OpenInferenceSpanKind.PROMPT;
							} else {
								kind = OpenInferenceSpanKind.CHAIN;
							}
						} else if (hasGenAi && !kind) {
							kind = operationToKind(attrs["gen_ai.operation.name"]);
						}
						if (kind) {
							normalized[OPENINFERENCE_SPAN_KIND_KEY] = kind;
						}

						// 2. Set Action Graph Schema Attributes
						const identity = await resolveActionIdentity(span, attrs);
						const actionId = identity.actionId;

						normalized[ACTION_ID_KEY] = actionId;
						normalized[ACTION_CONFIDENCE_KEY] = identity.confidence;
						normalized[ACTION_ROOT_ID_KEY] = identity.rootActionId;
						normalized[ACTION_CAUSED_BY_ID_KEY] = identity.causedByActionId;

						if (normalized[ACTOR_TYPE_KEY] === undefined) {
							normalized[ACTOR_TYPE_KEY] = "agent";
						}

						if (normalized[AGENT_RUN_ID_KEY] === undefined) {
							normalized[AGENT_RUN_ID_KEY] =
								identity.agentRunId ?? identity.rootActionId;
						}

						// Determine Action Kind
						let actionKind = attrs[ACTION_KIND_KEY] as string | undefined;
						if (!actionKind && kind) {
							if (kind === OpenInferenceSpanKind.AGENT) {
								actionKind = ActionKind.AgentStep;
							} else if (kind === OpenInferenceSpanKind.LLM) {
								actionKind = ActionKind.LlmCall;
							} else if (kind === OpenInferenceSpanKind.TOOL) {
								actionKind = ActionKind.ToolCall;
							} else if (kind === OpenInferenceSpanKind.RETRIEVER) {
								actionKind = ActionKind.Retrieval;
							} else if (kind === OpenInferenceSpanKind.EVALUATOR) {
								actionKind = ActionKind.Eval;
							} else {
								actionKind = ActionKind.AgentStep;
							}
						}
						if (actionKind) {
							normalized[ACTION_KIND_KEY] = actionKind;
						}

						// 3. MCP Specific Mapping Details
						if (hasMcp) {
							if (kind === OpenInferenceSpanKind.TOOL) {
								if (normalized[TOOL_CALL_ID_KEY] === undefined) {
									normalized[TOOL_CALL_ID_KEY] = actionId;
								}
								if (normalized[TOOL_NAME_KEY] === undefined) {
									const tName =
										attrs["mcp.tool.name"] ??
										attrs["mcp.operation.name"] ??
										attrs["mcp.name"] ??
										span.spanName;
									normalized[TOOL_NAME_KEY] = tName;
									normalized["obs.tool_call.tool_name"] = tName;
								}
								if (normalized[TOOL_ARGS_KEY] === undefined) {
									const rawArgs =
										attrs["mcp.tool.arguments"] ??
										attrs["mcp.operation.arguments"] ??
										attrs["mcp.arguments"];
									const tArgs = toJsonString(rawArgs) ?? "{}";
									normalized[TOOL_ARGS_KEY] = tArgs;
									normalized["obs.tool_call.args"] = tArgs;
									normalized[AI_PAYLOAD_INPUT_KEY] = tArgs;
								}
								if (normalized[TOOL_SIDE_EFFECT_KEY] === undefined) {
									const sideEffect =
										attrs["mcp.tool.side_effect"] ??
										attrs["mcp.side_effect"] ??
										inferToolSideEffect(attrs["mcp.tool.name"]);
									normalized[TOOL_SIDE_EFFECT_KEY] = sideEffect;
									normalized["obs.tool_call.side_effect"] = sideEffect;
								}
							}
						}

						// 4. GenAI Model + provider normalization
						const model =
							(attrs["gen_ai.response.model"] as string | undefined) ||
							(attrs["gen_ai.request.model"] as string | undefined);
						const provider = attrs["gen_ai.system"];
						if (kind === OpenInferenceSpanKind.LLM) {
							if (typeof model === "string")
								normalized["llm.model_name"] = model;
							if (typeof provider === "string")
								normalized["llm.provider"] = provider;
						} else if (kind === OpenInferenceSpanKind.EMBEDDING) {
							if (typeof model === "string")
								normalized["embedding.model_name"] = model;
							if (typeof provider === "string")
								normalized["embedding.provider"] = provider;
						}

						// GenAI Token Usage
						const promptTokens =
							asNumber(attrs["gen_ai.usage.input_tokens"]) ??
							asNumber(attrs["gen_ai.usage.prompt_tokens"]);
						const completionTokens =
							asNumber(attrs["gen_ai.usage.output_tokens"]) ??
							asNumber(attrs["gen_ai.usage.completion_tokens"]);
						if (promptTokens !== undefined)
							normalized["llm.token_count.prompt"] = promptTokens;
						if (completionTokens !== undefined)
							normalized["llm.token_count.completion"] = completionTokens;
						if (promptTokens !== undefined && completionTokens !== undefined) {
							normalized["llm.token_count.total"] =
								promptTokens + completionTokens;
						}

						// GenAI Inputs/Outputs
						if (normalized[AI_PAYLOAD_INPUT_KEY] === undefined) {
							const input = collectIndexed(attrs, "gen_ai.prompt");
							if (input !== undefined) {
								normalized[AI_PAYLOAD_INPUT_KEY] = toJsonString(input) ?? "";
							}
						}
						if (normalized[AI_PAYLOAD_OUTPUT_KEY] === undefined) {
							const output = collectIndexed(attrs, "gen_ai.completion");
							if (output !== undefined) {
								normalized[AI_PAYLOAD_OUTPUT_KEY] = toJsonString(output) ?? "";
							}
						}

						return {
							...span,
							attributesJson: JSON.stringify(normalized),
						};
					}),
				);
			},
		});
	},
};
