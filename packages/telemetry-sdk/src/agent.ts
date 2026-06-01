import { randomBytes } from "node:crypto";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_ID_KEY,
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
	const actionId = randomBytes(16).toString("hex");
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
 * Record a discrete step in the agent's plan or reasoning cycle.
 */
export async function step<T>(
	opts: StepOptions,
	fn: (stepObj: AgentStep) => Promise<T>,
): Promise<T> {
	const actionId = randomBytes(16).toString("hex");
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

	return withChildSpan(opts.name, async (child) => {
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

		return agentContextStorage.run(context, () => fn(stepObj));
	});
}

/**
 * Record a tool invocation, creating a tool call span that auto-propagates causal parent links.
 */
export async function tool<T>(
	opts: ToolOptions,
	fn: (toolCall: ToolCall) => Promise<T>,
): Promise<T> {
	const actionId = randomBytes(16).toString("hex");
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

	return withChildSpan(opts.name, async (child) => {
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

		return agentContextStorage.run(context, () => fn(toolCallObj));
	});
}

/**
 * Record a retriever query and returned documents.
 */
export async function recordRetrieval<T>(
	opts: RetrievalOptions,
	fn: (retriever: Retriever) => Promise<T>,
): Promise<T> {
	const actionId = randomBytes(16).toString("hex");
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

	return withChildSpan(opts.retrieverName, async (child) => {
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

		return agentContextStorage.run(context, () => fn(retrieverObj));
	});
}

/**
 * Record a guardrail or grader evaluation result.
 */
export async function recordEvaluation(opts: EvalOptions): Promise<void> {
	const actionId = randomBytes(16).toString("hex");
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	await withChildSpan(opts.evaluatorName, async (child) => {
		const actorType = parentContext?.actorType ?? "agent";
		setActionAttrs(
			child,
			{
				actionId,
				rootActionId,
				causedByActionId,
				agentRunId,
				actorType,
				actorId: parentContext?.actorId ?? null,
			},
			"eval",
		);
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
	});
}

/**
 * Record a generated artifact (assets, generated code, templates, etc.).
 */
export async function recordArtifact(opts: ArtifactOptions): Promise<void> {
	const actionId = randomBytes(16).toString("hex");
	const parentContext = getActiveAgentContext();

	const rootActionId = parentContext?.rootActionId ?? actionId;
	const causedByActionId = parentContext?.actionId ?? null;
	const agentRunId = parentContext?.agentRunId ?? null;

	await withChildSpan(opts.name, async (child) => {
		const actorType = parentContext?.actorType ?? "agent";
		setActionAttrs(
			child,
			{
				actionId,
				rootActionId,
				causedByActionId,
				agentRunId,
				actorType,
				actorId: parentContext?.actorId ?? null,
			},
			"artifact",
		);

		child.setAttribute(ARTIFACT_NAME_KEY, opts.name);
		child.setAttribute(ARTIFACT_TYPE_KEY, opts.type);
		child.setAttribute(ARTIFACT_CONTENT_KEY, opts.content);
		if (opts.storageRef) {
			child.setAttribute(ARTIFACT_STORAGE_REF_KEY, opts.storageRef);
		}
		if (opts.sizeBytes !== undefined) {
			child.setAttribute(ARTIFACT_SIZE_BYTES_KEY, opts.sizeBytes);
		}
	});
}
