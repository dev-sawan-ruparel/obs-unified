import type { CollectorPlugin } from "../framework/collector";
import { sqlDbFor } from "../lib/sql-db";

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
			const counts = await Promise.all([
				safeCount(db, "SELECT COUNT(*) AS n FROM telemetry_spans"),
				safeCount(db, "SELECT COUNT(*) AS n FROM logs"),
				safeCount(db, "SELECT COUNT(*) AS n FROM usage_events"),
				safeCount(db, "SELECT COUNT(*) AS n FROM user_profiles"),
				safeCount(db, "SELECT COUNT(*) AS n FROM ai_calls"),
				safeCount(db, "SELECT COUNT(*) AS n FROM session_replay_metadata"),
				safeCount(
					db,
					"SELECT COUNT(*) AS n FROM telemetry_spans WHERE attributes_json LIKE '%obs.interaction.id%'",
				),
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
	db: { prepare: (sql: string) => { first: <T>() => Promise<T | null> } },
	sql: string,
): Promise<number> {
	try {
		const row = await db.prepare(sql).first<{ n: number }>();
		return Number(row?.n ?? 0);
	} catch {
		// Table doesn't exist yet — fresh DB, no signals of this type.
		return 0;
	}
}
