/**
 * Retention for the RFC 0010 action graph (`actions` spine plus the
 * `agent_runs`, `tool_calls`, `retrieval_events`, `eval_results` and
 * `artifacts` leaves).
 *
 * Unlike the telemetry tables these rows carry no `expires_at`; the sweep
 * derives expiry from `actions.started_at` and the configured
 * `RETENTION_HOURS`. Deletion is decided per causal tree
 * (`project_id`, `root_action_id`), never per action, so a run is removed
 * only once *every* action in it is expired and finished. A tree is kept
 * whole while any of its actions:
 *
 *   - started inside the retention window,
 *   - is still in progress (`ended_at IS NULL`),
 *   - belongs to an `agent_runs` row whose `status` is `running`,
 *   - is referenced by an `eval_cases` row in the same project via
 *     `source_action_id`, `source_agent_run_id`, or (through a `tool_calls`
 *     row) `source_tool_call_id`.
 *
 * Each batch selects at most `batchSize` expired action ids (oldest first,
 * served by `idx_actions_started_at`), deletes their leaf rows and then the
 * spine rows in one `SqlDb.batch` (a D1 batch or a Postgres transaction),
 * and stops after `maxBatches` so an hourly run stays bounded. Leaf deletes
 * are scoped by `project_id` *and* `action_id`, so an id collision across
 * projects can never reach another project's rows.
 *
 * Intentionally **not** deleted here:
 *
 *   - `artifacts.storage_ref` blobs — only the metadata row goes; the blob
 *     store is not consulted (the collector never wrote those blobs).
 *   - `agent_runs` rows with no matching `actions` row — nothing proves
 *     when they started.
 *   - `ai_span_payloads.action_id` and `evidence_retrieval_refs` anchors —
 *     those tables have their own `expires_at` retention.
 *   - `eval_cases`, `eval_runs`, `eval_case_results` — curated fixtures,
 *     never retention-bound.
 */

import type { SqlDb, SqlStatement } from "./sql-db";

export interface ActionGraphRetentionOptions {
	/** Retention window; actions whose tree is older than this expire. */
	retentionHours: number;
	/** Clock override for tests. Defaults to `Date.now`. */
	now?: () => number;
	/** Expired action ids selected per batch. Defaults to 200. */
	batchSize?: number;
	/** Upper bound on batches per invocation. Defaults to 20. */
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
	/** Batches executed; equals `maxBatches` when the sweep was cut short. */
	batches: number;
	/** `true` when `maxBatches` was hit while candidates remained. */
	truncated: boolean;
}

/** Stay under D1's ~100 bound parameters per statement (1 is `project_id`). */
const MAX_IDS_PER_STATEMENT = 50;

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_MAX_BATCHES = 20;

/**
 * Oldest expired, finished actions whose whole tree is expired, finished,
 * not part of a running agent run, and not pinned by an eval case.
 * Binds: ISO cutoff (twice), then the batch size.
 */
const SELECT_EXPIRED_ACTIONS_SQL = `
	SELECT a.id, a.project_id
	FROM actions a
	WHERE a.started_at < ?
	  AND a.ended_at IS NOT NULL
	  AND NOT EXISTS (
	    SELECT 1 FROM actions t
	    WHERE t.project_id = a.project_id
	      AND t.root_action_id = a.root_action_id
	      AND (t.started_at >= ? OR t.ended_at IS NULL)
	  )
	  AND NOT EXISTS (
	    SELECT 1 FROM actions t
	    JOIN agent_runs r
	      ON r.project_id = t.project_id AND r.id = t.agent_run_id
	    WHERE t.project_id = a.project_id
	      AND t.root_action_id = a.root_action_id
	      AND r.status = 'running'
	  )
	  AND NOT EXISTS (
	    SELECT 1 FROM actions t
	    JOIN eval_cases c
	      ON c.project_id = t.project_id
	     AND (c.source_action_id = t.id OR c.source_agent_run_id = t.agent_run_id)
	    WHERE t.project_id = a.project_id
	      AND t.root_action_id = a.root_action_id
	  )
	  AND NOT EXISTS (
	    SELECT 1 FROM actions t
	    JOIN tool_calls tc
	      ON tc.project_id = t.project_id AND tc.action_id = t.id
	    JOIN eval_cases c
	      ON c.project_id = tc.project_id AND c.source_tool_call_id = tc.id
	    WHERE t.project_id = a.project_id
	      AND t.root_action_id = a.root_action_id
	  )
	ORDER BY a.started_at ASC
	LIMIT ?
`;

interface ExpiredActionRow {
	id: string;
	project_id: string;
}

