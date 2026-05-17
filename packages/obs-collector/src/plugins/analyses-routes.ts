/**
 * RFC 0002 — HTTP surface for application-aware Analyses.
 *
 *   GET  /internal/analyses               — list registered definitions
 *   GET  /internal/analyses/:id/result    — definition + latest result
 *   GET  /internal/analyses/results       — bulk: every definition + latest
 *   POST /internal/analyses/:id/run       — Stage 4: on-demand re-run for
 *                                            view: "page" investigations
 *
 * Cron writes happen via the scheduled handler (see analyses-runner.ts).
 * The on-demand POST exists so an investigation page's [Re-run] button
 * doesn't have to wait for the next 5-min tick.
 */

import { getConfiguredRetentionHours } from "@obs-unified/types/constants";
import type {
	AnalysesListResponse,
	AnalysisResultResponse,
	AnalysisResultsBulkResponse,
} from "@obs-unified/types";
import type { CollectorPlugin } from "../framework/collector";
import { AnalysesStore } from "../lib/analyses-store";
import { runSqlAnalysis } from "../lib/analyses-runner";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export const analysesRoutesPlugin: CollectorPlugin = {
	name: "analyses-routes",
	register(app, runtime) {
		app.get("/internal/analyses", async (c) => {
			const projectId = getProjectId(c);
			const store = new AnalysesStore(sqlDbFor(c.env));
			const analyses = await store.listDefinitions(projectId);
			const response: AnalysesListResponse = {
				analyses,
				timestamp: new Date().toISOString(),
			};
			return c.json(response);
		});

		app.get("/internal/analyses/results", async (c) => {
			const projectId = getProjectId(c);
			const store = new AnalysesStore(sqlDbFor(c.env));
			const definitions = await store.listDefinitions(projectId);
			const ids = definitions.map((def) => def.id);
			const latest = await store.getLatestResultsBulk(projectId, ids);
			const response: AnalysisResultsBulkResponse = {
				results: definitions.map((definition) => ({
					definition,
					result: latest.get(definition.id) ?? null,
				})),
				timestamp: new Date().toISOString(),
			};
			return c.json(response);
		});

		// Stage 4 [Re-run] target. Re-executes the SQL right now and persists
		// the new result. We deliberately keep this narrow:
		//   - only `view: "page"` definitions (tile cron is fast enough)
		//   - no narrate pass on the on-demand path; the page UI uses the most
		//     recent narrative from the cron tick (cheaper, avoids surprise
		//     LLM calls from a button click)
		app.post("/internal/analyses/:id/run", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) {
				return c.json(
					{ error: "Bad Request", message: "id is required" },
					400,
				);
			}
			const store = new AnalysesStore(sqlDbFor(c.env));
			const definitions = await store.listDefinitions(projectId);
			const definition = definitions.find((def) => def.id === id);
			if (!definition) {
				return c.json(
					{ error: "Not Found", message: `Analysis ${id} not found` },
					404,
				);
			}
			if (definition.view !== "page") {
				return c.json(
					{
						error: "Bad Request",
						message: "on-demand run only supported for view=page analyses",
					},
					400,
				);
			}
			const retentionHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const expiresAt = Date.now() + retentionHours * 3600 * 1000;
			try {
				const result = await runSqlAnalysis(definition, {
					db: sqlDbFor(c.env),
					projectId,
					retentionHours,
				});
				await store.insertResult(result, expiresAt);
				await store.markRan(projectId, definition.id, result.generatedAt);
				const response: AnalysisResultResponse = {
					definition,
					result,
					timestamp: new Date().toISOString(),
				};
				return c.json(response);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				runtime.logger.error("[analyses] on-demand run failed", {
					analysis_id: id,
					project_id: projectId,
					error: message,
				});
				return c.json(
					{ error: "Internal Server Error", message },
					500,
				);
			}
		});

		app.get("/internal/analyses/:id/result", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) {
				return c.json(
					{ error: "Bad Request", message: "id is required" },
					400,
				);
			}
			const store = new AnalysesStore(sqlDbFor(c.env));
			const definitions = await store.listDefinitions(projectId);
			const definition = definitions.find((def) => def.id === id);
			if (!definition) {
				return c.json(
					{ error: "Not Found", message: `Analysis ${id} not found` },
					404,
				);
			}
			const result = await store.getLatestResult(projectId, id);
			const response: AnalysisResultResponse = {
				definition,
				result,
				timestamp: new Date().toISOString(),
			};
			return c.json(response);
		});
	},
};
