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
import type { SqlDb, SqlStatement } from "./sql-db";
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

type PurgeOverrides = {
	maxActionsPerBatch?: number;
	maxTreesPerBatch?: number;
	maxBatches?: number;
};

const now = () => FIXTURE_NOW_MS;
const purge = (db: SqlDb, over: PurgeOverrides = {}) =>
	purgeExpiredActionGraph(db, {
		retentionHours: FIXTURE_RETENTION_HOURS,
		now,
		...over,
	});

const EMPTY_COUNTS = {
	actions: 0,
	agent_runs: 0,
	tool_calls: 0,
	retrieval_events: 0,
	eval_results: 0,
	artifacts: 0,
};

const NOTHING_PURGED = {
	...EMPTY_COUNTS,
	trees: 0,
	batches: 0,
	truncated: false,
	oversized_trees: 0,
	oversized: [],
};

const indexNames = (db: NodeSqliteDb): string[] =>
	(
		db.raw
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'actions'`,
			)
			.all() as Array<{ name: string }>
	).map((r) => r.name);

/** Root + `children` child actions, one `agent_runs` row, leaves on the first child. */
const seedWideTree = async (
	db: SqlDb,
	rootId: string,
	children: number,
	projectId = "alpha",
) => {
	const store = new ActionStore(db);
	await store.upsertAction(
		actionRecord({
			id: rootId,
			projectId,
			rootActionId: rootId,
			agentRunId: rootId,
		}),
	);
	await store.upsertAgentRun(agentRunRecord({ id: rootId, projectId }));
	for (let i = 0; i < children; i += 1) {
		await store.upsertAction(
			actionRecord({
				id: `${rootId}-c${i}`,
				projectId,
				rootActionId: rootId,
				causedByActionId: rootId,
				agentRunId: rootId,
				actionKind: "tool.call",
			}),
		);
	}
	await store.upsertToolCall(
		toolCallRecord({ id: `${rootId}-tc`, actionId: `${rootId}-c0`, projectId }),
	);
	return { rootId, actions: children + 1, toolCallId: `${rootId}-tc` };
};

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
		expect(summary.trees).toBe(1);
		expect(await countActionGraph(db, "alpha")).toEqual(EMPTY_COUNTS);
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
			trees: 2,
			batches: 1,
			truncated: false,
			oversized_trees: 0,
			oversized: [],
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
		expect(second).toEqual(NOTHING_PURGED);
		expect(await countActionGraph(db, "alpha")).toEqual({
			actions: 2,
			agent_runs: 1,
			tool_calls: 1,
			retrieval_events: 1,
			eval_results: 1,
			artifacts: 1,
		});
	});

	it("never splits a tree: one eligible tree larger than the batch cap is retained intact and reported", async () => {
		const db = NodeSqliteDb.migrated();
		const big = await seedWideTree(db, "big", 6); // 7 actions
		const small = await seedTree(db, { rootId: "small" }); // 2 actions

		const summary = await purge(db, { maxActionsPerBatch: 4, maxBatches: 1 });

		// The small tree goes whole; the big one is untouched, not trimmed.
		expect(summary).toMatchObject({
			actions: 2,
			trees: 1,
			batches: 1,
			truncated: false,
			oversized_trees: 1,
			oversized: [{ project_id: "alpha", root_action_id: "big", actions: 7 }],
		});
		expect(db.count("actions", "root_action_id = ?", big.rootId)).toBe(
			big.actions,
		);
		expect(db.count("agent_runs", "id = ?", big.rootId)).toBe(1);
		expect(db.count("tool_calls", "id = ?", big.toolCallId)).toBe(1);
		expect(db.count("actions", "root_action_id = ?", small.rootId)).toBe(0);

		// Running again with the same cap changes nothing; raising the cap
		// deletes the big tree in one piece.
		expect(await purge(db, { maxActionsPerBatch: 4 })).toMatchObject({
			actions: 0,
			oversized_trees: 1,
		});
		const raised = await purge(db, { maxActionsPerBatch: 7 });
		expect(raised).toMatchObject({
			actions: 7,
			trees: 1,
			agent_runs: 1,
			tool_calls: 1,
			oversized_trees: 0,
		});
		expect(await countActionGraph(db, "alpha")).toEqual(EMPTY_COUNTS);
	});

	it("packs whole trees into a batch up to the action cap and leaves the rest for later batches", async () => {
		const db = NodeSqliteDb.migrated();
		for (let i = 0; i < 5; i += 1) {
			await seedTree(db, { rootId: `run-${i}`, withLeaves: false });
		}
		expect(db.count("actions")).toBe(10);

		// 5 actions fit two 2-action trees, not two and a half.
		const capped = await purge(db, { maxActionsPerBatch: 5, maxBatches: 1 });
		expect(capped).toMatchObject({
			actions: 4,
			trees: 2,
			agent_runs: 2,
			batches: 1,
			truncated: true,
		});
		expect(db.count("actions")).toBe(6);
		expect(db.count("agent_runs")).toBe(3);
		// Every surviving tree is still complete.
		const survivors = db.raw
			.prepare(
				`SELECT root_action_id AS root, COUNT(*) AS n FROM actions GROUP BY root_action_id`,
			)
			.all() as Array<{ root: string; n: number }>;
		expect(survivors.map((s) => Number(s.n))).toEqual([2, 2, 2]);

		const rest = await purge(db, { maxActionsPerBatch: 5 });
		expect(rest).toMatchObject({
			actions: 6,
			trees: 3,
			batches: 2,
			truncated: false,
		});
		expect(db.count("actions")).toBe(0);
		expect(db.count("agent_runs")).toBe(0);
	});

	it("bounds trees per batch and reports truncation when batches run out", async () => {
		const db = NodeSqliteDb.migrated();
		for (let i = 0; i < 4; i += 1) {
			await seedTree(db, { rootId: `run-${i}`, withLeaves: false });
		}

		const summary = await purge(db, { maxTreesPerBatch: 1, maxBatches: 2 });

		expect(summary).toMatchObject({
			actions: 4,
			trees: 2,
			batches: 2,
			truncated: true,
		});
		expect(db.count("actions")).toBe(4);
	});

	it("re-checks eligibility inside the deleting transaction", async () => {
		// Simulate an ingest landing after selection but before the batch runs:
		// a fresh child arrives for the already-selected tree.
		const inner = NodeSqliteDb.migrated();
		await seedTree(inner, { rootId: "late" });
		await seedTree(inner, { rootId: "quiet" });
		const store = new ActionStore(inner);
		let raced = false;
		const racing: SqlDb = {
			prepare: (sql) => inner.prepare(sql),
			batch: async (statements: SqlStatement[]) => {
				if (!raced) {
					raced = true;
					await store.upsertAction(
						actionRecord({
							id: "late-straggler",
							rootActionId: "late",
							causedByActionId: "late",
							agentRunId: "late",
							startedAt: FRESH_START,
							endedAt: FRESH_START,
						}),
					);
				}
				return inner.batch(statements);
			},
		};

		const summary = await purge(racing);

		// Only the undisturbed tree went; the raced tree kept spine AND leaves.
		expect(summary.actions).toBe(2);
		expect(summary.trees).toBe(1);
		expect(inner.count("actions", "root_action_id = ?", "late")).toBe(3);
		expect(inner.count("agent_runs", "id = ?", "late")).toBe(1);
		expect(inner.count("tool_calls", "action_id = ?", "late-child")).toBe(1);
		expect(inner.count("artifacts", "action_id = ?", "late-child")).toBe(1);
		expect(inner.count("actions", "root_action_id = ?", "quiet")).toBe(0);
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
