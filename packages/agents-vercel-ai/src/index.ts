import {
	llm,
	startAgentRun,
	step,
	tool,
} from "@obsunified/telemetry-sdk/agent";
import type {
	AgentFrameworkAdapter,
	AgentFrameworkPluginOptions,
	AgentRun,
	AgentRunOptions,
} from "@obsunified/telemetry-sdk/agent-plugin";

type VercelAIModel =
	| string
	| {
			modelId?: string;
			id?: string;
			provider?: string;
	  };

interface VercelAIUsage {
	promptTokens?: number;
	completionTokens?: number;
	totalTokens?: number;
}

interface VercelAIToolResult {
	toolName?: string;
	args?: unknown;
	result?: unknown;
	error?: unknown;
}

interface VercelAIStepEvent {
	text?: unknown;
	toolCalls?: unknown;
	toolResults?: VercelAIToolResult[];
	usage?: VercelAIUsage;
	finishReason?: string;
}

interface VercelAIRequestOptions {
	model?: VercelAIModel;
	prompt?: unknown;
	messages?: unknown;
	onStepFinish?: (event: VercelAIStepEvent) => unknown | Promise<unknown>;
	onFinish?: (event: VercelAIStepEvent) => unknown | Promise<unknown>;
	[key: string]: unknown;
}

interface VercelAIResult {
	text?: unknown;
	toolCalls?: unknown;
	toolResults?: VercelAIToolResult[];
	usage?: VercelAIUsage;
	[key: string]: unknown;
}

type VercelAIFn<
	TOptions extends VercelAIRequestOptions,
	TResult extends VercelAIResult,
> = (options: TOptions) => Promise<TResult>;

export function withVercelAIRun<T>(
	options: AgentRunOptions,
	fn: (run: AgentRun) => Promise<T>,
): Promise<T> {
	return startAgentRun(
		{
			agentId: options.agentId,
			agentName: options.agentName,
			agentVersion: options.agentVersion,
			goal: options.goal,
			autonomyLevel: options.autonomyLevel,
			actorId: options.actorId,
			actorType: options.actorType,
		},
		fn,
	);
}

export function wrapGenerateText<
	TOptions extends VercelAIRequestOptions,
	TResult extends VercelAIResult,
>(
	generateTextFn: VercelAIFn<TOptions, TResult>,
	pluginOptions?: AgentFrameworkPluginOptions,
): VercelAIFn<TOptions, TResult> {
	return async (options: TOptions) => {
		const capturePayloads = pluginOptions?.capturePayloads ?? false;
		const modelObj = options.model;
		const modelName =
			(typeof modelObj === "object" && modelObj?.modelId) ||
			(typeof modelObj === "object" && modelObj?.id) ||
			(typeof modelObj === "string" ? modelObj : "unknown-model");
		const provider =
			(typeof modelObj === "object" && modelObj?.provider) ||
			"unknown-provider";

		const stepName = `generateText: ${modelName}`;
		return step({ name: stepName, kind: "agent.step" }, async (agentStep) => {
			const instrumentedOptions = { ...options };
			const originalOnStepFinish = instrumentedOptions.onStepFinish;
			const stepsData: VercelAIStepEvent[] = [];

			instrumentedOptions.onStepFinish = async (
				stepEvent: VercelAIStepEvent,
			) => {
				stepsData.push(stepEvent);

				await llm(
					{
						model: modelName,
						provider,
						input: capturePayloads
							? options.prompt || options.messages
							: undefined,
						name: `LLM Step ${stepsData.length}`,
					},
					async (llmCall) => {
						if (capturePayloads) {
							llmCall.setOutput(stepEvent.text || stepEvent.toolCalls);
						}
						if (stepEvent.usage) {
							llmCall.setTokens({
								prompt: stepEvent.usage.promptTokens,
								completion: stepEvent.usage.completionTokens,
								total: stepEvent.usage.totalTokens,
							});
						}
						llmCall.setAttribute(
							"vercel_ai.finish_reason",
							stepEvent.finishReason,
						);
					},
				);

				if (stepEvent.toolResults && stepEvent.toolResults.length > 0) {
					for (const toolResult of stepEvent.toolResults) {
						const toolName = toolResult.toolName ?? "unknown-tool";
						const toolArgs = toolResult.args;
						const toolOutput = toolResult.result;

						const classification =
							pluginOptions?.classifyTool?.(toolResult) || {};
						const sideEffect = classification.sideEffect ?? false;
						const approvalState = classification.approvalState ?? "bypassed";

						await tool(
							{
								name: toolName,
								arguments: capturePayloads ? toolArgs : undefined,
								sideEffect,
								approvalState,
							},
							async (tCall) => {
								if (capturePayloads) {
									tCall.setResult(toolOutput);
								}
								if (toolResult.error) {
									tCall.setError(String(toolResult.error));
								}
							},
						);
					}
				}

				if (originalOnStepFinish) {
					return originalOnStepFinish(stepEvent);
				}
			};

			try {
				const result = await generateTextFn(instrumentedOptions);

				if (stepsData.length === 0) {
					await llm(
						{
							model: modelName,
							provider,
							input: capturePayloads
								? options.prompt || options.messages
								: undefined,
							name: "LLM Call",
						},
						async (llmCall) => {
							if (capturePayloads) {
								llmCall.setOutput(result.text || result.toolCalls);
							}
							if (result.usage) {
								llmCall.setTokens({
									prompt: result.usage.promptTokens,
									completion: result.usage.completionTokens,
									total: result.usage.totalTokens,
								});
							}
						},
					);

					if (result.toolResults && result.toolResults.length > 0) {
						for (const toolResult of result.toolResults) {
							const toolName = toolResult.toolName ?? "unknown-tool";
							const toolArgs = toolResult.args;
							const toolOutput = toolResult.result;

							const classification =
								pluginOptions?.classifyTool?.(toolResult) || {};
							const sideEffect = classification.sideEffect ?? false;
							const approvalState = classification.approvalState ?? "bypassed";

							await tool(
								{
									name: toolName,
									arguments: capturePayloads ? toolArgs : undefined,
									sideEffect,
									approvalState,
								},
								async (tCall) => {
									if (capturePayloads) {
										tCall.setResult(toolOutput);
									}
									if (toolResult.error) {
										tCall.setError(String(toolResult.error));
									}
								},
							);
						}
					}
				}

				return result;
			} catch (err) {
				agentStep.setAttribute("error", true);
				throw err;
			}
		});
	};
}

