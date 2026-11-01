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
		/** Report `value` at `offsetSecs` after T0, then evaluate there. */
		const tick = async (offsetSecs: number, value: number) => {
			const atMs = T0 + offsetSecs * 1000;
			vi.setSystemTime(atMs);
			await metrics.ingestBatch({
				projectId: project.id,
				points: [gauge(atMs, value)],
				receivedAt: new Date(atMs).toISOString(),
				expiresAt: new Date(atMs + 86_400_000).toISOString(),
			});
			const result = await evaluateRuleBatch(store, [rule], { logger });
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
		rule.pendingSecs = 0;
		const r = await tick(0, 0);
		expect(r.result.fired).toBe(1);
		expect(r.state?.pending_since ?? null).toBeNull();
		db.close();
	});
});
