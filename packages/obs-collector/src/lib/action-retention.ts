/**
 * Retention for the RFC 0010 action graph (`actions` spine plus the
 * `agent_runs`, `tool_calls`, `retrieval_events`, `eval_results` and
 * `artifacts` leaves).
 *
 * Unlike the telemetry tables these rows carry no `expires_at`; the sweep
 * derives expiry from `actions.started_at` and the configured
 * `RETENTION_HOURS`. The unit of deletion is the causal tree
 * (`project_id`, `root_action_id`): a tree is selected, rechecked and
 * removed as a whole inside one `SqlDb.batch` (a D1 batch or a Postgres
 * transaction), never action by action. A tree is kept whole while any of
 * its actions:
 *
 *   - started inside the retention window,
 *   - is still in progress (`ended_at IS NULL`),
 *   - belongs to an `agent_runs` row whose `status` is `running`,
 *   - is referenced by an `eval_cases` row in the same project via
 *     `source_action_id`, `source_agent_run_id`, or (through a `tool_calls`
 *     row) `source_tool_call_id`.
 *
 * Work is bounded per invocation: each batch packs whole trees up to
 * `maxActionsPerBatch` actions and `maxTreesPerBatch` trees, and the sweep
 * stops after `maxBatches`. A tree with more than `maxActionsPerBatch`
 * actions can never be deleted atomically within those bounds, so it is
 * retained intact and reported as `oversized_trees` (and logged by the
 * handler) instead of being deleted in pieces. Raise `maxActionsPerBatch`
 * to reclaim such trees.
 *
 * Concurrency: every DELETE repeats the eligibility predicate, so a tree
 * that gained a fresh or unfinished action, a `running` run, or an eval
 * case between selection and deletion is left alone. On D1 the batch is a
 * single serialized SQLite transaction, so that recheck is airtight. On
 * Postgres (READ COMMITTED) each statement sees writes committed before it
 * started, so a commit landing between the leaf deletes and the final spine
 * delete of the same tree could leave that tree's spine without its leaves.
 * That needs an ingest for a tree whose newest action is already older than
 * the retention window, inside a sub-second window; it is documented rather
 * than locked against because `SqlDb` has no row-locking primitive.
 *
 * Intentionally **not** deleted here:
 *
 *   - `artifacts.storage_ref` blobs — only the metadata row goes; the blob
 *     store is not consulted (the collector never wrote those blobs).
 *   - `agent_runs` rows whose `id` is not an action in the tree — nothing
 *     proves when they started.
 *   - `ai_span_payloads.action_id` and `evidence_retrieval_refs` anchors —
 *     those tables have their own `expires_at` retention.
 *   - `eval_cases`, `eval_runs`, `eval_case_results` — curated fixtures,
 *     never retention-bound.
 */

import type { SqlDb, SqlStatement } from "./sql-db";

export interface ActionGraphRetentionOptions {
	/** Retention window; trees whose newest action is older than this expire. */
	retentionHours: number;
	/** Clock override for tests. Defaults to `Date.now`. */
	now?: () => number;
	/**
	 * Upper bound on actions deleted per batch/transaction. Also the largest
	 * tree the sweep will delete; bigger trees are retained and reported.
	 * Defaults to 500.
	 */
	maxActionsPerBatch?: number;
	/** Upper bound on trees per batch (bounds statements per transaction). Defaults to 25. */
	maxTreesPerBatch?: number;
	/** Upper bound on batches per invocation. Defaults to 10. */
	maxBatches?: number;
}

/** Per-table delete counts for one `purgeExpiredActionGraph` call. */
export interface ActionGraphPurgeSummary {
	actions: number;
	agent_runs: number;
	tool_calls: number;
	retrieval_events: number;
	eval_results: number;
	artifacts: number;
	/** Whole trees deleted. */
	trees: number;
	/** Batches (transactions) executed. */
	batches: number;
	/** `true` when `maxBatches` was hit while deletable trees remained. */
	truncated: boolean;
	/**
	 * Expired, otherwise eligible trees retained because they hold more than
	 * `maxActionsPerBatch` actions. Capped at `OVERSIZED_REPORT_LIMIT`.
	 */
	oversized_trees: number;
	/** Identities of the reported oversized trees, for operators. */
	oversized: Array<{
		project_id: string;
		root_action_id: string;
		actions: number;
	}>;
}

const DEFAULT_MAX_ACTIONS_PER_BATCH = 500;
const DEFAULT_MAX_TREES_PER_BATCH = 25;
const DEFAULT_MAX_BATCHES = 10;
/** How many oversized trees one invocation lists; keeps the log line bounded. */
export const OVERSIZED_REPORT_LIMIT = 20;

/**
 * Tree eligibility for the tree identified by the SQL expressions
 * `project` / `root`. The DELETEs pass `?` placeholders (bound through
 * `treeEligibleBinds`); the candidate query passes the grouped columns.
 * Using the same text in both places means the decision is re-made,
 * unchanged, inside the deleting transaction.
 */
