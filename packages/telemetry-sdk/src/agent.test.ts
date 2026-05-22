import { describe, expect, it, vi } from "vitest";
import {
	startAgentRun,
	step,
	tool,
	recordRetrieval,
	recordEvaluation,
	recordArtifact,
	getActiveAgentContext,
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
					const stepResult = await step({ name: "plan-next-action" }, async (stepObj) => {
						const stepCtx = getActiveAgentContext();
						expect(stepCtx).toBeDefined();
						expect(stepCtx?.causedByActionId).toBe(ctx?.actionId);
						expect(stepCtx?.rootActionId).toBe(ctx?.rootActionId);
						expect(stepCtx?.agentRunId).toBe(ctx?.agentRunId);
						return "step-done";
					});

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
		expect(spans!.length).toBeGreaterThan(1);

		// Find the agent run span
		const runSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "agent.run"),
		);
		expect(runSpan).toBeDefined();
		
		const runAttrs = runSpan!.attributes;
		expect(runAttrs.find((a) => a.key === "obs.agent_run.agent_id")?.value.stringValue).toBe("test-agent-123");
		expect(runAttrs.find((a) => a.key === "obs.agent_run.agent_name")?.value.stringValue).toBe("Agent Alpha");
		expect(runAttrs.find((a) => a.key === "obs.agent_run.goal")?.value.stringValue).toBe("Solve coding puzzle");
		expect(runAttrs.find((a) => a.key === "obs.agent_run.autonomy_level")?.value.stringValue).toBe("autonomous_write");
		expect(runAttrs.find((a) => a.key === "obs.agent_run.outcome")?.value.stringValue).toBe("Successfully solved the puzzle");

		// Find step span
		const stepSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "agent.step"),
		);
		expect(stepSpan).toBeDefined();
		expect(stepSpan!.parentSpanId).toBe(runSpan!.spanId);

		// Find tool span
		const toolSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "tool.call"),
		);
		expect(toolSpan).toBeDefined();
		expect(toolSpan!.parentSpanId).toBe(runSpan!.spanId);
		expect(toolSpan!.attributes.find((a) => a.key === "openinference.span.kind")?.value.stringValue).toBe("TOOL");
		expect(toolSpan!.attributes.find((a) => a.key === "obs.tool_call.tool_name")?.value.stringValue).toBe("execute-cmd");
		expect(toolSpan!.attributes.find((a) => a.key === "obs.tool_call.side_effect")?.value.intValue).toBe(1);
		expect(toolSpan!.attributes.find((a) => a.key === "obs.tool_call.approval_state")?.value.stringValue).toBe("human_approved");
		expect(toolSpan!.attributes.find((a) => a.key === "obs.tool_call.result")?.value.stringValue).toContain("ok");

		// Find retrieval span
		const retrievalSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "retrieval"),
		);
		expect(retrievalSpan).toBeDefined();
		expect(retrievalSpan!.parentSpanId).toBe(runSpan!.spanId);
		expect(retrievalSpan!.attributes.find((a) => a.key === "openinference.span.kind")?.value.stringValue).toBe("RETRIEVER");
		expect(retrievalSpan!.attributes.find((a) => a.key === "obs.retrieval.retriever_name")?.value.stringValue).toBe("vector-db");
		expect(retrievalSpan!.attributes.find((a) => a.key === "obs.retrieval.query")?.value.stringValue).toBe("agent concepts");
		expect(retrievalSpan!.attributes.find((a) => a.key === "obs.retrieval.total_results")?.value.intValue).toBe(1);

		// Find eval span
		const evalSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "eval"),
		);
		expect(evalSpan).toBeDefined();
		expect(evalSpan!.parentSpanId).toBe(runSpan!.spanId);
		expect(evalSpan!.attributes.find((a) => a.key === "obs.eval.evaluator_name")?.value.stringValue).toBe("correctness-grader");
		expect(evalSpan!.attributes.find((a) => a.key === "obs.eval.passed")?.value.intValue).toBe(1);
		expect(evalSpan!.attributes.find((a) => a.key === "obs.eval.score")?.value.intValue).toBe(1);

		// Find artifact span
		const artifactSpan = spans!.find((s) =>
			s.attributes.some((attr) => attr.key === "obs.action.kind" && attr.value.stringValue === "artifact"),
		);
		expect(artifactSpan).toBeDefined();
		expect(artifactSpan!.parentSpanId).toBe(runSpan!.spanId);
		expect(artifactSpan!.attributes.find((a) => a.key === "obs.artifact.name")?.value.stringValue).toBe("patch.diff");
		expect(artifactSpan!.attributes.find((a) => a.key === "obs.artifact.type")?.value.stringValue).toBe("patch");
		expect(artifactSpan!.attributes.find((a) => a.key === "obs.artifact.size_bytes")?.value.intValue).toBe(120);
	});
});