export function wrapStreamText<
	TOptions extends VercelAIRequestOptions,
	TResult extends VercelAIResult,
>(
	streamTextFn: VercelAIFn<TOptions, TResult>,
	pluginOptions?: AgentFrameworkPluginOptions,
): VercelAIFn<TOptions, TResult> {
	return async (options: TOptions) => {
		const capturePayloads = pluginOptions?.capturePayloads ?? false;
		const modelObj = options.model;
		const modelName =
			(typeof modelObj === "object" && modelObj?.modelId) ||
			(typeof modelObj === "object" && modelObj?.id) ||
			(typeof modelObj === "string" ? modelObj : "unknown-model");
		const provider =
			(typeof modelObj === "object" && modelObj?.provider) ||
			"unknown-provider";

		const stepName = `streamText: ${modelName}`;
		return step({ name: stepName, kind: "agent.step" }, async (agentStep) => {
			const instrumentedOptions = { ...options };
			const originalOnFinish = instrumentedOptions.onFinish;

			instrumentedOptions.onFinish = async (finishEvent: VercelAIStepEvent) => {
				await llm(
					{
						model: modelName,
						provider,
						input: capturePayloads
							? options.prompt || options.messages
							: undefined,
						name: "LLM Stream Call",
					},
					async (llmCall) => {
						if (capturePayloads) {
							llmCall.setOutput(finishEvent.text || finishEvent.toolCalls);
						}
						if (finishEvent.usage) {
							llmCall.setTokens({
								prompt: finishEvent.usage.promptTokens,
								completion: finishEvent.usage.completionTokens,
								total: finishEvent.usage.totalTokens,
							});
						}
					},
				);

				if (finishEvent.toolResults && finishEvent.toolResults.length > 0) {
					for (const toolResult of finishEvent.toolResults) {
						const toolName = toolResult.toolName ?? "unknown-tool";
						const toolArgs = toolResult.args;
						const toolOutput = toolResult.result;

						const classification =
							pluginOptions?.classifyTool?.(toolResult) || {};
						const sideEffect = classification.sideEffect ?? false;
						const approvalState = classification.approvalState ?? "bypassed";

						await tool(
							{
								name: toolName,
								arguments: capturePayloads ? toolArgs : undefined,
								sideEffect,
								approvalState,
							},
							async (tCall) => {
								if (capturePayloads) {
									tCall.setResult(toolOutput);
								}
								if (toolResult.error) {
									tCall.setError(String(toolResult.error));
								}
							},
						);
					}
				}

				if (originalOnFinish) {
					return originalOnFinish(finishEvent);
				}
			};

			try {
				const result = await streamTextFn(instrumentedOptions);
				return result;
			} catch (err) {
				agentStep.setAttribute("error", true);
				throw err;
			}
		});
	};
}

export class VercelAIAdapter implements AgentFrameworkAdapter {
	readonly name = "vercel-ai";

	install(
		framework: Partial<{
			generateText: VercelAIFn<VercelAIRequestOptions, VercelAIResult>;
			streamText: VercelAIFn<VercelAIRequestOptions, VercelAIResult>;
		}>,
		options?: AgentFrameworkPluginOptions,
	) {
		if (framework && typeof framework === "object") {
			if (typeof framework.generateText === "function") {
				framework.generateText = wrapGenerateText(
					framework.generateText,
					options,
				);
			}
			if (typeof framework.streamText === "function") {
				framework.streamText = wrapStreamText(framework.streamText, options);
			}
		}
	}
}
