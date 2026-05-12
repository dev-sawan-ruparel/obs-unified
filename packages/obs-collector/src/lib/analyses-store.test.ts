/**
 * AnalysesStore tests — focused on the claim semantics added to prevent
 * cron overlap. Pre-existing methods (upsertDefinition, getLatestResult)
 * are exercised end-to-end by the runner's integration tests; this file
 * only locks down the new claim primitive's contract.
 */

import { describe, expect, it } from "vitest";
import { AnalysesStore } from "./analyses-store";
import { MemSqlDb } from "./test-utils/mem-sql-db";

describe("AnalysesStore.claimAnalysis", () => {
	it("returns true when the UPDATE moved a row (claim acquired)", async () => {
		const db = new MemSqlDb({ run: () => ({ changes: 1 }) });
		const store = new AnalysesStore(db);
		const ok = await store.claimAnalysis(
			"proj-1",
			"analysis-1",
			Date.now(),
			90_000,
		);
		expect(ok).toBe(true);
	});

	it("returns false when the UPDATE matched zero rows (lease held)", async () => {
		// changes=0 simulates D1 declining the UPDATE because the WHERE
		// clause excluded the row (active lease held by another tick).
		const db = new MemSqlDb({ run: () => ({ changes: 0 }) });
		const store = new AnalysesStore(db);
		const ok = await store.claimAnalysis(
			"proj-1",
			"analysis-1",
			Date.now(),
			90_000,
		);
		expect(ok).toBe(false);
	});

	it("binds an ISO timestamp for the lease floor (now - leaseMs)", async () => {
		const db = new MemSqlDb({ run: () => ({ changes: 1 }) });
		const store = new AnalysesStore(db);
		const now = Date.parse("2026-05-01T12:00:00.000Z");
		await store.claimAnalysis("proj-1", "analysis-1", now, 90_000);

		const claim = db.callsMatching("last_started_at = ?")[0];
		expect(claim).toBeDefined();
		// binds: [nowIso, projectId, analysisId, leaseFloorIso]
		expect(claim.binds[0]).toBe("2026-05-01T12:00:00.000Z");
		expect(claim.binds[1]).toBe("proj-1");
		expect(claim.binds[2]).toBe("analysis-1");
		expect(claim.binds[3]).toBe("2026-05-01T11:58:30.000Z");
	});
});

describe("AnalysesStore.markRan", () => {
	it("clears last_started_at while writing last_run_at (releases the lease)", async () => {
		const db = new MemSqlDb({ run: () => ({ changes: 1 }) });
		const store = new AnalysesStore(db);
		await store.markRan("proj-1", "analysis-1", "2026-05-01T12:00:00Z");

		const call = db.callsMatching("UPDATE analysis_definitions")[0];
		expect(call).toBeDefined();
		expect(call.sql).toContain("last_started_at = NULL");
	});
});

describe("AnalysesStore.releaseClaim", () => {
	it("nullifies last_started_at without touching last_run_at", async () => {
		const db = new MemSqlDb({ run: () => ({ changes: 1 }) });
		const store = new AnalysesStore(db);
		await store.releaseClaim("proj-1", "analysis-1");

		const call = db.callsMatching("last_started_at = NULL")[0];
		expect(call).toBeDefined();
		expect(call.sql).not.toContain("last_run_at");
		expect(call.binds).toEqual(["proj-1", "analysis-1"]);
	});
});
