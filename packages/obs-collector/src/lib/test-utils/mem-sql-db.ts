/**
 * In-memory `SqlDb` test double — RFC 0008.
 *
 * Replaces hand-rolled `FakeDb` patterns scattered across tests (e.g. the
 * one in `stage6.test.ts` that motivated this). Tests configure `first` /
 * `all` / `run` matchers; the double records every prepare/bind so tests
 * can assert *which* SQL was issued, not just that something ran.
 *
 * Not a real SQLite — there is no execution. The point is decision
 * coverage (which query did the store choose, which value did it return),
 * not SQL grammar coverage.
 */

import type { SqlDb, SqlStatement } from "../sql-db";

export interface MemSqlDbOptions {
	/** Return value for `first()`. Receives the SQL + binds at call time. */
	first?: (sql: string, binds: unknown[]) => Record<string, unknown> | null;
	/** Rows returned for `all()`. The double wraps in `{ results }`. */
	all?: (sql: string, binds: unknown[]) => Record<string, unknown>[];
	/** Changes count for `run()`. Defaults to `1`. */
	run?: (sql: string, binds: unknown[]) => { changes: number };
}

export interface MemSqlDbCall {
	sql: string;
	binds: unknown[];
	op: "first" | "all" | "run";
}

export class MemSqlDb implements SqlDb {
	readonly calls: MemSqlDbCall[] = [];
	constructor(private readonly opts: MemSqlDbOptions = {}) {}

	prepare(sql: string): SqlStatement {
		return new MemSqlStatement(sql, [], this.calls, this.opts);
	}

	async batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>> {
		const results: Array<{ meta: { changes: number } }> = [];
		for (const stmt of statements) {
			results.push(await stmt.run());
		}
		return results;
	}

	/** Filter recorded calls by a substring of the SQL — convenient in tests. */
	callsMatching(needle: string): MemSqlDbCall[] {
		return this.calls.filter((c) => c.sql.includes(needle));
	}
}

class MemSqlStatement implements SqlStatement {
	constructor(
		private readonly sql: string,
		private readonly binds: unknown[],
		private readonly calls: MemSqlDbCall[],
		private readonly opts: MemSqlDbOptions,
	) {}

	bind(...args: unknown[]): SqlStatement {
		return new MemSqlStatement(this.sql, args, this.calls, this.opts);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		this.calls.push({ sql: this.sql, binds: this.binds, op: "first" });
		const row = this.opts.first ? this.opts.first(this.sql, this.binds) : null;
		return (row ?? null) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		this.calls.push({ sql: this.sql, binds: this.binds, op: "all" });
		const rows = this.opts.all ? this.opts.all(this.sql, this.binds) : [];
		return { results: rows as T[] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		this.calls.push({ sql: this.sql, binds: this.binds, op: "run" });
		const r = this.opts.run
			? this.opts.run(this.sql, this.binds)
			: { changes: 1 };
		return { meta: { changes: r.changes } };
	}
}
