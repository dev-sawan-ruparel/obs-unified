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
	markNotified: async () => true,
	getAnalysisNarrative: async () => null,
	transitionState: async () => {},
	recordEvaluation: async () => {},
	...overrides,
});

type StateRow = {
	current_state: "ok" | "firing";
	last_state_change: string;
	notified: number;
};

/**
 * In-memory alert_state (with the migration-049 `notified` flag) and
 * alert_evaluations, mirroring AlertsStore semantics so multi-tick scenarios
 * exercise the real transition / redelivery logic.
 */
const makeStatefulStore = (overrides: Partial<EvaluatorStore> = {}) => {
	let state: StateRow | null = null;
	const transitions: string[] = [];
	const evaluations: Array<{ state: string; notified: boolean }> = [];
	const store = makeStore({
		getState: async () => state,
		transitionState: async (_id, _project, next, now) => {
			transitions.push(next);
			state = { current_state: next, last_state_change: now, notified: 0 };
		},
		markNotified: async (_id, _project, s, lastStateChange) => {
			if (
				!state ||
				state.current_state !== s ||
				state.last_state_change !== lastStateChange ||
				state.notified === 1
			) {
				return false;
			}
			state.notified = 1;
			return true;
		},
		recordEvaluation: async (_id, _project, _value, s, notified) => {
			evaluations.push({ state: s, notified });
		},
		...overrides,
	});
	return { store, transitions, evaluations, current: () => state };
};

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

		expect(result).toEqual({
			evaluated: 6,
			fired: 0,
			resolved: 0,
			redelivered: 0,
		});
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

		expect(result).toEqual({
			evaluated: 2,
			fired: 0,
			resolved: 0,
			redelivered: 0,
		});
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

	it("records firing immediately when the webhook fails, then redelivers without a second transition", async () => {
		const statuses = [503, 200];
		const fetchMock = vi.fn(async () => {
			const status = statuses.shift() ?? 200;
			return new Response(null, { status });
		});
		vi.stubGlobal("fetch", fetchMock);
		const { store, transitions, evaluations, current } = makeStatefulStore({
			evaluateRule: async () => 42,
		});

		// Tick 1: breach, webhook returns 503. The dashboard must still see
		// `firing`; only the notification is outstanding.
		const first = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(first).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(transitions).toEqual(["firing"]);
		expect(current()).toMatchObject({ current_state: "firing", notified: 0 });
		expect(evaluations.map((e) => [e.state, e.notified])).toEqual([
			["firing", false],
		]);

		// Tick 2: still breaching, webhook now accepts → the owed notification
		// goes out; the state does not churn.
		const second = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(second).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(transitions).toEqual(["firing"]);
		expect(current()).toMatchObject({ current_state: "firing", notified: 1 });
		expect(evaluations.at(-1)).toMatchObject({
			state: "firing",
			notified: true,
		});

		// Tick 3: delivered already → plain evaluation, no webhook.
		const third = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(third).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(evaluations.at(-1)).toMatchObject({
			state: "firing",
			notified: false,
		});
	});

	it("records recovery immediately and retries the recovery webhook until it is accepted", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);
		const { store, transitions, current } = makeStatefulStore({
			evaluateRule: async () => 0,
		});
		await store.transitionState(
			"hook",
			"default",
			"firing",
			"2026-05-31T00:00:00.000Z",
		);
		transitions.length = 0;

		const result = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(result).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 1,
			redelivered: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(transitions).toEqual(["ok"]);
		expect(current()?.current_state).toBe("ok");

		// Next tick: still ok, recovery notice still owed → retried, no churn.
		const retry = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(retry).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(transitions).toEqual(["ok"]);
	});

	it("notifies a delivered state exactly once however many ticks follow", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { store } = makeStatefulStore({ evaluateRule: async () => 42 });

		await evaluateRuleBatch(store, [webhookRule()], { logger });
		await evaluateRuleBatch(store, [webhookRule()], { logger });
		await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("acknowledges delivery before writing history, so a failed history write cannot cause a resend", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger: capturing, entries } = (() => {
			const entries: string[] = [];
			return {
				entries,
				logger: {
					debug() {},
					info() {},
					warn() {},
					error(message: string) {
						entries.push(message);
					},
				},
			};
		})();
		const { store, current } = makeStatefulStore({
			evaluateRule: async () => 42,
		});
		const recordEvaluation = store.recordEvaluation;
		let failHistoryOnce = true;
		store.recordEvaluation = async (...args) => {
			if (failHistoryOnce) {
				failHistoryOnce = false;
				throw new Error("alert_evaluations insert failed");
			}
			return recordEvaluation(...args);
		};

		await evaluateRuleBatch(store, [webhookRule()], { logger: capturing });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(entries).toContain("[alerts-evaluator] rule evaluation failed");
		// The webhook was accepted, so the transition is already acknowledged.
		expect(current()).toMatchObject({ current_state: "firing", notified: 1 });

		await evaluateRuleBatch(store, [webhookRule()], { logger: capturing });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("treats a state row without the notified column (schema before 049) as delivered", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const store = makeStore({
			evaluateRule: async () => 42,
			getState: async () => ({
				current_state: "firing",
				last_state_change: "2026-05-31T00:00:00.000Z",
			}),
		});

		const result = await evaluateRuleBatch(store, [webhookRule()], { logger });
		expect(result).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("marks only the transition it delivered, so a state change during delivery keeps its own flag", async () => {
		// The webhook for `firing` is slow; by the time it is accepted the rule
		// has already flipped to `ok` on another tick.
		const { store, current, transitions } = makeStatefulStore({
			evaluateRule: async () => 42,
		});
		let releaseFiring: () => void = () => {};
		const slowFetch = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					releaseFiring = () => resolve(new Response(null, { status: 200 }));
				}),
		);
		vi.stubGlobal("fetch", slowFetch);
		const firingTick = evaluateRuleBatch(store, [webhookRule()], { logger });
		await vi.waitFor(() => expect(slowFetch).toHaveBeenCalledTimes(1));

		// A concurrent tick observes recovery and records `ok`, delivered at once.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 200 })),
		);
		await evaluateRuleBatch(
			{ ...store, evaluateRule: async () => 0 },
			[webhookRule()],
			{ logger },
		);
		expect(current()).toMatchObject({ current_state: "ok", notified: 1 });

		releaseFiring();
		await firingTick;
		// The late `firing` acknowledgement must not touch the `ok` row.
		expect(transitions).toEqual(["firing", "ok"]);
		expect(current()).toMatchObject({ current_state: "ok", notified: 1 });
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
		const { store, transitions, evaluations } = makeStatefulStore({
			evaluateRule: async () => 42,
		});

		const result = await evaluateRuleBatch(store, [ruleFor(SECRET_HOOK)], {
			logger,
			tracer: tracer as never,
		});

		// The redirect counts as a failed delivery: the state is recorded but
		// the evaluation is marked not notified, so the next tick retries.
		expect(result).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((fetchMock.mock.calls[0]?.[1] as RequestInit).redirect).toBe(
			"manual",
		);
		expect(transitions).toEqual(["firing"]);
		expect(evaluations.at(-1)).toMatchObject({
			state: "firing",
			notified: false,
		});
		const serialized = JSON.stringify({ entries, spanAttrs });
		expect(serialized).not.toContain("SUPERSECRET");
		expect(serialized).toContain("https://hooks.slack.com/…");
	});

	it("refuses private network targets at fire time unless explicitly allowed", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const rule = ruleFor("http://169.254.169.254/latest/meta-data/");
		const { store, current, evaluations } = makeStatefulStore({
			evaluateRule: async () => 42,
		});

		// The breach is recorded as `firing` for the dashboard even though the
		// target is refused; nothing is sent.
		const blocked = await evaluateRuleBatch(store, [rule], { logger });
		expect(blocked).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(current()?.current_state).toBe("firing");
		expect(evaluations).toEqual([
			expect.objectContaining({ state: "firing", notified: false }),
		]);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(entries.map((e) => e.message)).toContain(
			"[alerts-evaluator] webhook target refused",
		);

		const allowed = await evaluateRuleBatch(store, [rule], {
			logger,
			allowPrivateWebhookTargets: true,
		});
		// Once allowed, the outstanding notification is delivered without
		// another transition.
		expect(allowed).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses a public name whose DNS answer is private when a resolver is provided", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const { store } = makeStatefulStore({ evaluateRule: async () => 42 });
		const rule = ruleFor("https://hooks.example.com/alert/abc");

		const refused = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: async () => ["192.168.1.20"],
		});
		expect(refused).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(entries)).toContain("resolves to a private address");

		const delivered = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: async () => ["93.184.216.34"],
		});
		expect(delivered).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("refuses delivery when the configured resolver cannot answer, unless private targets are allowed", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { logger, entries } = capturingLogger();
		const { store } = makeStatefulStore({ evaluateRule: async () => 42 });
		const rule = ruleFor("https://hooks.example.com/alert/abc");
		const failingLookup = async () => {
			throw new Error("EAI_AGAIN");
		};

		const refused = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: failingLookup,
		});
		expect(refused).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		expect(JSON.stringify(entries)).toContain("could not be resolved");

		// The private-network opt-in skips the resolver entirely.
		const allowed = await evaluateRuleBatch(store, [rule], {
			logger,
			hostLookup: failingLookup,
			allowPrivateWebhookTargets: true,
		});
		expect(allowed).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 1,
		});
	});
});
