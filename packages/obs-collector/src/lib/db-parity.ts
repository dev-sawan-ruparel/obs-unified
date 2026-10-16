/**
 * Native-engine schema introspection and semantic parity comparator for
 * SQLite (`node:sqlite` / D1) and PostgreSQL (`pg`).
 *
 * Workstream 4 (RFC 0014): Rather than interpreting Postgres DDL in SQLite or
 * relying on regexes over raw `.sql` text, this module executes each migration
 * suite on its native engine, introspects the resulting catalogs, normalizes
 * documented logical representations (`INTEGER` <-> `bigint`/`integer`/`boolean`,
 * `REAL` <-> `double precision`/`real`, `TEXT` <-> `text`/`jsonb`), and
 * reports any structural or semantic drift across tables, columns, defaults,
 * primary keys, unique/foreign-key/check constraints, and partial/B-tree
 * indexes.
 */

import type { DatabaseSync } from "node:sqlite";

export type LogicalColumnType =
	| "text"
	| "integer"
	| "float"
	| "timestamptz"
	| "other";

export interface NormalizedColumn {
	name: string;
	rawType: string;
	logicalType: LogicalColumnType;
	notNull: boolean;
	defaultValue: string | null;
}

export interface NormalizedForeignKey {
	columns: string[];
	refTable: string;
	refColumns: string[];
	onDelete: string;
	onUpdate: string;
}

export interface NormalizedIndex {
	name: string;
	unique: boolean;
	method: "btree" | "gin" | string;
	columns: string[];
	where: string | null;
}

export interface NormalizedTableSchema {
	name: string;
	columns: Record<string, NormalizedColumn>;
	primaryKey: string[];
	uniqueConstraints: string[][];
	foreignKeys: NormalizedForeignKey[];
	checkConstraints: string[];
	indexes: Record<string, NormalizedIndex>;
}

export interface NormalizedDatabaseSchema {
	engine: "sqlite" | "postgres";
	tables: Record<string, NormalizedTableSchema>;
}

export interface SchemaParityDifference {
	table: string;
	kind:
		| "missing_table"
		| "missing_column"
		| "column_type"
		| "column_nullability"
		| "column_default"
		| "primary_key"
		| "unique_constraint"
		| "foreign_key"
		| "check_constraint"
		| "missing_index"
		| "index_unique"
		| "index_columns"
		| "index_where";
	detail: string;
}

export interface SchemaParityReport {
	ok: boolean;
	tableCount: number;
	differences: SchemaParityDifference[];
}

export interface PgQueryClient {
	query<R = Record<string, unknown>>(
		sql: string,
		params?: unknown[],
	): Promise<{ rows: R[] }>;
}

/**
 * Narrowly scoped, documented engine representation exceptions:
 * 1. Migration 040 (`evidence_retrieval_refs`, `evidence_ref_expansions`)
 *    declares non-retention audit timestamps as `TIMESTAMPTZ` on Postgres and
 *    `TEXT` on SQLite.
 * 2. Postgres migrations add `USING GIN` indexes on `JSONB` columns (see
 *    `migrations-postgres/README.md`).
 */
export const DOCUMENTED_TIMESTAMPTZ_COLUMNS = new Set<string>([
	"evidence_ref_expansions.expanded_at",
	"evidence_retrieval_refs.issued_at",
	"evidence_retrieval_refs.last_seen_at",
	"evidence_retrieval_refs.expires_at",
]);

export const DOCUMENTED_POSTGRES_GIN_INDEXES = new Set<string>([
	"actions.idx_actions_attrs_gin",
	"agent_runs.idx_agent_runs_metadata_gin",
	"eval_case_results.idx_eval_case_results_details_gin",
	"eval_cases.idx_eval_cases_metadata_gin",
	"eval_results.idx_eval_results_rubric_gin",
	"eval_runs.idx_eval_runs_metadata_gin",
	"profile_blobs.idx_profile_blobs_resource_attrs_gin",
	"retrieval_events.idx_retrieval_events_docs_gin",
	"telemetry_spans.idx_spans_attributes_gin",
	"tool_calls.idx_tool_calls_args_redacted_gin",
	"tool_calls.idx_tool_calls_result_redacted_gin",
]);

