/**
 * Pending duration (`pendingSecs`, Prometheus `for`) end to end: the real
 * evaluator over the real `AlertsStore` on the migrated SQLite schema, with
 * a `metrics` rule whose points come through `MetricsStore.ingestBatch`.
 * Only `Date` is faked so each tick runs at a chosen time.
 */

import type { AlertRule } from "@obsunified/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertsStore } from "../lib/alerts-store";
import { MetricsStore } from "../lib/metrics-store";
import { ProjectsStore } from "../lib/projects-store";
import { createMigratedSqliteDb } from "../lib/test-utils/node-sqlite-db";
import type { DecodedMetricPoint } from "../otlp/decode";
import { evaluateRuleBatch } from "./alerts-evaluator";

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const T0 = Date.parse("2026-10-31T12:00:00.000Z");

const gauge = (atMs: number, value: number): DecodedMetricPoint => ({
	name: "pg_up",
	description: null,
	unit: null,
	type: "gauge",
	isMonotonic: null,
	temporality: null,
	scopeName: "test",
	scopeVersion: null,
	serviceName: "vbox",
	resourceAttrsJson: JSON.stringify({ "service.name": "vbox" }),
	attributesJson: null,
	identity: "pg_up|vbox",
	tsNs: (BigInt(atMs) * 1_000_000n).toString(),
	startTsNs: null,
	value,
	count: null,
	sum: null,
	min: null,
	max: null,
	boundsJson: null,
	bucketCountsJson: null,
	extraJson: null,
	exemplarsJson: null,
});

