/**
 * Postgres adapter for the SqlDb seam (RFC 0008).
 *
 * Wraps `pg` (node-postgres) to expose the same `prepare → bind → first |
 * all | run` chain as `D1Adapter`. Used by the Docker / standalone Node
 * deployment of `apps/collector`; the Workers deployment continues to
 * use `D1Adapter`.
 *
 * Notable differences from D1 handled here:
 *  - Placeholders: D1 uses `?`; Postgres uses `$1`, `$2`. We rewrite
 *    `?` to `$N` in `prepare`. Statements MUST use `?` for portability.
 *  - `INSERT … RETURNING`: D1 doesn't support RETURNING; Postgres does.
 *    Code that targets both MUST NOT rely on RETURNING.
 *  - `TEXT vs VARCHAR`: D1 is permissive; we use TEXT exclusively in
 *    the postgres migrations.
 *  - `meta.changes`: D1 reports affected row count via meta.changes;
 *    Postgres reports it via `result.rowCount`. We normalize.
 *
 * Connection pooling is the caller's job — pass a `pg.Pool`, not a
 * one-shot Client. Each `prepare` checks out, runs the statement, and
 * releases. Long-lived transactions need a different surface (not yet
 * exposed; collector code today does not require them).
 */

import type { Pool, QueryResultRow } from "pg";
import { postgresDialect, type SqlDb, type SqlStatement } from "./sql-db";

export interface PostgresAdapterOptions {
	/**
	 * Statement-level timeout in milliseconds. Defaults to 30s. Issued
	 * via `SET statement_timeout` at the start of each query (session-level;
	 * `SET LOCAL` outside a transaction would be a no-op).
	 */
	statementTimeoutMs?: number;
}

export class PostgresAdapter implements SqlDb {
	readonly dialect = postgresDialect;
	private readonly statementTimeoutMs: number;

	constructor(
		private readonly pool: Pool,
		options: PostgresAdapterOptions = {},
	) {
		const rawTimeout = options.statementTimeoutMs ?? 30_000;
		this.statementTimeoutMs =
			Number.isFinite(rawTimeout) && rawTimeout >= 0
				? Math.trunc(rawTimeout)
				: 30_000;

		// Configure statement timeout once upon connection establishment
		this.pool.on("connect", (client) => {
			client
				.query(`SET statement_timeout = ${this.statementTimeoutMs}`)
				.catch(() => {});
		});
	}

	prepare(sql: string): SqlStatement {
		return new PostgresStatement(
			this.pool,
			translateD1Sql(rewriteQuestionMarks(sql)),
		);
	}

	async batch(
		statements: SqlStatement[],
	): Promise<Array<{ meta: { changes: number } }>> {
		const client = await this.pool.connect();
		try {
			await client.query("BEGIN");
			// SET LOCAL works here because it is inside the transaction.
			await client.query(
				`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`,
			);
			const out: Array<{ meta: { changes: number } }> = [];
			for (const s of statements) {
				if (!(s instanceof PostgresStatement)) {
					throw new Error(
						"PostgresAdapter.batch: statement was not produced by PostgresAdapter",
					);
				}
				const r = await s.runOnClient(client);
				out.push(r);
			}
			await client.query("COMMIT");
			return out;
		} catch (err) {
			await client.query("ROLLBACK").catch(() => {});
			throw err;
		} finally {
			client.release();
		}
	}
}

class PostgresStatement implements SqlStatement {
	private bound: unknown[] = [];

	constructor(
		private readonly pool: Pool,
		private readonly sql: string,
	) {}

	bind(...args: unknown[]): SqlStatement {
		this.bound = args;
		return this;
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const result = await this.exec<T & QueryResultRow>();
		return (result.rows[0] as T | undefined) ?? null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const result = await this.exec<T & QueryResultRow>();
		return { results: result.rows as unknown as T[] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		const result = await this.exec();
		return { meta: { changes: result.rowCount ?? 0 } };
	}

	// Internal — used by batch() to run inside an already-checked-out
	// client (so the BEGIN/COMMIT span the whole batch).
	async runOnClient(client: {
		query: (
			text: string,
			values?: unknown[],
		) => Promise<{ rowCount: number | null }>;
	}): Promise<{ meta: { changes: number } }> {
		const r = await client.query(this.sql, this.bound);
		return { meta: { changes: r.rowCount ?? 0 } };
	}

	private async exec<T extends QueryResultRow = QueryResultRow>(): Promise<{
		rows: T[];
		rowCount: number | null;
	}> {
		const client = await this.pool.connect();
		try {
			const r = await client.query<T>(this.sql, this.bound);
			return { rows: r.rows, rowCount: r.rowCount };
		} finally {
			client.release();
		}
	}
}

// D1 → Postgres placeholder rewrite. Walks the string once; tracks
// whether we're inside a single-quoted string literal so that '?' inside
// strings isn't rewritten. Doesn't handle dollar-quoted strings — none
// of the collector's SQL uses them.
const rewriteQuestionMarks = (sql: string): string => {
	let out = "";
	let inString = false;
	let n = 0;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'") {
			inString = !inString;
			out += ch;
			continue;
		}
		if (ch === "?" && !inString) {
			n += 1;
			out += `$${n}`;
			continue;
		}
		out += ch;
	}
	return out;
};

const translateD1Sql = (sql: string): string => {
	let out = sql;
	const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out);

	out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");

	out = out.replace(
		/datetime\('now',\s*'-'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*hours'\)/gi,
		"(CURRENT_TIMESTAMP - ($1::text || ' hours')::interval)",
	);
	out = out.replace(
		/datetime\('now',\s*'-'\s*\|\|\s*(\$\d+)\s*\|\|\s*'\s*minutes'\)/gi,
		"(CURRENT_TIMESTAMP - ($1::text || ' minutes')::interval)",
	);
	out = out.replace(
		/datetime\('now',\s*'-(\d+)\s+(hour|hours|minute|minutes|day|days)'\)/gi,
		"CURRENT_TIMESTAMP - INTERVAL '$1 $2'",
	);
	out = out.replace(/datetime\('now'\)/gi, "CURRENT_TIMESTAMP");

	out = out.replace(
		/json_extract\(([^,()]+),\s*'\$\.(?:"([^"]+)"|([A-Za-z0-9_\\.\\\\]+))'\)/gi,
		(
			_match,
			expr: string,
			quotedKey: string | undefined,
			bareKey: string | undefined,
		) => {
			const key = (quotedKey ?? bareKey ?? "").replace(
				/\\\\u002E|\\u002E/g,
				".",
			);
			return `(${expr.trim()}::jsonb ->> '${key.replace(/'/g, "''")}')`;
		},
	);

	out = out.replace(
		/strftime\('%Y-%m-%dT%H:%M:00Z',\s*([^)]+)\)/gi,
		"to_char(date_trunc('minute', $1::timestamp), 'YYYY-MM-DD\"T\"HH24:MI:00\"Z\"')",
	);
	out = out.replace(
		/strftime\('%Y-%m-%dT%H:00:00Z',\s*([^)]+)\)/gi,
		"to_char(date_trunc('hour', $1::timestamp), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"')",
	);
	out = out.replace(
		/strftime\('%s',\s*([^)]+)\)/gi,
		"EXTRACT(EPOCH FROM $1::timestamp)",
	);
	if (hadInsertOrIgnore && /\bON\s+CONFLICT\b/i.test(out) === false) {
		out = out.replace(/(;?\s*)$/, " ON CONFLICT DO NOTHING$1");
	}

	return out;
};
