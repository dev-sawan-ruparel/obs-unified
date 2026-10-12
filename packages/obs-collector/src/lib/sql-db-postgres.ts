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
 *  - SQLite built-ins used by the shared analysis SQL (`datetime`,
 *    `strftime`, `julianday`, `json_object`, `json_extract`, scalar
 *    `MAX`/`MIN`, …) are rewritten to Postgres equivalents by
 *    `translateD1Sql`. Timestamp columns are TEXT on both backends, so
 *    time windows are rendered as ISO text rather than `timestamptz`.
 *  - Result types: `pg` returns BIGINT/NUMERIC as strings, BOOLEAN as
 *    JS booleans and JSON/JSONB as parsed objects. Hosts must call
 *    `configurePostgresTypeParsers(pg.types)` once so rows come back in
 *    the D1 shape the stores expect (numbers, 0/1 flags, JSON text).
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
import {
	postgresDialect,
	postgresIsoText,
	type SqlDb,
	type SqlStatement,
} from "./sql-db";

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
		const translated = prepareSqlForPostgres(sql);
		return new PostgresStatement(
			this.pool,
			translated,
			mixedCaseAliases(translated),
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
	constructor(
		private readonly pool: Pool,
		private readonly sql: string,
		private readonly aliases: ReadonlyMap<string, string> = new Map(),
		private readonly bound: readonly unknown[] = [],
	) {}

	/**
	 * Returns a NEW statement, matching D1 semantics. Stores prepare once and
	 * bind per row (`calls.map((c) => stmt.bind(...))`), so mutating in place
	 * would make every statement in a batch carry the last row's values.
	 */
	bind(...args: unknown[]): SqlStatement {
		return new PostgresStatement(this.pool, this.sql, this.aliases, args);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const result = await this.exec<T & QueryResultRow>();
		const row = result.rows[0] as T | undefined;
		return row === undefined ? null : this.restoreAliases(row);
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const result = await this.exec<T & QueryResultRow>();
		return {
			results: (result.rows as unknown as T[]).map((row) =>
				this.restoreAliases(row),
			),
		};
	}

	/**
	 * Postgres folds unquoted identifiers to lower case, so `COUNT(*) AS
	 * totalCalls` comes back as `totalcalls`. D1 preserves the alias. Put the
	 * mixed-case spelling back so stores can read `row.totalCalls` on both.
	 */
	private restoreAliases<T>(row: T): T {
		if (this.aliases.size === 0 || !row || typeof row !== "object") return row;
		const out = row as Record<string, unknown>;
		for (const [lower, original] of this.aliases) {
			if (lower in out && !(original in out)) {
				out[original] = out[lower];
				delete out[lower];
			}
		}
		return row;
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
		const r = await client.query(this.sql, [...this.bound]);
		return { meta: { changes: r.rowCount ?? 0 } };
	}

	private async exec<T extends QueryResultRow = QueryResultRow>(): Promise<{
		rows: T[];
		rowCount: number | null;
	}> {
		const client = await this.pool.connect();
		try {
			const r = await client.query<T>(this.sql, [...this.bound]);
			return { rows: r.rows, rowCount: r.rowCount };
		} finally {
			client.release();
		}
	}
}

/**
 * Install `pg` result-type parsers so Postgres rows match the shape D1
 * returns and the shared stores keep working unchanged:
 *
 *  - BOOLEAN  → 0 / 1       (D1 stores flags as INTEGER; stores compare `=== 1`)
 *  - BIGINT   → number      (`COUNT(*)`, `SUM(bigint)` would otherwise be strings;
 *                            integral values above MAX_SAFE_INTEGER throw)
 *  - NUMERIC  → number      (`SUM`, `EXTRACT(EPOCH …)`; same overflow rule)
 *  - JSON/JSONB → raw text  (stores `JSON.parse` the column themselves)
 *
 * Call once per process before issuing queries, e.g.
 * `configurePostgresTypeParsers(pg.types)` in the Node entrypoint.
 */
export interface PostgresTypeParserRegistry {
	setTypeParser(oid: number, parser: (value: string) => unknown): void;
}

export const POSTGRES_TYPE_OIDS = {
	BOOL: 16,
	INT8: 20,
	JSON: 114,
	NUMERIC: 1700,
	JSONB: 3802,
} as const;

