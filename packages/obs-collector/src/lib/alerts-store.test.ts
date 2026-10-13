/**
 * Project scoping for alert rule deletion and webhook target validation,
 * executed against the real migrated SQLite schema.
 */

import type { AlertRuleInput } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import { AlertsStore } from "./alerts-store";
import { ProjectsStore } from "./projects-store";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const input = (over: Partial<AlertRuleInput> = {}): AlertRuleInput => ({
	name: "errors",
	signal: "spans",
	query: {},
	threshold: 1,
	windowMins: 5,
	comparison: ">",
	channels: [{ type: "webhook", url: "https://hooks.example.com/alert/abc" }],
	enabled: true,
	...over,
});

describe("AlertsStore.deleteRule", () => {
	it("deletes state and evaluations only for a rule the project owns", async () => {
		const db = createMigratedSqliteDb();
		// alert_rules.project_id references projects(id) (migration 012).
		const projects = new ProjectsStore(db);
		const alphaProject = await projects.createProject({ name: "A", slug: "a" });
		const betaProject = await projects.createProject({ name: "B", slug: "b" });
		const store = new AlertsStore(db);
		const alpha = await store.createRule(
			alphaProject.id,
			input({ name: "alpha" }),
		);
		const beta = await store.createRule(
			betaProject.id,
			input({ name: "beta" }),
		);
		for (const rule of [alpha, beta]) {
			await store.transitionState(rule.id, rule.projectId, "firing", "t0");
			await store.recordEvaluation(rule.id, rule.projectId, 5, "firing", true);
		}
		const count = async (table: string, ruleId: string) =>
			(
				await db
					.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE rule_id = ?`)
					.bind(ruleId)
					.first<{ n: number }>()
			)?.n;

		// Wrong project: nothing is deleted, not even the child rows.
		expect(await store.deleteRule(beta.id, alphaProject.id)).toBe(false);
		expect(await store.getRule(beta.id, betaProject.id)).not.toBeNull();
		expect(await count("alert_state", beta.id)).toBe(1);
		expect(await count("alert_evaluations", beta.id)).toBe(1);

		// Right project: the rule and its children go, beta's stay.
		expect(await store.deleteRule(alpha.id, alphaProject.id)).toBe(true);
		expect(await store.getRule(alpha.id, alphaProject.id)).toBeNull();
		expect(await count("alert_state", alpha.id)).toBe(0);
		expect(await count("alert_evaluations", alpha.id)).toBe(0);
		expect(await count("alert_state", beta.id)).toBe(1);
		expect(await count("alert_evaluations", beta.id)).toBe(1);
		db.close();
	});
});

describe("AlertsStore.validateInput webhook targets", () => {
	const store = new AlertsStore(createMigratedSqliteDb());

	it("accepts public https hooks and rejects internal or credentialed ones", () => {
		expect(() => store.validateInput(input())).not.toThrow();
		for (const url of [
			"http://127.0.0.1:8080/hook",
			"http://169.254.169.254/latest/meta-data/",
			"http://localhost/hook",
			"https://user:pw@hooks.example.com/alert",
			"ftp://hooks.example.com/alert",
		]) {
			expect(
				() =>
					store.validateInput(input({ channels: [{ type: "webhook", url }] })),
				url,
			).toThrow(/channel\.url/);
		}
	});

	it("permits private receivers when the store is told to", () => {
		const permissive = new AlertsStore(createMigratedSqliteDb(), {
			allowPrivateWebhookTargets: true,
		});
		const internal = input({
			channels: [{ type: "webhook", url: "http://10.0.0.5:9093/hook" }],
		});
		expect(() => permissive.validateInput(internal)).not.toThrow();
		expect(() => store.validateInput(internal)).toThrow(/not a public/);
	});
});

describe("AlertsStore alert_state.notified (migration 049)", () => {
	it("records a transition as undelivered, marks exactly that transition delivered, and scopes by project", async () => {
		const db = createMigratedSqliteDb();
		const projects = new ProjectsStore(db);
		const alpha = await projects.createProject({ name: "A", slug: "a" });
		const beta = await projects.createProject({ name: "B", slug: "b" });
		const store = new AlertsStore(db);
		const rule = await store.createRule(alpha.id, input());

		const t1 = "2026-05-31T00:00:00.000Z";
		await store.transitionState(rule.id, alpha.id, "firing", t1);
		expect(await store.getState(rule.id, alpha.id)).toMatchObject({
			current_state: "firing",
			last_state_change: t1,
			notified: 0,
		});
		// Another project cannot read or acknowledge this rule's state.
		expect(await store.getState(rule.id, beta.id)).toBeNull();
		expect(await store.markNotified(rule.id, beta.id, "firing", t1)).toBe(
			false,
		);

		// A stale acknowledgement (different state or timestamp) is ignored.
		expect(await store.markNotified(rule.id, alpha.id, "ok", t1)).toBe(false);
		expect(
			await store.markNotified(
				rule.id,
				alpha.id,
				"firing",
				"2026-01-01T00:00:00.000Z",
			),
		).toBe(false);
		expect((await store.getState(rule.id, alpha.id))?.notified).toBe(0);

		expect(await store.markNotified(rule.id, alpha.id, "firing", t1)).toBe(
			true,
		);
		expect((await store.getState(rule.id, alpha.id))?.notified).toBe(1);
		// Idempotent: already delivered → no row changed.
		expect(await store.markNotified(rule.id, alpha.id, "firing", t1)).toBe(
			false,
		);

		// The next transition starts a fresh outstanding notification.
		const t2 = "2026-05-31T01:00:00.000Z";
		await store.transitionState(rule.id, alpha.id, "ok", t2);
		expect(await store.getState(rule.id, alpha.id)).toMatchObject({
			current_state: "ok",
			last_state_change: t2,
			notified: 0,
		});
	});
});
