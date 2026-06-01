import { randomBytes } from "node:crypto";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_ID_KEY,
	ACTION_ID_RE,
	ACTION_KIND_KEY,
	ACTION_ROOT_ID_KEY,
	ACTOR_ID_KEY,
	ACTOR_TYPE_KEY,
	AGENT_AUTONOMY_LEVEL_KEY,
	AGENT_GOAL_KEY,
	AGENT_ID_KEY,
	AGENT_NAME_KEY,
	AGENT_OUTCOME_KEY,
	AGENT_RUN_ID_KEY,
	AGENT_STEP_ID_KEY,
	AGENT_VERSION_KEY,
	ARTIFACT_CONTENT_KEY,
	ARTIFACT_NAME_KEY,
	ARTIFACT_SIZE_BYTES_KEY,
	ARTIFACT_STORAGE_REF_KEY,
	ARTIFACT_TYPE_KEY,
	EVAL_EVALUATOR_NAME_KEY,
	EVAL_EVALUATOR_VERSION_KEY,
	EVAL_PASSED_KEY,
	EVAL_REASONING_KEY,
	EVAL_RUBRIC_KEY,
	EVAL_SCORE_KEY,
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
import {
	type AgentActionContext,
	agentContextStorage,
	withChildSpan,
} from "./span";

export interface AgentRunOptions {
	agentId: string;
	agentName: string;
	agentVersion?: string;
	goal?: string;
	autonomyLevel?:
		| "read_only"
		| "suggested_action"
		| "human_approved_write"
		| "autonomous_write"
		| "blocked_by_policy";
	actorType?: string;
	actorId?: string;
}

export interface AgentRun {
	runId: string;
	withAction<T>(opts: ActionContextOptions, fn: () => Promise<T>): Promise<T>;
	step<T>(opts: StepOptions, fn: (step: AgentStep) => Promise<T>): Promise<T>;
	llm<T>(opts: LLMOptions, fn: (llm: LLMCall) => Promise<T>): Promise<T>;
	tool<T>(
		opts: ToolOptions,
		fn: (toolCall: ToolCall) => Promise<T>,
	): Promise<T>;
	recordRetrieval<T>(
		opts: RetrievalOptions,
		fn: (retriever: Retriever) => Promise<T>,
	): Promise<T>;
	recordEvaluation(opts: EvalOptions): Promise<void>;
	recordArtifact(opts: ArtifactOptions): Promise<void>;
	setOutcome(outcome: string): void;
	setAttribute(key: string, value: unknown): void;
}

export interface StepOptions {
	name: string;
	kind?: string;
}

export interface AgentStep {
	stepId: string;
	setAttribute(key: string, value: unknown): void;
}

export interface ActionContextOptions {
	actionId?: string;
	rootActionId?: string;
	causedByActionId?: string | null;
	agentRunId?: string | null;
	actorType?: string;
	actorId?: string | null;
}

export interface SerializedActionContext {
	rootActionId: string;
	actionId: string;
	causedByActionId?: string | null;
	agentRunId?: string | null;
	actorType?: string;
	actorId?: string | null;
}

export interface LLMOptions {
	model: string;
	provider: string;
	input?: unknown;
	name?: string;
	promptVersion?: string;
}

export interface LLMCall {
	actionId: string;
	setOutput(output: unknown): void;
	setTokens(tokens: {
		prompt?: number;
		completion?: number;
		total?: number;
	}): void;
	setCost(usd: number): void;
	setAttribute(key: string, value: unknown): void;
}

export interface ToolOptions {
	name: string;
	arguments: unknown;
	sideEffect?: boolean;
	approvalState?: "suggested" | "human_approved" | "bypassed" | "blocked";
}

export interface ToolCall {
	toolCallId: string;
	setResult(result: unknown): void;
	setError(errorType: string, message?: string): void;
	setAttribute(key: string, value: unknown): void;
}

export interface RetrievalDocument {
	id?: string;
	score?: number;
	content?: string;
	metadata?: Record<string, unknown>;
}

export interface RetrievalOptions {
	retrieverName: string;
	query: string;
}

