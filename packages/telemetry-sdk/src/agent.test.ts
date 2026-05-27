import { describe, expect, it } from "vitest";
import {
	getActiveAgentContext,
	recordArtifact,
	recordEvaluation,
	recordRetrieval,
	startAgentRun,
	step,
	tool,
} from "./agent";
import { createRequestSpan, runWithSpan } from "./span";

describe("Agent Action Graph SDK Context Propagation", () => {
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

					// Let's call step inside
					const stepResult = await step(
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

					// Record a tool invocation
					await tool(
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
					await recordRetrieval(
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
					await recordEvaluation({
						evaluatorName: "correctness-grader",
						score: 1.0,
						passed: true,
						reasoning: "Perfect response match",
					});

					// Record artifact
					await recordArtifact({
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
		expect(attrValue(toolSpan, "obs.tool_call.side_effect").intValue).toBe(1);
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
		).toBe(1);

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
		expect(attrValue(evalSpan, "obs.eval.passed").intValue).toBe(1);
		expect(attrValue(evalSpan, "obs.eval.score").intValue).toBe(1);

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
			120,
		);
	});
});
