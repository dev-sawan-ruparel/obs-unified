import type { SqlDb } from "../sql-db";

export async function purgeExpiredTelemetry(db: SqlDb): Promise<number> {
	const now = new Date().toISOString();
	const result = await db
		.prepare("DELETE FROM telemetry_spans WHERE expires_at <= ?")
		.bind(now)
		.run();
	return result.meta?.changes ?? 0;
}