/**
 * Convert a BIGINT/NUMERIC text value to a JS number. Integral values beyond
 * `Number.MAX_SAFE_INTEGER` cannot be represented exactly, so the query fails
 * loudly instead of returning a silently rounded count. Fractional NUMERIC
 * values round to double precision like D1's REAL. Exported for tests.
 */
export const parsePostgresNumber = (
	value: string,
	typeName: "BIGINT" | "NUMERIC",
): number => {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new RangeError(
			`PostgresAdapter: cannot convert ${typeName} value ${JSON.stringify(value)} to a JS number`,
		);
	}
	if (/^-?\d+$/.test(value) && !Number.isSafeInteger(parsed)) {
		throw new RangeError(
			`PostgresAdapter: ${typeName} value ${value} exceeds Number.MAX_SAFE_INTEGER (${Number.MAX_SAFE_INTEGER}); cast it to TEXT in SQL if the exact value is needed`,
		);
	}
	return parsed;
};

export const configurePostgresTypeParsers = (
	types: PostgresTypeParserRegistry,
): void => {
	types.setTypeParser(POSTGRES_TYPE_OIDS.BOOL, (value) =>
		value === "t" || value === "true" ? 1 : 0,
	);
	types.setTypeParser(POSTGRES_TYPE_OIDS.INT8, (value) =>
		parsePostgresNumber(value, "BIGINT"),
	);
	types.setTypeParser(POSTGRES_TYPE_OIDS.NUMERIC, (value) =>
		parsePostgresNumber(value, "NUMERIC"),
	);
	types.setTypeParser(POSTGRES_TYPE_OIDS.JSON, (value) => value);
	types.setTypeParser(POSTGRES_TYPE_OIDS.JSONB, (value) => value);
};

/**
 * Full D1 → Postgres statement pipeline used by `prepare`: strip SQL
 * comments (apostrophes inside `-- …` would otherwise confuse the quote
 * tracking below), number the placeholders, translate SQLite built-ins.
 */
export const prepareSqlForPostgres = (sql: string): string =>
	translateD1Sql(rewriteQuestionMarks(stripSqlComments(sql)));

/**
 * Remove `-- line` and `/* block *\/` comments outside string literals.
 * Line breaks are preserved so the statement keeps its shape.
 */
export const stripSqlComments = (sql: string): string => {
	let out = "";
	let inString = false;
	for (let i = 0; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'") {
			inString = !inString;
			out += ch;
			continue;
		}
		if (inString) {
			out += ch;
			continue;
		}
		if (ch === "-" && sql[i + 1] === "-") {
			const eol = sql.indexOf("\n", i);
			if (eol === -1) return out;
			i = eol - 1;
			continue;
		}
		if (ch === "/" && sql[i + 1] === "*") {
			const end = sql.indexOf("*/", i + 2);
			if (end === -1) return out;
			i = end + 1;
			continue;
		}
		out += ch;
	}
	return out;
};

/**
 * Collect `AS alias` names that mix upper and lower case (e.g. `totalCalls`)
 * from the parts of the statement outside string literals, keyed by the
 * lower-cased spelling Postgres will return. All-caps words are skipped so
 * `CAST(x AS REAL)` is not mistaken for an alias.
 */
export const mixedCaseAliases = (sql: string): Map<string, string> => {
	const aliases = new Map<string, string>();
	const pattern = /\bAS\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
	stripSqlComments(sql)
		.split("'")
		// Even-indexed segments are outside quotes (odd ones are literals).
		.filter((_segment, index) => index % 2 === 0)
		.forEach((segment) => {
			for (const match of segment.matchAll(pattern)) {
				const alias = match[1];
				if (alias !== alias.toLowerCase() && alias !== alias.toUpperCase()) {
					aliases.set(alias.toLowerCase(), alias);
				}
			}
		});
	return aliases;
};