describe("pendingSecs", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(T0 - 60_000);
	});
	afterEach(() => vi.useRealTimers());

	const setup = async () => {
		const db = createMigratedSqliteDb();
		const project = await new ProjectsStore(db).createProject({
			name: "P",
			slug: "p",
		});
		const store = new AlertsStore(db);
		const created = await store.createRule(project.id, {
			name: "pg down for 30s",
			signal: "metrics",
			query: { metric: "pg_up", aggregation: "last" },
			threshold: 0,
			comparison: "==",
			windowMins: 1,
			pendingSecs: 30,
			channels: [{ type: "webhook", url: "https://hooks.example.com/x" }],
		});
		// No channel: delivery trivially succeeds, no network.
		const rule: AlertRule = { ...created, channels: [] };
		const metrics = new MetricsStore(db);
		/**
		 * Report `value` (null: report nothing) at `offsetSecs` after T0, then
		 * evaluate there.
		 */
		const tick = async (
			offsetSecs: number,
			value: number | null,
			options: Parameters<typeof evaluateRuleBatch>[2] = {},
			ruleOverride?: AlertRule,
		) => {
			const atMs = T0 + offsetSecs * 1000;
			vi.setSystemTime(atMs);
			if (value !== null) {
				await metrics.ingestBatch({
					projectId: project.id,
					points: [gauge(atMs, value)],
					receivedAt: new Date(atMs).toISOString(),
					expiresAt: new Date(atMs + 86_400_000).toISOString(),
				});
			}
			const evaluated = ruleOverride ?? {
				...((await store.getRule(rule.id, project.id)) as AlertRule),
				channels: [],
			};
			const result = await evaluateRuleBatch(store, [evaluated], {
				logger,
				...options,
			});
			const state = await store.getState(rule.id, project.id);
			return { result, state };
		};
		return { db, store, rule, project, tick };
	};

	it("fires only after the condition held for pendingSecs, and resolves immediately", async () => {
		const { db, store, rule, project, tick } = await setup();

		let r = await tick(0, 0);
		expect(r.result.fired).toBe(0);
		expect(r.state).toMatchObject({
			current_state: "ok",
			pending_since: new Date(T0).toISOString(),
			notified: 1,
		});
		expect((await store.getRule(rule.id, project.id))?.pendingSince).toBe(
			new Date(T0).toISOString(),
		);

		r = await tick(20, 0);
		expect(r.result.fired).toBe(0);
		expect(r.state?.current_state).toBe("ok");

		r = await tick(31, 0);
		expect(r.result.fired).toBe(1);
		expect(r.state).toMatchObject({
			current_state: "firing",
			pending_since: null,
		});

		r = await tick(40, 1);
		expect(r.result.resolved).toBe(1);
		expect(r.state).toMatchObject({ current_state: "ok", pending_since: null });

		const evaluations = await store.listEvaluations({
			ruleId: rule.id,
			projectId: project.id,
			hours: 24,
		});
		expect(evaluations.evaluations.map((e) => e.state).reverse()).toEqual([
			"ok",
			"ok",
			"firing",
			"ok",
		]);
		db.close();
	});

	it("restarts the pending period when one evaluation does not match", async () => {
		const { db, tick } = await setup();
		await tick(0, 0);
		let r = await tick(20, 1);
		expect(r.state).toMatchObject({ current_state: "ok", pending_since: null });
		r = await tick(35, 0);
		expect(r.state?.pending_since).toBe(new Date(T0 + 35_000).toISOString());
		r = await tick(60, 0);
		expect(r.result.fired).toBe(0);
		r = await tick(66, 0);
		expect(r.result.fired).toBe(1);
		db.close();
	});

	it("fires on the first matching evaluation without pendingSecs", async () => {
		const { db, store, rule, project, tick } = await setup();
		await store.updateRule(rule.id, project.id, { pendingSecs: 0 });
		const r = await tick(0, 0);
		expect(r.result.fired).toBe(1);
		expect(r.state?.pending_since ?? null).toBeNull();
		db.close();
	});

	it("starts the hold over after the rule is edited or disabled", async () => {
		const { db, store, rule, project, tick } = await setup();
		await tick(0, 0);
		await tick(20, 0);
		// Editing the threshold discards the 20 s already held.
		await store.updateRule(rule.id, project.id, { threshold: 0 });
		expect((await store.getState(rule.id, project.id))?.pending_since).toBe(
			new Date(T0).toISOString(),
		);
		await store.updateRule(rule.id, project.id, { comparison: "<=" });
		expect(
			(await store.getState(rule.id, project.id))?.pending_since ?? null,
		).toBeNull();
		let r = await tick(31, 0);
		expect(r.result.fired).toBe(0);
		expect(r.state?.pending_since).toBe(new Date(T0 + 31_000).toISOString());
		// Disable + re-enable also starts over.
		await store.updateRule(rule.id, project.id, { enabled: false });
		await store.updateRule(rule.id, project.id, { enabled: true });
		r = await tick(62, 0);
		expect(r.result.fired).toBe(0);
		r = await tick(93, 0);
		expect(r.result.fired).toBe(1);
		// A rename alone keeps the state.
		await store.updateRule(rule.id, project.id, { name: "renamed" });
		expect((await store.getState(rule.id, project.id))?.current_state).toBe(
			"firing",
		);
		db.close();
	});

	it("starts the hold over after a gap longer than maxEvaluationGapMs or a restart", async () => {
		const { db, tick } = await setup();
		const gap = { maxEvaluationGapMs: 20_000 };
		await tick(0, 0, gap);
		await tick(15, 0, gap);
		// 25 s without an evaluation: the hold does not survive it.
		let r = await tick(40, 0, gap);
		expect(r.result.fired).toBe(0);
		expect(r.state?.pending_since).toBe(new Date(T0 + 40_000).toISOString());
		r = await tick(55, 0, gap);
		expect(r.result.fired).toBe(0);
		// A collector process that started after the hold was last seen.
		const restarted = {
			...gap,
			holdStartedAt: new Date(T0 + 60_000).toISOString(),
		};
		r = await tick(71, 0, restarted);
		expect(r.result.fired).toBe(0);
		expect(r.state?.pending_since).toBe(new Date(T0 + 71_000).toISOString());
		r = await tick(86, 0, restarted);
		expect(r.result.fired).toBe(0);
		r = await tick(101, 0, restarted);
		expect(r.result.fired).toBe(1);
		db.close();
	});

	it('noData "keep" leaves a firing rule firing when the source vanishes', async () => {
		const { db, store, rule, project, tick } = await setup();
		await store.updateRule(rule.id, project.id, {
			pendingSecs: 0,
			comparison: ">",
			threshold: 5,
			query: {
				metric: "pg_up",
				aggregation: "last",
				noData: "keep",
				staleSecs: 30,
			},
		});
		let r = await tick(0, 9);
		expect(r.result.fired).toBe(1);
		// The source stops; after 30 s its series is stale: no data.
		r = await tick(45, null);
		expect(r.result).toMatchObject({ fired: 0, resolved: 0 });
		expect(r.state?.current_state).toBe("firing");
		r = await tick(90, null);
		expect(r.state?.current_state).toBe("firing");
		// Data again, below the threshold: resolves.
		r = await tick(120, 1);
		expect(r.result.resolved).toBe(1);
		const history = (
			await store.listEvaluations({
				ruleId: rule.id,
				projectId: project.id,
				hours: 24,
			})
		).evaluations
			.reverse()
			.map((e) => [e.state, e.outcome]);
		expect(history).toEqual([
			["firing", "value"],
			["firing", "no_data"],
			["firing", "no_data"],
			["ok", "value"],
		]);
		db.close();
	});

	it('noData "zero" (default) resolves when the source vanishes', async () => {
		const { db, store, rule, project, tick } = await setup();
		await store.updateRule(rule.id, project.id, {
			pendingSecs: 0,
			comparison: ">",
			threshold: 5,
			query: { metric: "pg_up", aggregation: "last", staleSecs: 30 },
		});
		expect((await tick(0, 9)).result.fired).toBe(1);
		expect((await tick(45, null)).result.resolved).toBe(1);
		db.close();
	});

	it("records an error evaluation and keeps the state when evaluation fails", async () => {
		const { db, store, rule, project, tick } = await setup();
		await store.updateRule(rule.id, project.id, { pendingSecs: 0 });
		expect((await tick(0, 0)).result.fired).toBe(1);
		const broken: AlertRule = {
			...((await store.getRule(rule.id, project.id)) as AlertRule),
			channels: [],
			// Unknown signal: evaluation throws.
			signal: "bogus" as never,
		};
		const r = await tick(10, 1, {}, broken);
		expect(r.result).toMatchObject({ fired: 0, resolved: 0 });
		expect(r.state?.current_state).toBe("firing");
		const latest = (
			await store.listEvaluations({
				ruleId: rule.id,
				projectId: project.id,
				hours: 24,
			})
		).evaluations[0];
		expect(latest).toMatchObject({ outcome: "error", state: "firing" });
		db.close();
	});
});
