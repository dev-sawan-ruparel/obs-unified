/**
 * RFC 0002 Stage 1 — read-only HTTP surface for application-aware Analyses.
 *
 *   GET /internal/analyses               — list registered definitions
 *   GET /internal/analyses/:id/result    — definition + latest result (404 if unknown id)
 *   GET /internal/analyses/results       — bulk: every definition + its latest result
 *
 * Writes happen via the scheduled handler (see analyses-runner.ts), not
 * here — the dashboard is read-only against this surface in Stage 1.
 */

import type {
	AnalysesListResponse,
	AnalysisResultResponse,
	AnalysisResultsBulkResponse,
} from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { AnalysesStore } from "../lib/analyses-store";
import { getProjectId } from "./_context";

export const analysesRoutesPlugin: CollectorPlugin = {
	name: "analyses-routes",
	register(app, _runtime) {
		app.get("/internal/analyses", async (c) => {
			const projectId = getProjectId(c);
			const store = new AnalysesStore(c.env.DB);
			const analyses = await store.listDefinitions(projectId);
			const response: AnalysesListResponse = {
				analyses,
				timestamp: new Date().toISOString(),
			};
			return c.json(response);
		});

		app.get("/internal/analyses/results", async (c) => {
			const projectId = getProjectId(c);
			const store = new AnalysesStore(c.env.DB);
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

		app.get("/internal/analyses/:id/result", async (c) => {
			const projectId = getProjectId(c);
			const id = c.req.param("id");
			if (!id) {
				return c.json(
					{ error: "Bad Request", message: "id is required" },
					400,
				);
			}
			const store = new AnalysesStore(c.env.DB);
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
