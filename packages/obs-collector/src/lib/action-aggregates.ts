import type { SqlDb } from "./sql-db";
import { dialectFor } from "./sql-db";

const TOP_CAUSERS_LIMIT = 5;
const EXEMPLAR_LIMIT = 3;

export interface ActionAggregateExemplar {
	actionId: string;
	agentRunId: string | null;
	traceId: string | null;
	toolCallId: string | null;
	evalId: string | null;
	label: string | null;
	status: string | null;
	occurredAt: string | null;
}

export interface ToolReliabilityCauser {
	id: string;
	label: string | null;
	count: number;
}

export interface ToolReliabilityAggregate {
	toolName: string;
	callCount: number;
	p50LatencyMs: number | null;
	p95LatencyMs: number | null;
	errorCount: number;
	errorRate: number;
	timeoutCount: number;
	timeoutRate: number;
	retryCount: number;
	malformedArgumentCount: number;
	sideEffectCount: number;
	topCausingAgents: ToolReliabilityCauser[];
	topCausingWorkflows: ToolReliabilityCauser[];
	exemplars: ActionAggregateExemplar[];
}

export interface ToolReliabilityResult {
	projectId: string;
	windowHours: number;
	tools: ToolReliabilityAggregate[];
	generatedAt: string;
}

export interface CostAttributionRow {
	dimension: string;
	key: string | null;
	label: string | null;
	totalCostUsd: number;
	actionCount: number;
	agentRunCount: number;
	toolCallCount: number;
	exemplars: ActionAggregateExemplar[];
}

export interface CostAttributionResult {
	projectId: string;
	windowHours: number;
	byAgent: CostAttributionRow[];
	byRun: CostAttributionRow[];
	byModel: CostAttributionRow[];
	byProvider: CostAttributionRow[];
	byPromptVersion: CostAttributionRow[];
	byTool: CostAttributionRow[];
	byUser: CostAttributionRow[];
	byTenant: CostAttributionRow[];
	byWorkflow: CostAttributionRow[];
	generatedAt: string;
}

export interface AutonomousReviewRow {
	id: string;
	toolName: string;
	actionId: string;
	actionName: string;
	agentRunId: string;
	agentName: string;
	agentVersion: string;
	autonomyLevel: string;
	sideEffect: boolean;
	approvalState: string;
	status: "ok" | "error";
	errorSnippet: string | null;
	traceId: string;
	occurredAt: string;
	mutationEvidence: boolean;
	mutationArtifactId: string | null;
}

export interface AutonomousReviewResult {
	projectId: string;
	windowHours: number;
	rows: AutonomousReviewRow[];
	timestamp: string;
}

export interface VersionDiffMetric {
	label: string;
	baselineValue: string | number;
	targetValue: string | number;
	deltaValue: string | number | null;
	deltaDirection: "positive" | "negative" | "neutral";
}

export interface VersionComparisonResult {
	projectId: string;
	baselineVersion: string;
	targetVersion: string;
	metrics: VersionDiffMetric[];
	baselineExemplars: ActionAggregateExemplar[];
	targetExemplars: ActionAggregateExemplar[];
	timestamp: string;
}

interface ToolAggregateRow {
	tool_name: string;
	call_count: number;
	error_count: number | null;
	timeout_count: number | null;
	malformed_argument_count: number | null;
	side_effect_count: number | null;
}

interface ToolDetailRow {
	tool_name: string;
	duration_ms: number | null;
	agent_id: string | null;
	agent_label: string | null;
	workflow_id: string | null;
	workflow_label: string | null;
	action_id: string | null;
	agent_run_id: string | null;
	trace_id: string | null;
	tool_call_id: string | null;
	eval_id: string | null;
	action_label: string | null;
	status: string | null;
	occurred_at: string | null;
}

interface CostRow {
	key: string | null;
	label: string | null;
	total_cost_usd: number | null;
	action_count: number | null;
	agent_run_count: number | null;
	tool_call_count: number | null;
}

interface ExemplarSqlRow {
	dimension_key?: string | null;
	action_id: string | null;
	agent_run_id: string | null;
	trace_id: string | null;
	tool_call_id: string | null;
	eval_id: string | null;
	label: string | null;
	status: string | null;
	occurred_at: string | null;
}

