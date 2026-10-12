/**
 * `SqlDb` over Node's built-in `node:sqlite` for tests that need real SQL
 * execution against the shipped `migrations/` (as opposed to `MemSqlDb`,
 * which only records which statements a store chose to issue).
 *
 * `batch` runs the statements inside one transaction, matching what D1's
 * `batch` and `PostgresAdapter.batch` guarantee.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { SqlDb, SqlStatement } from "../sql-db";

type SqliteBind = string | number | bigint | null | Uint8Array;

const here = path.dirname(fileURLToPath(import.meta.url));
export const SQLITE_MIGRATIONS_DIR = path.resolve(here, "../../migrations");

/** Sorted migration file names, optionally only those up to `through`. */
export const listSqliteMigrations = (through?: string): string[] =>
	readdirSync(SQLITE_MIGRATIONS_DIR)
		.filter((f) => f.endsWith(".sql"))
		.filter((f) => through === undefined || f <= through)
		.sort();

export class NodeSqliteDb implements SqlDb {
	constructor(readonly raw: DatabaseSync = new DatabaseSync(":memory:")) {}

	/** Apply `migrations/*.sql` in order. `through` applies up to that file. */
	static migrated(through?: string): NodeSqliteDb {
		const db = new NodeSqliteDb();
		db.applyMigrations(listSqliteMigrations(through));
		return db;
	}

	applyMigrations(files: readonly string[]): void {
		for (const file of files) {
			this.raw.exec(
				readFileSync(path.join(SQLITE_MIGRATIONS_DIR, file), "utf8"),
			);
		}
	}

	prepare(sql: string): SqlStatement {
		return new NodeSqliteStatement(this.raw, sql, []);
	}

	async batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>> {
		const results: Array<{ meta: { changes: number } }> = [];
		this.raw.exec("BEGIN");
		try {
			for (const stmt of statements) results.push(await stmt.run());
			this.raw.exec("COMMIT");
		} catch (err) {
			this.raw.exec("ROLLBACK");
			throw err;
		}
		return results;
	}

	/** Convenience for assertions: `SELECT COUNT(*)` with an optional filter. */
	count(table: string, where = "1 = 1", ...binds: SqliteBind[]): number {
		const row = this.raw
			.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
			.get(...binds) as { n: number | bigint };
		return Number(row.n);
	}
}

class NodeSqliteStatement implements SqlStatement {
	constructor(
		private readonly db: DatabaseSync,
		private readonly sql: string,
		private readonly binds: readonly unknown[],
	) {}

	bind(...args: unknown[]): SqlStatement {
		return new NodeSqliteStatement(this.db, this.sql, args);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const row = this.db.prepare(this.sql).get(...(this.binds as SqliteBind[]));
		return (row ?? null) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const rows = this.db.prepare(this.sql).all(...(this.binds as SqliteBind[]));
		return { results: rows as T[] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		const info = this.db.prepare(this.sql).run(...(this.binds as SqliteBind[]));
		return { meta: { changes: Number(info.changes) } };
	}
}
