import { describe, expect, it } from "vitest";
import {
	createActionId,
	getActiveAgentContext,
	llm,
	recordArtifact,
	recordEvaluation,
	recordRetrieval,
	restoreActionContext,
	serializeActionContext,
	startAgentRun,
	step,
	tool,
	withAction,
	withSerializedActionContext,
} from "./agent";
import { createRequestSpan, runWithSpan } from "./span";

describe("Agent Action Graph SDK Context Propagation", () => {
	it("creates RFC 0010 sortable action ids", () => {
		const actionId = createActionId();
		expect(actionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(
			createActionId(1_700_000_000_000) < createActionId(1_700_000_000_001),
		).toBe(true);
	});

	it("should initialize agent runs and propagate context to child spans", async () => {
		const requestSpan = createRequestSpan("test-service", "test-request");

		await runWithSpan(requestSpan, async () => {
			const result = await startAgentRun(
				{
					agentId: "test-agent-123",
					agentName: "Agent Alpha",
					goal: "Solve coding puzzle",
					autonomyLevel: "autonomous_write",
				},
				async (run) => {
					expect(run.runId).toBeDefined();
					const ctx = getActiveAgentContext();
					expect(ctx).toBeDefined();
					expect(ctx?.agentRunId).toBe(run.runId);
					expect(ctx?.actorType).toBe("agent");
					expect(ctx?.actorId).toBe("test-agent-123");
					expect(run.runId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

					// Let's call step inside
					const stepResult = await run.step(
						{ name: "plan-next-action" },
						async (_stepObj) => {
							const stepCtx = getActiveAgentContext();
							expect(stepCtx).toBeDefined();
							expect(stepCtx?.causedByActionId).toBe(ctx?.actionId);
							expect(stepCtx?.rootActionId).toBe(ctx?.rootActionId);
							expect(stepCtx?.agentRunId).toBe(ctx?.agentRunId);
							return "step-done";
						},
					);

					expect(stepResult).toBe("step-done");

					await run.llm(
						{
							name: "classify-intent",
							model: "gpt-4o-mini",
							provider: "openai",
							input: [{ role: "user", content: "Fix invoice address" }],
							promptVersion: "billing-v3",
						},
						async (call) => {
							const llmCtx = getActiveAgentContext();
							expect(llmCtx?.causedByActionId).toBe(ctx?.actionId);
							expect(call.actionId).toBe(llmCtx?.actionId);
							call.setTokens({ prompt: 11, completion: 7, total: 18 });
							call.setCost(0.0012);
							call.setOutput({ intent: "billing_update" });
						},
					);

					// Record a tool invocation
					await run.tool(
						{
							name: "execute-cmd",
							arguments: { cmd: "ls" },
							sideEffect: true,
							approvalState: "human_approved",
						},
						async (tCall) => {
							const toolCtx = getActiveAgentContext();
							expect(toolCtx?.causedByActionId).toBe(ctx?.actionId);
							tCall.setResult({ status: "ok", files: ["a.ts"] });
						},
					);

					// Record a retrieval
					await run.recordRetrieval(
						{
							retrieverName: "vector-db",
							query: "agent concepts",
						},
						async (retriever) => {
							retriever.addDocuments([
								{ id: "doc-1", score: 0.95, content: "Agent causal logs" },
							]);
							retriever.setMaxRelevanceScore(0.95);
						},
					);

					// Record evaluation
					await run.recordEvaluation({
						evaluatorName: "correctness-grader",
						score: 1.0,
						passed: true,
						reasoning: "Perfect response match",
					});

					// Record artifact
					await run.recordArtifact({
						name: "patch.diff",
						type: "patch",
						content: "diff --git a/file b/file",
						sizeBytes: 120,
					});

					run.setOutcome("Successfully solved the puzzle");
					return "run-done";
				},
			);

			expect(result).toBe("run-done");
		});

		// Export OTLP request to assert attribute properties
		const exportReq = requestSpan.toOtlpExportRequest();
		const spans = exportReq.resourceSpans?.[0]?.scopeSpans?.[0]?.spans;
		expect(spans).toBeDefined();
		expect(spans?.length).toBeGreaterThan(1);
		const spanList = spans ?? [];
		const hasStringAttr = (
			span: (typeof spanList)[number],
			key: string,
			value: string,
		) =>
			span.attributes?.some(
				(attr) => attr.key === key && attr.value?.stringValue === value,
			) ?? false;
		const attrValue = (span: (typeof spanList)[number], key: string) => {
			const value = span.attributes?.find((attr) => attr.key === key)?.value;
			expect(value).toBeDefined();
			if (!value) {
				throw new Error(`Missing span attribute: ${key}`);
			}
			return value;
		};

		// Find the agent run span
		const runSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.run"),
		);
		expect(runSpan).toBeDefined();
		if (!runSpan) {
			throw new Error("Missing agent run span");
		}

		expect(attrValue(runSpan, "obs.agent_run.agent_id").stringValue).toBe(
			"test-agent-123",
		);
		expect(attrValue(runSpan, "obs.agent_run.agent_name").stringValue).toBe(
			"Agent Alpha",
		);
		expect(attrValue(runSpan, "obs.agent_run.goal").stringValue).toBe(
			"Solve coding puzzle",
		);
		expect(attrValue(runSpan, "obs.agent_run.autonomy_level").stringValue).toBe(
			"autonomous_write",
		);
		expect(attrValue(runSpan, "obs.agent_run.outcome").stringValue).toBe(
			"Successfully solved the puzzle",
		);

		// Find step span
		const stepSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "agent.step"),
		);
		expect(stepSpan).toBeDefined();
		expect(stepSpan?.parentSpanId).toBe(runSpan?.spanId);

		// Find LLM span
		const llmSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "llm"),
		);
		expect(llmSpan).toBeDefined();
		if (!llmSpan) {
			throw new Error("Missing LLM span");
		}
		expect(llmSpan?.parentSpanId).toBe(runSpan?.spanId);
		expect(attrValue(llmSpan, "openinference.span.kind").stringValue).toBe(
			"LLM",
		);
		expect(attrValue(llmSpan, "llm.model_name").stringValue).toBe(
			"gpt-4o-mini",
		);
		expect(attrValue(llmSpan, "llm.provider").stringValue).toBe("openai");
		expect(attrValue(llmSpan, "gen_ai.request.model").stringValue).toBe(
			"gpt-4o-mini",
		);
		expect(attrValue(llmSpan, "llm.token_count.total").intValue).toBe("18");
		expect(attrValue(llmSpan, "llm.cost.total_usd").doubleValue).toBe(0.0012);

		// Find tool span
		const toolSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "tool.call"),
		);
		expect(toolSpan).toBeDefined();
		if (!toolSpan) {
			throw new Error("Missing tool span");
		}
		expect(toolSpan?.parentSpanId).toBe(runSpan?.spanId);
		expect(attrValue(toolSpan, "openinference.span.kind").stringValue).toBe(
			"TOOL",
		);
		expect(attrValue(toolSpan, "obs.tool_call.tool_name").stringValue).toBe(
			"execute-cmd",
		);
		expect(attrValue(toolSpan, "obs.tool_call.side_effect").intValue).toBe("1");
		expect(
			attrValue(toolSpan, "obs.tool_call.approval_state").stringValue,
		).toBe("human_approved");
		expect(attrValue(toolSpan, "obs.tool_call.result").stringValue).toContain(
			"ok",
		);

		// Find retrieval span
		const retrievalSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "retrieval"),
		);
		expect(retrievalSpan).toBeDefined();
		if (!retrievalSpan) {
			throw new Error("Missing retrieval span");
		}
		expect(retrievalSpan?.parentSpanId).toBe(runSpan?.spanId);
		expect(
			attrValue(retrievalSpan, "openinference.span.kind").stringValue,
		).toBe("RETRIEVER");
		expect(
			attrValue(retrievalSpan, "obs.retrieval.retriever_name").stringValue,
		).toBe("vector-db");
		expect(attrValue(retrievalSpan, "obs.retrieval.query").stringValue).toBe(
			"agent concepts",
		);
		expect(
			attrValue(retrievalSpan, "obs.retrieval.total_results").intValue,
		).toBe("1");

		// Find eval span
		const evalSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "eval"),
		);
		expect(evalSpan).toBeDefined();
		if (!evalSpan) {
			throw new Error("Missing eval span");
		}
		expect(evalSpan?.parentSpanId).toBe(runSpan?.spanId);
		expect(attrValue(evalSpan, "obs.eval.evaluator_name").stringValue).toBe(
			"correctness-grader",
		);
		expect(attrValue(evalSpan, "obs.eval.passed").intValue).toBe("1");
		expect(attrValue(evalSpan, "obs.eval.score").intValue).toBe("1");

		// Find artifact span
		const artifactSpan = spanList.find((s) =>
			hasStringAttr(s, "obs.action.kind", "artifact"),
		);
		expect(artifactSpan).toBeDefined();
		if (!artifactSpan) {
			throw new Error("Missing artifact span");
		}
		expect(artifactSpan?.parentSpanId).toBe(runSpan?.spanId);
		expect(attrValue(artifactSpan, "obs.artifact.name").stringValue).toBe(
			"patch.diff",
		);
		expect(attrValue(artifactSpan, "obs.artifact.type").stringValue).toBe(
			"patch",
		);
		expect(attrValue(artifactSpan, "obs.artifact.size_bytes").intValue).toBe(
			"120",
		);
	});

	it("restores explicit action context for framework and queue wrappers", async () => {
		const requestSpan = createRequestSpan("test-service", "queued-job");
		await runWithSpan(requestSpan, async () => {
			await withAction(
				{
					actionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
					rootActionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
					agentRunId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
					actorType: "agent",
					actorId: "queue-agent",
				},
				async () => {
					await step({ name: "queued-step" }, async () => undefined);
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const queuedStep = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "agent.step",
			),
		);
		expect(queuedStep).toBeDefined();
		expect(
			queuedStep?.attributes?.find((attr) => attr.key === "obs.action.root_id")
				?.value?.stringValue,
		).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
		expect(
			queuedStep?.attributes?.find(
				(attr) => attr.key === "obs.action.caused_by_id",
			)?.value?.stringValue,
		).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
	});

	it("keeps top-level helpers available for compatibility", async () => {
		const requestSpan = createRequestSpan("test-service", "compat-request");
		await runWithSpan(requestSpan, async () => {
			await startAgentRun(
				{ agentId: "agent-1", agentName: "Compat Agent" },
				async () => {
					await step({ name: "compat-step" }, async () => undefined);
					await llm(
						{ model: "claude-sonnet-4", provider: "anthropic" },
						async (call) => call.setOutput("ok"),
					);
					await tool({ name: "compat-tool", arguments: {} }, async (toolCall) =>
						toolCall.setResult({ ok: true }),
					);
					await recordRetrieval(
						{ retrieverName: "compat-retriever", query: "q" },
						async (retriever) => retriever.addDocuments([]),
					);
					await recordEvaluation({
						evaluatorName: "compat-eval",
						passed: true,
					});
					await recordArtifact({
						name: "compat.txt",
						type: "text",
						content: "ok",
					});
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		expect(
			spans.filter((s) =>
				s.attributes?.some((attr) => attr.key === "obs.action.kind"),
			),
		).toHaveLength(7);
	});

	it("returns undefined when no active action context is available", () => {
		expect(serializeActionContext()).toBeUndefined();
		expect(restoreActionContext(undefined)).toBeUndefined();
	});

	it("serializes active agent run context for queue metadata", async () => {
		await startAgentRun(
			{
				agentId: "queue-agent",
				agentName: "Queue Agent",
				actorType: "agent",
				actorId: "queue-agent",
			},
			async (run) => {
				const metadata = serializeActionContext();
				expect(metadata).toEqual({
					rootActionId: run.runId,
					actionId: run.runId,
					agentRunId: run.runId,
					actorType: "agent",
					actorId: "queue-agent",
				});
			},
		);
	});

	it("restores queue metadata so consumer child steps point to the producer action", async () => {
		const requestSpan = createRequestSpan("test-service", "queue-consumer");
		let queuedMetadata: ReturnType<typeof serializeActionContext>;

		await startAgentRun(
			{ agentId: "producer-agent", agentName: "Producer Agent" },
			async () => {
				await step({ name: "enqueue-invoice-job" }, async () => {
					queuedMetadata = serializeActionContext();
				});
			},
		);

		if (!queuedMetadata) throw new Error("Expected serialized queue metadata");

		await runWithSpan(requestSpan, async () => {
			await withSerializedActionContext(queuedMetadata, async () => {
				await step({ name: "process-invoice-job" }, async () => undefined);
			});
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const consumerStep = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "agent.step",
			),
		);
		expect(consumerStep).toBeDefined();
		expect(
			consumerStep?.attributes?.find(
				(attr) => attr.key === "obs.action.caused_by_id",
			)?.value?.stringValue,
		).toBe(queuedMetadata.actionId);
		expect(
			consumerStep?.attributes?.find(
				(attr) => attr.key === "obs.action.root_id",
			)?.value?.stringValue,
		).toBe(queuedMetadata.rootActionId);
	});

	it("carries explicit serialized metadata through a fake queue payload", async () => {
		const requestSpan = createRequestSpan("test-service", "explicit-queue");
		const payload = {
			name: "sync-invoice",
			metadata: {
				obsActionContext: {
					rootActionId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
					actionId: "01BX5ZZKBKACTAV9WEVGEMMVRZ",
					causedByActionId: "01BX5ZZKBKACTAV9WEVGEMMVRX",
					agentRunId: "01BX5ZZKBKACTAV9WEVGEMMVS0",
					actorType: "agent",
					actorId: "billing-worker",
				},
			},
		};

		await runWithSpan(requestSpan, async () => {
			await withSerializedActionContext(
				payload.metadata.obsActionContext,
				async () => {
					const active = getActiveAgentContext();
					expect(active?.actionId).toBe(
						payload.metadata.obsActionContext.actionId,
					);
					expect(active?.rootActionId).toBe(
						payload.metadata.obsActionContext.rootActionId,
					);
					expect(active?.causedByActionId).toBe(
						payload.metadata.obsActionContext.causedByActionId,
					);
					await step({ name: payload.name }, async () => undefined);
				},
			);
		});

		const spans =
			requestSpan.toOtlpExportRequest().resourceSpans?.[0]?.scopeSpans?.[0]
				?.spans ?? [];
		const consumerStep = spans.find((s) =>
			s.attributes?.some(
				(attr) =>
					attr.key === "obs.action.kind" &&
					attr.value?.stringValue === "agent.step",
			),
		);
		expect(
			consumerStep?.attributes?.find(
				(attr) => attr.key === "obs.action.caused_by_id",
			)?.value?.stringValue,
		).toBe(payload.metadata.obsActionContext.actionId);
		expect(
			consumerStep?.attributes?.find((attr) => attr.key === "obs.agent.run_id")
				?.value?.stringValue,
		).toBe(payload.metadata.obsActionContext.agentRunId);
	});
});