interface AutonomousReviewSqlRow {
	id: string;
	tool_name: string;
	action_id: string;
	action_name: string | null;
	agent_run_id: string | null;
	agent_name: string | null;
	agent_version: string | null;
	autonomy_level: string | null;
	side_effect: number | null;
	approval_state: string | null;
	status: string | null;
	error_snippet: string | null;
	trace_id: string | null;
	occurred_at: string | null;
	mutation_evidence: number | null;
	mutation_artifact_id: string | null;
}

interface VersionStatsRow {
	version: string;
	run_count: number | null;
	success_count: number | null;
	avg_duration_ms: number | null;
	avg_cost_usd: number | null;
	eval_count: number | null;
	passed_eval_count: number | null;
	avg_eval_score: number | null;
	tool_count: number | null;
	tool_error_count: number | null;
}

const toNumber = (value: unknown): number => {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : 0;
};

const percentile = (values: number[], p: number): number | null => {
	const sorted = values
		.filter((v) => Number.isFinite(v) && v >= 0)
		.sort((a, b) => a - b);
	if (sorted.length === 0) return null;
	const index = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.min(Math.max(index, 0), sorted.length - 1)] ?? null;
};

const topCausers = (
	rows: ToolDetailRow[],
	idKey: "agent_id" | "workflow_id",
	labelKey: "agent_label" | "workflow_label",
): ToolReliabilityCauser[] => {
	const counts = new Map<string, { label: string | null; count: number }>();
	for (const row of rows) {
		const id = row[idKey];
		if (!id) continue;
		const current = counts.get(id) ?? { label: row[labelKey], count: 0 };
		current.count += 1;
		if (!current.label && row[labelKey]) current.label = row[labelKey];
		counts.set(id, current);
	}
	return [...counts.entries()]
		.map(([id, value]) => ({ id, label: value.label, count: value.count }))
		.sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
		.slice(0, TOP_CAUSERS_LIMIT);
};

const exemplarFromRow = (row: ExemplarSqlRow): ActionAggregateExemplar => ({
	actionId: row.action_id ?? "",
	agentRunId: row.agent_run_id ?? null,
	traceId: row.trace_id ?? null,
	toolCallId: row.tool_call_id ?? null,
	evalId: row.eval_id ?? null,
	label: row.label ?? null,
	status: row.status ?? null,
	occurredAt: row.occurred_at ?? null,
});

const exemplarsFromRows = (rows: ExemplarSqlRow[]): ActionAggregateExemplar[] =>
	rows
		.filter((row) => row.action_id)
		.map(exemplarFromRow)
		.slice(0, EXEMPLAR_LIMIT);

const appendExemplar = (
	map: Map<string, ActionAggregateExemplar[]>,
	key: string | null,
	row: ExemplarSqlRow,
) => {
	if (key === null || key === undefined || !row.action_id) return;
	const current = map.get(key) ?? [];
	if (current.length >= EXEMPLAR_LIMIT) return;
	current.push(exemplarFromRow(row));
	map.set(key, current);
};

const costRows = (
	dimension: string,
	rows: CostRow[],
	exemplars = new Map<string, ActionAggregateExemplar[]>(),
): CostAttributionRow[] =>
	rows.map((row) => ({
		dimension,
		key: row.key,
		label: row.label,
		totalCostUsd: toNumber(row.total_cost_usd),
		actionCount: toNumber(row.action_count),
		agentRunCount: toNumber(row.agent_run_count),
		toolCallCount: toNumber(row.tool_call_count),
		exemplars: row.key ? (exemplars.get(row.key) ?? []) : [],
	}));

const inClause = (values: string[]): string => values.map(() => "?").join(", ");

const actionTenantExpr = (db: SqlDb, alias = "a"): string => {
	const dialect = dialectFor(db);
	return `COALESCE(
		${dialect.jsonText(`${alias}.attrs_json`, '$."obs.tenant.id"')},
		${dialect.jsonText(`${alias}.attrs_json`, '$."tenant.id"')},
		${dialect.jsonText(`${alias}.attrs_json`, "$.tenant_id")},
		${dialect.jsonText(`${alias}.attrs_json`, "$.target_tenant")}
	)`;
};

