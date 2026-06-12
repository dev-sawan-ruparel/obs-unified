import {
	llm,
	startAgentRun,
	step,
	tool,
} from "@obsunified/telemetry-sdk/agent";
import type {
	AgentFrameworkAdapter,
	AgentFrameworkPluginOptions,
} from "@obsunified/telemetry-sdk/agent-plugin";

type LangGraphMetadata = Record<string, unknown>;

interface LangGraphMessage {
	response_metadata?: {
		model_name?: string;
		provider?: string;
		token_usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
		};
	};
}

interface LangGraphGeneration {
	text?: unknown;
	message?: LangGraphMessage;
}

interface LangGraphLLMOutput {
	generations?: LangGraphGeneration[][];
}

interface LangGraphRunnableConfig {
	callbacks?: LangChainCallbackHandler[];
	[key: string]: unknown;
}

interface LangGraphRunnable<
	TInput = unknown,
	TConfig extends LangGraphRunnableConfig = LangGraphRunnableConfig,
	TResult = unknown,
> {
	invoke(input: TInput, config?: TConfig): Promise<TResult>;
}

export class LangChainCallbackHandler {
	private prompts = new Map<string, string[]>();
	private toolInputs = new Map<string, string>();

	constructor(private pluginOptions?: AgentFrameworkPluginOptions) {}

	async handleChainEnd(
		outputs: unknown,
		_runId: string,
		_parentRunId?: string,
		_tags?: string[],
		metadata?: LangGraphMetadata,
	) {
		const name =
			typeof metadata?.node_name === "string"
				? metadata.node_name
				: "langgraph.node";
		const capturePayloads = this.pluginOptions?.capturePayloads ?? false;

		await step({ name, kind: "agent.step" }, async (s) => {
			if (capturePayloads && outputs) {
				s.setAttribute("ai.payload.output", JSON.stringify(outputs));
			}
		});
	}

	async handleLLMStart(
		_llmObj: unknown,
		prompts: string[],
		runId: string,
		_parentRunId?: string,
	) {
		this.prompts.set(runId, prompts);
	}

	async handleLLMEnd(
		output: LangGraphLLMOutput,
		runId: string,
		_parentRunId?: string,
	) {
		const capturePayloads = this.pluginOptions?.capturePayloads ?? false;
		const prompt = this.prompts.get(runId);
		this.prompts.delete(runId);

		const generation = output?.generations?.[0]?.[0];
		const message = generation?.message;

		const model = message?.response_metadata?.model_name || "unknown-model";
		const provider = message?.response_metadata?.provider || "unknown-provider";
		const usage = message?.response_metadata?.token_usage;

		await llm(
			{
				model,
				provider,
				input: capturePayloads ? prompt : undefined,
				name: "LangGraph LLM Call",
			},
			async (llmCall) => {
				if (capturePayloads) {
					llmCall.setOutput(generation?.text || output);
				}
				if (usage) {
					llmCall.setTokens({
						prompt: usage.prompt_tokens,
						completion: usage.completion_tokens,
						total: usage.total_tokens,
					});
				}
			},
		);
	}

	async handleToolStart(
		_toolObj: unknown,
		input: string,
		runId: string,
		_parentRunId?: string,
	) {
		this.toolInputs.set(runId, input);
	}

	async handleToolEnd(
		output: string,
		runId: string,
		_parentRunId?: string,
		_tags?: string[],
		metadata?: LangGraphMetadata,
	) {
		const capturePayloads = this.pluginOptions?.capturePayloads ?? false;
		const toolInput = this.toolInputs.get(runId);
		this.toolInputs.delete(runId);

		const toolName =
			typeof metadata?.tool_name === "string"
				? metadata.tool_name
				: "unknown-tool";

		const classification = this.pluginOptions?.classifyTool?.(toolName) || {};
		const sideEffect = classification.sideEffect ?? false;
		const approvalState = classification.approvalState ?? "bypassed";

		await tool(
			{
				name: toolName,
				arguments: capturePayloads ? toolInput : undefined,
				sideEffect,
				approvalState,
			},
			async (tCall) => {
				if (capturePayloads) {
					tCall.setResult(output);
				}
			},
		);
	}
}

export function wrapLangGraphRunnable<TRunnable extends LangGraphRunnable>(
	runnable: TRunnable,
	pluginOptions?: AgentFrameworkPluginOptions,
): TRunnable {
	const originalInvoke = runnable.invoke;

	const wrappedInvoke = async function (
		this: TRunnable,
		input: Parameters<TRunnable["invoke"]>[0],
		config?: Parameters<TRunnable["invoke"]>[1],
	) {
		const agentName = pluginOptions?.defaultAgentName || "LangGraph Agent";
		const agentId = pluginOptions?.defaultAgentId || "langgraph-agent";
		const autonomyLevel = pluginOptions?.autonomyLevel || "autonomous_write";

		return startAgentRun(
			{
				agentId,
				agentName,
				autonomyLevel,
			},
			async (run) => {
				const actualConfig: LangGraphRunnableConfig = {
					...(config as LangGraphRunnableConfig | undefined),
				};
				const handler = new LangChainCallbackHandler(pluginOptions);
				actualConfig.callbacks = [...(actualConfig.callbacks || []), handler];

				try {
					const result = await originalInvoke.call(this, input, actualConfig);
					run.setOutcome("Successfully completed LangGraph workflow execution");
					return result;
				} catch (err) {
					run.setOutcome(
						`Failed: ${err instanceof Error ? err.message : String(err)}`,
					);
					throw err;
				}
			},
		);
	};

	return Object.create(runnable, {
		invoke: {
			value: wrappedInvoke,
			writable: true,
			configurable: true,
		},
	});
}

export function instrumentLangGraph(
	graph: LangGraphRunnable,
	options?: AgentFrameworkPluginOptions,
) {
	if (graph && typeof graph.invoke === "function") {
		const wrapped = wrapLangGraphRunnable(graph, options);
		graph.invoke = wrapped.invoke;
	}
}

export class LangGraphAdapter implements AgentFrameworkAdapter {
	readonly name = "langgraph";

	install(framework: LangGraphRunnable, options?: AgentFrameworkPluginOptions) {
		if (framework && typeof framework.invoke === "function") {
			instrumentLangGraph(framework, options);
		}
	}
}
