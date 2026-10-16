import { describe, expect, it } from "vitest";
import { hrefForEntity, linksFromAi, linksFromEvalResults } from "./manifest";

describe("connected-routes manifest link shapes", () => {
	it("routes eval, service and ai_call entities to deep-linkable hashes", () => {
		expect(hrefForEntity("eval", "case 1")).toBe("#/evaluations/case%201");
		expect(hrefForEntity("service", "checkout")).toBe(
			"#/service-map?service=checkout",
		);
		expect(hrefForEntity("ai_call", "call-1")).toBe("#/ai/calls/call-1");
	});

	it("carries the eval id and the ai call id in section links", () => {
		const evals = linksFromEvalResults(
			[
				{
					id: "eval-1",
					actionId: "act-1",
					projectId: "default",
					evaluatorName: "groundedness",
					evaluatorVersion: "1",
					score: 1,
					passed: 1,
					reasoning: null,
					rubricJson: null,
				},
			],
			"Evals",
		);
		expect(evals.links[0].href).toBe("#/evaluations/eval-1");
		const ai = linksFromAi(
			[
				{
					callId: "call/1",
					provider: "openai",
					modelName: "gpt",
				} as unknown as Parameters<typeof linksFromAi>[0][number],
			],
			"AI",
		);
		expect(ai.links[0].href).toBe("#/ai/calls/call%2F1");
		expect(ai.links[0].entityId).toBe("call/1");
	});
});
