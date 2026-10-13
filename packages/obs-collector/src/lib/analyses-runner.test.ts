/**
 * `runAllDueAnalyses` used to hard-code project `default`, so analyses for
 * every other project never refreshed and alert rules bound to them always
 * evaluated against nothing. These tests run the orchestrator against the
 * real migrated schema and against a database whose projects table fails.
 */

import { describe, expect, it } from "vitest";
import type { CollectorEnv } from "../framework/env";
import { runAllDueAnalyses } from "./analyses-runner";
import { ProjectsStore } from "./projects-store";
import { MemSqlDb } from "./test-utils/mem-sql-db";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe("runAllDueAnalyses", () => {
	it("refreshes and runs analyses for every project, not just default", async () => {
		const db = createMigratedSqliteDb();
		const beta = await new ProjectsStore(db).createProject({
			name: "Beta",
			slug: "beta",
		});

		const summary = await runAllDueAnalyses({
			env: { DB: db } as unknown as CollectorEnv,
			retentionHours: 24,
			logger: silent,
		});

		expect(summary.failed).toBe(0);
		expect(summary.ran).toBeGreaterThan(0);
		const projects = await db
			.prepare(
				`SELECT DISTINCT project_id FROM analysis_results ORDER BY project_id`,
			)
			.all<{ project_id: string }>();
		const ids = projects.results.map((r) => r.project_id);
		// 011 seeds `default`, 026 seeds `obs-dashboard`.
		expect(ids).toEqual(
			expect.arrayContaining(["default", "obs-dashboard", beta.id]),
		);

		const perProject = await db
			.prepare(
				`SELECT project_id, COUNT(*) AS n FROM analysis_results GROUP BY project_id`,
			)
			.all<{ project_id: string; n: number }>();
		const counts = new Map(perProject.results.map((r) => [r.project_id, r.n]));
		expect(counts.get(beta.id)).toBe(counts.get("default"));
		db.close();
	});

	it("falls back to the default project when projects cannot be listed", async () => {
		const db = new MemSqlDb({
			all: (sql) => {
				if (sql.includes("FROM projects")) throw new Error("no projects table");
				return [];
			},
			first: () => null,
		});

		const summary = await runAllDueAnalyses({
			env: { DB: db } as unknown as CollectorEnv,
			retentionHours: 24,
			logger: silent,
		});

		expect(summary).toMatchObject({ ran: 0, failed: 0 });
		expect(summary.refreshed).toBeGreaterThan(0);
		const due = db.callsMatching("FROM analysis_definitions");
		expect(due.length).toBeGreaterThan(0);
		expect(due.every((c) => c.binds[0] === "default")).toBe(true);
	});
});