const actionWorkflowExpr = (db: SqlDb, alias = "a"): string => {
	const dialect = dialectFor(db);
	return `COALESCE(
		CASE WHEN ${alias}.actor_type = 'workflow' THEN ${alias}.actor_id ELSE NULL END,
		${dialect.jsonText(`${alias}.attrs_json`, '$."obs.workflow.id"')},
		${dialect.jsonText(`${alias}.attrs_json`, '$."workflow.id"')},
		${dialect.jsonText(`${alias}.attrs_json`, "$.workflow_id")},
		${dialect.jsonText(`${alias}.attrs_json`, "$.task_id")}
	)`;
};

export const getToolReliabilityAggregates = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	limit: number,
): Promise<ToolReliabilityResult> => {
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");

	const aggregateRows = await db
		.prepare(`
			SELECT
				t.tool_name,
				COUNT(*) AS call_count,
				SUM(CASE WHEN t.error_type IS NOT NULL AND t.error_type <> '' THEN 1 ELSE 0 END) AS error_count,
				SUM(CASE
					WHEN LOWER(COALESCE(t.error_type, '')) LIKE '%timeout%'
						OR LOWER(COALESCE(t.error_type, '')) = 'deadline_exceeded'
					THEN 1 ELSE 0
				END) AS timeout_count,
				SUM(CASE
					WHEN LOWER(COALESCE(t.error_type, '')) LIKE '%malformed%'
						OR LOWER(COALESCE(t.error_type, '')) LIKE '%invalid_argument%'
						OR LOWER(COALESCE(t.error_type, '')) LIKE '%invalid_arguments%'
						OR LOWER(COALESCE(t.error_type, '')) LIKE '%schema_validation%'
						OR LOWER(COALESCE(t.error_type, '')) = 'bad_request'
					THEN 1 ELSE 0
				END) AS malformed_argument_count,
				SUM(CASE WHEN t.side_effect <> 0 THEN 1 ELSE 0 END) AS side_effect_count
			FROM tool_calls t
			LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
			WHERE t.project_id = ? AND (a.started_at IS NULL OR a.started_at >= ${since})
			GROUP BY t.tool_name
			ORDER BY call_count DESC, t.tool_name ASC
			LIMIT ?
		`)
		.bind(projectId, windowHours, limit)
		.all<ToolAggregateRow>();

	const toolNames = aggregateRows.results.map((row) => row.tool_name);
	if (toolNames.length === 0) {
		return {
			projectId,
			windowHours,
			tools: [],
			generatedAt: new Date().toISOString(),
		};
	}

	const workflowIdExpr = `COALESCE(
		${actionWorkflowExpr(db, "a")},
		${actionWorkflowExpr(db, "root")}
	)`;

	const detailRows = await db
		.prepare(`
			SELECT
				t.tool_name,
				a.duration_ms,
				COALESCE(
					ar.agent_id,
					CASE WHEN a.actor_type = 'agent' THEN a.actor_id ELSE NULL END,
					CASE WHEN root.actor_type = 'agent' THEN root.actor_id ELSE NULL END
				) AS agent_id,
				COALESCE(
					ar.agent_name,
					CASE WHEN a.actor_type = 'agent' THEN a.name ELSE NULL END,
					CASE WHEN root.actor_type = 'agent' THEN root.name ELSE NULL END
				) AS agent_label,
				${workflowIdExpr} AS workflow_id,
				${workflowIdExpr} AS workflow_label,
				a.id AS action_id,
				COALESCE(a.agent_run_id, a.root_action_id) AS agent_run_id,
				COALESCE(a.trace_id, root.trace_id) AS trace_id,
				t.id AS tool_call_id,
				er.id AS eval_id,
				COALESCE(a.name, t.tool_name) AS action_label,
				a.status,
				a.started_at AS occurred_at
			FROM tool_calls t
			LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
			LEFT JOIN actions root ON root.project_id = t.project_id AND root.id = a.root_action_id
			LEFT JOIN agent_runs ar ON ar.project_id = t.project_id AND ar.id = COALESCE(a.agent_run_id, a.root_action_id)
			LEFT JOIN eval_results er ON er.project_id = t.project_id AND er.action_id = a.id
			WHERE t.project_id = ?
				AND (a.started_at IS NULL OR a.started_at >= ${since})
				AND t.tool_name IN (${inClause(toolNames)})
			ORDER BY
				CASE WHEN a.status = 'error' OR t.error_type IS NOT NULL THEN 0 ELSE 1 END,
				a.started_at DESC
		`)
		.bind(projectId, windowHours, ...toolNames)
		.all<ToolDetailRow>();

	const detailsByTool = new Map<string, ToolDetailRow[]>();
	for (const row of detailRows.results) {
		const rows = detailsByTool.get(row.tool_name) ?? [];
		rows.push(row);
		detailsByTool.set(row.tool_name, rows);
	}

	return {
		projectId,
		windowHours,
		tools: aggregateRows.results.map((row) => {
			const callCount = toNumber(row.call_count);
			const errorCount = toNumber(row.error_count);
			const timeoutCount = toNumber(row.timeout_count);
			const details = detailsByTool.get(row.tool_name) ?? [];
			const durations = details
				.map((detail) => detail.duration_ms)
				.filter((duration): duration is number => duration !== null);
			return {
				toolName: row.tool_name,
				callCount,
				p50LatencyMs: percentile(durations, 50),
				p95LatencyMs: percentile(durations, 95),
				errorCount,
				errorRate: callCount > 0 ? errorCount / callCount : 0,
				timeoutCount,
				timeoutRate: callCount > 0 ? timeoutCount / callCount : 0,
				retryCount: 0,
				malformedArgumentCount: toNumber(row.malformed_argument_count),
				sideEffectCount: toNumber(row.side_effect_count),
				topCausingAgents: topCausers(details, "agent_id", "agent_label"),
				topCausingWorkflows: topCausers(
					details,
					"workflow_id",
					"workflow_label",
				),
				exemplars: exemplarsFromRows(
					details.map((detail) => ({
						action_id: detail.action_id,
						agent_run_id: detail.agent_run_id,
						trace_id: detail.trace_id,
						tool_call_id: detail.tool_call_id,
						eval_id: detail.eval_id,
						label: detail.action_label,
						status: detail.status,
						occurred_at: detail.occurred_at,
					})),
				),
			};
		}),
		generatedAt: new Date().toISOString(),
	};
};

