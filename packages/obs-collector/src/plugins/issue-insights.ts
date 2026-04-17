import {
	DEFAULT_WINDOW_HOURS,
	MAX_ISSUE_ROWS,
	RETENTION_HOURS,
} from "@obs/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { getProjectId } from "./_context";

const parseHours = (rawValue?: string): number =>
	Math.min(
		RETENTION_HOURS,
		Math.max(
			1,
			Number.parseInt(rawValue || String(DEFAULT_WINDOW_HOURS), 10) ||
				DEFAULT_WINDOW_HOURS,
		),
	);

const parseLimit = (rawValue?: string): number =>
	Math.min(
		MAX_ISSUE_ROWS,
		Math.max(
			1,
			Number.parseInt(rawValue || String(MAX_ISSUE_ROWS), 10) || MAX_ISSUE_ROWS,
		),
	);

export const issueInsightsPlugin: CollectorPlugin = {
	name: "issue-insights",
	register(app, runtime) {
		app.get("/internal/telemetry/issues", async (c) => {
			const projectId = getProjectId(c);
			const store = runtime.createStore(c.env);
			const overview = await store.getIssueOverview({
				projectId,
				hours: parseHours(c.req.query("hours")),
				service: c.req.query("service") || undefined,
				category:
					c.req.query("category") === "error" ||
					c.req.query("category") === "latency" ||
					c.req.query("category") === "dependency"
						? (c.req.query("category") as "error" | "latency" | "dependency")
						: "all",
				includeInternal: c.req.query("includeInternal") === "true",
				limit: parseLimit(c.req.query("limit")),
			});
			return c.json({
				...overview,
				plugins: runtime.getRegisteredPluginNames(),
			});
		});

		app.get("/internal/telemetry/issues/detail", async (c) => {
			const issueId = c.req.query("issueId");
			if (!issueId)
				return c.json(
					{ error: "Bad Request", message: "issueId is required" },
					400,
				);

			const projectId = getProjectId(c);
			const store = runtime.createStore(c.env);
			const detail = await store.getIssueDetail(issueId, {
				projectId,
				hours: parseHours(c.req.query("hours")),
				service: c.req.query("service") || undefined,
				category:
					c.req.query("category") === "error" ||
					c.req.query("category") === "latency" ||
					c.req.query("category") === "dependency"
						? (c.req.query("category") as "error" | "latency" | "dependency")
						: "all",
				includeInternal: c.req.query("includeInternal") === "true",
			});

			if (!detail)
				return c.json({ error: "Not Found", message: "Issue not found" }, 404);
			return c.json({ ...detail, plugins: runtime.getRegisteredPluginNames() });
		});
	},
};