const treeEligibleSql = (project: string, root: string, cutoff: string) => `
	NOT EXISTS (
	  SELECT 1 FROM actions t
	  WHERE t.project_id = ${project} AND t.root_action_id = ${root}
	    AND (t.started_at >= ${cutoff} OR t.ended_at IS NULL)
	)
	AND NOT EXISTS (
	  SELECT 1 FROM actions t
	  JOIN agent_runs r ON r.project_id = t.project_id AND r.id = t.agent_run_id
	  WHERE t.project_id = ${project} AND t.root_action_id = ${root}
	    AND r.status = 'running'
	)
	AND NOT EXISTS (
	  SELECT 1 FROM actions t
	  JOIN eval_cases c
	    ON c.project_id = t.project_id
	   AND (c.source_action_id = t.id OR c.source_agent_run_id = t.agent_run_id)
	  WHERE t.project_id = ${project} AND t.root_action_id = ${root}
	)
	AND NOT EXISTS (
	  SELECT 1 FROM actions t
	  JOIN tool_calls tc ON tc.project_id = t.project_id AND tc.action_id = t.id
	  JOIN eval_cases c ON c.project_id = tc.project_id AND c.source_tool_call_id = tc.id
	  WHERE t.project_id = ${project} AND t.root_action_id = ${root}
	)`;

/** Eligibility with every tree reference bound; pair with `treeEligibleBinds`. */
const TREE_ELIGIBLE_SQL = treeEligibleSql("?", "?", "?");

/** Binds for `TREE_ELIGIBLE_SQL`, in placeholder order. */
const treeEligibleBinds = (
	projectId: string,
	rootActionId: string,
	cutoff: string,
): unknown[] => [
	projectId,
	rootActionId,
	cutoff,
	projectId,
	rootActionId,
	projectId,
	rootActionId,
	projectId,
	rootActionId,
];

/**
 * Candidate trees, oldest first. The WHERE keeps the scan to expired rows
 * (served by `idx_actions_started_at`); eligibility is decided per tree in
 * HAVING over the whole tree, which — because eligible trees contain no
 * fresh action — also makes `COUNT(*)` the full tree size.
 *
 * `sizeOp` is `<=` for deletable trees and `>` for oversized reporting.
 * Binds: cutoff, size cap, cutoff (inside the eligibility test), limit.
 */
const candidateTreesSql = (sizeOp: "<=" | ">") => `
	SELECT a.project_id, a.root_action_id, COUNT(*) AS action_count,
	       MIN(a.started_at) AS oldest_started_at
	FROM actions a
	WHERE a.started_at < ?
	GROUP BY a.project_id, a.root_action_id
	HAVING COUNT(*) ${sizeOp} ?
	   AND ${treeEligibleSql("a.project_id", "a.root_action_id", "?")}
	ORDER BY oldest_started_at ASC
	LIMIT ?
`;

const SELECT_DELETABLE_TREES_SQL = candidateTreesSql("<=");
const SELECT_OVERSIZED_TREES_SQL = candidateTreesSql(">");

interface CandidateTreeRow {
	project_id: string;
	root_action_id: string;
	/** D1 returns numbers; pg returns BIGINT as string unless type parsers are configured. */
	action_count: number | string;
}

interface CandidateTree {
	projectId: string;
	rootActionId: string;
	actions: number;
}

/** Tables keyed by `action_id`, deleted before the spine. */
const LEAF_TABLES = [
	"tool_calls",
	"retrieval_events",
	"eval_results",
	"artifacts",
] as const;

type LeafTable = (typeof LEAF_TABLES)[number];
type CountedTable = LeafTable | "agent_runs" | "actions";

const emptySummary = (): ActionGraphPurgeSummary => ({
	actions: 0,
	agent_runs: 0,
	tool_calls: 0,
	retrieval_events: 0,
	eval_results: 0,
	artifacts: 0,
	trees: 0,
	batches: 0,
	truncated: false,
	oversized_trees: 0,
	oversized: [],
});

/** Cutoff as the same ISO text shape the collector writes to `started_at`. */
export const actionRetentionCutoff = (
	retentionHours: number,
	nowMs: number = Date.now(),
): string => new Date(nowMs - retentionHours * 60 * 60 * 1000).toISOString();

const selectTrees = async (
	db: SqlDb,
	sql: string,
	cutoff: string,
	sizeCap: number,
	limit: number,
): Promise<CandidateTree[]> => {
	const { results } = await db
		.prepare(sql)
		.bind(cutoff, sizeCap, cutoff, limit)
		.all<CandidateTreeRow>();
	return results.map((row) => ({
		projectId: row.project_id,
		rootActionId: row.root_action_id,
		actions: Number(row.action_count),
	}));
};

/**
 * Greedy pack of whole trees (already ordered oldest first) into one batch
 * without exceeding `maxActions`. Every candidate fits on its own because
 * the SELECT capped tree size at `maxActions`.
 */
const packBatch = (
	candidates: readonly CandidateTree[],
	maxActions: number,
): CandidateTree[] => {
	const batch: CandidateTree[] = [];
	let used = 0;
	for (const tree of candidates) {
		if (batch.length > 0 && used + tree.actions > maxActions) break;
		batch.push(tree);
		used += tree.actions;
	}
	return batch;
};