const groupByActionDimension = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	limit: number,
	dimension: string,
	keyExpr: string,
	labelExpr = keyExpr,
): Promise<CostAttributionRow[]> => {
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const rows = await db
		.prepare(`
			SELECT
				${keyExpr} AS key,
				${labelExpr} AS label,
				COALESCE(SUM(COALESCE(a.total_cost_usd, 0)), 0) AS total_cost_usd,
				COUNT(*) AS action_count,
				COUNT(DISTINCT a.agent_run_id) AS agent_run_count,
				0 AS tool_call_count
			FROM actions a
			WHERE a.project_id = ? AND a.started_at >= ${since}
			GROUP BY 1, 2
			ORDER BY total_cost_usd DESC, action_count DESC
			LIMIT ?
		`)
		.bind(projectId, windowHours, limit)
		.all<CostRow>();
	const keys = rows.results
		.map((row) => row.key)
		.filter((key): key is string => !!key);
	if (keys.length === 0) return costRows(dimension, rows.results);

	const exemplarRows = await db
		.prepare(`
			SELECT
				${keyExpr} AS dimension_key,
				a.id AS action_id,
				COALESCE(a.agent_run_id, a.root_action_id) AS agent_run_id,
				a.trace_id,
				a.tool_call_id,
				er.id AS eval_id,
				a.name AS label,
				a.status,
				a.started_at AS occurred_at
			FROM actions a
			LEFT JOIN eval_results er ON er.project_id = a.project_id AND er.action_id = a.id
			WHERE a.project_id = ?
				AND a.started_at >= ${since}
				AND ${keyExpr} IN (${inClause(keys)})
			ORDER BY COALESCE(a.total_cost_usd, 0) DESC, a.started_at DESC
		`)
		.bind(projectId, windowHours, ...keys)
		.all<ExemplarSqlRow>();
	const exemplars = new Map<string, ActionAggregateExemplar[]>();
	for (const row of exemplarRows.results) {
		appendExemplar(exemplars, row.dimension_key ?? null, row);
	}
	return costRows(dimension, rows.results, exemplars);
};

