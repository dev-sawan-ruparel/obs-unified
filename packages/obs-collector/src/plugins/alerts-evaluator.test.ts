import type { AlertRule } from "@obsunified/types";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("evaluateRuleBatch — webhook delivery failures", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const webhookRule = (): AlertRule => ({
		...makeRule("hook"),
		channels: [{ type: "webhook", url: "https://hooks.example.test/alert" }],
	});

	const logger = { debug() {}, info() {}, warn() {}, error() {} };

	it("keeps the rule in its prior state when the webhook fails, then retries", async () => {
		const statuses = [503, 200];
		const fetchMock = vi.fn(async () => {
			const status = statuses.shift() ?? 200;
			return new Response(null, { status });
		});
		vi.stubGlobal("fetch", fetchMock);

		let state: { current_state: "ok" | "firing" } | null = null;
		const transitions: string[] = [];
		const evaluations: Array<{ state: string; notified: boolean }> = [];
		const store = makeStore({
			evaluateRule: async () => 42,
			getState: async () =>
				state as unknown as Awaited<ReturnType<EvaluatorStore["getState"]>>,
			transitionState: async (_id, _project, next) => {
				transitions.push(next);
				state = { current_state: next };
			},
			recordEvaluation: async (_id, _project, _value, s, notified) => {
				evaluations.push({ state: s, notified });
			},
		});

		// Tick 1: breach, webhook returns 503 → no state change, not notified.
		const first = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(first).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(transitions).toEqual([]);
		expect(evaluations).toEqual([{ state: "firing", notified: false }]);

		// Tick 2: still breaching, webhook now accepts → fires and transitions.
		const second = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(second).toEqual({ evaluated: 1, fired: 1, resolved: 0 });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(transitions).toEqual(["firing"]);
		expect(evaluations.at(-1)).toEqual({ state: "firing", notified: true });
	});

	it("does not resolve a firing rule until the recovery webhook is delivered", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);
		const transitions: string[] = [];
		const store = makeStore({
			evaluateRule: async () => 0,
			getState: async () =>
				({ current_state: "firing" }) as unknown as Awaited<
					ReturnType<EvaluatorStore["getState"]>
				>,
			transitionState: async (_id, _project, next) => {
				transitions.push(next);
			},
		});

		const result = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(result).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(transitions).toEqual([]);
	});
});

describe("evaluateRuleBatch — webhook target safety", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const SECRET_HOOK = "https://hooks.slack.com/services/T000/B000/SUPERSECRET";

	const ruleFor = (url: string): AlertRule => ({
		...makeRule("safety"),
		channels: [{ type: "webhook", url }],
	});

	const capturingLogger = () => {
		const entries: Array<{ message: string; attrs?: Record<string, unknown> }> =
			[];
		return {
			entries,
			logger: {
				debug() {},
				info() {},
				warn(message: string, attrs?: Record<string, unknown>) {
					entries.push({ message, attrs });
				},
				error(message: string, attrs?: Record<string, unknown>) {
					entries.push({ message, attrs });
				},
			},
		};
	};

	it("does not follow redirects and never logs the secret-bearing URL", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response(null, {
					status: 302,
					headers: { Location: "https://evil.example/collect" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const spanAttrs: Record<string, unknown>[] = [];
		const tracer = async <T>(
			_name: string,
			fn: (span: { setAttribute(k: string, v: unknown): void }) => Promise<T>,
			attrs?: Record<string, unknown>,
		) => {
			if (attrs) spanAttrs.push(attrs);
			return fn({ setAttribute() {} });
		};
		const transitions: string[] = [];
		const store = makeStore({
			evaluateRule: async () => 42,
			transitionState: async (_id, _project, next) => {
				transitions.push(next);
			},
		});

		const result = await evaluateRuleBatch(store, [ruleFor(SECRET_HOOK)], {
			logger,
			tracer: tracer as never,
		});

		expect(result).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe(
			"manual",
		);
		expect(transitions).toEqual([]);
		const serialized = JSON.stringify({ entries, spanAttrs });
		expect(serialized).not.toContain("SUPERSECRET");
		expect(serialized).toContain("https://hooks.slack.com/…");
	});

	it("refuses private network targets at fire time unless explicitly allowed", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const rule = ruleFor("http://169.254.169.254/latest/meta-data/");
		const store = makeStore({ evaluateRule: async () => 42 });

		const blocked = await evaluateRuleBatch(store, [rule], { logger });
		expect(blocked).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(entries.map((e) => e.message)).toContain(
			"[alerts-evaluator] webhook target refused",
		);

		const allowed = await evaluateRuleBatch(store, [rule], {
			logger,
			allowPrivateWebhookTargets: true,
		});
		expect(allowed).toEqual({ evaluated: 1, fired: 1, resolved: 0 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses a public name whose DNS answer is private when a resolver is provided", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const store = makeStore({ evaluateRule: async () => 42 });
		const rule = ruleFor("https://hooks.example.com/alert/abc");

		const refused = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: async () => ["192.168.1.20"],
		});
		expect(refused).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(entries)).toContain("resolves to a private address");

		const delivered = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: async () => ["93.184.216.34"],
		});
		expect(delivered).toEqual({ evaluated: 1, fired: 1, resolved: 0 });
	});

	it("refuses delivery when the configured resolver cannot answer, unless private targets are allowed", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const store = makeStore({ evaluateRule: async () => 42 });
		const rule = ruleFor("https://hooks.example.com/alert/abc");
		const failingLookup = async () => {
			throw new Error("EAI_AGAIN");
		};

		const refused = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: failingLookup,
		});
		expect(refused).toEqual({ evaluated: 1, fired: 0, resolved: 0 });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(entries)).toContain("could not be resolved");

		// The private-network opt-in skips the resolver entirely.
		const allowed = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: failingLookup,
			allowPrivateWebhookTargets: true,
		});
		expect(allowed).toEqual({ evaluated: 1, fired: 1, resolved: 0 });
	});
});