export interface Retriever {
	addDocuments(docs: RetrievalDocument[]): void;
	setMaxRelevanceScore(score: number): void;
}

export interface EvalOptions {
	evaluatorName: string;
	evaluatorVersion?: string;
	score?: number;
	passed: boolean;
	reasoning?: string;
	rubric?: unknown;
}

export interface ArtifactOptions {
	name: string;
	type: "file" | "patch" | "text" | "message" | "data";
	content: string;
	storageRef?: string;
	sizeBytes?: number;
}

/**
 * Read the active agent action context.
 */
export function getActiveAgentContext(): AgentActionContext | undefined {
	return agentContextStorage.getStore();
}

/**
 * Serialize the active RFC 0010 action context into JSON-safe job metadata.
 *
 * Queue and workflow producers should attach this value to job metadata. The
 * consumer can pass it to `withSerializedActionContext` before creating child
 * spans so causal links point back to the producer action.
 */
export function serializeActionContext(
	context = getActiveAgentContext(),
): SerializedActionContext | undefined {
	if (!context) return undefined;

	const serialized: SerializedActionContext = {
		rootActionId: context.rootActionId,
		actionId: context.actionId,
	};
	if (context.causedByActionId) {
		serialized.causedByActionId = context.causedByActionId;
	}
	if (context.agentRunId) {
		serialized.agentRunId = context.agentRunId;
	}
	if (context.actorType) {
		serialized.actorType = context.actorType;
	}
	if (context.actorId) {
		serialized.actorId = context.actorId;
	}
	return serialized;
}

export function restoreActionContext(
	metadata: SerializedActionContext | null | undefined,
): ActionContextOptions | undefined {
	if (!metadata) return undefined;
	return {
		rootActionId: metadata.rootActionId,
		actionId: metadata.actionId,
		causedByActionId: metadata.causedByActionId ?? null,
		agentRunId: metadata.agentRunId ?? null,
		actorType: metadata.actorType,
		actorId: metadata.actorId ?? null,
	};
}

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Create a sortable 26-character Crockford base32 action id.
 *
 * This follows the ULID layout: 48 bits timestamp + 80 bits random entropy.
 * The value is opaque to callers, but lexicographic order follows creation
 * time closely enough for range scans and timeline queries.
 */
export function createActionId(now = Date.now()): string {
	const time = Math.max(0, Math.min(now, 0xffffffffffff));
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 6; i += 1) {
		bytes[i] = Math.floor(time / 256 ** (5 - i)) & 0xff;
	}
	bytes.set(randomBytes(10), 6);

	let value = 0n;
	for (const byte of bytes) value = (value << 8n) | BigInt(byte);

	let encoded = "";
	for (let i = 0; i < 26; i += 1) {
		const shift = BigInt((25 - i) * 5);
		const index = Number((value >> shift) & 31n);
		encoded += CROCKFORD_BASE32[index];
	}

	if (!ACTION_ID_RE.test(encoded)) {
		throw new Error("Generated action id does not satisfy RFC 0010 format");
	}
	return encoded;
}

const setAttrWithAliases = (
	child: { setAttribute(key: string, value: unknown): void },
	key: string,
	value: unknown,
	aliases: string[] = [],
) => {
	child.setAttribute(key, value);
	for (const alias of aliases) child.setAttribute(alias, value);
};

const setActionAttrs = (
	child: { setAttribute(key: string, value: unknown): void },
	context: AgentActionContext,
	actionKind: string,
) => {
	child.setAttribute(ACTION_ID_KEY, context.actionId);
	child.setAttribute(ACTION_ROOT_ID_KEY, context.rootActionId);
	if (context.causedByActionId) {
		child.setAttribute(ACTION_CAUSED_BY_ID_KEY, context.causedByActionId);
	}
	setAttrWithAliases(child, ACTOR_TYPE_KEY, context.actorType, [
		"obs.action.actor_type",
	]);
	if (context.actorId) {
		setAttrWithAliases(child, ACTOR_ID_KEY, context.actorId, [
			"obs.action.actor_id",
		]);
	}
	child.setAttribute(ACTION_KIND_KEY, actionKind);
	if (context.agentRunId) {
		setAttrWithAliases(child, AGENT_RUN_ID_KEY, context.agentRunId, [
			"obs.action.agent_run_id",
		]);
	}
};