const getAgentCostExemplars = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	keys: string[],
): Promise<Map<string, ActionAggregateExemplar[]>> => {
	if (keys.length === 0) return new Map();
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const rows = await db
		.prepare(`
			SELECT
				ar.agent_id AS dimension_key,
				root.id AS action_id,
				ar.id AS agent_run_id,
				root.trace_id,
				root.tool_call_id,
				er.id AS eval_id,
				ar.agent_name AS label,
				ar.status,
				root.started_at AS occurred_at
			FROM agent_runs ar
			LEFT JOIN actions root ON root.project_id = ar.project_id AND root.id = ar.id
			LEFT JOIN eval_results er ON er.project_id = ar.project_id AND er.action_id = root.id
			WHERE ar.project_id = ?
				AND (root.started_at IS NULL OR root.started_at >= ${since})
				AND ar.agent_id IN (${inClause(keys)})
			ORDER BY COALESCE(ar.total_cost_usd, 0) DESC, root.started_at DESC
		`)
		.bind(projectId, windowHours, ...keys)
		.all<ExemplarSqlRow>();
	const exemplars = new Map<string, ActionAggregateExemplar[]>();
	for (const row of rows.results) {
		appendExemplar(exemplars, row.dimension_key ?? null, row);
	}
	return exemplars;
};

const getRunCostExemplars = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	keys: string[],
): Promise<Map<string, ActionAggregateExemplar[]>> => {
	if (keys.length === 0) return new Map();
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const rows = await db
		.prepare(`
			SELECT
				ar.id AS dimension_key,
				root.id AS action_id,
				ar.id AS agent_run_id,
				root.trace_id,
				root.tool_call_id,
				er.id AS eval_id,
				ar.agent_name AS label,
				ar.status,
				root.started_at AS occurred_at
			FROM agent_runs ar
			LEFT JOIN actions root ON root.project_id = ar.project_id AND root.id = ar.id
			LEFT JOIN eval_results er ON er.project_id = ar.project_id AND er.action_id = root.id
			WHERE ar.project_id = ?
				AND (root.started_at IS NULL OR root.started_at >= ${since})
				AND ar.id IN (${inClause(keys)})
			ORDER BY COALESCE(ar.total_cost_usd, 0) DESC, root.started_at DESC
		`)
		.bind(projectId, windowHours, ...keys)
		.all<ExemplarSqlRow>();
	const exemplars = new Map<string, ActionAggregateExemplar[]>();
	for (const row of rows.results) {
		appendExemplar(exemplars, row.dimension_key ?? null, row);
	}
	return exemplars;
};

const getToolCostExemplars = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	keys: string[],
): Promise<Map<string, ActionAggregateExemplar[]>> => {
	if (keys.length === 0) return new Map();
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const rows = await db
		.prepare(`
			SELECT
				t.tool_name AS dimension_key,
				a.id AS action_id,
				COALESCE(a.agent_run_id, a.root_action_id) AS agent_run_id,
				COALESCE(a.trace_id, root.trace_id) AS trace_id,
				t.id AS tool_call_id,
				er.id AS eval_id,
				COALESCE(a.name, t.tool_name) AS label,
				a.status,
				a.started_at AS occurred_at
			FROM tool_calls t
			LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
			LEFT JOIN actions root ON root.project_id = t.project_id AND root.id = a.root_action_id
			LEFT JOIN eval_results er ON er.project_id = t.project_id AND er.action_id = a.id
			WHERE t.project_id = ?
				AND (a.started_at IS NULL OR a.started_at >= ${since})
				AND t.tool_name IN (${inClause(keys)})
			ORDER BY COALESCE(a.total_cost_usd, 0) DESC, a.started_at DESC
		`)
		.bind(projectId, windowHours, ...keys)
		.all<ExemplarSqlRow>();
	const exemplars = new Map<string, ActionAggregateExemplar[]>();
	for (const row of rows.results) {
		appendExemplar(exemplars, row.dimension_key ?? null, row);
	}
	return exemplars;
};

