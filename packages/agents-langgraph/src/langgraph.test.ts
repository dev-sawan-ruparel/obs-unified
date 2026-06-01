import { createRequestSpan, runWithSpan } from "@obs-unified/telemetry-sdk";
import { describe, expect, it } from "vitest";
import { LangGraphAdapter, wrapLangGraphRunnable } from "./index";

describe("LangGraph SDK Agent Action Graph Wrapper", () => {
	it("should track runs, steps, llm calls, and tool calls via callbacks", async () => {
		const requestSpan = createRequestSpan("test-service", "langgraph-run");

		await runWithSpan(requestSpan, async () => {
			const fakeRunnable = {
				invoke: async (_input: any, config?: any) => {
					// Simulate callbacks triggered by LangGraph engine
					if (config?.callbacks && config.callbacks.length > 0) {
						for (const callback of config.callbacks) {
							// 1. Node start / end
							await callback.handleChainEnd(
								{ result: "Step node outputs" },
								"node-run-id",
								undefined,
								[],
								{ node_name: "triage_node" },
							);

							// 2. LLM start / end
							await callback.handleLLMStart(
								{},
								["User request query"],
								"llm-run-id",
							);
							await callback.handleLLMEnd(
								{
									generations: [
										[
											{
												text: "LLM result text",
												message: {
													response_metadata: {
														model_name: "gpt-4o",
														provider: "openai",
														token_usage: {
															prompt_tokens: 12,
															completion_tokens: 6,
															total_tokens: 18,
														},
													},
												},
											},
										],
									],
								},
								"llm-run-id",
							);

							// 3. Tool start / end
							await callback.handleToolStart(
								{},
								JSON.stringify({ key: "val" }),
								"tool-run-id",
							);
							await callback.handleToolEnd(
								"Tool output success result",
								"tool-run-id",
								undefined,
								[],
								{ tool_name: "stripe_charge_tool" },
							);
						}
					}
					return { finalOutput: "Workflow complete" };
				},
			};

			const instrumented = wrapLangGraphRunnable(fakeRunnable, {
				defaultAgentId: "langgraph-agent-123",
				defaultAgentName: "StateGraph Assistant",
				capturePayloads: true,
				classifyTool: (toolName: any) => {
					if (toolName === "stripe_charge_tool") {
						return { sideEffect: true, approvalState: "human_approved" };
					}
					return {};
				},
			});

			const result = await instrumented.invoke({ query: "triage request" });
			expect(result.finalOutput).toBe("Workflow complete");
		});

		// Assert spans and OTel attributes
		const exportReq = requestSpan.toOtlpExportRequest();
		const spans = exportReq.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
		expect(spans.length).toBeGreaterThan(1);

		const hasStringAttr = (span: any, key: string, value: string) =>
			span.attributes?.some(
				(attr: any) => attr.key === key && attr.value?.stringValue === value,
			) ?? false;
		const attrValue = (span: any, key: string) => {
			const value = span.attributes?.find(
				(attr: any) => attr.key === key,
			)?.value;
			expect(value).toBeDefined();
			return value;
		};

		// 1. Assert Agent Run
		const runSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.run"),
		);
		if (!runSpan) throw new Error("Missing runSpan");
		expect(attrValue(runSpan, "obs.agent_run.agent_id").stringValue).toBe(
			"langgraph-agent-123",
		);
		expect(attrValue(runSpan, "obs.agent_run.agent_name").stringValue).toBe(
			"StateGraph Assistant",
		);
		expect(attrValue(runSpan, "obs.agent_run.outcome").stringValue).toBe(
			"Successfully completed LangGraph workflow execution",
		);

		// 2. Assert Step node
		const stepSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.step"),
		);
		if (!stepSpan) throw new Error("Missing stepSpan");
		expect(stepSpan.parentSpanId).toBe(runSpan.spanId);
		expect(stepSpan.name).toBe("triage_node");

		// 3. Assert LLM
		const llmSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "llm"),
		);
		if (!llmSpan) throw new Error("Missing llmSpan");
		expect(llmSpan.parentSpanId).toBe(runSpan.spanId);
		expect(attrValue(llmSpan, "llm.model_name").stringValue).toBe("gpt-4o");
		expect(attrValue(llmSpan, "llm.token_count.total").intValue).toBe("18");

		// 4. Assert Tool
		const toolSpan = spans.find((s) =>
			hasStringAttr(s, "obs.action.kind", "tool.call"),
		);
		if (!toolSpan) throw new Error("Missing toolSpan");
		expect(toolSpan.parentSpanId).toBe(runSpan.spanId);
		expect(attrValue(toolSpan, "obs.tool_call.tool_name").stringValue).toBe(
			"stripe_charge_tool",
		);
		expect(attrValue(toolSpan, "obs.tool_call.side_effect").intValue).toBe("1");
		expect(
			attrValue(toolSpan, "obs.tool_call.approval_state").stringValue,
		).toBe("human_approved");
	});

	it("respects privacy default (payloads not captured unless explicit)", async () => {
		const requestSpan = createRequestSpan("test-service", "langgraph-privacy");

		await runWithSpan(requestSpan, async () => {
			const fakeRunnable = {
				invoke: async (_input: any, config?: any) => {
					if (config?.callbacks && config.callbacks.length > 0) {
						for (const callback of config.callbacks) {
							await callback.handleLLMStart(
								{},
								["Secret request"],
								"llm-run-id",
							);
							await callback.handleLLMEnd(
								{
									generations: [
										[
											{
												text: "Secret text",
												message: {
													response_metadata: {
														model_name: "gpt-4o",
													},
												},
											},
										],
									],
								},
								"llm-run-id",
							);
						}
					}
					return {};
				},
			};

			const instrumented = wrapLangGraphRunnable(fakeRunnable, {
				capturePayloads: false, // Default
			});

			await instrumented.invoke({ query: "Secret triage" });
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const llmSpan = spans.find((s) =>
			s.attributes?.some(
				(attr: any) =>
					attr.key === "obs.action.kind" && attr.value?.stringValue === "llm",
			),
		);
		if (!llmSpan) throw new Error("Missing llmSpan");

		const inputAttr = llmSpan.attributes?.find(
			(attr: any) => attr.key === "ai.payload.input",
		);
		expect(inputAttr?.value?.stringValue || "").toBe("");

		const outputAttr = llmSpan.attributes?.find(
			(attr: any) => attr.key === "ai.payload.output",
		);
		expect(outputAttr?.value?.stringValue || "").toBe("");
	});

	it("can install using LangGraphAdapter and instrumentLangGraph on compiled graph", async () => {
		const graph = {
			invoke: async (_input: any, _config?: any) => {
				return { ok: true };
			},
		};

		const adapter = new LangGraphAdapter();
		adapter.install(graph, { defaultAgentName: "Adapter StateGraph" });

		const requestSpan = createRequestSpan("test-service", "langgraph-adapter");

		await runWithSpan(requestSpan, async () => {
			await graph.invoke({ test: 1 });
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const runSpan = spans.find((s) =>
			s.attributes?.some(
				(attr: any) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "agent.run",
			),
		);
		if (!runSpan) throw new Error("Missing runSpan");
		expect(attrValue(runSpan, "obs.agent_run.agent_name").stringValue).toBe(
			"Adapter StateGraph",
		);
	});
});

const attrValue = (span: any, key: string) => {
	const value = span.attributes?.find((attr: any) => attr.key === key)?.value;
	return value;
};
