import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

/**
 * Drives the in-dashboard Onboarding tab — returns counts of signal
 * types, used to decide which "you need to wire X" snippets to show
 * the user.
 *
 * Returns zeros for tables that don't yet exist (e.g. fresh DB) rather
 * than 500ing — onboarding has to work on day zero.
 */
export const onboardingRoutesPlugin: CollectorPlugin = {
	name: "onboarding-routes",
	register(app) {
		app.get("/internal/onboarding/counts", async (c) => {
			const db = sqlDbFor(c.env);
			// Every signal table is project-scoped; counting across tenants
			// would leak other projects' volumes and hide an empty project.
			const projectId = getProjectId(c);
			const count = (table: string, extra = "") =>
				safeCount(
					db,
					`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?${extra}`,
					projectId,
				);
			const counts = await Promise.all([
				count("telemetry_spans"),
				count("logs"),
				count("usage_events"),
				count("user_profiles"),
				count("ai_calls"),
				count("session_replay_metadata"),
				count("telemetry_spans", " AND interaction_id IS NOT NULL"),
			]);

			return c.json({
				spans: counts[0],
				logs: counts[1],
				usageEvents: counts[2],
				identifiedUsers: counts[3],
				aiCalls: counts[4],
				replayChunks: counts[5],
				spansWithInteraction: counts[6],
			});
		});
	},
};

async function safeCount(
	db: {
		prepare: (sql: string) => {
			bind: (...args: unknown[]) => { first: <T>() => Promise<T | null> };
		};
	},
	sql: string,
	...binds: unknown[]
): Promise<number> {
	try {
		const row = await db
			.prepare(sql)
			.bind(...binds)
			.first<{ n: number }>();
		return Number(row?.n ?? 0);
	} catch {
		// Table doesn't exist yet — fresh DB, no signals of this type.
		return 0;
	}
}