export const getCostAttributionAggregates = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	limit: number,
): Promise<CostAttributionResult> => {
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const tenantExpr = actionTenantExpr(db, "a");
	const workflowExpr = actionWorkflowExpr(db, "a");

	const [
		agentRows,
		runRows,
		byModel,
		byProvider,
		byPromptVersion,
		toolRows,
		byUser,
		byTenant,
		byWorkflow,
	] = await Promise.all([
		db
			.prepare(`
				SELECT
					ar.agent_id AS key,
					ar.agent_name AS label,
					COALESCE(SUM(COALESCE(ar.total_cost_usd, 0)), 0) AS total_cost_usd,
					0 AS action_count,
					COUNT(*) AS agent_run_count,
					0 AS tool_call_count
				FROM agent_runs ar
				LEFT JOIN actions root ON root.project_id = ar.project_id AND root.id = ar.id
				WHERE ar.project_id = ? AND (root.started_at IS NULL OR root.started_at >= ${since})
				GROUP BY ar.agent_id, ar.agent_name
				ORDER BY total_cost_usd DESC, agent_run_count DESC
				LIMIT ?
			`)
			.bind(projectId, windowHours, limit)
			.all<CostRow>(),
		db
			.prepare(`
				SELECT
					ar.id AS key,
					ar.agent_name AS label,
					COALESCE(ar.total_cost_usd, 0) AS total_cost_usd,
					0 AS action_count,
					1 AS agent_run_count,
					0 AS tool_call_count
				FROM agent_runs ar
				LEFT JOIN actions root ON root.project_id = ar.project_id AND root.id = ar.id
				WHERE ar.project_id = ? AND (root.started_at IS NULL OR root.started_at >= ${since})
				ORDER BY total_cost_usd DESC
				LIMIT ?
			`)
			.bind(projectId, windowHours, limit)
			.all<CostRow>(),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"model",
			"a.model_name",
		),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"provider",
			"a.provider",
		),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"prompt_version",
			"a.prompt_version",
		),
		db
			.prepare(`
				SELECT
					t.tool_name AS key,
					t.tool_name AS label,
					COALESCE(SUM(COALESCE(a.total_cost_usd, 0)), 0) AS total_cost_usd,
					COUNT(DISTINCT a.id) AS action_count,
					COUNT(DISTINCT a.agent_run_id) AS agent_run_count,
					COUNT(*) AS tool_call_count
				FROM tool_calls t
				LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
				WHERE t.project_id = ? AND (a.started_at IS NULL OR a.started_at >= ${since})
				GROUP BY t.tool_name
				ORDER BY total_cost_usd DESC, tool_call_count DESC
				LIMIT ?
			`)
			.bind(projectId, windowHours, limit)
			.all<CostRow>(),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"user",
			"a.user_id",
		),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"tenant",
			tenantExpr,
		),
		groupByActionDimension(
			db,
			projectId,
			windowHours,
			limit,
			"workflow",
			workflowExpr,
		),
	]);
	const agentKeys = agentRows.results
		.map((row) => row.key)
		.filter((key): key is string => !!key);
	const runKeys = runRows.results
		.map((row) => row.key)
		.filter((key): key is string => !!key);
	const toolKeys = toolRows.results
		.map((row) => row.key)
		.filter((key): key is string => !!key);
	const [agentExemplars, runExemplars, toolExemplars] = await Promise.all([
		getAgentCostExemplars(db, projectId, windowHours, agentKeys),
		getRunCostExemplars(db, projectId, windowHours, runKeys),
		getToolCostExemplars(db, projectId, windowHours, toolKeys),
	]);

	return {
		projectId,
		windowHours,
		byAgent: costRows("agent", agentRows.results, agentExemplars),
		byRun: costRows("run", runRows.results, runExemplars),
		byModel,
		byProvider,
		byPromptVersion,
		byTool: costRows("tool", toolRows.results, toolExemplars),
		byUser,
		byTenant,
		byWorkflow,
		generatedAt: new Date().toISOString(),
	};
};