/**
 * Start an agent run segment. Sets up AsyncLocalStorage context and OTel span wrappers.
 */
export async function startAgentRun<T>(
	opts: AgentRunOptions,
	fn: (run: AgentRun) => Promise<T>,
): Promise<T> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = actionId;

	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: opts.actorType ?? "agent",
		actorId: opts.actorId ?? opts.agentId,
	};

	return withChildSpan(opts.agentName, async (child) => {
		setActionAttrs(child, context, "agent.run");

		// Leaf attributes
		setAttrWithAliases(child, AGENT_ID_KEY, opts.agentId, [
			"obs.agent_run.agent_id",
		]);
		setAttrWithAliases(child, AGENT_NAME_KEY, opts.agentName, [
			"obs.agent_run.agent_name",
		]);
		setAttrWithAliases(child, AGENT_VERSION_KEY, opts.agentVersion ?? "1.0.0", [
			"obs.agent_run.agent_version",
		]);
		if (opts.goal) {
			setAttrWithAliases(child, AGENT_GOAL_KEY, opts.goal, [
				"obs.agent_run.goal",
			]);
			child.setAttribute("ai.payload.input", opts.goal);
		}
		setAttrWithAliases(
			child,
			AGENT_AUTONOMY_LEVEL_KEY,
			opts.autonomyLevel ?? "autonomous_write",
			["obs.agent_run.autonomy_level"],
		);

		const run: AgentRun = {
			runId: agentRunId,
			withAction(actionOpts, actionFn) {
				return withAction(actionOpts, actionFn);
			},
			step(stepOpts, stepFn) {
				return step(stepOpts, stepFn);
			},
			llm(llmOpts, llmFn) {
				return llm(llmOpts, llmFn);
			},
			tool(toolOpts, toolFn) {
				return tool(toolOpts, toolFn);
			},
			recordRetrieval(retrievalOpts, retrievalFn) {
				return recordRetrieval(retrievalOpts, retrievalFn);
			},
			recordEvaluation(evalOpts) {
				return recordEvaluation(evalOpts);
			},
			recordArtifact(artifactOpts) {
				return recordArtifact(artifactOpts);
			},
			setOutcome(outcome: string) {
				setAttrWithAliases(child, AGENT_OUTCOME_KEY, outcome, [
					"obs.agent_run.outcome",
				]);
				child.setAttribute("ai.payload.output", outcome);
			},
			setAttribute(key: string, value: unknown) {
				child.setAttribute(key, value);
			},
		};

		return agentContextStorage.run(context, () => fn(run));
	});
}

/**
 * Run arbitrary code under an explicit action context.
 *
 * This is useful when queue/workflow glue or framework wrappers already have
 * an action identity and only need to restore async-local context before
 * creating child spans.
 */
export async function withAction<T>(
	opts: ActionContextOptions,
	fn: () => Promise<T>,
): Promise<T> {
	const parentContext = getActiveAgentContext();
	const actionId = opts.actionId ?? createActionId();
	const context: AgentActionContext = {
		actionId,
		rootActionId: opts.rootActionId ?? parentContext?.rootActionId ?? actionId,
		causedByActionId:
			opts.causedByActionId === undefined
				? (parentContext?.actionId ?? null)
				: opts.causedByActionId,
		agentRunId:
			opts.agentRunId === undefined
				? (parentContext?.agentRunId ?? null)
				: opts.agentRunId,
		actorType: opts.actorType ?? parentContext?.actorType ?? "agent",
		actorId:
			opts.actorId === undefined
				? (parentContext?.actorId ?? null)
				: opts.actorId,
	};

	return agentContextStorage.run(context, fn);
}

export async function withSerializedActionContext<T>(
	metadata: SerializedActionContext | null | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	const restored = restoreActionContext(metadata);
	if (!restored) return fn();
	return withAction(restored, fn);
}

/**
 * Record a discrete step in the agent's plan or reasoning cycle.
 */
