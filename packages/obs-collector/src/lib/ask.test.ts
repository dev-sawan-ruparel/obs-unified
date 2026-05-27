import type { AnalysisDefinition, AnalysisResult } from "@obs-unified/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAsk } from "./ask";

const def = (
	overrides: Partial<AnalysisDefinition> = {},
): AnalysisDefinition => ({
	id: "overall_error_rate",
	title: "Overall error rate",
	group: "Health",
	source: "tier0",
	view: "tile",
	refreshSeconds: 60,
	...overrides,
});

const result = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
	analysisId: "overall_error_rate",
	projectId: "default",
	generatedAt: "2026-04-28T00:00:00Z",
	paramsHash: null,
	status: "warn",
	primaryValue: 0.05,
	baselineValue: 0.01,
	deltaPct: 400,
	payload: {},
	narrative: null,
	narrativeSignature: "warn|0.1|0.0|",
	durationMs: 5,
	...overrides,
});

const llm = {
	provider: "anthropic" as const,
	apiKey: "test-key",
	model: "claude-haiku-4-5",
};

const mockFetchSequence = (responses: Array<Record<string, unknown>>) => {
	let i = 0;
	return vi.fn(
		async () =>
			({
				ok: true,
				json: async () => responses[i++] ?? responses[responses.length - 1],
				text: async () => "",
			}) as unknown as Response,
	);
};

describe("runAsk", () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		// vi.fn replaces fetch in each test below
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns the model's text when it answers without tools", async () => {
		globalThis.fetch = mockFetchSequence([
			{
				stop_reason: "end_turn",
				content: [
					{
						type: "text",
						text: "error rate is 5% (overall_error_rate), up 400% vs the prior hour",
					},
				],
			},
		]) as typeof fetch;

		const out = await runAsk("is anything broken?", {
			llm,
			listAnalyses: async () => [],
			getLatestResult: async () => null,
		});

		expect(out.answer).toContain("error rate is 5%");
		expect(out.evidence).toEqual([]);
		expect(out.queries).toEqual([]);
		expect(out.error).toBeNull();
	});

	it("invokes list_analyses then run_analysis then synthesizes", async () => {
		globalThis.fetch = mockFetchSequence([
			// turn 1: model asks for the analyses catalog
			{
				stop_reason: "tool_use",
				content: [
					{
						type: "tool_use",
						id: "tu_1",
						name: "list_analyses",
						input: { group: "Health" },
					},
				],
			},
			// turn 2: model picks one and asks for its result
			{
				stop_reason: "tool_use",
				content: [
					{
						type: "tool_use",
						id: "tu_2",
						name: "run_analysis",
						input: { id: "overall_error_rate" },
					},
				],
			},
			// turn 3: model writes the final answer
			{
				stop_reason: "end_turn",
				content: [
					{
						type: "text",
						text: "errors at 5% in the last 5 minutes, up from 1% (overall_error_rate)",
					},
				],
			},
		]) as typeof fetch;

		const def0 = def();
		const r0 = result();
		const out = await runAsk("any errors?", {
			llm,
			listAnalyses: async () => [def0],
			getLatestResult: async (id) =>
				id === def0.id ? { definition: def0, result: r0 } : null,
		});

		expect(out.answer).toContain("errors at 5%");
		expect(out.queries).toHaveLength(2);
		expect(out.queries.map((q) => q.tool)).toEqual([
			"list_analyses",
			"run_analysis",
		]);
		expect(out.evidence).toHaveLength(1);
		expect(out.evidence[0]?.analysisId).toBe("overall_error_rate");
	});

	it("surfaces tool errors back to the model rather than throwing", async () => {
		globalThis.fetch = mockFetchSequence([
			{
				stop_reason: "tool_use",
				content: [
					{
						type: "tool_use",
						id: "tu_1",
						name: "run_analysis",
						input: { id: "does_not_exist" },
					},
				],
			},
			{
				stop_reason: "end_turn",
				content: [
					{
						type: "text",
						text: "the requested analysis isn't registered (does_not_exist)",
					},
				],
			},
		]) as typeof fetch;

		const out = await runAsk("does this work?", {
			llm,
			listAnalyses: async () => [],
			getLatestResult: async () => null,
		});

		expect(out.answer).toContain("isn't registered");
		expect(out.evidence).toEqual([]);
		expect(out.queries).toHaveLength(1);
	});

	it("hits the iteration cap and returns an error", async () => {
		// Model never calls end_turn — keeps requesting list_analyses.
		const loopForever = {
			stop_reason: "tool_use",
			content: [
				{
					type: "tool_use",
					id: "tu_x",
					name: "list_analyses",
					input: {},
				},
			],
		};
		globalThis.fetch = mockFetchSequence([
			loopForever,
			loopForever,
			loopForever,
			loopForever,
			loopForever,
			loopForever,
			loopForever,
		]) as typeof fetch;

		const out = await runAsk("loop please", {
			llm,
			listAnalyses: async () => [def()],
			getLatestResult: async () => null,
		});

		expect(out.answer).toBeNull();
		expect(out.error).toMatch(/iteration cap/);
		// Each iteration's tool call gets logged, even when we cap.
		expect(out.queries.length).toBeGreaterThanOrEqual(5);
	});

	it("treats an empty stop_reason=end_turn as 'no answer'", async () => {
		globalThis.fetch = mockFetchSequence([
			{ stop_reason: "end_turn", content: [] },
		]) as typeof fetch;

		const out = await runAsk("hmm", {
			llm,
			listAnalyses: async () => [],
			getLatestResult: async () => null,
		});

		expect(out.answer).toBeNull();
		expect(out.error).toBe("model returned no text");
	});
});