export function normalizeSqliteType(rawType: string): LogicalColumnType {
	const upper = rawType.trim().toUpperCase();
	if (upper === "TEXT" || upper.startsWith("VARCHAR")) return "text";
	if (upper === "INTEGER" || upper === "INT" || upper === "BIGINT") {
		return "integer";
	}
	if (upper === "REAL" || upper === "DOUBLE" || upper === "FLOAT") {
		return "float";
	}
	return "other";
}

export function normalizePostgresType(rawType: string): LogicalColumnType {
	const lower = rawType.trim().toLowerCase();
	if (
		lower === "text" ||
		lower === "character varying" ||
		lower === "jsonb" ||
		lower === "json"
	) {
		return "text";
	}
	if (
		lower === "integer" ||
		lower === "bigint" ||
		lower === "smallint" ||
		lower === "boolean"
	) {
		return "integer";
	}
	if (lower === "double precision" || lower === "real" || lower === "numeric") {
		return "float";
	}
	if (lower === "timestamp with time zone") {
		return "timestamptz";
	}
	return "other";
}

export function normalizeDefaultValue(
	rawDefault: string | null | undefined,
	rawType: string,
): string | null {
	if (rawDefault === null || rawDefault === undefined) return null;
	let expr = rawDefault.trim();
	// Strip outer parentheses if balanced
	while (expr.startsWith("(") && expr.endsWith(")")) {
		const inner = expr.slice(1, -1).trim();
		let depth = 0;
		let balanced = true;
		for (const ch of inner) {
			if (ch === "(") depth += 1;
			else if (ch === ")") {
				depth -= 1;
				if (depth < 0) {
					balanced = false;
					break;
				}
			}
		}
		if (balanced && depth === 0) {
			expr = inner;
		} else {
			break;
		}
	}
	// Strip Postgres type casts like ::text, ::jsonb, ::character varying
	expr = expr.replace(/::[a-z_]+(?:\s+[a-z_]+)*/gi, "").trim();

	// Normalize boolean/integer flag defaults (0/1 <-> false/true)
	const lowerType = rawType.trim().toLowerCase();
	if (
		lowerType === "boolean" ||
		lowerType === "integer" ||
		lowerType === "bigint"
	) {
		if (expr.toLowerCase() === "false" || expr === "'0'") return "0";
		if (expr.toLowerCase() === "true" || expr === "'1'") return "1";
	}

	// Normalize current-timestamp defaults
	if (
		/^datetime\(\s*'now'\s*\)$/i.test(expr) ||
		/^current_timestamp$/i.test(expr) ||
		/^now\(\)$/i.test(expr)
	) {
		return "CURRENT_TIMESTAMP";
	}

	return expr;
}

/**
 * Normalizes a partial-index `WHERE` predicate or `CHECK` constraint expression
 * across SQLite and Postgres while preserving column names, operators, and
 * literal values so any semantic predicate change is caught.
 */
