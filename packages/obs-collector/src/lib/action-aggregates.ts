import type { SqlDb } from "./sql-db";
import { dialectFor } from "./sql-db";

const TOP_CAUSERS_LIMIT = 5;

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
}

interface CostRow {
	key: string | null;
	label: string | null;
	total_cost_usd: number | null;
	action_count: number | null;
	agent_run_count: number | null;
	tool_call_count: number | null;
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

const costRows = (dimension: string, rows: CostRow[]): CostAttributionRow[] =>
	rows.map((row) => ({
		dimension,
		key: row.key,
		label: row.label,
		totalCostUsd: toNumber(row.total_cost_usd),
		actionCount: toNumber(row.action_count),
		agentRunCount: toNumber(row.agent_run_count),
		toolCallCount: toNumber(row.tool_call_count),
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
				${workflowIdExpr} AS workflow_label
			FROM tool_calls t
			LEFT JOIN actions a ON a.project_id = t.project_id AND a.id = t.action_id
			LEFT JOIN actions root ON root.project_id = t.project_id AND root.id = a.root_action_id
			LEFT JOIN agent_runs ar ON ar.project_id = t.project_id AND ar.id = COALESCE(a.agent_run_id, a.root_action_id)
			WHERE t.project_id = ?
				AND (a.started_at IS NULL OR a.started_at >= ${since})
				AND t.tool_name IN (${inClause(toolNames)})
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
	return costRows(dimension, rows.results);
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

	return {
		projectId,
		windowHours,
		byAgent: costRows("agent", agentRows.results),
		byRun: costRows("run", runRows.results),
		byModel,
		byProvider,
		byPromptVersion,
		byTool: costRows("tool", toolRows.results),
		byUser,
		byTenant,
		byWorkflow,
		generatedAt: new Date().toISOString(),
	};
};
