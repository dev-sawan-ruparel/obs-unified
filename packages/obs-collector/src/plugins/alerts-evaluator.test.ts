import type { AlertRule } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import { evaluateRuleBatch } from "./alerts-evaluator";

type EvaluatorStore = Parameters<typeof evaluateRuleBatch>[0];

const makeRule = (id: string): AlertRule => ({
	id,
	projectId: "default",
	name: `Rule ${id}`,
	signal: "spans",
	query: {},
	threshold: 10,
	windowMins: 5,
	comparison: ">",
	channels: [],
	enabled: true,
	createdAt: "2026-05-31T00:00:00.000Z",
	updatedAt: "2026-05-31T00:00:00.000Z",
	analysisId: null,
	currentState: "ok",
	lastStateChange: null,
});

const makeStore = (
	overrides: Partial<EvaluatorStore> = {},
): EvaluatorStore => ({
	listEnabledRules: async () => [],
	evaluateRule: async () => 0,
	getState: async () => null,
	getAnalysisNarrative: async () => null,
	transitionState: async () => {},
	recordEvaluation: async () => {},
	...overrides,
});

describe("evaluateRuleBatch", () => {
	it("evaluates rules with a bounded concurrency limit", async () => {
		const rules = Array.from({ length: 6 }, (_, i) => makeRule(`r${i}`));
		let active = 0;
		let maxActive = 0;
		const store = makeStore({
			evaluateRule: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				await new Promise((resolve) => setTimeout(resolve, 5));
				active -= 1;
				return 0;
			},
		});

		const result = await evaluateRuleBatch(store, rules, { concurrency: 2 });

		expect(result).toEqual({ evaluated: 6, fired: 0, resolved: 0 });
		expect(maxActive).toBeLessThanOrEqual(2);
	});

	it("times out a stuck rule and continues the batch", async () => {
		const errors: unknown[] = [];
		let recorded = 0;
		const store = makeStore({
			evaluateRule: async (rule) => {
				if (rule.id === "stuck") return new Promise<number>(() => {});
				return 0;
			},
			recordEvaluation: async () => {
				recorded += 1;
			},
		});

		const result = await evaluateRuleBatch(
			store,
			[makeRule("stuck"), makeRule("ok")],
			{
				concurrency: 2,
				ruleTimeoutMs: 1,
				logger: {
					debug: () => {},
					info: () => {},
					warn: () => {},
					error: (_message, attrs) => errors.push(attrs),
				},
			},
		);

		expect(result).toEqual({ evaluated: 2, fired: 0, resolved: 0 });
		expect(recorded).toBe(1);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ rule_id: "stuck" });
	});
});
