/**
 * Migration 049 — `alert_state.notified`, applied to the real SQLite/D1
 * schema, plus the store's behaviour on a database that has not applied it.
 */

import { describe, expect, it } from "vitest";
import { AlertsStore } from "../lib/alerts-store";
import { ProjectsStore } from "../lib/projects-store";
import {
	applySqliteMigrations,
	createMigratedSqliteDb,
} from "../lib/test-utils/node-sqlite-db";

const ruleInput = {
	name: "errors",
	signal: "spans" as const,
	query: {},
	threshold: 1,
	windowMins: 5,
	comparison: ">" as const,
	channels: [{ type: "webhook" as const, url: "https://hooks.example.com/a" }],
	enabled: true,
};

describe("migration 049 (alert_state.notified)", () => {
	it("adds the column and backfills existing state rows as delivered", async () => {
		const db = createMigratedSqliteDb({ upTo: "048" });
		const project = await new ProjectsStore(db).createProject({
			name: "A",
			slug: "a",
		});
		const store = new AlertsStore(db);
		const rule = await store.createRule(project.id, ruleInput);
		// The pre-049 evaluator only wrote a transition after delivery.
		db.raw
			.prepare(
				`INSERT INTO alert_state (rule_id, project_id, current_state, last_state_change)
				 VALUES (?, ?, 'firing', '2026-05-31T00:00:00.000Z')`,
			)
			.run(rule.id, project.id);
		const columnsBefore = db.raw
			.prepare("PRAGMA table_info(alert_state)")
			.all()
			.map((c) => (c as { name: string }).name);
		expect(columnsBefore).not.toContain("notified");

		expect(
			applySqliteMigrations(db.raw, { from: "049", upTo: "049" }),
		).toEqual(["049_alert_state_notified.sql"]);

		const notified = db.raw
			.prepare("PRAGMA table_info(alert_state)")
			.all()
			.find((c) => (c as { name: string }).name === "notified") as {
			type: string;
			notnull: number;
			dflt_value: string;
		};
		expect(notified).toMatchObject({
			type: "INTEGER",
			notnull: 1,
			dflt_value: "1",
		});
		expect(await store.getState(rule.id, project.id)).toMatchObject({
			current_state: "firing",
			notified: 1,
		});
		// Other state is untouched and the new write path works afterwards.
		await store.transitionState(
			rule.id,
			project.id,
			"ok",
			"2026-05-31T01:00:00.000Z",
		);
		expect((await store.getState(rule.id, project.id))?.notified).toBe(0);
	});

	it("keeps transitions working on a database that has not applied 049 yet", async () => {
		const db = createMigratedSqliteDb({ upTo: "048" });
		const project = await new ProjectsStore(db).createProject({
			name: "A",
			slug: "a",
		});
		const store = new AlertsStore(db);
		const rule = await store.createRule(project.id, ruleInput);
		const t1 = "2026-05-31T00:00:00.000Z";

		// Falls back to the legacy statement instead of failing the tick.
		await store.transitionState(rule.id, project.id, "firing", t1);
		const row = await store.getState(rule.id, project.id);
		expect(row).toMatchObject({
			current_state: "firing",
			last_state_change: t1,
		});
		expect(row?.notified).toBeUndefined();
		// Nothing to acknowledge; the evaluator treats the row as delivered.
		expect(await store.markNotified(rule.id, project.id, "firing", t1)).toBe(
			false,
		);
		// Upserting over the existing row also works.
		await store.transitionState(
			rule.id,
			project.id,
			"ok",
			"2026-05-31T01:00:00.000Z",
		);
		expect((await store.getState(rule.id, project.id))?.current_state).toBe(
			"ok",
		);
	});
});
