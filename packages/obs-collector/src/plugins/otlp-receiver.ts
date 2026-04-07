/** Union: A's JSON error handling, payload size limit, env-based retention */

import type { OtlpTraceExportRequest } from "@obs/types";
import { getConfiguredRetentionHours } from "@obs/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { toStoredSpans } from "../lib/otlp";

export const otlpReceiverPlugin: CollectorPlugin = {
	name: "otlp-http-receiver",
	register(app, runtime) {
		app.post("/v1/traces", async (c) => {
			const routeContext = runtime.createRouteContext(c.env, c);
			let payload: OtlpTraceExportRequest;
			try {
				payload = await c.req.json<OtlpTraceExportRequest>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			const resourceSpans = payload.resourceSpans ?? [];
			const spanCount = resourceSpans.reduce(
				(total, rs) =>
					total +
					(rs.scopeSpans ?? []).reduce(
						(sum, ss) => sum + (ss.spans ?? []).length,
						0,
					),
				0,
			);
			if (spanCount > 500) {
				return c.json(
					{ error: `Payload too large: ${spanCount} spans (max 500)` },
					413,
				);
			}
			const parsedSpans = toStoredSpans(
				payload,
				routeContext.now,
				getConfiguredRetentionHours(c.env.RETENTION_HOURS),
			);
			const spans = await runtime.runSpanProcessors(parsedSpans, routeContext);
			const store = runtime.createStore(c.env);
			const result = await store.ingest(spans);

			return c.json(
				{
					success: true,
					inserted: result.inserted,
					traceCount: result.traceCount,
					processorCount: runtime.getRegisteredPluginNames().length,
					timestamp: new Date().toISOString(),
				},
				202,
			);
		});
	},
};
