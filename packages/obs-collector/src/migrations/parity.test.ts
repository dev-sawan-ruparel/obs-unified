/**
 * The Postgres migrations in `../migrations-postgres/` must mirror the
 * SQLite/D1 files here one-to-one (see migrations-postgres/README.md
 * "Numbering"). Both runners apply files by sorted name and record them in
 * `schema_migrations`, so a number that exists on one side only would drift
 * the two schemas apart silently.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
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
	"change_events",
	"incident_investigations",
	"investigation_findings",
	"remediation_proposals",
];

export function checkMigrationFilePairings(
	sqliteFiles: readonly string[],
	postgresFiles: readonly string[],
): string[] {
	const errors: string[] = [];
	const sqliteSet = new Set(sqliteFiles);
	const pgSet = new Set(postgresFiles);
	for (const f of sqliteFiles) {
		if (!pgSet.has(f)) {
			errors.push(`Missing Postgres migration counterpart for ${f}`);
		}
	}
	for (const f of postgresFiles) {
		if (!sqliteSet.has(f)) {
			errors.push(`Missing SQLite migration counterpart for ${f}`);
		}
	}
	const seenPrefixes = new Set<string>();
	for (const f of sqliteFiles) {
		const prefix = f.slice(0, 3);
		if (seenPrefixes.has(prefix)) {
			errors.push(`Duplicate migration prefix ${prefix} in ${f}`);
		}
		seenPrefixes.add(prefix);
	}
	return errors;
}

const extractCreatedTables = (sql: string): string[] => {
	const names: string[] = [];
	for (const m of sql.matchAll(
		/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/gi,
	)) {
		const table = m[1].toLowerCase();
		if (!table.endsWith("_new")) {
			names.push(table);
		}
	}
	return [...new Set(names)].sort();
};

const extractAddedColumns = (sql: string): string[] => {
	const cols: string[] = [];
	for (const m of sql.matchAll(
		/ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_]+)/gi,
	)) {
		cols.push(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
	}
	return [...new Set(cols)].sort();
};

describe("migration parity", () => {
	it("has the same numbered files on SQLite/D1 and Postgres and catches missing pairs", () => {
		const sqlite = sqlFiles(sqliteDir);
		const postgres = sqlFiles(postgresDir);
		expect(postgres).toEqual(sqlite);
		expect(sqlite.length).toBeGreaterThanOrEqual(53);
		expect(checkMigrationFilePairings(sqlite, postgres)).toEqual([]);

		// Regression check: missing or duplicate migration files must be flagged.
		expect(
			checkMigrationFilePairings([...sqlite, "099_new_feature.sql"], postgres),
		).toEqual([
			"Missing Postgres migration counterpart for 099_new_feature.sql",
		]);
		expect(
			checkMigrationFilePairings(sqlite, [...postgres, "099_pg_only.sql"]),
		).toEqual(["Missing SQLite migration counterpart for 099_pg_only.sql"]);
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

	it("creates and alters the same tables and columns per migration file", () => {
		const mismatches: string[] = [];
		for (const file of sqlFiles(sqliteDir)) {
			const sqliteSql = readFileSync(path.join(sqliteDir, file), "utf8");
			const pgSql = readFileSync(path.join(postgresDir, file), "utf8");
			const sTables = extractCreatedTables(sqliteSql);
			const pTables = extractCreatedTables(pgSql);
			if (JSON.stringify(sTables) !== JSON.stringify(pTables)) {
				mismatches.push(
					`${file} CREATE TABLE mismatch: sqlite=${JSON.stringify(sTables)} pg=${JSON.stringify(pTables)}`,
				);
			}
			const sCols = extractAddedColumns(sqliteSql);
			const pCols = extractAddedColumns(pgSql);
			if (JSON.stringify(sCols) !== JSON.stringify(pCols)) {
				mismatches.push(
					`${file} ALTER TABLE ADD COLUMN mismatch: sqlite=${JSON.stringify(sCols)} pg=${JSON.stringify(pCols)}`,
				);
			}
		}
		expect(mismatches).toEqual([]);
	});

	it("applies all SQLite migrations cleanly in-memory without leftover staging tables", () => {
		const db = new DatabaseSync(":memory:");
		try {
			for (const file of sqlFiles(sqliteDir)) {
				db.exec(readFileSync(path.join(sqliteDir, file), "utf8"));
			}
			const leftover = db
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%_new'",
				)
				.all();
			expect(leftover).toEqual([]);
		} finally {
			db.close();
		}
	});
});
