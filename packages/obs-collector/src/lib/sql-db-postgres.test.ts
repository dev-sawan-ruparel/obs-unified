/**
 * Unit coverage for the D1 → Postgres SQL translation and the `pg` result
 * type parsers. These run without a database; the live-Postgres checks
 * live in `sql-db-postgres.integration.test.ts`.
 */

import type { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { INVESTIGATION_ANALYSES } from "../analyses/investigations";
import { TIER0_ANALYSES } from "../analyses/tier0";
import { postgresDialect, sqliteDialect } from "./sql-db";
import {
	configurePostgresTypeParsers,
	mixedCaseAliases,
	POSTGRES_TYPE_OIDS,
	PostgresAdapter,
	parsePostgresNumber,
	prepareSqlForPostgres,
	rewriteQuestionMarks,
	stripSqlComments,
	translateD1Sql,
} from "./sql-db-postgres";

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`;
const UTC_NOW = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
const translate = prepareSqlForPostgres;

describe("rewriteQuestionMarks", () => {
	it("numbers placeholders and leaves '?' inside string literals alone", () => {
		expect(rewriteQuestionMarks("SELECT ? WHERE a = ? AND b = 'x?y'")).toBe(
			"SELECT $1 WHERE a = $2 AND b = 'x?y'",
		);
	});
});

describe("stripSqlComments", () => {
	it("drops -- and /* */ comments but keeps string literals and newlines", () => {
		const sql =
			"SELECT 'a -- not a comment' AS a, -- isn't this fun?\n  1 /* block ' */ AS b";
		expect(stripSqlComments(sql)).toBe(
			"SELECT 'a -- not a comment' AS a, \n  1  AS b",
		);
	});

	it("keeps placeholder numbering correct after a comment with an apostrophe", () => {
		expect(translate("SELECT ? -- don't\n WHERE x = ?")).toBe(
			"SELECT $1 \n WHERE x = $2",
		);
	});
});

describe("translateD1Sql — time windows against TEXT timestamp columns", () => {
	it("renders datetime('now') as ISO text", () => {
		expect(
			translate("DELETE FROM logs WHERE expires_at < datetime('now')"),
		).toBe(`DELETE FROM logs WHERE expires_at < to_char(${UTC_NOW}, ${ISO})`);
	});

	it("renders literal relative windows as ISO text", () => {
		expect(translate("received_at >= datetime('now', '-5 minutes')")).toBe(
			`received_at >= to_char(${UTC_NOW} - INTERVAL '5 minutes', ${ISO})`,
		);
		expect(translate("received_at <  datetime('now', '-1 hour')")).toBe(
			`received_at <  to_char(${UTC_NOW} - INTERVAL '1 hour', ${ISO})`,
		);
		expect(translate("received_at >= datetime('now', '-25 hours')")).toBe(
			`received_at >= to_char(${UTC_NOW} - INTERVAL '25 hours', ${ISO})`,
		);
	});

	it("renders bound relative windows (sqlite dialect form) as ISO text", () => {
		expect(
			translate("received_at >= datetime('now', '-' || ? || ' hours')"),
		).toBe(
			`received_at >= to_char(${UTC_NOW} - ($1::text || ' hours')::interval, ${ISO})`,
		);
	});

	it("renders the sqlite ISO strftime('now') forms as the same ISO text", () => {
		// `sqliteDialect` and the shared analysis SQL now spell time windows
		// as strftime('%Y-%m-%dT%H:%M:%fZ', 'now'[, modifier]) so SQLite
		// compares ISO text to ISO text; Postgres gets postgresDialect's shape.
		expect(
			translate("expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"),
		).toBe(`expires_at < to_char(${UTC_NOW}, ${ISO})`);
		expect(
			translate(
				"received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')",
			),
		).toBe(`received_at >= to_char(${UTC_NOW} - INTERVAL '5 minutes', ${ISO})`);
		expect(
			translate(
				"received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-' || ? || ' hours')",
			),
		).toBe(
			`received_at >= to_char(${UTC_NOW} - ($1::text || ' hours')::interval, ${ISO})`,
		);
		expect(translate(sqliteDialect.sinceMinutes("?"))).toBe(
			postgresDialect.sinceMinutes("$1"),
		);
		expect(translate(sqliteDialect.now())).toBe(postgresDialect.now());
	});

	it("maps datetime(…, 'unixepoch') to to_timestamp", () => {
		expect(translate("datetime(x, 'unixepoch')")).toBe("to_timestamp(x)");
	});
});

describe("translateD1Sql — strftime / julianday", () => {
	it("buckets by minute and hour in UTC", () => {
		expect(
			translate("strftime('%Y-%m-%dT%H:%M:00Z', received_at) AS minute"),
		).toBe(
			`to_char(date_trunc('minute', (received_at)::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS minute`,
		);
		expect(
			translate("strftime('%Y-%m-%dT%H:00:00Z', received_at) AS hour"),
		).toBe(
			`to_char(date_trunc('hour', (received_at)::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"') AS hour`,
		);
	});

	it("handles the nested 5-minute bucket expression from tier0 latency p95", () => {
		const sql = `strftime('%Y-%m-%dT%H:%M:00Z',
					datetime((CAST(strftime('%s', received_at) AS INTEGER) / 300) * 300, 'unixepoch')
				) AS bucket`;
		expect(translate(sql)).toBe(
			`to_char(date_trunc('minute', (to_timestamp((CAST(EXTRACT(EPOCH FROM (received_at)::timestamptz) AS INTEGER) / 300) * 300))::timestamptz AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:00"Z"') AS bucket`,
		);
	});

	it("rewrites julianday differences to epoch seconds", () => {
		expect(
			translate("(julianday(c.start_time) - julianday(p.end_time)) * 86400.0"),
		).toBe(
			"((EXTRACT(EPOCH FROM (c.start_time)::timestamptz) / 86400.0 + 2440587.5) - (EXTRACT(EPOCH FROM (p.end_time)::timestamptz) / 86400.0 + 2440587.5)) * 86400.0",
		);
	});
});