export async function step<T>(
	opts: StepOptions,
	fn: (stepObj: AgentStep) => Promise<T>,
): Promise<T> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	return agentContextStorage.run(context, () =>
		withChildSpan(opts.name, async (child) => {
			setActionAttrs(child, context, opts.kind ?? "agent.step");
			setAttrWithAliases(child, AGENT_STEP_ID_KEY, actionId, [
				"obs.action.step_id",
			]);

			const stepObj: AgentStep = {
				stepId: actionId,
				setAttribute(key: string, value: unknown) {
					child.setAttribute(key, value);
				},
			};

			return fn(stepObj);
		}),
	);
}

/**
 * Record an LLM call as its own action while preserving the active agent run.
 */
export async function llm<T>(
	opts: LLMOptions,
	fn: (llmCall: LLMCall) => Promise<T>,
): Promise<T> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	return agentContextStorage.run(context, () =>
		withChildSpan(opts.name ?? "llm", async (child) => {
			setActionAttrs(child, context, "llm");
			child.setAttribute("openinference.span.kind", "LLM");
			child.setAttribute("llm.model_name", opts.model);
			child.setAttribute("llm.provider", opts.provider);
			child.setAttribute("gen_ai.system", opts.provider);
			child.setAttribute("gen_ai.request.model", opts.model);
			child.setAttribute("gen_ai.operation.name", "chat");
			child.setAttribute("ai.payload.input", stringify(opts.input));
			if (opts.promptVersion) {
				child.setAttribute("obs.prompt.version", opts.promptVersion);
			}

			const llmCall: LLMCall = {
				actionId,
				setOutput(output) {
					child.setAttribute("ai.payload.output", stringify(output));
				},
				setTokens({ prompt, completion, total }) {
					if (prompt !== undefined) {
						child.setAttribute("llm.token_count.prompt", prompt);
						child.setAttribute("gen_ai.usage.input_tokens", prompt);
					}
					if (completion !== undefined) {
						child.setAttribute("llm.token_count.completion", completion);
						child.setAttribute("gen_ai.usage.output_tokens", completion);
					}
					if (total !== undefined) {
						child.setAttribute("llm.token_count.total", total);
					}
				},
				setCost(usd) {
					child.setAttribute("llm.cost.total_usd", usd);
					child.setAttribute("gen_ai.usage.cost_usd", usd);
				},
				setAttribute(key, value) {
					child.setAttribute(key, value);
				},
			};

			return fn(llmCall);
		}),
	);
}

/**
 * Record a tool invocation, creating a tool call span that auto-propagates causal parent links.
 */
export async function tool<T>(
	opts: ToolOptions,
	fn: (toolCall: ToolCall) => Promise<T>,
): Promise<T> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	const rawArgs =
		typeof opts.arguments === "string"
			? opts.arguments
			: JSON.stringify(opts.arguments);

	return agentContextStorage.run(context, () =>
		withChildSpan(opts.name, async (child) => {
			setActionAttrs(child, context, "tool.call");
			setAttrWithAliases(child, TOOL_CALL_ID_KEY, actionId, [
				"obs.action.tool_call_id",
			]);

			// Downstream OpenInference normalization trigger
			child.setAttribute("openinference.span.kind", "TOOL");

			// Leaf attributes
			setAttrWithAliases(child, TOOL_NAME_KEY, opts.name, [
				"obs.tool_call.tool_name",
			]);
			setAttrWithAliases(child, TOOL_ARGS_KEY, rawArgs, ["obs.tool_call.args"]);
			setAttrWithAliases(child, TOOL_SIDE_EFFECT_KEY, opts.sideEffect ? 1 : 0, [
				"obs.tool_call.side_effect",
			]);
			setAttrWithAliases(
				child,
				TOOL_APPROVAL_STATE_KEY,
				opts.approvalState ?? "suggested",
				["obs.tool_call.approval_state"],
			);

			// Stored payloads link compatibility
			child.setAttribute("ai.payload.input", rawArgs);

			const toolCallObj: ToolCall = {
				toolCallId: actionId,
				setResult(result: unknown) {
					const rawResult =
						typeof result === "string" ? result : JSON.stringify(result);
					setAttrWithAliases(child, TOOL_RESULT_KEY, rawResult, [
						"obs.tool_call.result",
					]);
					child.setAttribute("ai.payload.output", rawResult);
				},
				setError(errorType: string, message?: string) {
					setAttrWithAliases(child, TOOL_ERROR_TYPE_KEY, errorType, [
						"obs.tool_call.error_type",
					]);
					child.setStatus(2, message ?? errorType);
				},
				setAttribute(key: string, value: unknown) {
					child.setAttribute(key, value);
				},
			};

			return fn(toolCallObj);
		}),
	);
}

