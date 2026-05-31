import type { CollectorPlugin } from "../framework/collector";
import { dialectFor, sqlDbFor } from "../lib/sql-db";
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

		// RFC 0009 Phase 5.2 — Linux hosts mode. Queries the latest
		// gauge points for the standard OTel host-metrics semconv
		// (system.cpu.utilization, system.memory.usage, etc.) grouped
		// by host.name. Returns an empty array if no `system.*` series
		// exist; the dashboard renders Cloudflare-only mode in that case.
		app.get("/internal/platform/hosts", async (c) => {
			const projectId = getProjectId(c);
			const db = sqlDbFor(c.env);
			const dialect = dialectFor(db);

			const rows = await db
				.prepare(
					`WITH host_series AS (
						SELECT
							s.id AS series_id,
							s.name AS metric_name,
							${dialect.jsonText("s.resource_attrs_json", "$.host\\u002Ename")} AS host_name,
							s.attributes_json
						FROM metric_series s
						WHERE s.project_id = ?
							AND s.name LIKE 'system.%'
					),
					latest_points AS (
						SELECT
							p.series_id,
							p.value,
							p.received_at,
							ROW_NUMBER() OVER (PARTITION BY p.series_id ORDER BY p.received_at DESC) AS rn
						FROM metric_point p
						WHERE p.project_id = ?
							AND p.received_at >= ${dialect.sinceMinutes("15")}
							AND p.series_id IN (SELECT series_id FROM host_series)
					)
					SELECT
						hs.host_name,
						hs.metric_name,
						lp.value,
						lp.received_at
					FROM latest_points lp
					JOIN host_series hs ON hs.series_id = lp.series_id
					WHERE lp.rn = 1
					ORDER BY hs.host_name, hs.metric_name`,
				)
				.bind(projectId, projectId)
				.all<{
					host_name: string | null;
					metric_name: string;
					value: number | null;
					received_at: string;
				}>();

			// Bucket per host — null host_name means resource_attrs_json
			// didn't carry host.name, group as <unknown>.
			const byHost = new Map<
				string,
				{ host: string; metrics: Record<string, number>; updatedAt: string }
			>();
			for (const row of rows.results) {
				const host = row.host_name ?? "<unknown>";
				if (!byHost.has(host)) {
					byHost.set(host, {
						host,
						metrics: {},
						updatedAt: row.received_at,
					});
				}
				const entry = byHost.get(host);
				if (!entry) continue;
				if (row.value !== null) entry.metrics[row.metric_name] = row.value;
				if (row.received_at > entry.updatedAt)
					entry.updatedAt = row.received_at;
			}

			return c.json({
				success: true,
				hosts: Array.from(byHost.values()),
			});
		});
	},
};
