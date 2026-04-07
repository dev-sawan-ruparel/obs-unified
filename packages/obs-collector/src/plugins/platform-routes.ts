import { Hono } from "hono";
import type { CollectorPlugin } from "../framework/collector";

export const platformRoutesPlugin: CollectorPlugin = {
	name: "platform-routes",
	register(app) {
		app.get("/v1/query/platform/resources", async (c) => {
			const db = c.env.DB;
			
			const eventsCount = await db.prepare("SELECT COUNT(*) as c FROM usage_events").first<{c: number}>();
			const tracesCount = await db.prepare("SELECT COUNT(*) as c FROM telemetry_spans").first<{c: number}>();
			const logsCount = await db.prepare("SELECT COUNT(*) as c FROM logs").first<{c: number}>();
			const aiCallsCount = await db.prepare("SELECT COUNT(*) as c FROM ai_calls").first<{c: number}>();
			
			const d1RowDensity = (eventsCount?.c || 0) + (tracesCount?.c || 0) + (logsCount?.c || 0) + (aiCallsCount?.c || 0);

			let r2StorageBytes = 0;
			try {
				const r2Info = await db.prepare("SELECT SUM(storage_bytes) as s FROM session_replay_metadata").first<{s: number}>();
				if (r2Info?.s) {
					r2StorageBytes = r2Info.s;
				} else {
					// Check for historical size estimate
					const fallbackInfo = await db.prepare("SELECT SUM(events_count) as s FROM session_replay_metadata").first<{s: number}>();
					r2StorageBytes = (fallbackInfo?.s || 0) * 65;
				}
			} catch (e) {
				// Column doesn't exist yet, gracefully fallback
				try {
					const r2Info = await db.prepare("SELECT SUM(events_count) as c FROM session_replay_metadata").first<{c: number}>();
					r2StorageBytes = (r2Info?.c || 0) * 65;
				} catch {
					r2StorageBytes = 0;
				}
			}

			return c.json({
				success: true,
				resources: {
					d1: {
						rowDensity: d1RowDensity,
						eventsCount: eventsCount?.c || 0,
						tracesCount: tracesCount?.c || 0,
						logsCount: logsCount?.c || 0,
						aiCallsCount: aiCallsCount?.c || 0
					},
					r2: {
						storageBytes: r2StorageBytes
					},
					worker: {
					    cpuMs: 0,
						memoryBytes: 0,
						requestsCount: 0,
						status: "Needs Cloudflare Auth Token for live metrics"
					}
				}
			});
		});
	}
};