// D1 → Postgres placeholder rewrite. Walks the string once; tracks
// whether we're inside a single-quoted string literal so that '?' inside
// strings isn't rewritten. Doesn't handle dollar-quoted strings — none
// of the collector's SQL uses them.
export const rewriteQuestionMarks = (sql: string): string => {
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

const UTC_NOW = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')";
const INTERVAL_UNITS = /^(hour|hours|minute|minutes|day|days|second|seconds)$/i;

/** `'-5 minutes'` → `INTERVAL '5 minutes'`; `'-' || $1 || ' hours'` → `($1::text || ' hours')::interval`. */
const sqliteModifierToInterval = (modifier: string): string | null => {
	const literal = /^'-(\d+)\s+([a-z]+)'$/i.exec(modifier);
	if (literal && INTERVAL_UNITS.test(literal[2])) {
		return `INTERVAL '${literal[1]} ${literal[2].toLowerCase()}'`;
	}
	const concat = /^'-'\s*\|\|\s*(.+?)\s*\|\|\s*'\s*([a-z]+)'$/i.exec(modifier);
	if (concat && INTERVAL_UNITS.test(concat[2])) {
		return `(${concat[1].trim()}::text || ' ${concat[2].toLowerCase()}')::interval`;
	}
	return null;
};

const asUtcTimestamp = (expr: string): string =>
	`(${expr})::timestamptz AT TIME ZONE 'UTC'`;

const STRFTIME_FORMATS: Record<string, (expr: string) => string> = {
	"%Y-%m-%dT%H:%M:00Z": (expr) =>
		`to_char(date_trunc('minute', ${asUtcTimestamp(expr)}), 'YYYY-MM-DD"T"HH24:MI:00"Z"')`,
	"%Y-%m-%dT%H:00:00Z": (expr) =>
		`to_char(date_trunc('hour', ${asUtcTimestamp(expr)}), 'YYYY-MM-DD"T"HH24:00:00"Z"')`,
	"%s": (expr) => `EXTRACT(EPOCH FROM (${expr})::timestamptz)`,
};

const unquote = (literal: string): string | null => {
	const m = /^'((?:[^']|'')*)'$/.exec(literal.trim());
	return m ? m[1].replace(/''/g, "'") : null;
};

const jsonPathToPostgres = (
	expr: string,
	pathLiteral: string,
): string | null => {
	const path = unquote(pathLiteral);
	if (!path?.startsWith("$.")) return null;
	const rest = path.slice(2);
	const quoted = /^"([^"]+)"$/.exec(rest);
	const escapeKey = (key: string) =>
		key.replace(/\\u002E/g, ".").replace(/'/g, "''");
	if (quoted) return `((${expr})::jsonb ->> '${escapeKey(quoted[1])}')`;
	if (!/^[A-Za-z0-9_.\\]+$/.test(rest)) return null;
	const segments = rest.split(".").map(escapeKey);
	if (segments.length === 1) return `((${expr})::jsonb ->> '${segments[0]}')`;
	return `((${expr})::jsonb #>> '{${segments.join(",")}}')`;
};

/**
 * SQLite → Postgres function rewrites. Each receives the already-translated
 * argument list and returns the replacement, or `null` to leave the call
 * untouched.
 */
const FUNCTION_REWRITES: Record<string, (args: string[]) => string | null> = {
	datetime: (args) => {
		if (args.length === 1 && /^'now'$/i.test(args[0])) {
			return postgresIsoText(UTC_NOW);
		}
		if (args.length === 2 && /^'now'$/i.test(args[0])) {
			const interval = sqliteModifierToInterval(args[1]);
			return interval ? postgresIsoText(`${UTC_NOW} - ${interval}`) : null;
		}
		if (args.length === 2 && /^'unixepoch'$/i.test(args[1])) {
			return `to_timestamp(${args[0]})`;
		}
		return null;
	},
	strftime: (args) => {
		if (args.length !== 2) return null;
		const format = unquote(args[0]);
		const render = format ? STRFTIME_FORMATS[format] : undefined;
		return render ? render(args[1]) : null;
	},
	julianday: (args) =>
		args.length === 1
			? `(EXTRACT(EPOCH FROM (${args[0]})::timestamptz) / 86400.0 + 2440587.5)`
			: null,
	json_extract: (args) =>
		args.length === 2 ? jsonPathToPostgres(args[0], args[1]) : null,
	json_object: (args) => `json_build_object(${args.join(", ")})`,
	json_array: (args) => `json_build_array(${args.join(", ")})`,
	json_group_array: (args) => `json_agg(${args.join(", ")})`,
	// SQLite's scalar MAX/MIN take several arguments; Postgres spells those
	// GREATEST/LEAST. Single-argument MAX/MIN stay aggregates.
	max: (args) => (args.length > 1 ? `GREATEST(${args.join(", ")})` : null),
	min: (args) => (args.length > 1 ? `LEAST(${args.join(", ")})` : null),
	// Postgres only defines ROUND(numeric, int); SQLite rounds REAL directly.
	round: (args) =>
		args.length === 2 ? `ROUND((${args[0]})::numeric, ${args[1]})` : null,
};

