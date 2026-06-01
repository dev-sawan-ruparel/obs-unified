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
