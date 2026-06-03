import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obs-unified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import {
	getAutonomousReviewAggregates,
	getCostAttributionAggregates,
	getToolReliabilityAggregates,
	getVersionDiffAggregates,
} from "../lib/action-aggregates";
import type {
	ActionRef,
	EntityManifestExtended,
	EvalResultRef,
	ToolCallRef,
} from "../lib/identity-index";
import { IdentityIndex } from "../lib/identity-index";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

const parsePositiveInt = (
	raw: string | undefined,
	fallback: number,
	min: number,
	max: number,
): number => {
	const parsed = Number.parseInt(raw ?? "", 10);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, parsed));
};

const parseWindowHours = (
	raw: string | undefined,
	retentionHours: string | undefined,
): number => {
	const maxHours = getConfiguredRetentionHours(retentionHours);
	return parsePositiveInt(raw, DEFAULT_WINDOW_HOURS, 1, maxHours);
};

interface CompareStep {
	key: string;
	index: number;
	actionId: string;
	parentActionId: string | null;
	actionKind: string;
	name: string | null;
	status: string;
	durationMs: number | null;
	totalCostUsd: number | null;
	toolName: string | null;
	toolCallId: string | null;
	evalPassed: boolean | null;
	evalScore: number | null;
	traceId: string | null;
	spanId: string | null;
	causalConfidence?: string;
}

const sortActionSteps = (actions: ActionRef[]): ActionRef[] =>
	[...actions].sort((a, b) => {
		const time = a.startedAt.localeCompare(b.startedAt);
		if (time !== 0) return time;
		return a.id.localeCompare(b.id);
	});

const stepBaseKey = (
	action: ActionRef,
	tool: ToolCallRef | undefined,
): string => {
	const name = tool?.toolName ?? action.stepId ?? action.name ?? "unnamed";
	return `${action.actionKind}:${name}`.toLowerCase();
};

const buildCompareSteps = (manifest: EntityManifestExtended): CompareStep[] => {
	const toolsByAction = new Map<string, ToolCallRef[]>();
	for (const tool of manifest.toolCalls) {
		const tools = toolsByAction.get(tool.actionId) ?? [];
		tools.push(tool);
		toolsByAction.set(tool.actionId, tools);
	}

	const evalsByAction = new Map<string, EvalResultRef[]>();
	for (const evalResult of manifest.evalResults) {
		const evals = evalsByAction.get(evalResult.actionId) ?? [];
		evals.push(evalResult);
		evalsByAction.set(evalResult.actionId, evals);
	}

	const seen = new Map<string, number>();
	return sortActionSteps(manifest.actions).map((action, index) => {
		const tool = toolsByAction.get(action.id)?.[0];
		const evalResult = evalsByAction.get(action.id)?.[0];
		const baseKey = stepBaseKey(action, tool);
		const count = seen.get(baseKey) ?? 0;
		seen.set(baseKey, count + 1);
		return {
			key: `${baseKey}#${count}`,
			index,
			actionId: action.id,
			parentActionId: action.causedByActionId,
			actionKind: action.actionKind,
			name: action.name,
			status: action.status,
			durationMs: action.durationMs,
			totalCostUsd: action.totalCostUsd,
			toolName: tool?.toolName ?? null,
			toolCallId: tool?.id ?? action.toolCallId,
			evalPassed: evalResult ? evalResult.passed !== 0 : null,
			evalScore: evalResult?.score ?? null,
			traceId: action.traceId,
			spanId: action.spanId,
			causalConfidence: action.causalConfidence,
		};
	});
};

const changedFields = (left: CompareStep, right: CompareStep): string[] => {
	const fields: (keyof CompareStep)[] = [
		"parentActionId",
		"actionKind",
		"name",
		"status",
		"durationMs",
		"totalCostUsd",
		"toolName",
		"evalPassed",
		"evalScore",
		"traceId",
		"causalConfidence",
	];
	return fields.filter((field) => left[field] !== right[field]);
};

const compareStepSequences = (
	leftSteps: CompareStep[],
	rightSteps: CompareStep[],
) => {
	const leftByKey = new Map(leftSteps.map((step) => [step.key, step]));
	const rightByKey = new Map(rightSteps.map((step) => [step.key, step]));
	const keys = Array.from(new Set([...leftByKey.keys(), ...rightByKey.keys()]));
	return keys.map((key) => {
		const left = leftByKey.get(key) ?? null;
		const right = rightByKey.get(key) ?? null;
		const fields = left && right ? changedFields(left, right) : [];
		return {
			key,
			changeType:
				left && right
					? fields.length > 0
						? "changed"
						: "same"
					: left
						? "removed"
						: "added",
			changedFields: fields,
			left,
			right,
		};
	});
};