const FUNCTION_NAME_PATTERN = new RegExp(
	`\\b(${Object.keys(FUNCTION_REWRITES).join("|")})\\s*\\(`,
	"i",
);

const isIdentifierChar = (ch: string | undefined): boolean =>
	ch !== undefined && /[A-Za-z0-9_.]/.test(ch);

/**
 * Find the index of the `)` closing the call whose `(` is at `open`,
 * skipping parentheses inside single-quoted literals. Returns -1 when the
 * SQL is unbalanced.
 */
const findClosingParen = (sql: string, open: number): number => {
	let depth = 0;
	let inString = false;
	for (let i = open; i < sql.length; i++) {
		const ch = sql[i];
		if (ch === "'") {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (ch === "(") depth += 1;
		else if (ch === ")") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
};

/** Split a call's argument text on top-level commas (outside quotes/parens). */
const splitTopLevelArgs = (inner: string): string[] => {
	const args: string[] = [];
	let depth = 0;
	let inString = false;
	let current = "";
	for (const ch of inner) {
		if (ch === "'") inString = !inString;
		if (!inString) {
			if (ch === "(") depth += 1;
			else if (ch === ")") depth -= 1;
			else if (ch === "," && depth === 0) {
				args.push(current.trim());
				current = "";
				continue;
			}
		}
		current += ch;
	}
	if (current.trim() !== "" || args.length > 0) args.push(current.trim());
	return args;
};

/** Does `index` fall inside a single-quoted literal of `sql`? */
const insideStringLiteral = (sql: string, index: number): boolean => {
	let inString = false;
	for (let i = 0; i < index; i++) {
		if (sql[i] === "'") inString = !inString;
	}
	return inString;
};

const translateFunctionCalls = (sql: string): string => {
	let out = "";
	let rest = sql;
	for (;;) {
		const match = FUNCTION_NAME_PATTERN.exec(rest);
		if (!match) return out + rest;
		const start = match.index;
		const open = start + match[0].length - 1;
		if (insideStringLiteral(rest, start)) {
			// Skip the rest of the literal so quote tracking stays in sync.
			const closeQuote = rest.indexOf("'", start);
			const cut = closeQuote === -1 ? rest.length : closeQuote + 1;
			out += rest.slice(0, cut);
			rest = rest.slice(cut);
			continue;
		}
		const precededByIdentifier = isIdentifierChar(rest[start - 1]);
		const close = findClosingParen(rest, open);
		if (precededByIdentifier || close === -1) {
			out += rest.slice(0, open + 1);
			rest = rest.slice(open + 1);
			continue;
		}
		const name = match[1].toLowerCase();
		const inner = translateFunctionCalls(rest.slice(open + 1, close));
		const replacement = FUNCTION_REWRITES[name](splitTopLevelArgs(inner));
		out += rest.slice(0, start);
		out += replacement ?? `${match[1]}(${inner})`;
		rest = rest.slice(close + 1);
	}
};

/**
 * Translate SQL written against SQLite/D1 into Postgres. Placeholders must
 * already be `$N` (see `rewriteQuestionMarks`). Exported for tests.
 */
export const translateD1Sql = (sql: string): string => {
	let out = sql;
	const hadInsertOrIgnore = /\bINSERT\s+OR\s+IGNORE\s+INTO\b/i.test(out);

	out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, "INSERT INTO");
	out = translateFunctionCalls(out);

	if (hadInsertOrIgnore && /\bON\s+CONFLICT\b/i.test(out) === false) {
		out = out.replace(/(;?\s*)$/, " ON CONFLICT DO NOTHING$1");
	}

	return out;
};
