import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export const platformRoutesPlugin: CollectorPlugin = {
	name: "platform-routes",
	register(app) {
		app.get("/internal/platform/resources", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);

			const countFor = async (table: string) => {
				const row = await db
					.prepare(`SELECT COUNT(*) as c FROM ${table} WHERE project_id = ?`)
					.bind(projectId)
					.first<{ c: number }>();
				return row?.c ?? 0;
			};

			const eventsCount = await countFor("usage_events");
			const tracesCount = await countFor("telemetry_spans");
			const logsCount = await countFor("logs");
			const aiCallsCount = await countFor("ai_calls");

			const d1RowDensity = eventsCount + tracesCount + logsCount + aiCallsCount;

			let r2StorageBytes = 0;
			try {
				const r2Info = await db
					.prepare(
						"SELECT SUM(storage_bytes) as s FROM session_replay_metadata WHERE project_id = ?",
					)
					.bind(projectId)
					.first<{ s: number }>();
				r2StorageBytes = r2Info?.s ?? 0;
			} catch {
				r2StorageBytes = 0;
			}

			return c.json({
				success: true,
				resources: {
					d1: {
						rowDensity: d1RowDensity,
						eventsCount,
						tracesCount,
						logsCount,
						aiCallsCount,
					},
					r2: {
						storageBytes: r2StorageBytes,
					},
					worker: {
						cpuMs: 0,
						memoryBytes: 0,
						requestsCount: 0,
						status: "Needs Cloudflare Auth Token for live metrics",
					},
				},
			});
		});
	},
};