/** Tables keyed by `action_id`, deleted before the spine. */
const LEAF_TABLES = [
	"tool_calls",
	"retrieval_events",
	"eval_results",
	"artifacts",
] as const;

type LeafTable = (typeof LEAF_TABLES)[number];

const emptySummary = (): ActionGraphPurgeSummary => ({
	actions: 0,
	agent_runs: 0,
	tool_calls: 0,
	retrieval_events: 0,
	eval_results: 0,
	artifacts: 0,
	batches: 0,
	truncated: false,
});

const placeholders = (count: number): string =>
	Array.from({ length: count }, () => "?").join(", ");

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
};

/** Cutoff as the same ISO text shape the collector writes to `started_at`. */
export const actionRetentionCutoff = (
	retentionHours: number,
	nowMs: number = Date.now(),
): string => new Date(nowMs - retentionHours * 60 * 60 * 1000).toISOString();

/**
 * Purge expired action trees. Safe to call repeatedly: a second call right
 * after the first finds no candidates and deletes nothing.
 */
export async function purgeExpiredActionGraph(
	db: SqlDb,
	options: ActionGraphRetentionOptions,
): Promise<ActionGraphPurgeSummary> {
	const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
	const maxBatches = Math.max(1, options.maxBatches ?? DEFAULT_MAX_BATCHES);
	const nowMs = (options.now ?? Date.now)();
	const cutoff = actionRetentionCutoff(options.retentionHours, nowMs);

	const summary = emptySummary();

	for (let batch = 0; batch < maxBatches; batch += 1) {
		const { results } = await db
			.prepare(SELECT_EXPIRED_ACTIONS_SQL)
			.bind(cutoff, cutoff, batchSize)
			.all<ExpiredActionRow>();
		if (results.length === 0) return summary;

		summary.batches += 1;
		const deleted = await deleteActionBatch(db, results);
		for (const table of LEAF_TABLES) summary[table] += deleted[table];
		summary.agent_runs += deleted.agent_runs;
		summary.actions += deleted.actions;

		if (results.length < batchSize) return summary;
	}

	// We stopped because of `maxBatches`; a candidate may remain. Probe so
	// the summary says so without doing another delete.
	const remaining = await db
		.prepare(SELECT_EXPIRED_ACTIONS_SQL)
		.bind(cutoff, cutoff, 1)
		.all<ExpiredActionRow>();
	summary.truncated = remaining.results.length > 0;
	return summary;
}

type BatchCounts = Record<LeafTable | "agent_runs" | "actions", number>;

/**
 * Delete leaves, then `agent_runs`, then the spine for the given actions in
 * a single `SqlDb.batch`. Statements are grouped per project so every
 * `DELETE` is scoped by `project_id`, and id lists are chunked to respect
 * D1's bound-parameter ceiling.
 */
async function deleteActionBatch(
	db: SqlDb,
	rows: readonly ExpiredActionRow[],
): Promise<BatchCounts> {
	const byProject = new Map<string, string[]>();
	for (const row of rows) {
		const ids = byProject.get(row.project_id);
		if (ids) ids.push(row.id);
		else byProject.set(row.project_id, [row.id]);
	}

	const statements: SqlStatement[] = [];
	const owners: Array<keyof BatchCounts> = [];
	const push = (table: keyof BatchCounts, stmt: SqlStatement) => {
		statements.push(stmt);
		owners.push(table);
	};

	for (const [projectId, ids] of byProject) {
		for (const idChunk of chunk(ids, MAX_IDS_PER_STATEMENT)) {
			const list = placeholders(idChunk.length);
			for (const table of LEAF_TABLES) {
				push(
					table,
					db
						.prepare(
							`DELETE FROM ${table} WHERE project_id = ? AND action_id IN (${list})`,
						)
						.bind(projectId, ...idChunk),
				);
			}
			// `agent_runs.id` matches the run's root `actions.id`, so only runs
			// whose spine row is in this batch are removed.
			push(
				"agent_runs",
				db
					.prepare(
						`DELETE FROM agent_runs WHERE project_id = ? AND id IN (${list})`,
					)
					.bind(projectId, ...idChunk),
			);
			push(
				"actions",
				db
					.prepare(
						`DELETE FROM actions WHERE project_id = ? AND id IN (${list})`,
					)
					.bind(projectId, ...idChunk),
			);
		}
	}

	const results = await db.batch(statements);
	const counts: BatchCounts = {
		tool_calls: 0,
		retrieval_events: 0,
		eval_results: 0,
		artifacts: 0,
		agent_runs: 0,
		actions: 0,
	};
	results.forEach((result, index) => {
		const owner = owners[index];
		if (owner) counts[owner] += result?.meta?.changes ?? 0;
	});
	return counts;
}
