import type {
	ActionContextOptions,
	AgentRun,
	AgentRunOptions,
	LLMOptions,
	RetrievalDocument,
	StepOptions,
	ToolOptions,
} from "./agent";

export interface AgentFrameworkToolClassification {
	sideEffect?: boolean;
	approvalState?: ToolOptions["approvalState"];
}

export interface AgentFrameworkPluginHooks<TEvent = unknown> {
	beforeRun?: (event: TEvent, run: AgentRun) => void | Promise<void>;
	afterRun?: (event: TEvent, run: AgentRun) => void | Promise<void>;
	onError?: (error: unknown, event?: TEvent) => void | Promise<void>;
}

export interface AgentFrameworkPluginOptions<
	TTool = unknown,
	TEvent = unknown,
> {
	serviceName?: string;
	serviceVersion?: string;
	defaultAgentId?: string;
	defaultAgentName?: string;
	defaultAgentVersion?: string;
	autonomyLevel?: AgentRunOptions["autonomyLevel"];
	capturePayloads?: boolean;
	classifyTool?: (
		tool: TTool,
	) => AgentFrameworkToolClassification | null | undefined;
	redactPayload?: (payload: unknown, event?: TEvent) => unknown;
	hooks?: AgentFrameworkPluginHooks<TEvent>;
}

export interface AgentFrameworkRunInput<TNativeRun = unknown> {
	nativeRun?: TNativeRun;
	agentId?: string;
	agentName: string;
	agentVersion?: string;
	goal?: string;
	autonomyLevel?: AgentRunOptions["autonomyLevel"];
	actorId?: string;
}

export interface AgentFrameworkStepInput<TNativeStep = unknown> {
	nativeStep?: TNativeStep;
	name: string;
	kind?: StepOptions["kind"];
	context?: ActionContextOptions;
}

export interface AgentFrameworkLLMInput<TNativeCall = unknown> {
	nativeCall?: TNativeCall;
	name?: string;
	model: string;
	provider: string;
	input?: unknown;
	output?: unknown;
	promptVersion?: string;
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
	costUsd?: number;
}

export interface AgentFrameworkToolInput<TNativeTool = unknown> {
	nativeTool?: TNativeTool;
	name: string;
	arguments?: unknown;
	result?: unknown;
	errorType?: string;
	errorMessage?: string;
	sideEffect?: boolean;
	approvalState?: ToolOptions["approvalState"];
}

export interface AgentFrameworkRetrievalInput<TNativeRetrieval = unknown> {
	nativeRetrieval?: TNativeRetrieval;
	retrieverName: string;
	query: string;
	documents?: RetrievalDocument[];
	maxRelevanceScore?: number;
}

export interface AgentFrameworkEvaluationInput<TNativeEvaluation = unknown> {
	nativeEvaluation?: TNativeEvaluation;
	evaluatorName: string;
	evaluatorVersion?: string;
	score?: number;
	passed: boolean;
	reasoning?: string;
	rubric?: unknown;
}

export interface AgentFrameworkAdapter<TFramework = unknown> {
	readonly name: string;
	install(
		framework: TFramework,
		options?: AgentFrameworkPluginOptions,
	): void | Promise<void> | (() => void | Promise<void>);
}

export interface AgentFrameworkRuntime {
	startRun<T>(
		input: AgentFrameworkRunInput,
		fn: (run: AgentRun) => Promise<T>,
	): Promise<T>;
	withStep<T>(input: AgentFrameworkStepInput, fn: () => Promise<T>): Promise<T>;
	recordLLM<T>(input: AgentFrameworkLLMInput, fn: () => Promise<T>): Promise<T>;
	recordTool<T>(
		input: AgentFrameworkToolInput,
		fn: () => Promise<T>,
	): Promise<T>;
	recordRetrieval<T>(
		input: AgentFrameworkRetrievalInput,
		fn: () => Promise<T>,
	): Promise<T>;
	recordEvaluation(input: AgentFrameworkEvaluationInput): Promise<void>;
}

export const agentFrameworkPluginContractVersion = "1.0.0";

export type {
	ActionContextOptions,
	AgentRun,
	AgentRunOptions,
	LLMOptions,
	StepOptions,
	ToolOptions,
};
