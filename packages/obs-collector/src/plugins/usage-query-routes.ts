import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obs/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { getProjectId } from "./_context";

export const usageQueryRoutesPlugin: CollectorPlugin = {
	name: "usage-query-routes",
	register(app, runtime) {
		app.get("/internal/usage/overview", async (c) => {
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

			const store = runtime.createUsageStore(c.env);
			const overview = await store.getOverview({
				projectId,
				hours,
				path: c.req.query("path") || undefined,
				includeAdmin: c.req.query("includeAdmin") === "true",
			});
			return c.json({
				...overview,
				plugins: runtime.getRegisteredPluginNames(),
			});
		});

		app.get("/internal/usage/sessions/:sessionId", async (c) => {
			const projectId = getProjectId(c);
			const store = runtime.createUsageStore(c.env);
			const detail = await store.getSessionDetail(
				c.req.param("sessionId"),
				projectId,
			);
			if (!detail)
				return c.json(
					{ error: "Not Found", message: "Session not found" },
					404,
				);
			return c.json({ ...detail, plugins: runtime.getRegisteredPluginNames() });
		});
	},
};
