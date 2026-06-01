import type { CollectorEnv } from "../framework/env";
import type { SqlDb } from "./sql-db";

export const isTruthyFlag = (value: unknown): boolean =>
	value === true || value === 1 || value === "1" || value === "true";

export async function isPayloadCaptureEnabled(
	db: SqlDb,
	projectId: string,
	env?: Partial<CollectorEnv>,
): Promise<boolean> {
	if (isTruthyFlag(env?.OBS_PAYLOAD_CAPTURE_DEFAULT)) return true;

	const row = await db
		.prepare(
			`SELECT payload_capture_enabled FROM projects WHERE id = ? LIMIT 1`,
		)
		.bind(projectId)
		.first<{ payload_capture_enabled: boolean | number | string | null }>();

	return isTruthyFlag(row?.payload_capture_enabled);
}
