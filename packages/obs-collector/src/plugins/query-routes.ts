/** Union: A's env-based retention + D's search param + D's export endpoint */
import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obs/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { getProjectId } from "./_context";

export const queryRoutesPlugin: CollectorPlugin = {
	name: "query-routes",
	register(app, runtime) {
		app.get("/internal/telemetry/overview", async (c) => {
			const projectId = getProjectId(c);
			const maxHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const hours = Math.min(
				maxHours,
				Math.max(
					1,
					Number.parseInt(
						c.req.query("hours") || String(DEFAULT_WINDOW_HOURS),
						10,
					) || DEFAULT_WINDOW_HOURS,
				),
			);
			const service = c.req.query("service") || undefined;
			const statusParam = c.req.query("status");
			const status =
				statusParam === "ok" || statusParam === "error" ? statusParam : "all";
			const limit = Number.parseInt(c.req.query("limit") || "30", 10) || 30;
			const search = c.req.query("q")?.trim() || undefined;

			const store = runtime.createStore(c.env);
			const overview = await store.getOverview({
				projectId,
				hours,
				service,
				status,
				limit,
				search,
			});
			return c.json({
				...overview,
				plugins: runtime.getRegisteredPluginNames(),
			});
		});

		app.get("/internal/telemetry/traces/:traceId", async (c) => {
			const projectId = getProjectId(c);
			const store = runtime.createStore(c.env);
			const detail = await store.getTraceDetail(c.req.param("traceId"), projectId);
			if (!detail)
				return c.json({ error: "Not Found", message: "Trace not found" }, 404);
			return c.json({ ...detail, plugins: runtime.getRegisteredPluginNames() });
		});

		// NDJSON export (from D)
		app.get("/internal/telemetry/export", async (c) => {
			const projectId = getProjectId(c);
			const maxHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const hours = Math.min(
				maxHours,
				Math.max(
					1,
					Number.parseInt(
						c.req.query("hours") || String(DEFAULT_WINDOW_HOURS),
						10,
					) || DEFAULT_WINDOW_HOURS,
				),
			);
			const service = c.req.query("service") || undefined;
			const statusParam = c.req.query("status");
			const status =
				statusParam === "ok" || statusParam === "error" ? statusParam : "all";
			const search = c.req.query("q")?.trim() || undefined;

			const store = runtime.createStore(c.env);
			const ndjson = await store.getExportRows({
				projectId,
				hours,
				service,
				status,
				search,
			});

			return new Response(ndjson, {
				headers: {
					"content-type": "application/x-ndjson; charset=utf-8",
					"content-disposition": `attachment; filename="telemetry-export-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.jsonl"`,
				},
			});
		});
	},
};