const manifestForComparableId = async (
	index: IdentityIndex,
	projectId: string,
	id: string,
): Promise<EntityManifestExtended> => {
	const byAction = await index.byAction(projectId, id);
	if (byAction.actions.some((action) => action.id === id)) return byAction;
	return index.byAgentRun(projectId, id);
};

export const actionRoutesPlugin: CollectorPlugin = {
	name: "action-routes",
	register(app) {
		app.get("/internal/actions/aggregates/tool-reliability", async (c) => {
			const projectId = getProjectId(c);
			const hours = parseWindowHours(
				c.req.query("hours"),
				c.env.RETENTION_HOURS,
			);
			const limit = parsePositiveInt(c.req.query("limit"), 20, 1, 100);
			const result = await getToolReliabilityAggregates(
				sqlDbFor(c.env),
				projectId,
				hours,
				limit,
			);
			return c.json(result);
		});

		app.get("/internal/actions/aggregates/cost-attribution", async (c) => {
			const projectId = getProjectId(c);
			const hours = parseWindowHours(
				c.req.query("hours"),
				c.env.RETENTION_HOURS,
			);
			const limit = parsePositiveInt(c.req.query("limit"), 20, 1, 100);
			const result = await getCostAttributionAggregates(
				sqlDbFor(c.env),
				projectId,
				hours,
				limit,
			);
			return c.json(result);
		});

		app.get("/internal/actions/aggregates/autonomous-review", async (c) => {
			const projectId = getProjectId(c);
			const hours = parseWindowHours(
				c.req.query("hours"),
				c.env.RETENTION_HOURS,
			);
			const limit = parsePositiveInt(c.req.query("limit"), 50, 1, 200);
			const result = await getAutonomousReviewAggregates(
				sqlDbFor(c.env),
				projectId,
				hours,
				limit,
			);
			return c.json(result);
		});

		app.get("/internal/actions/aggregates/version-diff", async (c) => {
			const projectId = getProjectId(c);
			const result = await getVersionDiffAggregates(
				sqlDbFor(c.env),
				projectId,
				c.req.query("baseline"),
				c.req.query("target"),
			);
			return c.json(result);
		});

		app.get("/internal/actions/compare", async (c) => {
			const projectId = getProjectId(c);
			const leftId = c.req.query("left");
			const rightId = c.req.query("right");
			if (!leftId || !rightId) {
				return c.json(
					{ error: "left and right query parameters required" },
					400,
				);
			}

			const index = new IdentityIndex(sqlDbFor(c.env));
			const [leftManifest, rightManifest] = await Promise.all([
				manifestForComparableId(index, projectId, leftId),
				manifestForComparableId(index, projectId, rightId),
			]);
			const leftSteps = buildCompareSteps(leftManifest);
			const rightSteps = buildCompareSteps(rightManifest);

			if (leftSteps.length === 0 || rightSteps.length === 0) {
				return c.json(
					{
						error: "Not Found",
						message: "Both comparable action graphs must exist",
					},
					404,
				);
			}

			return c.json({
				projectId,
				leftId,
				rightId,
				leftManifest,
				rightManifest,
				leftSteps,
				rightSteps,
				stepComparisons: compareStepSequences(leftSteps, rightSteps),
				generatedAt: new Date().toISOString(),
			});
		});

		app.get("/internal/actions/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) return c.json({ error: "id required" }, 400);

			const index = new IdentityIndex(sqlDbFor(c.env));
			const manifest = await index.byAction(projectId, id);
			const action = manifest.actions.find((a) => a.id === id);
			if (!action) {
				return c.json({ error: "Not Found", message: "Action not found" }, 404);
			}

			return c.json({ action, manifest });
		});

		app.get("/internal/agent-runs/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) return c.json({ error: "id required" }, 400);

			const index = new IdentityIndex(sqlDbFor(c.env));
			const manifest = await index.byAgentRun(projectId, id);
			const agentRun = manifest.agentRuns.find((r) => r.id === id);
			if (!agentRun) {
				return c.json(
					{ error: "Not Found", message: "Agent run not found" },
					404,
				);
			}

			return c.json({ agentRun, manifest });
		});

		app.get("/internal/tool-calls/:id", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) return c.json({ error: "id required" }, 400);

			const db = sqlDbFor(c.env);
			const toolCallRow = await db
				.prepare(
					`SELECT action_id FROM tool_calls
						WHERE project_id = ? AND id = ? LIMIT 1`,
				)
				.bind(projectId, id)
				.first<{ action_id: string }>();
			if (!toolCallRow) {
				return c.json(
					{ error: "Not Found", message: "Tool call not found" },
					404,
				);
			}

			const index = new IdentityIndex(db);
			const manifest = await index.byAction(projectId, toolCallRow.action_id);
			const toolCall = manifest.toolCalls.find((t) => t.id === id);
			if (!toolCall) {
				return c.json(
					{ error: "Not Found", message: "Tool call not found" },
					404,
				);
			}

			return c.json({ toolCall, manifest });
		});
	},
};
