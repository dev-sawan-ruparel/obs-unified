/** Union: A's env-based retention + D's search param + D's export endpoint */
import {
	DEFAULT_WINDOW_HOURS,
	getConfiguredRetentionHours,
} from "@obsunified/types/constants";
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

		app.get("/internal/telemetry/service-map", async (c) => {
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
			const store = runtime.createStore(c.env);
			// RFC 0009 — `?source=sdk|ebpf|all` toggles which spans
			// contribute. Default is `all` so existing dashboards see
			// every edge. The dashboard's service-map view exposes the
			// filter as a UI toggle.
			const sourceParam = c.req.query("source");
			const source: "all" | "sdk" | "ebpf" =
				sourceParam === "sdk" || sourceParam === "ebpf" ? sourceParam : "all";
			const map = await store.getServiceMap({ projectId, hours, source });
			return c.json({
				...map,
				windowHours: hours,
				source,
				timestamp: new Date().toISOString(),
			});
		});

		app.get("/internal/telemetry/services/:service/operations", async (c) => {
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
			const service = c.req.param("service");
			if (!service) {
				return c.json(
					{ error: "Bad Request", message: "service is required" },
					400,
				);
			}
			const store = runtime.createStore(c.env);
			const result = await store.getServiceOperations({
				projectId,
				service,
				hours,
			});
			return c.json({
				...result,
				windowHours: hours,
				timestamp: new Date().toISOString(),
			});
		});

		app.get("/internal/telemetry/traces/:traceId", async (c) => {
			const projectId = getProjectId(c);
			const traceId = c.req.param("traceId");
			const store = runtime.createStore(c.env);
			// A `query.trace_detail` span = a trace was viewed. Counting these
			// against `traces.ingest`'s trace_count gives the read/write ratio
			// (Q3); span duration captures end-to-end read latency (Q1).
			const detail = await runtime.withChildSpan(
				"query.trace_detail",
				async (span) => {
					span.setAttribute("project.id", projectId);
					span.setAttribute("trace.id", traceId);
					const result = await store.getTraceDetail(traceId, projectId);
					span.setAttribute("query.found", result !== null);
					span.setAttribute("query.span_count", result?.spans.length ?? 0);
					return result;
				},
			);
			if (!detail)
				return c.json({ error: "Not Found", message: "Trace not found" }, 404);
			return c.json({ ...detail, plugins: runtime.getRegisteredPluginNames() });
		});

		app.get("/internal/telemetry/traces/:traceId/gaps", async (c) => {
			const projectId = getProjectId(c);
			const traceId = c.req.param("traceId");
			const store = runtime.createStore(c.env);
			// `query.trace_gaps` span duration is the read-time gap computation
			// cost end-to-end (project-scoped span SELECT + compute) — the
			// DB-inclusive half of Q1 that the pure-compute benchmark omits.
			const gaps = await runtime.withChildSpan(
				"query.trace_gaps",
				async (span) => {
					span.setAttribute("project.id", projectId);
					span.setAttribute("trace.id", traceId);
					const result = await store.getTraceGaps(traceId, projectId);
					span.setAttribute("query.found", result !== null);
					span.setAttribute(
						"query.blindspot_count",
						result?.blindspots.length ?? 0,
					);
					return result;
				},
			);
			if (!gaps)
				return c.json(
					{ error: "Not Found", message: "Trace gaps not found" },
					404,
				);
			return c.json(gaps);
		});

		app.get(
			"/internal/telemetry/instrumentation-gaps/calibration",
			async (c) => {
				const projectId = getProjectId(c);
				const maxHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
				const hours = Math.min(
					maxHours,
					Math.max(1, Number.parseInt(c.req.query("hours") || "72", 10) || 72),
				);
				const limit =
					Number.parseInt(c.req.query("limit") || "5000", 10) || 5000;
				const store = runtime.createStore(c.env);
				const calibration = await store.calibrateTraceGaps({
					projectId,
					hours,
					limit,
				});
				return c.json(calibration);
			},
		);

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
