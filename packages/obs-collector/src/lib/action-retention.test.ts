/**
 * Action graph retention against real SQLite (`node:sqlite`) with the shipped
 * `migrations/`. Postgres coverage for the same module lives in
 * `sql-db-postgres.integration.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
	actionRetentionCutoff,
	purgeExpiredActionGraph,
} from "./action-retention";
import { ActionStore } from "./actions-store";
import {
	actionRecord,
	agentRunRecord,
	countActionGraph,
	EXPIRED_START,
	FIXTURE_NOW_MS,
	FIXTURE_RETENTION_HOURS,
	FRESH_START,
	hoursAgo,
	seedEvalCase,
	seedTree,
	toolCallRecord,
} from "./test-utils/action-graph-fixtures";
import {
	listSqliteMigrations,
	NodeSqliteDb,
} from "./test-utils/node-sqlite-db";

const now = () => FIXTURE_NOW_MS;
const purge = (
	db: NodeSqliteDb,
	over: { batchSize?: number; maxBatches?: number } = {},
) =>
	purgeExpiredActionGraph(db, {
		retentionHours: FIXTURE_RETENTION_HOURS,
		now,
		...over,
	});

const EMPTY = {
	actions: 0,
	agent_runs: 0,
	tool_calls: 0,
	retrieval_events: 0,
	eval_results: 0,
	artifacts: 0,
};

const indexNames = (db: NodeSqliteDb): string[] =>
	(
		db.raw
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'actions'`,
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);

describe("actionRetentionCutoff", () => {
	it("renders the cutoff as collector-style ISO text", () => {
		expect(actionRetentionCutoff(72, FIXTURE_NOW_MS)).toBe(hoursAgo(72));
		expect(actionRetentionCutoff(1, FIXTURE_NOW_MS)).toMatch(
			/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		);
	});
});

describe("purgeExpiredActionGraph (SQLite)", () => {
	it("fresh schema ships the started_at index", () => {
		const db = NodeSqliteDb.migrated();
		expect(indexNames(db)).toContain("idx_actions_started_at");
	});

	it("upgrade: 044 adds the index to a database migrated through 043 and the purge then works", async () => {
		const db = NodeSqliteDb.migrated(
			"043_metric_exemplars_text_timestamps.sql",
		);
		expect(indexNames(db)).not.toContain("idx_actions_started_at");
		await seedTree(db, { rootId: "old" });

		db.applyMigrations(
			listSqliteMigrations().filter((f) => f.startsWith("044_")),
		);
		expect(indexNames(db)).toContain("idx_actions_started_at");

		const summary = await purge(db);
		expect(summary.actions).toBe(2);
		expect(await countActionGraph(db, "alpha")).toEqual(EMPTY);
	});

	it("deletes expired trees with their leaves and keeps fresh trees, per project", async () => {
		const db = NodeSqliteDb.migrated();
		const expired = await seedTree(db, { rootId: "alpha-old" });
		const fresh = await seedTree(db, {
			rootId: "alpha-new",
			rootStartedAt: FRESH_START,
		});
		// `actions.id` is a global primary key, so ids never collide across
		// projects; beta gets its own fresh and expired trees instead.
		const otherFresh = await seedTree(db, {
			projectId: "beta",
			rootId: "beta-new",
			rootStartedAt: FRESH_START,
		});
		await seedTree(db, { projectId: "beta", rootId: "beta-old" });

		const summary = await purge(db);

		expect(summary).toEqual({
			actions: 4,
			agent_runs: 2,
			tool_calls: 2,
			retrieval_events: 2,
			eval_results: 2,
			artifacts: 2,
			batches: 1,
			truncated: false,
		});
		expect(db.count("actions", "root_action_id = ?", expired.rootId)).toBe(0);
		expect(db.count("agent_runs", "id = ?", expired.rootId)).toBe(0);
		expect(db.count("tool_calls", "id = ?", expired.toolCallId)).toBe(0);
		expect(
			db.count("retrieval_events", "id = ?", expired.retrievalEventId),
		).toBe(0);
		expect(db.count("eval_results", "id = ?", expired.evalResultId)).toBe(0);
		expect(db.count("artifacts", "id = ?", expired.artifactId)).toBe(0);
		expect(db.count("actions", "root_action_id = ?", "beta-old")).toBe(0);

		expect(db.count("actions", "root_action_id = ?", fresh.rootId)).toBe(2);
		expect(db.count("tool_calls", "id = ?", fresh.toolCallId)).toBe(1);
		expect(await countActionGraph(db, "beta")).toEqual({
			actions: 2,
			agent_runs: 1,
			tool_calls: 1,
			retrieval_events: 1,
			eval_results: 1,
			artifacts: 1,
		});
		expect(db.count("tool_calls", "id = ?", otherFresh.toolCallId)).toBe(1);
	});

	it("scopes every DELETE by project even though action ids are globally unique", async () => {
		const db = NodeSqliteDb.migrated();
		await seedTree(db, { rootId: "alpha-old" });
		// A beta leaf row that (incorrectly) points at an alpha action id must
		// not be swept up with alpha's tree.
		await new ActionStore(db).upsertToolCall(
			toolCallRecord({
				id: "beta-stray",
				actionId: "alpha-old-child",
				projectId: "beta",
			}),
		);

		const summary = await purge(db);

		expect(summary.actions).toBe(2);
		expect(summary.tool_calls).toBe(1);
		expect(db.count("tool_calls", "id = ?", "beta-stray")).toBe(1);
	});

	it("keeps a whole tree while any action in it is fresh or still in progress", async () => {
		const db = NodeSqliteDb.migrated();
		// Expired root, fresh child → the root must survive too.
		await seedTree(db, { rootId: "straddles", childStartedAt: FRESH_START });
		// Expired root, expired child that never ended.
		await seedTree(db, { rootId: "hung", childEndedAt: null });
		// Fully expired control tree.
		await seedTree(db, { rootId: "done" });

		const summary = await purge(db);

		expect(summary.actions).toBe(2);
		expect(db.count("actions", "root_action_id = ?", "straddles")).toBe(2);
		expect(db.count("actions", "root_action_id = ?", "hung")).toBe(2);
		expect(db.count("tool_calls", "action_id = ?", "hung-child")).toBe(1);
		expect(db.count("actions", "root_action_id = ?", "done")).toBe(0);
	});

	it("keeps trees whose agent run is still marked running", async () => {
		const db = NodeSqliteDb.migrated();
		await seedTree(db, { rootId: "running", agentRunStatus: "running" });
		await seedTree(db, { rootId: "finished" });

		const summary = await purge(db);

		expect(summary.actions).toBe(2);
		expect(db.count("actions", "root_action_id = ?", "running")).toBe(2);
		expect(db.count("agent_runs", "id = ?", "running")).toBe(1);
		expect(db.count("actions", "root_action_id = ?", "finished")).toBe(0);
	});

	it("keeps trees referenced by eval cases through action, agent run or tool call ids", async () => {
		const db = NodeSqliteDb.migrated();
		const byAction = await seedTree(db, { rootId: "pin-action" });
		const byRun = await seedTree(db, { rootId: "pin-run" });
		const byTool = await seedTree(db, { rootId: "pin-tool" });
		await seedTree(db, { rootId: "unpinned" });
		await seedTree(db, { rootId: "cross" });

		await seedEvalCase(db, { id: "c1", sourceActionId: byAction.childId });
		await seedEvalCase(db, { id: "c2", sourceAgentRunId: byRun.rootId });
		await seedEvalCase(db, { id: "c3", sourceToolCallId: byTool.toolCallId });
		// An eval case in another project naming an alpha action id does not
		// pin alpha's tree: references are matched within the project.
		await seedEvalCase(db, {
			id: "c4",
			projectId: "beta",
			sourceActionId: "cross-child",
		});

		const summary = await purge(db);

		expect(summary.actions).toBe(4);
		for (const root of ["pin-action", "pin-run", "pin-tool"]) {
			expect(db.count("actions", "root_action_id = ?", root)).toBe(2);
			expect(db.count("agent_runs", "id = ?", root)).toBe(1);
		}
		expect(db.count("tool_calls", "id = ?", byTool.toolCallId)).toBe(1);
		expect(db.count("actions", "root_action_id = ?", "unpinned")).toBe(0);
		expect(db.count("actions", "root_action_id = ?", "cross")).toBe(0);
		expect(db.count("eval_cases")).toBe(4);
	});

	it("is idempotent: a second sweep finds nothing and changes nothing", async () => {
		const db = NodeSqliteDb.migrated();
		await seedTree(db, { rootId: "run-1" });
		await seedTree(db, { rootId: "run-2", rootStartedAt: FRESH_START });

		const first = await purge(db);
		const second = await purge(db);

		expect(first.actions).toBe(2);
		expect(second).toEqual({ ...EMPTY, batches: 0, truncated: false });
		expect(await countActionGraph(db, "alpha")).toEqual({
			actions: 2,
			agent_runs: 1,
			tool_calls: 1,
			retrieval_events: 1,
			eval_results: 1,
			artifacts: 1,
		});
	});

	it("works in bounded batches and reports when the cap leaves candidates behind", async () => {
		const db = NodeSqliteDb.migrated();
		for (let i = 0; i < 5; i += 1) {
			await seedTree(db, { rootId: `run-${i}`, withLeaves: false });
		}
		expect(db.count("actions")).toBe(10);

		const capped = await purge(db, { batchSize: 4, maxBatches: 1 });
		expect(capped).toMatchObject({ actions: 4, batches: 1, truncated: true });
		expect(db.count("actions")).toBe(6);
		// agent_runs rows go only once their root action is in the batch.
		expect(db.count("agent_runs")).toBe(5 - capped.agent_runs);

		const rest = await purge(db, { batchSize: 4 });
		expect(rest).toMatchObject({ actions: 6, batches: 2, truncated: false });
		expect(db.count("actions")).toBe(0);
		expect(db.count("agent_runs")).toBe(0);
	});

	it("chunks id lists so a batch larger than D1's bind limit still deletes everything", async () => {
		const db = NodeSqliteDb.migrated();
		const store = new ActionStore(db);
		for (let i = 0; i < 120; i += 1) {
			await store.upsertAction(actionRecord({ id: `single-${i}` }));
		}

		const summary = await purge(db, { batchSize: 200 });

		expect(summary).toMatchObject({
			actions: 120,
			batches: 1,
			truncated: false,
		});
		expect(db.count("actions")).toBe(0);
	});

	it("leaves agent_runs rows that have no action and leaves other actions' leaves alone", async () => {
		const db = NodeSqliteDb.migrated();
		const store = new ActionStore(db);
		await store.upsertAgentRun(agentRunRecord({ id: "orphan-run" }));
		const expired = await seedTree(db, { rootId: "run-1" });
		const fresh = await seedTree(db, {
			rootId: "run-2",
			rootStartedAt: FRESH_START,
		});

		await purge(db);

		expect(db.count("agent_runs", "id = ?", "orphan-run")).toBe(1);
		expect(db.count("artifacts", "id = ?", expired.artifactId)).toBe(0);
		expect(db.count("artifacts", "id = ?", fresh.artifactId)).toBe(1);
		expect(db.count("tool_calls", "id = ?", fresh.toolCallId)).toBe(1);
	});

	it("treats started_at exactly at the cutoff as not expired", async () => {
		const db = NodeSqliteDb.migrated();
		const store = new ActionStore(db);
		const cutoff = actionRetentionCutoff(
			FIXTURE_RETENTION_HOURS,
			FIXTURE_NOW_MS,
		);
		await store.upsertAction(
			actionRecord({ id: "at-cutoff", startedAt: cutoff, endedAt: cutoff }),
		);
		await store.upsertAction(
			actionRecord({ id: "just-before", startedAt: EXPIRED_START }),
		);

		const summary = await purge(db);

		expect(summary.actions).toBe(1);
		expect(db.count("actions", "id = ?", "at-cutoff")).toBe(1);
	});
});
