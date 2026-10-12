/**
 * Builders for RFC 0010 action-graph rows used by the retention tests on
 * both SQLite (`action-retention.test.ts`) and live Postgres
 * (`sql-db-postgres.integration.test.ts`). Everything is written through
 * `ActionStore`, i.e. the same SQL the ingest path uses.
 */

import {
	type ActionRecord,
	ActionStore,
	type AgentRunRecord,
	type ArtifactRecord,
	type EvalResultRecord,
	type RetrievalEventRecord,
	type ToolCallRecord,
} from "../actions-store";
import type { SqlDb } from "../sql-db";

/** Fixed clock for deterministic cutoffs: 2026-10-12T12:00:00Z. */
export const FIXTURE_NOW_MS = Date.UTC(2026, 9, 12, 12, 0, 0);
export const FIXTURE_RETENTION_HOURS = 72;

/** ISO timestamp `hours` before `FIXTURE_NOW_MS`. */
export const hoursAgo = (hours: number): string =>
	new Date(FIXTURE_NOW_MS - hours * 3_600_000).toISOString();

export const EXPIRED_START = hoursAgo(100);
export const FRESH_START = hoursAgo(1);

export const actionRecord = (
	over: Partial<ActionRecord> = {},
): ActionRecord => {
	const id = over.id ?? "act-1";
	return {
		id,
		projectId: "alpha",
		rootActionId: id,
		causedByActionId: null,
		actorType: "agent",
		actorId: "agent-1",
		actionKind: "agent.run",
		name: "run",
		status: "ok",
		startedAt: EXPIRED_START,
		endedAt: EXPIRED_START,
		durationMs: 10,
		traceId: null,
		spanId: null,
		sessionId: null,
		interactionId: null,
		userId: null,
		agentRunId: null,
		stepId: null,
		toolCallId: null,
		promptVersion: null,
		modelName: null,
		provider: null,
		totalCostUsd: null,
		causalConfidence: "explicit",
		attrsJson: null,
		...over,
	};
};

export const agentRunRecord = (
	over: Partial<AgentRunRecord> = {},
): AgentRunRecord => ({
	id: "act-1",
	projectId: "alpha",
	agentId: "agent-1",
	agentName: "Agent",
	agentVersion: "1",
	goal: null,
	outcome: null,
	autonomyLevel: "autonomous_write",
	status: "success",
	errorMessage: null,
	totalCostUsd: 0,
	totalDurationMs: 10,
	metadataJson: null,
	...over,
});

export const toolCallRecord = (
	over: Partial<ToolCallRecord> = {},
): ToolCallRecord => ({
	id: "tc-1",
	actionId: "act-1",
	projectId: "alpha",
	toolName: "sql_query",
	argsHash: "a",
	resultHash: "r",
	errorType: null,
	sideEffect: 0,
	approvalState: null,
	argsRedacted: null,
	resultRedacted: null,
	mcpAuditJson: null,
	mutationBeforeJson: null,
	mutationAfterJson: null,
	mutationDiffJson: null,
	mutationArtifactId: null,
	...over,
});

export const retrievalEventRecord = (
	over: Partial<RetrievalEventRecord> = {},
): RetrievalEventRecord => ({
	id: "re-1",
	actionId: "act-1",
	projectId: "alpha",
	retrieverName: "vector-db",
	queryHash: "q",
	documentsJson: null,
	totalResults: 0,
	maxRelevanceScore: null,
	durationMs: null,
	...over,
});

export const evalResultRecord = (
	over: Partial<EvalResultRecord> = {},
): EvalResultRecord => ({
	id: "er-1",
	actionId: "act-1",
	projectId: "alpha",
	evaluatorName: "groundedness",
	evaluatorVersion: "1",
	score: 1,
	passed: 1,
	reasoning: null,
	rubricJson: null,
	...over,
});

export const artifactRecord = (
	over: Partial<ArtifactRecord> = {},
): ArtifactRecord => ({
	id: "af-1",
	actionId: "act-1",
	projectId: "alpha",
	artifactName: "invoice-pdf",
	artifactType: "file",
	storageRef: "s3://bucket/invoice.pdf",
	sizeBytes: 1,
	sha256Hash: null,
	contentPreview: null,
	...over,
});