export function normalizeSqlPredicate(
	rawPredicate: string | null | undefined,
): string | null {
	if (!rawPredicate) return null;
	let s = rawPredicate.trim();
	// Remove leading WHERE or CHECK keyword if present
	s = s.replace(/^(?:WHERE|CHECK)\s+/i, "").trim();

	// Strip Postgres type casts such as ::text, ::jsonb, ::integer, ::bigint
	s = s.replace(/::[a-z_]+(?:\s+[a-z_]+)*(?:\[\])?/gi, "");

	// Convert Postgres `col = ANY (ARRAY['a', 'b'])` into `col IN ('a', 'b')`
	s = s.replace(
		/([a-zA-Z0-9_.]+)\s*=\s*ANY\s*\(\s*ARRAY\[([^\]]+)\]\s*\)/gi,
		(_match, col: string, list: string) => `${col} IN (${list})`,
	);

	// Normalize <> to !=
	s = s.replace(/<>/g, "!=");

	// Strip redundant parentheses around simple comparisons like (col IS NOT NULL)
	const stripBalancedParens = (input: string): string => {
		let cur = input.trim();
		while (cur.startsWith("(") && cur.endsWith(")")) {
			const inner = cur.slice(1, -1).trim();
			let depth = 0;
			let inQuotes = false;
			let balanced = true;
			for (let i = 0; i < inner.length; i += 1) {
				const ch = inner[i];
				if (ch === "'") inQuotes = !inQuotes;
				else if (!inQuotes) {
					if (ch === "(") depth += 1;
					else if (ch === ")") {
						depth -= 1;
						if (depth < 0) {
							balanced = false;
							break;
						}
					}
				}
			}
			if (balanced && depth === 0) {
				cur = inner;
			} else {
				break;
			}
		}
		return cur;
	};

	s = stripBalancedParens(s);
	// Also strip parentheses around simple `(a IS NOT NULL)` / `(a != '[]')` clauses inside AND chains
	s = s.replace(/\(([^()]+)\)/g, (full, inner: string) => {
		if (/^\s*'[a-zA-Z0-9_'\s,]+'\s*$/.test(inner) || inner.includes(",")) {
			// Keep `IN ('a', 'b')` list parentheses intact
			return full;
		}
		return inner.trim();
	});

	// Normalize SQL keywords outside single-quoted literals to uppercase and collapse whitespace
	const parts = s.split(/('(?:''|[^'])*')/g);
	s = parts
		.map((part, idx) => {
			if (idx % 2 === 1) return part;
			return part
				.replace(/\s+/g, " ")
				.replace(/\b(is|not|null|and|or|in|true|false)\b/gi, (kw) =>
					kw.toUpperCase(),
				);
		})
		.join("")
		.replace(/\s+/g, " ")
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")")
		.trim();

	return s;
}

