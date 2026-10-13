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
import { type SqlDb, type SqlStatement, sqliteDialect } from "../sql-db";

type SqliteBind = string | number | bigint | null | Uint8Array;

/** D1 accepts `undefined` and booleans in `bind`; node:sqlite does not. */
const toBind = (value: unknown): SqliteBind => {
	if (value === undefined || value === null) return null;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (
		typeof value === "number" ||
		typeof value === "bigint" ||
		typeof value === "string" ||
		value instanceof Uint8Array
	) {
		return value;
	}
	return JSON.stringify(value);
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const SQLITE_MIGRATIONS_DIR = path.resolve(here, "../../migrations");

/** Sorted migration file names, optionally only those up to `through`. */
export const listSqliteMigrations = (through?: string): string[] =>
	readdirSync(SQLITE_MIGRATIONS_DIR)
		.filter((f) => f.endsWith(".sql"))
		.filter((f) => through === undefined || f <= through)
		.sort();

export interface ApplyMigrationsOptions {
	/** Apply files whose numeric prefix is `>= from` (inclusive, e.g. "045"). */
	from?: string;
	/** Apply files whose numeric prefix is `<= upTo` (inclusive, e.g. "044"). */
	upTo?: string;
}

/** Apply `migrations/*.sql` in sorted order; returns the file names applied. */
export function applySqliteMigrations(
	db: DatabaseSync,
	options: ApplyMigrationsOptions = {},
): string[] {
	const applied: string[] = [];
	for (const file of listSqliteMigrations()) {
		const prefix = file.slice(0, 3);
		if (options.from && prefix < options.from) continue;
		if (options.upTo && prefix > options.upTo) continue;
		db.exec(readFileSync(path.join(SQLITE_MIGRATIONS_DIR, file), "utf8"));
		applied.push(file);
	}
	return applied;
}

/** Fresh in-memory database with the selected D1 migrations applied. */
export const createMigratedSqliteDb = (
	options: ApplyMigrationsOptions = {},
): NodeSqliteDb => {
	const db = new NodeSqliteDb();
	applySqliteMigrations(db.raw, options);
	return db;
};

/** Column names of a table's PRIMARY KEY in key order. */
export const primaryKeyColumns = (db: DatabaseSync, table: string): string[] =>
	(
		db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
			name: string;
			pk: number;
		}>
	)
		.filter((c) => c.pk > 0)
		.sort((a, b) => a.pk - b.pk)
		.map((c) => c.name);

/** Index names declared on a table (SQLite auto-indexes excluded). */
export const indexNames = (db: DatabaseSync, table: string): string[] =>
	(db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>)
		.map((i) => i.name)
		.filter((n) => !n.startsWith("sqlite_autoindex"))
		.sort();

export class NodeSqliteDb implements SqlDb {
	readonly dialect = sqliteDialect;

	constructor(readonly raw: DatabaseSync = new DatabaseSync(":memory:")) {}

	close(): void {
		this.raw.close();
	}

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

	/** Batches are serialized and run without yielding, like D1's atomic batch. */
	private batchQueue: Promise<unknown> = Promise.resolve();

	batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>> {
		const run = () => {
			const results: Array<{ meta: { changes: number } }> = [];
			this.raw.exec("BEGIN");
			try {
				for (const stmt of statements) {
					if (!(stmt instanceof NodeSqliteStatement)) {
						throw new Error("NodeSqliteDb.batch: foreign statement");
					}
					results.push(stmt.runSync());
				}
				this.raw.exec("COMMIT");
			} catch (err) {
				this.raw.exec("ROLLBACK");
				throw err;
			}
			return results;
		};
		const next = this.batchQueue.then(run, run);
		this.batchQueue = next.catch(() => undefined);
		return next;
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
		return new NodeSqliteStatement(this.db, this.sql, args.map(toBind));
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const row = this.db.prepare(this.sql).get(...(this.binds as SqliteBind[]));
		return (row ?? null) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const rows = this.db.prepare(this.sql).all(...(this.binds as SqliteBind[]));
		return { results: rows as T[] };
	}

	runSync(): { meta: { changes: number } } {
		const info = this.db.prepare(this.sql).run(...(this.binds as SqliteBind[]));
		return { meta: { changes: Number(info.changes) } };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		return this.runSync();
	}
}