export interface SeedTreeOptions {
	projectId?: string;
	/** Root action id; also the `agent_runs.id`. */
	rootId: string;
	rootStartedAt?: string;
	childStartedAt?: string;
	/** `null` leaves the child in progress. */
	childEndedAt?: string | null;
	agentRunStatus?: string;
	/** Attach one row of every leaf table to the child action. */
	withLeaves?: boolean;
}

/**
 * Seed a two-action tree (root `agent.run` + child `tool.call`) with an
 * `agent_runs` row for the root and, optionally, one row in each leaf table
 * hanging off the child. Returns the ids so tests can assert on them.
 */
export async function seedTree(db: SqlDb, options: SeedTreeOptions) {
	const store = new ActionStore(db);
	const projectId = options.projectId ?? "alpha";
	const rootId = options.rootId;
	const childId = `${rootId}-child`;
	const rootStartedAt = options.rootStartedAt ?? EXPIRED_START;
	const childStartedAt = options.childStartedAt ?? rootStartedAt;
	const childEndedAt =
		options.childEndedAt === undefined ? childStartedAt : options.childEndedAt;

	await store.upsertAction(
		actionRecord({
			id: rootId,
			projectId,
			rootActionId: rootId,
			agentRunId: rootId,
			startedAt: rootStartedAt,
			endedAt: rootStartedAt,
		}),
	);
	await store.upsertAgentRun(
		agentRunRecord({
			id: rootId,
			projectId,
			status: options.agentRunStatus ?? "success",
		}),
	);
	await store.upsertAction(
		actionRecord({
			id: childId,
			projectId,
			rootActionId: rootId,
			causedByActionId: rootId,
			agentRunId: rootId,
			actionKind: "tool.call",
			startedAt: childStartedAt,
			endedAt: childEndedAt,
			toolCallId: `${childId}-tc`,
		}),
	);

	const leaves = {
		toolCallId: `${childId}-tc`,
		retrievalEventId: `${childId}-re`,
		evalResultId: `${childId}-er`,
		artifactId: `${childId}-af`,
	};
	if (options.withLeaves ?? true) {
		await store.upsertArtifact(
			artifactRecord({ id: leaves.artifactId, actionId: childId, projectId }),
		);
		await store.upsertToolCall(
			toolCallRecord({
				id: leaves.toolCallId,
				actionId: childId,
				projectId,
				mutationArtifactId: leaves.artifactId,
			}),
		);
		await store.upsertRetrievalEvent(
			retrievalEventRecord({
				id: leaves.retrievalEventId,
				actionId: childId,
				projectId,
			}),
		);
		await store.upsertEvalResult(
			evalResultRecord({
				id: leaves.evalResultId,
				actionId: childId,
				projectId,
			}),
		);
	}

	return { projectId, rootId, childId, ...leaves };
}

/** Minimal `eval_cases` row pointing at production entities. */
export async function seedEvalCase(
	db: SqlDb,
	over: {
		id: string;
		projectId?: string;
		sourceActionId?: string | null;
		sourceAgentRunId?: string | null;
		sourceToolCallId?: string | null;
	},
): Promise<void> {
	const now = new Date(FIXTURE_NOW_MS).toISOString();
	await db
		.prepare(
			`INSERT INTO eval_cases (
				id, project_id, source_entity_type, source_entity_id,
				source_agent_run_id, source_action_id, source_tool_call_id,
				name, metadata_json, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			over.id,
			over.projectId ?? "alpha",
			over.sourceActionId
				? "action"
				: over.sourceToolCallId
					? "tool_call"
					: "agent_run",
			over.sourceActionId ??
				over.sourceToolCallId ??
				over.sourceAgentRunId ??
				"unknown",
			over.sourceAgentRunId ?? null,
			over.sourceActionId ?? null,
			over.sourceToolCallId ?? null,
			`case ${over.id}`,
			"{}",
			now,
			now,
		)
		.run();
}

/** Row counts across the whole action graph for a project. */
export async function countActionGraph(db: SqlDb, projectId: string) {
	const count = async (table: string) => {
		const row = await db
			.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`)
			.bind(projectId)
			.first<{ n: number | string | bigint }>();
		return Number(row?.n ?? 0);
	};
	return {
		actions: await count("actions"),
		agent_runs: await count("agent_runs"),
		tool_calls: await count("tool_calls"),
		retrieval_events: await count("retrieval_events"),
		eval_results: await count("eval_results"),
		artifacts: await count("artifacts"),
	};
}
