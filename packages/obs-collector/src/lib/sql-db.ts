/**
 * Storage seam for the collector — RFC 0008.
 *
 * Stores and plugins target this interface instead of `D1Database` directly,
 * so a future Node / better-sqlite3 / ClickHouse runtime is one new adapter
 * away rather than a fork-and-rewrite. The shape is deliberately D1's
 * existing `prepare → bind → first|all|run` chain so the migration of
 * existing stores is mechanical (search-and-replace the constructor type).
 *
 * Today there is one implementation, `D1Adapter`. A `MemSqlDb` test double
 * lives next door under `test-utils/`; `BetterSqliteAdapter` and
 * `ClickHouseAdapter` are deferred until they have a real runtime to serve.
 */

export interface SqlDb {
	prepare(sql: string): SqlStatement;
}

export interface SqlStatement {
	bind(...args: unknown[]): SqlStatement;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
	run(): Promise<{ meta: { changes: number } }>;
}

/**
 * D1 already conforms to this shape almost exactly; the adapter normalizes
 * two small differences:
 *  - `all()` on D1 returns `results?: T[]` (optional). We coerce to `[]`.
 *  - `run()`'s `meta.changes` is optional on D1. We coerce to `0`.
 * Both differences are runtime-undetectable for the queries this codebase
 * issues (every successful all() returns results; every run() against an
 * INSERT/UPDATE/DELETE reports changes), but coercing keeps the typed
 * interface honest.
 */
export class D1Adapter implements SqlDb {
	constructor(private readonly d1: D1Database) {}

	prepare(sql: string): SqlStatement {
		return new D1StatementAdapter(this.d1.prepare(sql));
	}
}

class D1StatementAdapter implements SqlStatement {
	constructor(private readonly stmt: D1PreparedStatement) {}

	bind(...args: unknown[]): SqlStatement {
		return new D1StatementAdapter(this.stmt.bind(...args));
	}

	first<T = Record<string, unknown>>(): Promise<T | null> {
		return this.stmt.first<T>();
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const r = await this.stmt.all<T>();
		return { results: r.results ?? [] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		const r = await this.stmt.run();
		return { meta: { changes: r.meta?.changes ?? 0 } };
	}
}
