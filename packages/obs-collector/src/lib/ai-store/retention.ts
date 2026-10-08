import { dialectFor, type SqlDb } from "../sql-db";

export async function purgeExpiredAIData(db: SqlDb): Promise<number> {
	const dialect = dialectFor(db);
	const { meta } = await db
		.prepare(`DELETE FROM ai_calls WHERE expires_at < ${dialect.now()}`)
		.run();
	const { meta: payloadMeta } = await db
		.prepare(`DELETE FROM ai_span_payloads WHERE expires_at < ${dialect.now()}`)
		.run();
	const { meta: evalMeta } = await db
		.prepare(
			`DELETE FROM ai_span_evaluations WHERE expires_at < ${dialect.now()}`,
		)
		.run();
	return meta.changes + (payloadMeta?.changes ?? 0) + (evalMeta?.changes ?? 0);
}
