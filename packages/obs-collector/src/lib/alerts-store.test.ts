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