describe("translateD1Sql — JSON functions", () => {
	it("maps json_extract with quoted keys to ->>", () => {
		expect(
			translate(`json_extract(attributes_json, '$."messaging.destination"')`),
		).toBe(`((attributes_json)::jsonb ->> 'messaging.destination')`);
	});

	it("maps bare and nested json_extract paths", () => {
		expect(translate("json_extract(link.value, '$.traceId')")).toBe(
			"((link.value)::jsonb ->> 'traceId')",
		);
		expect(translate("json_extract(p, '$.a.b')")).toBe(
			"((p)::jsonb #>> '{a,b}')",
		);
	});

	it("maps json_object / json_array / json_group_array to Postgres builders", () => {
		expect(
			translate(
				"json_object('unit', 'usd', 'n', (SELECT n FROM cur), 'rows', (SELECT json_group_array(json_array(service, errors)) FROM t))",
			),
		).toBe(
			"json_build_object('unit', 'usd', 'n', (SELECT n FROM cur), 'rows', (SELECT json_agg(json_build_array(service, errors)) FROM t))",
		);
	});
});

describe("translateD1Sql — scalar MAX/MIN", () => {
	it("turns multi-argument MAX/MIN into GREATEST/LEAST but keeps aggregates", () => {
		expect(translate("WHERE rn = MAX(1, (95 * n + 99) / 100)")).toBe(
			"WHERE rn = GREATEST(1, (95 * n + 99) / 100)",
		);
		expect(translate("SELECT MAX(duration_ms) AS approx_max, MIN(a, b)")).toBe(
			"SELECT MAX(duration_ms) AS approx_max, LEAST(a, b)",
		);
	});
});

describe("translateD1Sql — ROUND", () => {
	it("casts two-argument ROUND to numeric", () => {
		expect(translate("ROUND(AVG(duration_ms), 2) AS avg_ms")).toBe(
			"ROUND((AVG(duration_ms))::numeric, 2) AS avg_ms",
		);
		expect(translate("ROUND(x)")).toBe("ROUND(x)");
	});
});