function parseIndexColumnsFromSql(
	indexSql: string,
	engine: "sqlite" | "postgres",
): { columns: string[]; where: string | null } {
	const cleaned = indexSql.replace(/\s+/g, " ").trim();
	let colsPart = "";
	let restAfterCols = "";

	const onMatch =
		engine === "postgres"
			? /USING\s+[a-z0-9_]+\s*\(/i.exec(cleaned)
			: /ON\s+[a-zA-Z0-9_."]+\s*\(/i.exec(cleaned);

	if (onMatch && onMatch.index !== undefined) {
		const start = onMatch.index + onMatch[0].length;
		let depth = 1;
		let inQuotes = false;
		let end = start;
		for (; end < cleaned.length; end += 1) {
			const ch = cleaned[end];
			if (ch === "'") inQuotes = !inQuotes;
			else if (!inQuotes) {
				if (ch === "(") depth += 1;
				else if (ch === ")") {
					depth -= 1;
					if (depth === 0) break;
				}
			}
		}
		colsPart = cleaned.slice(start, end);
		restAfterCols = cleaned.slice(end + 1).trim();
	}

	const columns = colsPart
		.split(",")
		.map((c) => {
			const tokens = c.trim().replace(/"/g, "").split(/\s+/);
			const dir =
				tokens.length > 1 && tokens[tokens.length - 1].toUpperCase() === "DESC"
					? "DESC"
					: "ASC";
			const colExpr =
				tokens.length > 1 &&
				(tokens[tokens.length - 1].toUpperCase() === "ASC" ||
					tokens[tokens.length - 1].toUpperCase() === "DESC")
					? tokens.slice(0, -1).join(" ")
					: tokens.join(" ");
			return `${colExpr} ${dir}`;
		})
		.filter(Boolean);

	const whereMatch = /^WHERE\s+(.+)$/i.exec(restAfterCols);
	const where = whereMatch ? normalizeSqlPredicate(whereMatch[1]) : null;
	return { columns, where };
}

function extractSqliteCheckConstraints(tableSql: string | null): string[] {
	if (!tableSql) return [];
	const checks: string[] = [];
	const upper = tableSql.toUpperCase();
	let pos = 0;
	while (pos < tableSql.length) {
		const match = /\bCHECK\s*\(/gi;
		match.lastIndex = pos;
		const found = match.exec(upper);
		if (!found || found.index === undefined) break;
		const start = found.index + found[0].length;
		let depth = 1;
		let inQuotes = false;
		let end = start;
		for (; end < tableSql.length; end += 1) {
			const ch = tableSql[end];
			if (ch === "'") inQuotes = !inQuotes;
			else if (!inQuotes) {
				if (ch === "(") depth += 1;
				else if (ch === ")") {
					depth -= 1;
					if (depth === 0) break;
				}
			}
		}
		const normalized = normalizeSqlPredicate(tableSql.slice(start, end));
		if (normalized) checks.push(normalized);
		pos = end + 1;
	}
	return checks.sort();
}

export function introspectSqliteSchema(
	db: DatabaseSync,
): NormalizedDatabaseSchema {
	const tableRows = db
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
		)
		.all() as Array<{ name: string; sql: string | null }>;

	const tables: Record<string, NormalizedTableSchema> = {};

	for (const { name: tableName, sql: tableSql } of tableRows) {
		const colRows = db
			.prepare(`PRAGMA table_info(${tableName})`)
			.all() as Array<{
			cid: number;
			name: string;
			type: string;
			notnull: number;
			dflt_value: string | null;
			pk: number;
		}>;

		const columns: Record<string, NormalizedColumn> = {};
		for (const c of colRows) {
			columns[c.name] = {
				name: c.name,
				rawType: c.type,
				logicalType: normalizeSqliteType(c.type),
				notNull: c.notnull === 1 || c.pk > 0,
				defaultValue: normalizeDefaultValue(c.dflt_value, c.type),
			};
		}

		const primaryKey = colRows
			.filter((c) => c.pk > 0)
			.sort((a, b) => a.pk - b.pk)
			.map((c) => c.name);

		const indexList = db
			.prepare(`PRAGMA index_list(${tableName})`)
			.all() as Array<{
			seq: number;
			name: string;
			unique: number;
			origin: string;
			partial: number;
		}>;

		const uniqueConstraints: string[][] = [];
		for (const idx of indexList) {
			if (idx.origin === "u") {
				const info = db
					.prepare(`PRAGMA index_info(${idx.name})`)
					.all() as Array<{ seqno: number; cid: number; name: string }>;
				uniqueConstraints.push(
					info.sort((a, b) => a.seqno - b.seqno).map((x) => x.name),
				);
			}
		}
		uniqueConstraints.sort((a, b) => a.join(",").localeCompare(b.join(",")));

		const fkRows = db
			.prepare(`PRAGMA foreign_key_list(${tableName})`)
			.all() as Array<{
			id: number;
			seq: number;
			table: string;
			from: string;
			to: string;
			on_update: string;
			on_delete: string;
		}>;
		const fkById = new Map<number, typeof fkRows>();
		for (const row of fkRows) {
			const group = fkById.get(row.id) ?? [];
			group.push(row);
			fkById.set(row.id, group);
		}
		const foreignKeys: NormalizedForeignKey[] = [...fkById.values()]
			.map((group) => {
				const sorted = group.sort((a, b) => a.seq - b.seq);
				return {
					columns: sorted.map((r) => r.from),
					refTable: sorted[0].table,
					refColumns: sorted.map((r) => r.to),
					onDelete: (sorted[0].on_delete || "NO ACTION").toUpperCase(),
					onUpdate: (sorted[0].on_update || "NO ACTION").toUpperCase(),
				};
			})
			.sort((a, b) =>
				`${a.columns.join(",")}->${a.refTable}`.localeCompare(
					`${b.columns.join(",")}->${b.refTable}`,
				),
			);

		const checkConstraints = extractSqliteCheckConstraints(tableSql);

		const explicitIdxRows = db
			.prepare(
				"SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL ORDER BY name",
			)
			.all(tableName) as Array<{ name: string; sql: string }>;

		const indexes: Record<string, NormalizedIndex> = {};
		for (const idxRow of explicitIdxRows) {
			const listEntry = indexList.find((x) => x.name === idxRow.name);
			const parsed = parseIndexColumnsFromSql(idxRow.sql, "sqlite");
			indexes[idxRow.name] = {
				name: idxRow.name,
				unique:
					listEntry !== undefined
						? listEntry.unique === 1
						: /^CREATE\s+UNIQUE\s+INDEX/i.test(idxRow.sql.trim()),
				method: "btree",
				columns: parsed.columns,
				where: parsed.where,
			};
		}

		tables[tableName] = {
			name: tableName,
			columns,
			primaryKey,
			uniqueConstraints,
			foreignKeys,
			checkConstraints,
			indexes,
		};
	}

	return { engine: "sqlite", tables };
}

export async function introspectPostgresSchema(
	client: PgQueryClient,
	schemaName = "public",
): Promise<NormalizedDatabaseSchema> {
	const tableRes = await client.query<{ table_name: string }>(
		`SELECT table_name
		 FROM information_schema.tables
		 WHERE table_schema = $1 AND table_type = 'BASE TABLE'
		 ORDER BY table_name`,
		[schemaName],
	);

	const tables: Record<string, NormalizedTableSchema> = {};

	for (const { table_name: tableName } of tableRes.rows) {
		const colRes = await client.query<{
			column_name: string;
			data_type: string;
			is_nullable: string;
			column_default: string | null;
		}>(
			`SELECT column_name, data_type, is_nullable, column_default
			 FROM information_schema.columns
			 WHERE table_schema = $1 AND table_name = $2
			 ORDER BY ordinal_position`,
			[schemaName, tableName],
		);

		const columns: Record<string, NormalizedColumn> = {};
		for (const c of colRes.rows) {
			columns[c.column_name] = {
				name: c.column_name,
				rawType: c.data_type,
				logicalType: normalizePostgresType(c.data_type),
				notNull: c.is_nullable === "NO",
				defaultValue: normalizeDefaultValue(c.column_default, c.data_type),
			};
		}

		const pkRes = await client.query<{ attname: string }>(
			`SELECT a.attname
			 FROM pg_index i
			 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
			 JOIN pg_class t ON t.oid = i.indrelid
			 JOIN pg_namespace n ON n.oid = t.relnamespace
			 WHERE n.nspname = $1 AND t.relname = $2 AND i.indisprimary
			 ORDER BY array_position(i.indkey, a.attnum)`,
			[schemaName, tableName],
		);
		const primaryKey = pkRes.rows.map((r) => r.attname);

		const constraintRes = await client.query<{
			contype: string;
			def: string;
		}>(
			`SELECT c.contype, pg_get_constraintdef(c.oid) AS def
			 FROM pg_constraint c
			 JOIN pg_class t ON t.oid = c.conrelid
			 JOIN pg_namespace n ON n.oid = t.relnamespace
			 WHERE n.nspname = $1 AND t.relname = $2 AND c.contype IN ('u', 'f', 'c')
			 ORDER BY c.conname`,
			[schemaName, tableName],
		);

		const uniqueConstraints: string[][] = [];
		const foreignKeys: NormalizedForeignKey[] = [];
		const checkConstraints: string[] = [];

		for (const row of constraintRes.rows) {
			if (row.contype === "u") {
				const m = /^UNIQUE\s*\(([^)]+)\)/i.exec(row.def.trim());
				if (m) {
					uniqueConstraints.push(
						m[1].split(",").map((s) => s.trim().replace(/"/g, "")),
					);
				}
			} else if (row.contype === "f") {
				const m =
					/^FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+([a-zA-Z0-9_."]+)\(([^)]+)\)(.*)$/i.exec(
						row.def.trim(),
					);
				if (m) {
					const cols = m[1].split(",").map((s) => s.trim().replace(/"/g, ""));
					const refTable = m[2].replace(/^[^.]+\./, "").replace(/"/g, "");
					const refCols = m[3]
						.split(",")
						.map((s) => s.trim().replace(/"/g, ""));
					const tail = m[4] ?? "";
					const onDelete =
						/ON DELETE\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i
							.exec(tail)?.[1]
							?.toUpperCase() ?? "NO ACTION";
					const onUpdate =
						/ON UPDATE\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION)/i
							.exec(tail)?.[1]
							?.toUpperCase() ?? "NO ACTION";
					foreignKeys.push({
						columns: cols,
						refTable,
						refColumns: refCols,
						onDelete,
						onUpdate,
					});
				}
			} else if (row.contype === "c") {
				const norm = normalizeSqlPredicate(row.def);
				if (norm) checkConstraints.push(norm);
			}
		}

		uniqueConstraints.sort((a, b) => a.join(",").localeCompare(b.join(",")));
		foreignKeys.sort((a, b) =>
			`${a.columns.join(",")}->${a.refTable}`.localeCompare(
				`${b.columns.join(",")}->${b.refTable}`,
			),
		);
		checkConstraints.sort();

		const idxRes = await client.query<{
			name: string;
			sql: string;
			is_unique: boolean;
			amname: string;
		}>(
			`SELECT i.relname AS name,
			        pg_get_indexdef(ix.indexrelid) AS sql,
			        ix.indisunique AS is_unique,
			        am.amname AS amname
			 FROM pg_index ix
			 JOIN pg_class t ON t.oid = ix.indrelid
			 JOIN pg_class i ON i.oid = ix.indexrelid
			 JOIN pg_am am ON am.oid = i.relam
			 JOIN pg_namespace n ON n.oid = t.relnamespace
			 LEFT JOIN pg_constraint c ON c.conindid = ix.indexrelid
			 WHERE n.nspname = $1 AND t.relname = $2 AND c.oid IS NULL
			 ORDER BY i.relname`,
			[schemaName, tableName],
		);

		const indexes: Record<string, NormalizedIndex> = {};
		for (const idxRow of idxRes.rows) {
			const parsed = parseIndexColumnsFromSql(idxRow.sql, "postgres");
			indexes[idxRow.name] = {
				name: idxRow.name,
				unique: Boolean(idxRow.is_unique),
				method: idxRow.amname,
				columns: parsed.columns,
				where: parsed.where,
			};
		}

		tables[tableName] = {
			name: tableName,
			columns,
			primaryKey,
			uniqueConstraints,
			foreignKeys,
			checkConstraints,
			indexes,
		};
	}

	return { engine: "postgres", tables };
}

export function compareDatabaseSchemas(
	sqliteSchema: NormalizedDatabaseSchema,
	postgresSchema: NormalizedDatabaseSchema,
): SchemaParityReport {
	const differences: SchemaParityDifference[] = [];
	const allTableNames = new Set([
		...Object.keys(sqliteSchema.tables),
		...Object.keys(postgresSchema.tables),
	]);

	for (const tableName of [...allTableNames].sort()) {
		const sTable = sqliteSchema.tables[tableName];
		const pTable = postgresSchema.tables[tableName];
		if (!sTable) {
			differences.push({
				table: tableName,
				kind: "missing_table",
				detail: `Table "${tableName}" exists on Postgres but is missing on SQLite`,
			});
			continue;
		}
		if (!pTable) {
			differences.push({
				table: tableName,
				kind: "missing_table",
				detail: `Table "${tableName}" exists on SQLite but is missing on Postgres`,
			});
			continue;
		}

		// Compare columns
		const allColNames = new Set([
			...Object.keys(sTable.columns),
			...Object.keys(pTable.columns),
		]);
		for (const colName of [...allColNames].sort()) {
			const sCol = sTable.columns[colName];
			const pCol = pTable.columns[colName];
			if (!sCol) {
				differences.push({
					table: tableName,
					kind: "missing_column",
					detail: `Column "${tableName}.${colName}" exists on Postgres (${pCol.rawType}) but is missing on SQLite`,
				});
				continue;
			}
			if (!pCol) {
				differences.push({
					table: tableName,
					kind: "missing_column",
					detail: `Column "${tableName}.${colName}" exists on SQLite (${sCol.rawType}) but is missing on Postgres`,
				});
				continue;
			}

			const fullColKey = `${tableName}.${colName}`;
			const isDocumentedTimestamptz =
				DOCUMENTED_TIMESTAMPTZ_COLUMNS.has(fullColKey) &&
				sCol.logicalType === "text" &&
				pCol.logicalType === "timestamptz";

			if (!isDocumentedTimestamptz && sCol.logicalType !== pCol.logicalType) {
				differences.push({
					table: tableName,
					kind: "column_type",
					detail: `Column "${fullColKey}" type mismatch: SQLite ${sCol.rawType} (${sCol.logicalType}) vs Postgres ${pCol.rawType} (${pCol.logicalType})`,
				});
			}

			if (sCol.notNull !== pCol.notNull) {
				differences.push({
					table: tableName,
					kind: "column_nullability",
					detail: `Column "${fullColKey}" nullability mismatch: SQLite notNull=${sCol.notNull} vs Postgres notNull=${pCol.notNull}`,
				});
			}

			if (sCol.defaultValue !== pCol.defaultValue) {
				differences.push({
					table: tableName,
					kind: "column_default",
					detail: `Column "${fullColKey}" default mismatch: SQLite ${JSON.stringify(sCol.defaultValue)} vs Postgres ${JSON.stringify(pCol.defaultValue)}`,
				});
			}
		}

		// Compare Primary Key
		if (
			JSON.stringify(sTable.primaryKey) !== JSON.stringify(pTable.primaryKey)
		) {
			differences.push({
				table: tableName,
				kind: "primary_key",
				detail: `Primary key mismatch on "${tableName}": SQLite (${sTable.primaryKey.join(", ")}) vs Postgres (${pTable.primaryKey.join(", ")})`,
			});
		}

		// Compare Unique Constraints
		if (
			JSON.stringify(sTable.uniqueConstraints) !==
			JSON.stringify(pTable.uniqueConstraints)
		) {
			differences.push({
				table: tableName,
				kind: "unique_constraint",
				detail: `Unique constraints mismatch on "${tableName}": SQLite ${JSON.stringify(sTable.uniqueConstraints)} vs Postgres ${JSON.stringify(pTable.uniqueConstraints)}`,
			});
		}

		// Compare Foreign Keys
		if (
			JSON.stringify(sTable.foreignKeys) !== JSON.stringify(pTable.foreignKeys)
		) {
			differences.push({
				table: tableName,
				kind: "foreign_key",
				detail: `Foreign keys mismatch on "${tableName}": SQLite ${JSON.stringify(sTable.foreignKeys)} vs Postgres ${JSON.stringify(pTable.foreignKeys)}`,
			});
		}

		// Compare Check Constraints
		if (
			JSON.stringify(sTable.checkConstraints) !==
			JSON.stringify(pTable.checkConstraints)
		) {
			differences.push({
				table: tableName,
				kind: "check_constraint",
				detail: `Check constraints mismatch on "${tableName}": SQLite ${JSON.stringify(sTable.checkConstraints)} vs Postgres ${JSON.stringify(pTable.checkConstraints)}`,
			});
		}

		// Compare Indexes (excluding documented Postgres-only GIN JSONB indexes)
		const allIndexNames = new Set([
			...Object.keys(sTable.indexes),
			...Object.keys(pTable.indexes),
		]);
		for (const idxName of [...allIndexNames].sort()) {
			const fullIdxKey = `${tableName}.${idxName}`;
			const sIdx = sTable.indexes[idxName];
			const pIdx = pTable.indexes[idxName];
			if (!sIdx && pIdx) {
				if (
					pIdx.method === "gin" &&
					DOCUMENTED_POSTGRES_GIN_INDEXES.has(fullIdxKey)
				) {
					continue;
				}
				differences.push({
					table: tableName,
					kind: "missing_index",
					detail: `Index "${fullIdxKey}" exists on Postgres (${pIdx.method}) but is missing on SQLite`,
				});
				continue;
			}
			if (sIdx && !pIdx) {
				differences.push({
					table: tableName,
					kind: "missing_index",
					detail: `Index "${fullIdxKey}" exists on SQLite (${sIdx.columns.join(", ")}) but is missing on Postgres`,
				});
				continue;
			}
			if (sIdx && pIdx) {
				if (sIdx.unique !== pIdx.unique) {
					differences.push({
						table: tableName,
						kind: "index_unique",
						detail: `Index "${fullIdxKey}" uniqueness mismatch: SQLite unique=${sIdx.unique} vs Postgres unique=${pIdx.unique}`,
					});
				}
				if (JSON.stringify(sIdx.columns) !== JSON.stringify(pIdx.columns)) {
					differences.push({
						table: tableName,
						kind: "index_columns",
						detail: `Index "${fullIdxKey}" columns mismatch: SQLite (${sIdx.columns.join(", ")}) vs Postgres (${pIdx.columns.join(", ")})`,
					});
				}
				if (sIdx.where !== pIdx.where) {
					differences.push({
						table: tableName,
						kind: "index_where",
						detail: `Index "${fullIdxKey}" partial WHERE mismatch: SQLite ${JSON.stringify(sIdx.where)} vs Postgres ${JSON.stringify(pIdx.where)}`,
					});
				}
			}
		}
	}

	return {
		ok: differences.length === 0,
		tableCount: allTableNames.size,
		differences,
	};
}
