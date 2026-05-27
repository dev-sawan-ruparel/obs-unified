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
	/**
	 * Run multiple prepared statements as a batch. On D1 this maps to a
	 * single network round-trip; on a future better-sqlite3 adapter it
	 * wraps the calls in a transaction. Returns one result per statement
	 * in input order, mirroring D1's `batch`.
	 *
	 * Statements MUST have been produced by this same `SqlDb` instance —
	 * mixing adapters is an error and runtime behavior is undefined.
	 */
	batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>>;
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

	async batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>> {
		// Unwrap each statement back to its D1 form — D1's batch takes
		// D1PreparedStatement[], not our typed wrapper.
		const unwrapped = statements.map((s) => {
			if (!(s instanceof D1StatementAdapter)) {
				throw new Error(
					"D1Adapter.batch: statement was not produced by D1Adapter",
				);
			}
			return s.unwrap();
		});
		const results = await this.d1.batch(unwrapped);
		return results.map((r) => ({
			meta: { changes: r.meta?.changes ?? 0 },
		}));
	}
}

/**
 * Convenience wrapper for the common case: take a `CollectorEnv`-shaped
 * object and return an `SqlDb`. Most plugins don't have access to the
 * `CollectorRuntime` (they get it at register time, not handler time)
 * so they call this directly. Plugins that *do* hold the runtime should
 * prefer `runtime.getSqlDb(env)` so a host-supplied `sqlDb` factory in
 * `CollectorConfig` takes effect.
 */
export const sqlDbFor = (env: { DB: D1Database | SqlDb }): SqlDb =>
	isSqlDb(env.DB) ? env.DB : new D1Adapter(env.DB);

const isSqlDb = (db: unknown): db is SqlDb => {
	if (!db || typeof db !== "object") return false;
	const candidate = db as {
		prepare?: unknown;
		batch?: unknown;
		exec?: unknown;
	};
	return (
		typeof candidate.prepare === "function" &&
		typeof candidate.batch === "function" &&
		typeof candidate.exec !== "function"
	);
};

class D1StatementAdapter implements SqlStatement {
	constructor(private readonly stmt: D1PreparedStatement) {}

	/** Internal escape hatch for `D1Adapter.batch` to recover the wrapped
	 *  D1 statement. Not part of the public `SqlStatement` shape. */
	unwrap(): D1PreparedStatement {
		return this.stmt;
	}

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
