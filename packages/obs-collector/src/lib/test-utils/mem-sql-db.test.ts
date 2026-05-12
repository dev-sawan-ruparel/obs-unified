/**
 * Self-test for the `MemSqlDb` test double — RFC 0008 Phase 0.4.
 *
 * The point is to validate the double behaves as the `SqlDb` contract
 * promises (prepare → bind → first/all/run, with binds carried forward
 * through `bind`), so anything that uses it for store-level testing in
 * later phases can trust the seam.
 */

import { describe, expect, it } from "vitest";
import type { SqlDb } from "../sql-db";
import { MemSqlDb } from "./mem-sql-db";

const useDb = (db: SqlDb) => db; // type-witness — fails to compile if MemSqlDb drifts from SqlDb.

describe("MemSqlDb", () => {
	it("conforms to SqlDb structurally", () => {
		const db = new MemSqlDb();
		// Compiles only because MemSqlDb implements SqlDb.
		expect(useDb(db)).toBe(db);
	});

	it("records prepare / bind / first calls with the bound args", async () => {
		const db = new MemSqlDb({
			first: (sql, binds) =>
				sql.startsWith("SELECT count") && binds[0] === "p1"
					? { c: 7 }
					: null,
		});

		const row = await db
			.prepare("SELECT count(*) as c FROM x WHERE project_id = ?")
			.bind("p1")
			.first<{ c: number }>();

		expect(row).toEqual({ c: 7 });
		expect(db.calls).toHaveLength(1);
		expect(db.calls[0]).toEqual({
			sql: "SELECT count(*) as c FROM x WHERE project_id = ?",
			binds: ["p1"],
			op: "first",
		});
	});

	it("returns wrapped results for all()", async () => {
		const db = new MemSqlDb({
			all: () => [{ id: "a" }, { id: "b" }],
		});

		const out = await db.prepare("SELECT id FROM x").all<{ id: string }>();
		expect(out).toEqual({ results: [{ id: "a" }, { id: "b" }] });
	});

	it("returns empty results when no all() handler is configured", async () => {
		const db = new MemSqlDb();
		const out = await db.prepare("SELECT 1").all();
		expect(out).toEqual({ results: [] });
	});

	it("returns changes=1 by default for run()", async () => {
		const db = new MemSqlDb();
		const out = await db.prepare("INSERT INTO x DEFAULT VALUES").run();
		expect(out).toEqual({ meta: { changes: 1 } });
	});

	it("honors a configurable run() handler", async () => {
		const db = new MemSqlDb({ run: () => ({ changes: 3 }) });
		const out = await db.prepare("UPDATE x SET y=1").run();
		expect(out).toEqual({ meta: { changes: 3 } });
	});

	it("each bind() returns a new statement (binds don't leak across statements)", async () => {
		const db = new MemSqlDb({
			first: (_sql, binds) => ({ bind0: binds[0] }),
		});
		const stmt = db.prepare("SELECT ? AS x");

		const a = await stmt.bind("a").first<{ bind0: string }>();
		const b = await stmt.bind("b").first<{ bind0: string }>();

		expect(a).toEqual({ bind0: "a" });
		expect(b).toEqual({ bind0: "b" });
	});

	it("callsMatching filters by SQL substring", async () => {
		const db = new MemSqlDb();
		await db.prepare("INSERT INTO foo VALUES (?)").bind(1).run();
		await db.prepare("INSERT INTO bar VALUES (?)").bind(2).run();
		await db.prepare("SELECT * FROM foo").all();

		expect(db.callsMatching("foo")).toHaveLength(2);
		expect(db.callsMatching("bar")).toHaveLength(1);
		expect(db.callsMatching("baz")).toHaveLength(0);
	});
});