describe("translateD1Sql — safety", () => {
	it("does not touch function names inside string literals", () => {
		const sql = "SELECT 'datetime(''now'')' AS label, datetime('now') AS now";
		expect(translate(sql)).toBe(
			`SELECT 'datetime(''now'')' AS label, to_char(${UTC_NOW}, ${ISO}) AS now`,
		);
	});

	it("keeps INSERT OR IGNORE → ON CONFLICT DO NOTHING", () => {
		expect(translate("INSERT OR IGNORE INTO t (a) VALUES (?)")).toBe(
			"INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING",
		);
	});

	it("leaves plain SQL untouched", () => {
		const sql =
			"SELECT COUNT(*) AS c, SUM(CASE WHEN is_error THEN 1 ELSE 0 END) AS e FROM ai_calls WHERE project_id = $1";
		expect(translateD1Sql(sql)).toBe(sql);
	});

	it("leaves no SQLite-only built-ins in the shipped analysis SQL", () => {
		const sqliteOnly =
			/\b(datetime|strftime|julianday|json_object|json_array|json_group_array|json_extract)\s*\(/i;
		for (const def of [...TIER0_ANALYSES, ...INVESTIGATION_ANALYSES]) {
			const translated = translate(def.sql ?? "");
			expect(translated, def.id).not.toMatch(sqliteOnly);
			expect(translated, def.id).not.toMatch(/\bMAX\(\s*1\s*,/i);
		}
	});
});

describe("mixedCaseAliases", () => {
	it("maps the lower-cased Postgres column name back to the camelCase alias", () => {
		const sql = `SELECT COUNT(*) as totalCalls, SUM(CAST(x AS REAL)) AS totalCostUsd,
			COUNT(*) AS plain, 'AS notAnAlias' AS label FROM ai_calls`;
		expect([...mixedCaseAliases(sql)]).toEqual([
			["totalcalls", "totalCalls"],
			["totalcostusd", "totalCostUsd"],
		]);
	});

	it("returns an empty map for snake_case-only statements", () => {
		expect(
			mixedCaseAliases("SELECT a AS b, CAST(c AS INTEGER) FROM t").size,
		).toBe(0);
	});
});

describe("configurePostgresTypeParsers", () => {
	it("returns D1-shaped values for booleans, big integers, numerics and JSON", () => {
		const parsers = new Map<number, (value: string) => unknown>();
		configurePostgresTypeParsers({
			setTypeParser: (oid, parser) => {
				parsers.set(oid, parser);
			},
		});
		expect(parsers.get(POSTGRES_TYPE_OIDS.BOOL)?.("t")).toBe(1);
		expect(parsers.get(POSTGRES_TYPE_OIDS.BOOL)?.("f")).toBe(0);
		expect(parsers.get(POSTGRES_TYPE_OIDS.INT8)?.("42")).toBe(42);
		expect(parsers.get(POSTGRES_TYPE_OIDS.NUMERIC)?.("0.25")).toBe(0.25);
		expect(parsers.get(POSTGRES_TYPE_OIDS.JSON)?.('{"a":1}')).toBe('{"a":1}');
		expect(parsers.get(POSTGRES_TYPE_OIDS.JSONB)?.("[1]")).toBe("[1]");
	});

	it("fails loudly instead of rounding integers beyond MAX_SAFE_INTEGER", () => {
		expect(parsePostgresNumber("9007199254740991", "BIGINT")).toBe(
			Number.MAX_SAFE_INTEGER,
		);
		expect(parsePostgresNumber("-9007199254740991", "NUMERIC")).toBe(
			-Number.MAX_SAFE_INTEGER,
		);
		expect(parsePostgresNumber("12345.678", "NUMERIC")).toBe(12345.678);
		expect(() => parsePostgresNumber("9007199254740993", "BIGINT")).toThrow(
			/BIGINT value 9007199254740993 exceeds Number.MAX_SAFE_INTEGER/,
		);
		expect(() =>
			parsePostgresNumber("18446744073709551616", "NUMERIC"),
		).toThrow(RangeError);
		expect(() => parsePostgresNumber("NaN", "NUMERIC")).toThrow(RangeError);
	});
});

describe("PostgresAdapter statements", () => {
	/** Minimal `pg.Pool` stand-in that records every query it is asked to run. */
	const fakePool = () => {
		const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
		const client = {
			query: async (text: string, values?: unknown[]) => {
				queries.push({ text, values });
				return {
					rows: text.startsWith("SELECT") ? [{ totalcalls: 2, plain: 1 }] : [],
					rowCount: 1,
				};
			},
			release: () => {},
		};
		const pool = {
			on: () => pool,
			connect: async () => client,
		} as unknown as Pool;
		return { pool, queries };
	};

	it("bind() returns a new statement so one prepared statement can back a whole batch", async () => {
		const { pool, queries } = fakePool();
		const db = new PostgresAdapter(pool);
		const stmt = db.prepare("INSERT OR IGNORE INTO t (a, b) VALUES (?, ?)");
		await db.batch([stmt.bind("row-1", 1), stmt.bind("row-2", 2)]);
		const inserts = queries.filter((q) => q.text.startsWith("INSERT"));
		expect(inserts.map((q) => q.values)).toEqual([
			["row-1", 1],
			["row-2", 2],
		]);
		expect(inserts[0]?.text).toBe(
			"INSERT INTO t (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING",
		);
	});

	it("restores camelCase aliases on rows read back from Postgres", async () => {
		const { pool } = fakePool();
		const db = new PostgresAdapter(pool);
		const row = await db
			.prepare("SELECT COUNT(*) AS totalCalls, 1 AS plain FROM t")
			.first<{ totalCalls: number; plain: number }>();
		expect(row).toEqual({ totalCalls: 2, plain: 1 });
	});
});
