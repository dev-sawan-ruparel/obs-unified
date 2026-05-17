/**
 * OpenAI provider adapter tests.
 *
 * Same coverage as ask.test.ts (Anthropic side), with the OpenAI
 * Chat Completions / function-calling shape:
 *
 *   - assistant turn that emits `tool_calls`
 *   - tool result message with role: "tool" and tool_call_id
 *   - finish_reason: "stop" terminates the loop
 */

import type { AnalysisDefinition, AnalysisResult } from "@obs-unified/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAsk } from "./ask";

const def = (overrides: Partial<AnalysisDefinition> = {}): AnalysisDefinition => ({
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
	generatedAt: "2026-04-29T00:00:00Z",
	paramsHash: null,
	status: "warn",
	primaryValue: 0.05,
	baselineValue: 0.01,
	deltaPct: 400,
	payload: {},
	narrative: null,
	narrativeSignature: "warn|0.05|0.01|",
	durationMs: 5,
	...overrides,
});

const llm = {
	provider: "openai" as const,
	apiKey: "test-key",
	model: "gpt-4o-mini",
};

const mockFetchSequence = (responses: Array<Record<string, unknown>>) => {
	let i = 0;
	return vi.fn(async (_url: unknown, init: unknown) => {
		// Capture last init for header assertions
		(globalThis as Record<string, unknown>).__lastInit = init;
		return {
			ok: true,
			json: async () => responses[i++] ?? responses[responses.length - 1],
			text: async () => "",
		} as unknown as Response;
	});
};

describe("runAsk (openai)", () => {
	const originalFetch = globalThis.fetch;
	beforeEach(() => {
		// fetch replaced per test
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("uses Authorization: Bearer and chat/completions endpoint", async () => {
		globalThis.fetch = mockFetchSequence([
			{
				choices: [
					{
						finish_reason: "stop",
						message: {
							role: "assistant",
							content:
								"errors at 5% in last 5 minutes (overall_error_rate)",
						},
					},
				],
			},
		]) as typeof fetch;

		const out = await runAsk("any errors?", {
			llm,
			listAnalyses: async () => [],
			getLatestResult: async () => null,
		});

		expect(out.answer).toContain("errors at 5%");
		expect(out.error).toBeNull();
		const init = (globalThis as Record<string, unknown>).__lastInit as {
			headers: Record<string, string>;
		};
		expect(init.headers.Authorization).toBe("Bearer test-key");
	});

	it("invokes list_analyses then run_analysis then synthesizes", async () => {
		globalThis.fetch = mockFetchSequence([
			// turn 1: assistant requests list_analyses
			{
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: {
										name: "list_analyses",
										arguments: '{"group":"Health"}',
									},
								},
							],
						},
					},
				],
			},
			// turn 2: assistant requests run_analysis
			{
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_2",
									type: "function",
									function: {
										name: "run_analysis",
										arguments: '{"id":"overall_error_rate"}',
									},
								},
							],
						},
					},
				],
			},
			// turn 3: assistant writes the final answer
			{
				choices: [
					{
						finish_reason: "stop",
						message: {
							role: "assistant",
							content:
								"errors at 5% in the last 5 minutes (overall_error_rate)",
						},
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

	it("tolerates malformed tool arguments (parses to empty object)", async () => {
		globalThis.fetch = mockFetchSequence([
			{
				choices: [
					{
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call_x",
									type: "function",
									function: {
										name: "run_analysis",
										arguments: "{not json",
									},
								},
							],
						},
					},
				],
			},
			{
				choices: [
					{
						finish_reason: "stop",
						message: {
							role: "assistant",
							content: "the request was missing an id",
						},
					},
				],
			},
		]) as typeof fetch;

		const out = await runAsk("err?", {
			llm,
			listAnalyses: async () => [],
			getLatestResult: async () => null,
		});

		expect(out.answer).toContain("missing an id");
		expect(out.queries).toHaveLength(1);
	});

	it("hits the iteration cap and returns an error", async () => {
		const loopForever = {
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: null,
						tool_calls: [
							{
								id: "call_x",
								type: "function",
								function: {
									name: "list_analyses",
									arguments: "{}",
								},
							},
						],
					},
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
		]) as typeof fetch;

		const out = await runAsk("loop", {
			llm,
			listAnalyses: async () => [def()],
			getLatestResult: async () => null,
		});

		expect(out.answer).toBeNull();
		expect(out.error).toMatch(/iteration cap/);
		expect(out.queries.length).toBeGreaterThanOrEqual(5);
	});

	it("treats a stop turn with empty content as 'no answer'", async () => {
		globalThis.fetch = mockFetchSequence([
			{
				choices: [
					{
						finish_reason: "stop",
						message: { role: "assistant", content: "" },
					},
				],
			},
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
