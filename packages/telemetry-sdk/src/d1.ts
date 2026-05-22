/**
 * Cloudflare D1 instrumentation — wraps a `D1Database` binding so every
 * prepared-statement execution becomes a child span on the active request
 * span. Drop-in: returns an object that satisfies the `D1Database` interface
 * but transparently emits OpenTelemetry-shaped spans.
 *
 * Conventions follow OTel semantic conventions for database calls:
 *   db.system     = "d1"
 *   db.statement  = the SQL (truncated to maxStatementChars)
 *   db.operation  = SELECT / INSERT / UPDATE / DELETE / DDL / EXEC / BATCH
 *   db.rows_read, db.rows_written, db.duration_ms — when the binding reports
 *
 * No-op when no active span exists (e.g., before initObservability runs or
 * outside a runWithSpan scope) — the SDK's `withChildSpan` falls through to
 * the underlying call.
 */

import { withChildSpan } from "./span";

const FIRST_WORD = /^\s*([A-Za-z]+)/;

const deriveOperation = (sql: string): string => {
	const match = FIRST_WORD.exec(sql);
	if (!match) return "UNKNOWN";
	const word = match[1].toUpperCase();
	// SQLite DDL doesn't fit one verb cleanly — bucket as DDL for cardinality.
	if (word === "CREATE" || word === "ALTER" || word === "DROP") return "DDL";
	return word;
};

const truncate = (s: string, max: number): string =>
	s.length > max ? `${s.slice(0, max)}…` : s;

const stampMeta = (
	span: { setAttribute(k: string, v: unknown): void },
	result: unknown,
): void => {
	if (!result || typeof result !== "object") return;
	const meta = (result as { meta?: unknown }).meta;
	if (!meta || typeof meta !== "object") return;
	const m = meta as Record<string, unknown>;
	if (typeof m.rows_read === "number")
		span.setAttribute("db.rows_read", m.rows_read);
	if (typeof m.rows_written === "number")
		span.setAttribute("db.rows_written", m.rows_written);
	if (typeof m.duration === "number")
		span.setAttribute("db.duration_ms", m.duration);
	if (typeof m.changes === "number") span.setAttribute("db.changes", m.changes);
};

export interface WrapD1Options {
	/** Span-name prefix; defaults to `"d1"`. Final name is `${prefix}.${operation.toLowerCase()}`. */
	spanNamePrefix?: string;
	/** Max chars of the SQL captured into `db.statement`. Defaults to 1024. */
	maxStatementChars?: number;
}

const EXEC_METHODS = new Set(["run", "all", "first", "raw"]);

/**
 * Wraps a `D1Database` to emit child spans for every prepared-statement
 * execution. The returned object behaves identically to the input.
 *
 * Usage:
 * ```ts
 * const db = wrapD1(env.DB);
 * await db.prepare("SELECT * FROM foo WHERE id = ?").bind(id).first();
 * // ↳ child span "d1.select" with db.statement / db.rows_read
 * ```
 */
export const wrapD1 = <T extends D1Database>(
	db: T,
	opts?: WrapD1Options,
): T => {
	const prefix = opts?.spanNamePrefix ?? "d1";
	const maxChars = opts?.maxStatementChars ?? 1024;

	const wrapStatement = (
		stmt: D1PreparedStatement,
		sql: string,
	): D1PreparedStatement =>
		new Proxy(stmt, {
			get(target, prop, receiver) {
				if (prop === "bind") {
					return (...args: unknown[]) => {
						const bound = (
							target.bind as (...a: unknown[]) => D1PreparedStatement
						)(...args);
						return wrapStatement(bound, sql);
					};
				}
				if (typeof prop === "string" && EXEC_METHODS.has(prop)) {
					const method = (target as unknown as Record<string, unknown>)[prop];
					if (typeof method !== "function")
						return Reflect.get(target, prop, receiver);
					return async (...args: unknown[]) => {
						const operation = deriveOperation(sql);
						return withChildSpan(
							`${prefix}.${operation.toLowerCase()}`,
							async (span) => {
								span.setAttribute("db.system", "d1");
								span.setAttribute("db.operation", operation);
								span.setAttribute("db.statement", truncate(sql, maxChars));
								try {
									const result = await (
										method as (...a: unknown[]) => Promise<unknown>
									).call(target, ...args);
									stampMeta(span, result);
									return result;
								} catch (err) {
									span.setStatus(
										2,
										err instanceof Error ? err.message : String(err),
									);
									throw err;
								}
							},
						);
					};
				}
				return Reflect.get(target, prop, receiver);
			},
		});

	return new Proxy(db, {
		get(target, prop, receiver) {
			if (prop === "prepare") {
				return (sql: string) => {
					const stmt = target.prepare(sql);
					return wrapStatement(stmt, sql);
				};
			}
			if (prop === "batch") {
				return async (statements: D1PreparedStatement[]) =>
					withChildSpan(`${prefix}.batch`, async (span) => {
						span.setAttribute("db.system", "d1");
						span.setAttribute("db.operation", "BATCH");
						span.setAttribute("db.batch.size", statements.length);
						try {
							const result = await target.batch(statements);
							return result;
						} catch (err) {
							span.setStatus(
								2,
								err instanceof Error ? err.message : String(err),
							);
							throw err;
						}
					});
			}
			if (prop === "exec") {
				return async (sql: string) =>
					withChildSpan(`${prefix}.exec`, async (span) => {
						span.setAttribute("db.system", "d1");
						span.setAttribute("db.operation", "EXEC");
						span.setAttribute("db.statement", truncate(sql, maxChars));
						try {
							const result = await target.exec(sql);
							return result;
						} catch (err) {
							span.setStatus(
								2,
								err instanceof Error ? err.message : String(err),
							);
							throw err;
						}
					});
			}
			return Reflect.get(target, prop, receiver);
		},
	}) as T;
};
