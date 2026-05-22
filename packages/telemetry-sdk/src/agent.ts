import { randomBytes } from "node:crypto";
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
	autonomyLevel?: "read_only" | "suggested_action" | "human_approved_write" | "autonomous_write" | "blocked_by_policy";
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
		// Spine attributes
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		child.setAttribute("obs.action.actor_type", context.actorType);
		if (context.actorId) {
			child.setAttribute("obs.action.actor_id", context.actorId);
		}
		child.setAttribute("obs.action.kind", "agent.run");
		child.setAttribute("obs.action.agent_run_id", agentRunId);

		// Leaf attributes
		child.setAttribute("obs.agent_run.agent_id", opts.agentId);
		child.setAttribute("obs.agent_run.agent_name", opts.agentName);
		child.setAttribute("obs.agent_run.agent_version", opts.agentVersion ?? "1.0.0");
		if (opts.goal) {
			child.setAttribute("obs.agent_run.goal", opts.goal);
			child.setAttribute("ai.payload.input", opts.goal);
		}
		child.setAttribute("obs.agent_run.autonomy_level", opts.autonomyLevel ?? "autonomous_write");

		const run: AgentRun = {
			runId: agentRunId,
			setOutcome(outcome: string) {
				child.setAttribute("obs.agent_run.outcome", outcome);
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
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		child.setAttribute("obs.action.actor_type", context.actorType);
		if (context.actorId) {
			child.setAttribute("obs.action.actor_id", context.actorId);
		}
		child.setAttribute("obs.action.kind", opts.kind ?? "agent.step");
		if (agentRunId) {
			child.setAttribute("obs.action.agent_run_id", agentRunId);
		}

		child.setAttribute("obs.action.step_id", actionId);

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

	const rawArgs = typeof opts.arguments === "string" ? opts.arguments : JSON.stringify(opts.arguments);

	return withChildSpan(opts.name, async (child) => {
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		child.setAttribute("obs.action.actor_type", context.actorType);
		if (context.actorId) {
			child.setAttribute("obs.action.actor_id", context.actorId);
		}
		child.setAttribute("obs.action.kind", "tool.call");
		if (agentRunId) {
			child.setAttribute("obs.action.agent_run_id", agentRunId);
		}

		child.setAttribute("obs.action.tool_call_id", actionId);

		// Downstream OpenInference normalization trigger
		child.setAttribute("openinference.span.kind", "TOOL");

		// Leaf attributes
		child.setAttribute("obs.tool_call.tool_name", opts.name);
		child.setAttribute("obs.tool_call.args", rawArgs);
		child.setAttribute("obs.tool_call.side_effect", opts.sideEffect ? 1 : 0);
		child.setAttribute("obs.tool_call.approval_state", opts.approvalState ?? "suggested");

		// Stored payloads link compatibility
		child.setAttribute("ai.payload.input", rawArgs);

		const toolCallObj: ToolCall = {
			toolCallId: actionId,
			setResult(result: unknown) {
				const rawResult = typeof result === "string" ? result : JSON.stringify(result);
				child.setAttribute("obs.tool_call.result", rawResult);
				child.setAttribute("ai.payload.output", rawResult);
			},
			setError(errorType: string, message?: string) {
				child.setAttribute("obs.tool_call.error_type", errorType);
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
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		child.setAttribute("obs.action.actor_type", context.actorType);
		if (context.actorId) {
			child.setAttribute("obs.action.actor_id", context.actorId);
		}
		child.setAttribute("obs.action.kind", "retrieval");
		if (agentRunId) {
			child.setAttribute("obs.action.agent_run_id", agentRunId);
		}

		child.setAttribute("openinference.span.kind", "RETRIEVER");
		child.setAttribute("obs.retrieval.retriever_name", opts.retrieverName);
		child.setAttribute("obs.retrieval.query", opts.query);
		child.setAttribute("ai.payload.input", opts.query);

		const retrieverObj: Retriever = {
			addDocuments(docs: RetrievalDocument[]) {
				child.setAttribute("obs.retrieval.total_results", docs.length);
				child.setAttribute("obs.retrieval.documents", JSON.stringify(docs));
				child.setAttribute("ai.payload.output", JSON.stringify(docs));
			},
			setMaxRelevanceScore(score: number) {
				child.setAttribute("obs.retrieval.max_relevance_score", score);
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
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		const actorType = parentContext?.actorType ?? "agent";
		child.setAttribute("obs.action.actor_type", actorType);
		if (parentContext?.actorId) {
			child.setAttribute("obs.action.actor_id", parentContext.actorId);
		}
		child.setAttribute("obs.action.kind", "eval");
		if (agentRunId) {
			child.setAttribute("obs.action.agent_run_id", agentRunId);
		}

		child.setAttribute("obs.eval.evaluator_name", opts.evaluatorName);
		child.setAttribute("obs.eval.evaluator_version", opts.evaluatorVersion ?? "1.0.0");
		if (opts.score !== undefined) {
			child.setAttribute("obs.eval.score", opts.score);
		}
		child.setAttribute("obs.eval.passed", opts.passed ? 1 : 0);
		if (opts.reasoning) {
			child.setAttribute("obs.eval.reasoning", opts.reasoning);
		}
		if (opts.rubric !== undefined) {
			const rubricStr = typeof opts.rubric === "string" ? opts.rubric : JSON.stringify(opts.rubric);
			child.setAttribute("obs.eval.rubric", rubricStr);
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
		child.setAttribute("obs.action.id", actionId);
		child.setAttribute("obs.action.root_id", rootActionId);
		if (causedByActionId) {
			child.setAttribute("obs.action.caused_by_id", causedByActionId);
		}
		const actorType = parentContext?.actorType ?? "agent";
		child.setAttribute("obs.action.actor_type", actorType);
		if (parentContext?.actorId) {
			child.setAttribute("obs.action.actor_id", parentContext.actorId);
		}
		child.setAttribute("obs.action.kind", "artifact");
		if (agentRunId) {
			child.setAttribute("obs.action.agent_run_id", agentRunId);
		}

		child.setAttribute("obs.artifact.name", opts.name);
		child.setAttribute("obs.artifact.type", opts.type);
		child.setAttribute("obs.artifact.content", opts.content);
		if (opts.storageRef) {
			child.setAttribute("obs.artifact.storage_ref", opts.storageRef);
		}
		if (opts.sizeBytes !== undefined) {
			child.setAttribute("obs.artifact.size_bytes", opts.sizeBytes);
		}
	});
}