export const getAutonomousReviewAggregates = async (
	db: SqlDb,
	projectId: string,
	windowHours: number,
	limit: number,
): Promise<AutonomousReviewResult> => {
	const dialect = dialectFor(db);
	const since = dialect.sinceHours("?");
	const rows = await db
		.prepare(`
			SELECT
				t.id,
				t.tool_name,
				t.action_id,
				a.name AS action_name,
				COALESCE(a.agent_run_id, a.root_action_id) AS agent_run_id,
				ar.agent_name,
				ar.agent_version,
				COALESCE(ar.autonomy_level, 'autonomous_write') AS autonomy_level,
				t.side_effect,
				COALESCE(t.approval_state, 'suggested') AS approval_state,
				COALESCE(a.status, 'ok') AS status,
				t.error_type AS error_snippet,
				COALESCE(a.trace_id, root.trace_id) AS trace_id,
				COALESCE(a.started_at, root.started_at) AS occurred_at,
				CASE
					WHEN t.mutation_before_json IS NOT NULL
						OR t.mutation_after_json IS NOT NULL
						OR t.mutation_diff_json IS NOT NULL
						OR t.mutation_artifact_id IS NOT NULL
					THEN 1 ELSE 0
				END AS mutation_evidence,
				t.mutation_artifact_id
			FROM tool_calls t
			LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
			LEFT JOIN actions root ON root.project_id = t.project_id AND root.id = a.root_action_id
			LEFT JOIN agent_runs ar ON ar.project_id = t.project_id AND ar.id = COALESCE(a.agent_run_id, a.root_action_id)
			WHERE t.project_id = ?
				AND t.side_effect <> 0
				AND COALESCE(ar.autonomy_level, '') = 'autonomous_write'
				AND (a.started_at IS NULL OR a.started_at >= ${since})
			ORDER BY occurred_at DESC
			LIMIT ?
		`)
		.bind(projectId, windowHours, limit)
		.all<AutonomousReviewSqlRow>();

	return {
		projectId,
		windowHours,
		rows: rows.results.map((row) => ({
			id: row.id,
			toolName: row.tool_name,
			actionId: row.action_id,
			actionName: row.action_name ?? row.tool_name,
			agentRunId: row.agent_run_id ?? "",
			agentName: row.agent_name ?? "Unknown agent",
			agentVersion: row.agent_version ?? "unknown",
			autonomyLevel: row.autonomy_level ?? "autonomous_write",
			sideEffect: row.side_effect !== 0,
			approvalState: row.approval_state ?? "suggested",
			status: row.status === "error" ? "error" : "ok",
			errorSnippet: row.error_snippet,
			traceId: row.trace_id ?? "",
			occurredAt: row.occurred_at ?? new Date(0).toISOString(),
			mutationEvidence: row.mutation_evidence !== 0,
			mutationArtifactId: row.mutation_artifact_id ?? null,
		})),
		timestamp: new Date().toISOString(),
	};
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const directionForHigherBetter = (
	baseline: number,
	target: number,
): "positive" | "negative" | "neutral" =>
	target === baseline ? "neutral" : target > baseline ? "positive" : "negative";
const directionForLowerBetter = (
	baseline: number,
	target: number,
): "positive" | "negative" | "neutral" =>
	target === baseline ? "neutral" : target < baseline ? "positive" : "negative";

const getVersionExemplars = async (
	db: SqlDb,
	projectId: string,
	version: string,
): Promise<ActionAggregateExemplar[]> => {
	if (!version || version === "unknown") return [];
	const rows = await db
		.prepare(`
			SELECT
				root.id AS action_id,
				ar.id AS agent_run_id,
				root.trace_id,
				root.tool_call_id,
				er.id AS eval_id,
				ar.agent_name AS label,
				ar.status,
				root.started_at AS occurred_at
			FROM agent_runs ar
			LEFT JOIN actions root ON root.project_id = ar.project_id AND root.id = ar.id
			LEFT JOIN eval_results er ON er.project_id = ar.project_id AND er.action_id = root.id
			WHERE ar.project_id = ? AND ar.agent_version = ?
			ORDER BY
				CASE WHEN ar.status <> 'success' THEN 0 ELSE 1 END,
				root.started_at DESC
			LIMIT ?
		`)
		.bind(projectId, version, EXEMPLAR_LIMIT)
		.all<ExemplarSqlRow>();
	return exemplarsFromRows(rows.results);
};

export const getVersionDiffAggregates = async (
	db: SqlDb,
	projectId: string,
	baselineVersion?: string,
	targetVersion?: string,
): Promise<VersionComparisonResult> => {
	const rows = await db
		.prepare(`
			SELECT
				ar.agent_version AS version,
				COUNT(DISTINCT ar.id) AS run_count,
				SUM(CASE WHEN ar.status = 'success' THEN 1 ELSE 0 END) AS success_count,
				AVG(ar.total_duration_ms) AS avg_duration_ms,
				AVG(ar.total_cost_usd) AS avg_cost_usd,
				COUNT(er.id) AS eval_count,
				SUM(CASE WHEN er.passed <> 0 THEN 1 ELSE 0 END) AS passed_eval_count,
				AVG(er.score) AS avg_eval_score,
				COUNT(t.id) AS tool_count,
				SUM(CASE WHEN t.error_type IS NOT NULL AND t.error_type <> '' THEN 1 ELSE 0 END) AS tool_error_count
			FROM agent_runs ar
			LEFT JOIN actions a ON a.project_id = ar.project_id AND a.agent_run_id = ar.id
			LEFT JOIN eval_results er ON er.project_id = ar.project_id AND er.action_id = a.id
			LEFT JOIN tool_calls t ON t.project_id = ar.project_id AND t.action_id = a.id
			WHERE ar.project_id = ?
			GROUP BY ar.agent_version
			ORDER BY MAX(COALESCE(a.started_at, '')) DESC, ar.agent_version DESC
			LIMIT 20
		`)
		.bind(projectId)
		.all<VersionStatsRow>();

	const versions = rows.results.filter((row) => row.version);
	const baseline =
		versions.find((row) => row.version === baselineVersion) ??
		versions[1] ??
		versions[0];
	const target =
		versions.find((row) => row.version === targetVersion) ??
		versions[0] ??
		baseline;

	const metric = (
		label: string,
		baselineValue: number,
		targetValue: number,
		format: (value: number) => string | number,
		direction: "higher" | "lower",
	): VersionDiffMetric => ({
		label,
		baselineValue: format(baselineValue),
		targetValue: format(targetValue),
		deltaValue:
			typeof format(targetValue - baselineValue) === "number"
				? format(targetValue - baselineValue)
				: `${targetValue - baselineValue >= 0 ? "+" : ""}${format(targetValue - baselineValue)}`,
		deltaDirection:
			direction === "higher"
				? directionForHigherBetter(baselineValue, targetValue)
				: directionForLowerBetter(baselineValue, targetValue),
	});

	const empty = {
		version: "unknown",
		run_count: 0,
		success_count: 0,
		avg_duration_ms: 0,
		avg_cost_usd: 0,
		eval_count: 0,
		passed_eval_count: 0,
		avg_eval_score: 0,
		tool_count: 0,
		tool_error_count: 0,
	} satisfies VersionStatsRow;
	const b = baseline ?? empty;
	const t = target ?? empty;
	const bRuns = toNumber(b.run_count);
	const tRuns = toNumber(t.run_count);
	const bTools = toNumber(b.tool_count);
	const tTools = toNumber(t.tool_count);
	const bEvals = toNumber(b.eval_count);
	const tEvals = toNumber(t.eval_count);
	const [baselineExemplars, targetExemplars] = await Promise.all([
		getVersionExemplars(db, projectId, b.version),
		getVersionExemplars(db, projectId, t.version),
	]);

	return {
		projectId,
		baselineVersion: b.version,
		targetVersion: t.version,
		metrics: [
			metric(
				"Success Rate",
				bRuns > 0 ? toNumber(b.success_count) / bRuns : 0,
				tRuns > 0 ? toNumber(t.success_count) / tRuns : 0,
				formatPercent,
				"higher",
			),
			metric(
				"Evaluation Score",
				toNumber(b.avg_eval_score),
				toNumber(t.avg_eval_score),
				(value) => value.toFixed(2),
				"higher",
			),
			metric(
				"Evaluation Pass Rate",
				bEvals > 0 ? toNumber(b.passed_eval_count) / bEvals : 0,
				tEvals > 0 ? toNumber(t.passed_eval_count) / tEvals : 0,
				formatPercent,
				"higher",
			),
			metric(
				"Average Run Latency",
				toNumber(b.avg_duration_ms),
				toNumber(t.avg_duration_ms),
				(value) => `${Math.round(value)}ms`,
				"lower",
			),
			metric(
				"Average Run Cost",
				toNumber(b.avg_cost_usd),
				toNumber(t.avg_cost_usd),
				(value) => `$${value.toFixed(4)}`,
				"lower",
			),
			metric(
				"Tool Error Rate",
				bTools > 0 ? toNumber(b.tool_error_count) / bTools : 0,
				tTools > 0 ? toNumber(t.tool_error_count) / tTools : 0,
				formatPercent,
				"lower",
			),
		],
		baselineExemplars,
		targetExemplars,
		timestamp: new Date().toISOString(),
	};
};
