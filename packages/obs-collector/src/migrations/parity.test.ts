/**
 * The Postgres migrations in `../migrations-postgres/` must mirror the
 * SQLite/D1 files here one-to-one (see migrations-postgres/README.md
 * "Numbering"). Both runners apply files by sorted name and record them in
 * `schema_migrations`, so a number that exists on one side only would drift
 * the two schemas apart silently.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqliteDir = here;
const postgresDir = path.resolve(here, "../migrations-postgres");

const sqlFiles = (dir: string) =>
	readdirSync(dir)
		.filter((f) => f.endsWith(".sql"))
		.sort();

/** Tables the retention purge deletes from by comparing `expires_at` to text. */
const RETENTION_TABLES = [
	"telemetry_spans",
	"logs",
	"usage_events",
	"ai_calls",
	"metric_point",
	"metric_exemplars",
];

describe("migration parity", () => {
	it("has the same numbered files on SQLite/D1 and Postgres", () => {
		const sqlite = sqlFiles(sqliteDir);
		const postgres = sqlFiles(postgresDir);
		expect(postgres).toEqual(sqlite);
		const prefixes = sqlite.map((f) => f.slice(0, 3));
		expect(new Set(prefixes).size).toBe(prefixes.length);
	});

	it("declares retention timestamps as TEXT in every Postgres CREATE TABLE", () => {
		// postgresDialect.now() renders ISO text; Postgres refuses
		// `timestamptz < text`, so any retention table created with
		// TIMESTAMPTZ breaks purgeExpired (the 035 metric_exemplars bug).
		const offenders: string[] = [];
		for (const file of sqlFiles(postgresDir)) {
			const sql = readFileSync(path.join(postgresDir, file), "utf8");
			const tables = sql.matchAll(
				/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([^;]*?)\);/gis,
			);
			for (const [, table, body] of tables) {
				if (!RETENTION_TABLES.includes(table)) continue;
				for (const column of ["received_at", "expires_at"]) {
					const decl = new RegExp(`^\\s*${column}\\s+(\\w+)`, "im").exec(body);
					if (decl && decl[1].toUpperCase() !== "TEXT") {
						offenders.push(`${file}: ${table}.${column} ${decl[1]}`);
					}
				}
			}
		}
		expect(offenders).toEqual([]);
	});
});