/**
 * Purge expired action trees. Safe to call repeatedly: a second call right
 * after the first finds no deletable trees and changes nothing.
 */
export async function purgeExpiredActionGraph(
	db: SqlDb,
	options: ActionGraphRetentionOptions,
): Promise<ActionGraphPurgeSummary> {
	const maxActions = Math.max(
		1,
		options.maxActionsPerBatch ?? DEFAULT_MAX_ACTIONS_PER_BATCH,
	);
	const maxTrees = Math.max(
		1,
		options.maxTreesPerBatch ?? DEFAULT_MAX_TREES_PER_BATCH,
	);
	const maxBatches = Math.max(1, options.maxBatches ?? DEFAULT_MAX_BATCHES);
	const nowMs = (options.now ?? Date.now)();
	const cutoff = actionRetentionCutoff(options.retentionHours, nowMs);

	const summary = emptySummary();
	let exhausted = false;

	for (let batch = 0; batch < maxBatches && !exhausted; batch += 1) {
		const candidates = await selectTrees(
			db,
			SELECT_DELETABLE_TREES_SQL,
			cutoff,
			maxActions,
			maxTrees,
		);
		if (candidates.length === 0) {
			exhausted = true;
			break;
		}
		const trees = packBatch(candidates, maxActions);
		summary.batches += 1;
		const deleted = await deleteTrees(db, trees, cutoff);
		for (const table of LEAF_TABLES) summary[table] += deleted[table];
		summary.agent_runs += deleted.agent_runs;
		summary.actions += deleted.actions;
		summary.trees += deleted.trees;
		// Fewer candidates than asked for and all of them packed: nothing left.
		exhausted =
			candidates.length < maxTrees && trees.length === candidates.length;
	}

	if (!exhausted) {
		const remaining = await selectTrees(
			db,
			SELECT_DELETABLE_TREES_SQL,
			cutoff,
			maxActions,
			1,
		);
		summary.truncated = remaining.length > 0;
	}

	const oversized = await selectTrees(
		db,
		SELECT_OVERSIZED_TREES_SQL,
		cutoff,
		maxActions,
		OVERSIZED_REPORT_LIMIT,
	);
	summary.oversized_trees = oversized.length;
	summary.oversized = oversized.map((tree) => ({
		project_id: tree.projectId,
		root_action_id: tree.rootActionId,
		actions: tree.actions,
	}));

	return summary;
}

type BatchCounts = Record<CountedTable, number> & { trees: number };

/**
 * Delete the given trees in one `SqlDb.batch`: for each tree, its four leaf
 * tables, then `agent_runs`, then the spine, every statement scoped by
 * `project_id` and the tree and guarded by the eligibility recheck.
 */
async function deleteTrees(
	db: SqlDb,
	trees: readonly CandidateTree[],
	cutoff: string,
): Promise<BatchCounts> {
	const statements: SqlStatement[] = [];
	const owners: Array<{ table: CountedTable; tree: number }> = [];

	trees.forEach(({ projectId, rootActionId }, treeIndex) => {
		const guard = treeEligibleBinds(projectId, rootActionId, cutoff);
		const push = (table: CountedTable, stmt: SqlStatement) => {
			statements.push(stmt);
			owners.push({ table, tree: treeIndex });
		};
		for (const table of LEAF_TABLES) {
			push(
				table,
				db
					.prepare(
						`DELETE FROM ${table}
						 WHERE project_id = ?
						   AND action_id IN (
						     SELECT id FROM actions WHERE project_id = ? AND root_action_id = ?
						   )
						   AND ${TREE_ELIGIBLE_SQL}`,
					)
					.bind(projectId, projectId, rootActionId, ...guard),
			);
		}
		// `agent_runs.id` matches the run's root `actions.id` (sub-agent runs
		// match a nested action), so only runs anchored in this tree go.
		push(
			"agent_runs",
			db
				.prepare(
					`DELETE FROM agent_runs
					 WHERE project_id = ?
					   AND id IN (
					     SELECT id FROM actions WHERE project_id = ? AND root_action_id = ?
					   )
					   AND ${TREE_ELIGIBLE_SQL}`,
				)
				.bind(projectId, projectId, rootActionId, ...guard),
		);
		push(
			"actions",
			db
				.prepare(
					`DELETE FROM actions
					 WHERE project_id = ? AND root_action_id = ?
					   AND ${TREE_ELIGIBLE_SQL}`,
				)
				.bind(projectId, rootActionId, ...guard),
		);
	});

	const results = await db.batch(statements);
	const counts: BatchCounts = {
		tool_calls: 0,
		retrieval_events: 0,
		eval_results: 0,
		artifacts: 0,
		agent_runs: 0,
		actions: 0,
		trees: 0,
	};
	const spineDeleted = new Set<number>();
	results.forEach((result, index) => {
		const owner = owners[index];
		if (!owner) return;
		const changes = result?.meta?.changes ?? 0;
		counts[owner.table] += changes;
		if (owner.table === "actions" && changes > 0) spineDeleted.add(owner.tree);
	});
	counts.trees = spineDeleted.size;
	return counts;
}
