import { createRequestSpan, runWithSpan } from "@obs-unified/telemetry-sdk";
import { describe, expect, it } from "vitest";
import {
	VercelAIAdapter,
	withVercelAIRun,
	wrapGenerateText,
	wrapStreamText,
} from "./index";

interface TestAttribute {
	key: string;
	value?: {
		stringValue?: string;
		intValue?: number | string;
	};
}

interface TestSpan {
	spanId?: string;
	parentSpanId?: string;
	attributes?: TestAttribute[];
}

interface TestStepEvent {
	text?: unknown;
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
	};
	finishReason?: string;
	toolCalls?: unknown;
	toolResults?: Array<{
		toolName?: string;
		args?: unknown;
		result?: unknown;
		error?: unknown;
	}>;
}

interface TestGenerateOptions {
	model?: string | { id?: string; modelId?: string; provider?: string };
	prompt?: unknown;
	messages?: unknown;
	onStepFinish?: (event: TestStepEvent) => unknown;
	[key: string]: unknown;
}

interface TestStreamOptions {
	model?: string | { id?: string; modelId?: string; provider?: string };
	prompt?: unknown;
	messages?: unknown;
	onFinish?: (event: TestStepEvent) => unknown;
	[key: string]: unknown;
}

describe("Vercel AI SDK Agent Action Graph Wrapper", () => {
	it("establishes agent run context and handles wrapped generateText with tools", async () => {
		const requestSpan = createRequestSpan("test-service", "vercel-ai-run");

		await runWithSpan(requestSpan, async () => {
			await withVercelAIRun(
				{
					agentId: "vercel-ai-agent",
					agentName: "Vercel AI Assistant",
					goal: "Process invoice refund",
					autonomyLevel: "human_approved_write",
				},
				async (run) => {
					// Mock the inner generateText call
					const fakeGenerateText = async (options: TestGenerateOptions) => {
						// Simulate Vercel AI SDK triggering onStepFinish callback internally
						if (options.onStepFinish) {
							await options.onStepFinish({
								text: "LLM response suggesting tool call",
								usage: {
									promptTokens: 10,
									completionTokens: 5,
									totalTokens: 15,
								},
								finishReason: "tool-calls",
								toolCalls: [{ toolName: "refund_tool", args: { amount: 100 } }],
								toolResults: [
									{
										toolName: "refund_tool",
										args: { amount: 100 },
										result: { success: true, txnId: "tx-999" },
									},
								],
							});
						}
						return {
							text: "Refund processed successfully.",
							usage: {
								promptTokens: 15,
								completionTokens: 10,
								totalTokens: 25,
							},
							toolResults: [
								{
									toolName: "refund_tool",
									args: { amount: 100 },
									result: { success: true, txnId: "tx-999" },
								},
							],
						};
					};

					const wrappedGenerateText = wrapGenerateText(fakeGenerateText, {
						capturePayloads: true,
						classifyTool: (toolObj: unknown) => {
							if (
								typeof toolObj === "object" &&
								toolObj !== null &&
								"toolName" in toolObj &&
								toolObj.toolName === "refund_tool"
							) {
								return { sideEffect: true, approvalState: "human_approved" };
							}
							return {};
						},
					});

					const result = await wrappedGenerateText({
						model: { id: "gpt-4o", provider: "openai" },
						prompt: "Please refund $100",
					});

					expect(result.text).toBe("Refund processed successfully.");
					run.setOutcome("Refund successfully handled");
				},
			);
		});

		// Assert spans and their attributes
		const exportReq = requestSpan.toOtlpExportRequest();
		const spans = exportReq.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
		expect(spans.length).toBeGreaterThan(1);

		const hasStringAttr = (span: TestSpan, key: string, value: string) =>
			span.attributes?.some(
				(attr) => attr.key === key && attr.value?.stringValue === value,
			) ?? false;
		const attrValue = (span: TestSpan, key: string) => {
			const value = span.attributes?.find((attr) => attr.key === key)?.value;
			if (!value) throw new Error(`Missing attribute ${key}`);
			return value;
		};

		// 1. Assert Agent Run
		const runSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.run"),
		);
		if (!runSpan) throw new Error("Missing runSpan");
		expect(attrValue(runSpan, "obs.agent_run.agent_id").stringValue).toBe(
			"vercel-ai-agent",
		);
		expect(attrValue(runSpan, "obs.agent_run.agent_name").stringValue).toBe(
			"Vercel AI Assistant",
		);
		expect(attrValue(runSpan, "obs.agent_run.goal").stringValue).toBe(
			"Process invoice refund",
		);
		expect(attrValue(runSpan, "obs.agent_run.outcome").stringValue).toBe(
			"Refund successfully handled",
		);

		// 2. Assert Step
		const stepSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.step"),
		);
		if (!stepSpan) throw new Error("Missing stepSpan");
		expect(stepSpan.parentSpanId).toBe(runSpan.spanId);

		// 3. Assert LLM
		const llmSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "llm.call"),
		);
		if (!llmSpan) throw new Error("Missing llmSpan");
		expect(llmSpan.parentSpanId).toBe(stepSpan.spanId);
		expect(attrValue(llmSpan, "llm.model_name").stringValue).toBe("gpt-4o");
		expect(attrValue(llmSpan, "llm.provider").stringValue).toBe("openai");
		expect(attrValue(llmSpan, "llm.token_count.total").intValue).toBe("15");

		// 4. Assert Tool
		const toolSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "tool.call"),
		);
		if (!toolSpan) throw new Error("Missing toolSpan");
		expect(toolSpan.parentSpanId).toBe(stepSpan.spanId);
		expect(attrValue(toolSpan, "obs.tool_call.tool_name").stringValue).toBe(
			"refund_tool",
		);
		expect(attrValue(toolSpan, "obs.tool_call.side_effect").intValue).toBe("1");
		expect(
			attrValue(toolSpan, "obs.tool_call.approval_state").stringValue,
		).toBe("human_approved");
	});

	it("respects privacy default (payloads not captured unless explicit)", async () => {
		const requestSpan = createRequestSpan("test-service", "vercel-ai-privacy");

		await runWithSpan(requestSpan, async () => {
			await withVercelAIRun(
				{
					agentId: "vercel-ai-agent",
					agentName: "Vercel AI Assistant",
				},
				async () => {
					const fakeGenerateText = async (_options: TestGenerateOptions) => {
						return {
							text: "Secret data",
							usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
						};
					};

					const wrappedGenerateText = wrapGenerateText(fakeGenerateText, {
						capturePayloads: false, // Default / explicit false
					});

					await wrappedGenerateText({
						model: "gpt-4o",
						prompt: "Secret query",
					});
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		// respects privacy default test
		const llmSpan = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "llm.call",
			),
		);
		if (!llmSpan) throw new Error("Missing llmSpan");

		// Payloads should NOT be present in OTel input/output
		const inputAttr = llmSpan.attributes?.find(
			(attr) => attr.key === "ai.payload.input",
		);
		expect(inputAttr?.value?.stringValue || "").toBe("");

		const outputAttr = llmSpan.attributes?.find(
			(attr) => attr.key === "ai.payload.output",
		);
		expect(outputAttr?.value?.stringValue || "").toBe("");
	});

	it("supports wrapStreamText functionality", async () => {
		const requestSpan = createRequestSpan("test-service", "vercel-ai-stream");

		await runWithSpan(requestSpan, async () => {
			await withVercelAIRun(
				{
					agentId: "vercel-ai-agent",
					agentName: "Vercel AI Assistant",
				},
				async () => {
					const fakeStreamText = async (options: TestStreamOptions) => {
						if (options.onFinish) {
							await options.onFinish({
								text: "Stream response",
								usage: {
									promptTokens: 8,
									completionTokens: 4,
									totalTokens: 12,
								},
								finishReason: "stop",
							});
						}
						return {};
					};

					const wrappedStreamText = wrapStreamText(fakeStreamText, {
						capturePayloads: true,
					});

					await wrappedStreamText({
						model: "gpt-4o",
						prompt: "Hello stream",
					});
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const streamLlmSpan = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "llm.call",
			),
		);
		if (!streamLlmSpan) throw new Error("Missing streamLlmSpan");
		const tokensAttr = streamLlmSpan.attributes?.find(
			(attr) => attr.key === "llm.token_count.total",
		)?.value?.intValue;
		expect(tokensAttr).toBe("12");
	});

	it("can install using VercelAIAdapter on framework object", async () => {
		const framework = {
			generateText: async (_options: TestGenerateOptions) => {
				return { text: "Adapter output" };
			},
			streamText: async (_options: TestStreamOptions) => {
				return { text: "Stream adapter output" };
			},
		};

		const adapter = new VercelAIAdapter();
		adapter.install(framework, { capturePayloads: true });

		const requestSpan = createRequestSpan("test-service", "vercel-ai-adapter");

		await runWithSpan(requestSpan, async () => {
			await withVercelAIRun(
				{
					agentId: "vercel-ai-agent",
					agentName: "Vercel AI Assistant",
				},
				async () => {
					await framework.generateText({
						model: "gpt-4o",
						prompt: "Test",
					});
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const llmSpan = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "llm.call",
			),
		);
		if (!llmSpan) throw new Error("Missing llmSpan");
	});
});
