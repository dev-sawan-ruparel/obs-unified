import { describe, expect, it } from "vitest";
import { mapEvaluationRows } from "./evaluations";

describe("mapEvaluationRows", () => {
	it("adds evidence references that pivot from AI evaluation to span and trace", () => {
		const [evaluation] = mapEvaluationRows([
			{
				evaluation_id: "eval-1",
				project_id: "default",
				trace_id: "trace-1",
				span_id: "span-1",
				name: "groundedness",
				score: 0.2,
				label: "fail",
				explanation: "unsupported answer",
				source: "llm_judge",
				metadata_json: "{}",
				created_at: "2026-05-01T00:00:00.000Z",
				expires_at: "2026-05-02T00:00:00.000Z",
			},
		]);

		expect(evaluation.evidenceReferences).toEqual([
			expect.objectContaining({
				evidenceId: "ai-evaluation:eval-1",
				entityKind: "eval",
				entityId: "eval-1",
				route: "#/evals/eval-1",
				source: "ai_span_evaluations.llm_judge",
				citations: [
					{
						label: "span span-1",
						entityKind: "span",
						entityId: "trace-1:span-1",
						route: "#/traces/trace-1#span=span-1",
					},
					{
						label: "trace trace-1",
						entityKind: "trace",
						entityId: "trace-1",
						route: "#/traces/trace-1",
					},
				],
			}),
		]);
	});
});
