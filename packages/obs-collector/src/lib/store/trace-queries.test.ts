import { describe, expect, it } from "vitest";
import { MemSqlDb } from "../test-utils/mem-sql-db";
import { fetchSpansForTraceIds } from "./trace-queries";

describe("fetchSpansForTraceIds", () => {
	it("does not query when there are no trace ids", async () => {
		const db = new MemSqlDb();

		const spans = await fetchSpansForTraceIds(db, "default", []);

		expect(spans).toEqual([]);
		expect(db.calls).toHaveLength(0);
	});

	it("chunks large trace id lists to stay under D1 SQL variable limits", async () => {
		const db = new MemSqlDb({ all: () => [] });
		const traceIds = Array.from({ length: 1801 }, (_, i) => `trace-${i}`);

		await fetchSpansForTraceIds(db, "default", traceIds);

		const calls = db.callsMatching("FROM telemetry_spans");
		expect(calls).toHaveLength(19);
		expect(calls.slice(0, -1).map((call) => call.binds.length)).toEqual(
			Array.from({ length: 18 }, () => 100),
		);
		expect(calls.at(-1)?.binds.length).toBe(20);
		expect(calls.every((call) => call.binds[0] === "default")).toBe(true);
	});
});