/**
 * Record a retriever query and returned documents.
 */
export async function recordRetrieval<T>(
	opts: RetrievalOptions,
	fn: (retriever: Retriever) => Promise<T>,
): Promise<T> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	return agentContextStorage.run(context, () =>
		withChildSpan(opts.retrieverName, async (child) => {
			setActionAttrs(child, context, "retrieval");

			child.setAttribute("openinference.span.kind", "RETRIEVER");
			child.setAttribute(RETRIEVAL_NAME_KEY, opts.retrieverName);
			child.setAttribute(RETRIEVAL_QUERY_KEY, opts.query);
			child.setAttribute("ai.payload.input", opts.query);

			const retrieverObj: Retriever = {
				addDocuments(docs: RetrievalDocument[]) {
					child.setAttribute(RETRIEVAL_TOTAL_RESULTS_KEY, docs.length);
					child.setAttribute(RETRIEVAL_DOCUMENTS_KEY, JSON.stringify(docs));
					child.setAttribute("ai.payload.output", JSON.stringify(docs));
				},
				setMaxRelevanceScore(score: number) {
					child.setAttribute(RETRIEVAL_MAX_RELEVANCE_SCORE_KEY, score);
				},
			};

			return fn(retrieverObj);
		}),
	);
}

/**
 * Record a guardrail or grader evaluation result.
 */
export async function recordEvaluation(opts: EvalOptions): Promise<void> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;
	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	await agentContextStorage.run(context, () =>
		withChildSpan(opts.evaluatorName, async (child) => {
			setActionAttrs(child, context, "eval");
			child.setAttribute(EVAL_EVALUATOR_NAME_KEY, opts.evaluatorName);
			child.setAttribute(
				EVAL_EVALUATOR_VERSION_KEY,
				opts.evaluatorVersion ?? "1.0.0",
			);
			if (opts.score !== undefined) {
				child.setAttribute(EVAL_SCORE_KEY, opts.score);
			}
			child.setAttribute(EVAL_PASSED_KEY, opts.passed ? 1 : 0);
			if (opts.reasoning) {
				child.setAttribute(EVAL_REASONING_KEY, opts.reasoning);
			}
			if (opts.rubric !== undefined) {
				const rubricStr =
					typeof opts.rubric === "string"
						? opts.rubric
						: JSON.stringify(opts.rubric);
				child.setAttribute(EVAL_RUBRIC_KEY, rubricStr);
			}
		}),
	);
}

/**
 * Record a generated artifact (assets, generated code, templates, etc.).
 */
export async function recordArtifact(opts: ArtifactOptions): Promise<void> {
	const actionId = createActionId();
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;
	const context: AgentActionContext = {
		actionId,
		rootActionId,
		causedByActionId,
		agentRunId,
		actorType: parentContext?.actorType ?? "agent",
		actorId: parentContext?.actorId ?? null,
	};

	await agentContextStorage.run(context, () =>
		withChildSpan(opts.name, async (child) => {
			setActionAttrs(child, context, "artifact");

			child.setAttribute(ARTIFACT_NAME_KEY, opts.name);
			child.setAttribute(ARTIFACT_TYPE_KEY, opts.type);
			child.setAttribute(ARTIFACT_CONTENT_KEY, opts.content);
			if (opts.storageRef) {
				child.setAttribute(ARTIFACT_STORAGE_REF_KEY, opts.storageRef);
			}
			if (opts.sizeBytes !== undefined) {
				child.setAttribute(ARTIFACT_SIZE_BYTES_KEY, opts.sizeBytes);
			}
		}),
	);
}

const stringify = (value: unknown): string => {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};
