import type { AnalysisResult } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import { AnalysesStore } from "./analyses-store";
import { createMigratedSqliteDb } from "./test-utils/node-sqlite-db";

const result = (
	analysisId: string,
	generatedAt: string,
	status: AnalysisResult["status"],
): AnalysisResult => ({
	analysisId,
	projectId: "alpha",
	generatedAt,
	paramsHash: null,
	status,
	primaryValue: 1,
	baselineValue: 0,
	deltaPct: null,
	payload: {},
	narrative: null,
	narrativeSignature: null,
	durationMs: 1,
});

describe("AnalysesStore.getLatestResultsBulk", () => {
	it("returns the newest result per analysis from a single bounded query", async () => {
		const db = createMigratedSqliteDb();
		const store = new AnalysesStore(db);
		const expires = Date.now() + 3_600_000;
		for (const [id, at, status] of [
			["a", "2026-10-13T01:00:00.000Z", "ok"],
			["a", "2026-10-13T03:00:00.000Z", "critical"],
			["a", "2026-10-13T02:00:00.000Z", "warn"],
			["b", "2026-10-13T02:30:00.000Z", "warn"],
			["c", "2026-10-13T02:30:00.000Z", "ok"],
		] as const) {
			await store.insertResult(result(id, at, status), expires);
		}
		// Another project with the same ids must not bleed through.
		await store.insertResult(
			{ ...result("a", "2026-10-13T09:00:00.000Z", "ok"), projectId: "beta" },
			expires,
		);

		const latest = await store.getLatestResultsBulk("alpha", ["a", "b", "zz"]);
		expect([...latest.keys()].sort()).toEqual(["a", "b"]);
		expect(latest.get("a")?.status).toBe("critical");
		expect(latest.get("a")?.generatedAt).toBe("2026-10-13T03:00:00.000Z");
		expect(latest.get("b")?.status).toBe("warn");

		// The query itself must not return every retained row.
		const rows = await db
			.prepare(
				`SELECT COUNT(*) AS n FROM analysis_results WHERE project_id = ? AND analysis_id = ?`,
			)
			.bind("alpha", "a")
			.first<{ n: number }>();
		expect(rows?.n).toBe(3);
		db.close();
	});
});
