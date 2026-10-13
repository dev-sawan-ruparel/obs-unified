/**
 * Regression for the alert notification retry: the "still owed" decision
 * lives on `alert_state.notified` (migration 049), not in alert_evaluations,
 * which housekeeping purges after 720 hours. A long-lived firing rule whose
 * evaluation history has been purged must not be re-notified every tick.
 * Runs the real AlertsStore against the migrated SQLite schema; only the
 * signal query and `fetch` are substituted.
 */

import type { AlertRule } from "@obsunified/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlertsStore } from "../lib/alerts-store";
import {
	ALERT_EVALUATIONS_MAX_AGE_HOURS,
	purgeSecondaryRows,
} from "../lib/housekeeping";
import { ProjectsStore } from "../lib/projects-store";
import { createMigratedSqliteDb } from "../lib/test-utils/node-sqlite-db";
import { evaluateRuleBatch } from "./alerts-evaluator";

type EvaluatorStore = Parameters<typeof evaluateRuleBatch>[0];

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const HOUR = 3_600_000;

/** Real store for state and evaluations; the signal value is injected. */
const evaluatorOver = (
	store: AlertsStore,
	value: () => number,
): EvaluatorStore => ({
	listEnabledRules: () => store.listEnabledRules(),
	evaluateRule: async () => value(),
	getState: (id, project) => store.getState(id, project),
	getAnalysisNarrative: (project, analysis) =>
		store.getAnalysisNarrative(project, analysis),
	transitionState: (id, project, next, now) =>
		store.transitionState(id, project, next, now),
	markNotified: (id, project, state, since) =>
		store.markNotified(id, project, state, since),
	recordEvaluation: (id, project, v, state, notified) =>
		store.recordEvaluation(id, project, v, state, notified),
});

const setup = async () => {
	const db = createMigratedSqliteDb();
	const project = await new ProjectsStore(db).createProject({
		name: "A",
		slug: "a",
	});
	const store = new AlertsStore(db);
	const rule = await store.createRule(project.id, {
		name: "errors",
		signal: "spans",
		query: {},
		threshold: 10,
		windowMins: 5,
		comparison: ">",
		channels: [{ type: "webhook", url: "https://hooks.example.com/alert/x" }],
		enabled: true,
	});
	const evaluations = () =>
		db.count("alert_evaluations", "rule_id = ?", rule.id);
	return { db, project, store, rule, evaluations };
};

const purgeAllEvaluations = async (
	db: ReturnType<typeof createMigratedSqliteDb>,
) =>
	purgeSecondaryRows(db, {
		retentionHours: 72,
		now: () => Date.now() + (ALERT_EVALUATIONS_MAX_AGE_HOURS + 1) * HOUR,
	});

describe("alert notification retry survives evaluation retention", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("does not re-send a delivered firing notification after its evaluations are purged", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const { db, project, store, rule, evaluations } = await setup();
		const evaluator = evaluatorOver(store, () => 42);
		const rules: AlertRule[] = [rule];

		// Breach: state recorded, webhook accepted, flag set.
		expect(await evaluateRuleBatch(evaluator, rules, { logger })).toEqual({
			evaluated: 1,
			fired: 1,
			resolved: 0,
			redelivered: 0,
		});
		expect(await store.getState(rule.id, project.id)).toMatchObject({
			current_state: "firing",
			notified: 1,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Still breaching for longer than evaluation retention: history goes.
		await evaluateRuleBatch(evaluator, rules, { logger });
		expect(await evaluations()).toBe(2);
		const purged = await purgeAllEvaluations(db);
		expect(purged.alert_evaluations).toBe(2);
		expect(await evaluations()).toBe(0);

		// The flag on the state row is the source of truth: no resend.
		for (let tick = 0; tick < 3; tick += 1) {
			expect(await evaluateRuleBatch(evaluator, rules, { logger })).toEqual({
				evaluated: 1,
				fired: 0,
				resolved: 0,
				redelivered: 0,
			});
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await store.getState(rule.id, project.id)).toMatchObject({
			current_state: "firing",
			notified: 1,
		});
	});

	it("keeps retrying an undelivered notification across the purge until a channel accepts it", async () => {
		const statuses = [503, 503, 200];
		const fetchMock = vi.fn(
			async () => new Response(null, { status: statuses.shift() ?? 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { db, project, store, rule } = await setup();
		const evaluator = evaluatorOver(store, () => 42);
		const rules: AlertRule[] = [rule];

		await evaluateRuleBatch(evaluator, rules, { logger }); // 503
		expect(await store.getState(rule.id, project.id)).toMatchObject({
			current_state: "firing",
			notified: 0,
		});
		await purgeAllEvaluations(db);

		await evaluateRuleBatch(evaluator, rules, { logger }); // 503 again
		expect(await evaluateRuleBatch(evaluator, rules, { logger })).toEqual({
			evaluated: 1,
			fired: 0,
			resolved: 0,
			redelivered: 1,
		}); // 200
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect((await store.getState(rule.id, project.id))?.notified).toBe(1);

		await evaluateRuleBatch(evaluator, rules, { logger });
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("listRules and getRule still expose the current state for the dashboard", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 500 })),
		);
		const { project, store, rule } = await setup();
		await evaluateRuleBatch(
			evaluatorOver(store, () => 42),
			[rule],
			{ logger },
		);
		// Delivery failed, but the breach is visible.
		expect((await store.getRule(rule.id, project.id))?.currentState).toBe(
			"firing",
		);
		expect((await store.listRules(project.id))[0]?.currentState).toBe("firing");
	});
});
