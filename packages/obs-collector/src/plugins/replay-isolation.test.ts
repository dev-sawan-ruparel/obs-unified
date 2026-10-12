import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Hono, type MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import { createTelemetryCollectorApp } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { IdentityIndex } from "../lib/identity-index";
import type { SqlDb, SqlStatement } from "../lib/sql-db";
import { replayQueryRoutesPlugin } from "./replay-query-routes";
import { replayReceiverPlugin } from "./replay-receiver";

class SyncSqliteDb implements SqlDb {
	constructor(readonly db: DatabaseSync) {}

	prepare(sql: string): SqlStatement {
		return new SyncSqliteStatement(this.db, sql, []);
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
}

class SyncSqliteStatement implements SqlStatement {
	constructor(
		private readonly db: DatabaseSync,
		private readonly sql: string,
		private readonly binds: unknown[] = [],
	) {}

	bind(...args: unknown[]): SqlStatement {
		return new SyncSqliteStatement(this.db, this.sql, args);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const stmt = this.db.prepare(this.sql);
		const row = stmt.get(
			...(this.binds as (string | number | bigint | null | Uint8Array)[]),
		);
		return (row ?? null) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
		const stmt = this.db.prepare(this.sql);
		const rows = stmt.all(
			...(this.binds as (string | number | bigint | null | Uint8Array)[]),
		);
		return { results: rows as T[] };
	}

	async run(): Promise<{ meta: { changes: number } }> {
		const stmt = this.db.prepare(this.sql);
		const info = stmt.run(
			...(this.binds as (string | number | bigint | null | Uint8Array)[]),
		);
		return { meta: { changes: Number(info.changes) } };
	}
}

class MemR2Bucket {
	readonly objects = new Map<string, string>();

	async put(key: string, value: string): Promise<void> {
		this.objects.set(key, value);
	}

	async get(key: string) {
		const val = this.objects.get(key);
		if (val === undefined) return null;
		return {
			async json<T>() {
				return JSON.parse(val) as T;
			},
			async text() {
				return val;
			},
		};
	}

	async list(opts: { prefix?: string; cursor?: string }) {
		const prefix = opts.prefix ?? "";
		const matched = Array.from(this.objects.keys())
			.filter((k) => k.startsWith(prefix))
			.sort()
			.map((k) => ({ key: k }));
		return {
			objects: matched,
			cursor: undefined,
			truncated: false,
		};
	}

	async delete(key: string): Promise<void> {
		this.objects.delete(key);
	}
}

interface PgTestHarness {
	query<T = Record<string, unknown>>(
		sql: string,
		params?: unknown[],
	): Promise<{ rows: T[] }>;
	exec(sql: string): Promise<void>;
	close(): Promise<void>;
}

const pgliteEnvPath =
	"/tmp/obs-pglite-env/node_modules/@electric-sql/pglite/dist/index.js";
const hasPgHarness = Boolean(
	process.env.OBS_PG_TEST_URL || existsSync(pgliteEnvPath),
);

async function createPgTestHarness(): Promise<PgTestHarness | null> {
	if (process.env.OBS_PG_TEST_URL) {
		const pgModule = await import("pg");
		const Client = pgModule.default?.Client ?? pgModule.Client;
		const client = new Client({
			connectionString: process.env.OBS_PG_TEST_URL,
		});
		await client.connect();

		// Guard: create an isolated scratch schema so we NEVER touch any non-scratch database
		const scratchSchema = `obs_replay_scratch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
		await client.query(`CREATE SCHEMA "${scratchSchema}"`);
		await client.query(`SET search_path TO "${scratchSchema}"`);

		// Guard: verify the newly active schema is completely empty
		const tables = await client.query<{ table_name: string }>(
			`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
		);
		if (tables.rows.length > 0) {
			await client.query(`DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE`);
			await client.end();
			throw new Error("Scratch schema was unexpectedly not empty");
		}

		return {
			async query<T = Record<string, unknown>>(
				sql: string,
				params: unknown[] = [],
			) {
				const res = await client.query(sql, params);
				return { rows: res.rows as T[] };
			},
			async exec(sql: string) {
				await client.query(sql);
			},
			async close() {
				try {
					await client.query("RESET search_path").catch(() => {});
					await client.query(`DROP SCHEMA IF EXISTS "${scratchSchema}" CASCADE`);
				} finally {
					await client.end();
				}
			},
		};
	}

	if (existsSync(pgliteEnvPath)) {
		const { PGlite } = (await import(
			/* @vite-ignore */ pgliteEnvPath
		)) as {
			PGlite: {
				create: () => Promise<{
					query: <T = Record<string, unknown>>(
						sql: string,
						params?: unknown[],
					) => Promise<{ rows: T[] }>;
					exec: (sql: string) => Promise<void>;
					close: () => Promise<void>;
				}>;
			};
		};

		const db = await PGlite.create();
		return {
			async query<T = Record<string, unknown>>(
				sql: string,
				params: unknown[] = [],
			) {
				const res = await db.query<T>(sql, params);
				return { rows: res.rows };
			},
			async exec(sql: string) {
				await db.exec(sql);
			},
			async close() {
				await db.close();
			},
		};
	}

	return null;
}

describe("Cross-Project Session Replay Isolation & Migration 042", () => {
	const migrationsDir = resolve(__dirname, "../migrations");
	const pgMigrationsDir = resolve(__dirname, "../migrations-postgres");

	it("migrates existing deployed SQLite database without data loss and enables cross-project co-existence", () => {
		const db = new DatabaseSync(":memory:");

		// 1. Simulate existing deployed database schema up to migration 010
		const m007 = readFileSync(
			resolve(migrationsDir, "007_session_replay_metadata.sql"),
			"utf8",
		);
		const m008 = readFileSync(
			resolve(migrationsDir, "008_session_replay_storage_bytes.sql"),
			"utf8",
		);
		// Execute table creation from 007
		db.exec(m007);
		db.exec(m008);

		// Execute signal_project_id line for session_replay_metadata
		db.exec(
			"ALTER TABLE session_replay_metadata ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default';",
		);
		db.exec(
			"CREATE INDEX IF NOT EXISTS idx_replay_project_last ON session_replay_metadata (project_id, last_chunk_at DESC);",
		);

		// 2. Insert existing data before migration 042
		db.prepare(
			`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			"proj-existing",
			"sess-123",
			"vis-1",
			"2026-06-01T10:00:00Z",
			"2026-06-01T10:02:00Z",
			2,
			20,
			2048,
		);

		db.prepare(
			`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			"default",
			"sess-456",
			"vis-2",
			"2026-06-01T11:00:00Z",
			"2026-06-01T11:05:00Z",
			5,
			50,
			5120,
		);

		// Prior to 042, inserting a row in another project with duplicate session_id fails due to single-column PK
		expect(() => {
			db.prepare(
				`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				"proj-other",
				"sess-123",
				"vis-3",
				"2026-06-01T12:00:00Z",
				"2026-06-01T12:00:00Z",
				1,
				10,
				1024,
			);
		}).toThrow();

		// 3. Execute migration 042
		const m042 = readFileSync(
			resolve(migrationsDir, "042_session_replay_project_composite_pk.sql"),
			"utf8",
		);
		db.exec(m042);

		// 4. Verify existing rows were completely preserved
		const existingRows = db
			.prepare("SELECT * FROM session_replay_metadata ORDER BY session_id ASC")
			.all() as Record<string, unknown>[];

		expect(existingRows).toHaveLength(2);
		expect(existingRows[0]).toEqual({
			project_id: "proj-existing",
			session_id: "sess-123",
			visitor_id: "vis-1",
			first_chunk_at: "2026-06-01T10:00:00Z",
			last_chunk_at: "2026-06-01T10:02:00Z",
			chunk_count: 2,
			events_count: 20,
			storage_bytes: 2048,
		});
		expect(existingRows[1]).toEqual({
			project_id: "default",
			session_id: "sess-456",
			visitor_id: "vis-2",
			first_chunk_at: "2026-06-01T11:00:00Z",
			last_chunk_at: "2026-06-01T11:05:00Z",
			chunk_count: 5,
			events_count: 50,
			storage_bytes: 5120,
		});

		// 5. Verify identical session_id can now be inserted under a different project
		expect(() => {
			db.prepare(
				`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			).run(
				"proj-other",
				"sess-123",
				"vis-3",
				"2026-06-01T12:00:00Z",
				"2026-06-01T12:00:00Z",
				1,
				10,
				1024,
			);
		}).not.toThrow();

		// 6. Verify ON CONFLICT(project_id, session_id) updates ONLY the targeted project's row
		const upsertStmt = db.prepare(`
			INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(project_id, session_id) DO UPDATE SET
				last_chunk_at = excluded.last_chunk_at,
				chunk_count = session_replay_metadata.chunk_count + 1,
				events_count = session_replay_metadata.events_count + excluded.events_count,
				storage_bytes = session_replay_metadata.storage_bytes + excluded.storage_bytes
		`);

		upsertStmt.run(
			"proj-other",
			"sess-123",
			"vis-3",
			"2026-06-01T12:00:00Z",
			"2026-06-01T12:05:00Z",
			1,
			15,
			1500,
		);

		const projExistingRow = db
			.prepare(
				"SELECT * FROM session_replay_metadata WHERE project_id = ? AND session_id = ?",
			)
			.get("proj-existing", "sess-123") as Record<string, unknown>;

		const projOtherRow = db
			.prepare(
				"SELECT * FROM session_replay_metadata WHERE project_id = ? AND session_id = ?",
			)
			.get("proj-other", "sess-123") as Record<string, unknown>;

		// proj-existing remains unchanged
		expect(projExistingRow.chunk_count).toBe(2);
		expect(projExistingRow.events_count).toBe(20);
		expect(projExistingRow.storage_bytes).toBe(2048);

		// proj-other has its chunk count and bytes incremented
		expect(projOtherRow.chunk_count).toBe(2);
		expect(projOtherRow.events_count).toBe(25);
		expect(projOtherRow.storage_bytes).toBe(2524);
		expect(projOtherRow.last_chunk_at).toBe("2026-06-01T12:05:00Z");
	});

	it("applies all migrations sequentially on fresh install without errors", () => {
		const db = new DatabaseSync(":memory:");
		const files = readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort((a, b) => a.localeCompare(b));

		// Apply all migrations
		for (const file of files) {
			const sql = readFileSync(resolve(migrationsDir, file), "utf8");
			try {
				db.exec(sql);
			} catch (err) {
				throw new Error(
					`Failed to apply migration ${file}: ${(err as Error).message}`,
				);
			}
		}

		// Inspect table_info for session_replay_metadata to prove composite PK
		const columns = db
			.prepare("PRAGMA table_info(session_replay_metadata)")
			.all() as Array<{
			name: string;
			pk: number;
		}>;

		const pkCols = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
		expect(pkCols.map((c) => c.name)).toEqual(["project_id", "session_id"]);
	});

	it("contains valid PostgreSQL forward migration DDL syntax", () => {
		const pgMigration = readFileSync(
			resolve(pgMigrationsDir, "042_session_replay_project_composite_pk.sql"),
			"utf8",
		);

		expect(pgMigration).toContain(
			"DROP CONSTRAINT IF EXISTS session_replay_metadata_pkey",
		);
		expect(pgMigration).toContain("PRIMARY KEY (project_id, session_id)");
		expect(pgMigration).toContain(
			"UPDATE session_replay_metadata SET project_id = 'default'",
		);
	});

	it.runIf(hasPgHarness)(
		"executes PostgreSQL migration 042 against an old-schema table with preserved rows and validates cross-project ON CONFLICT upsert",
		async () => {
			const pg = await createPgTestHarness();
			if (!pg) return;

			try {
				// 1. Simulate existing deployed database schema up to migration 010
				const m007 = readFileSync(
					resolve(pgMigrationsDir, "007_session_replay_metadata.sql"),
					"utf8",
				);
				const m008 = readFileSync(
					resolve(pgMigrationsDir, "008_session_replay_storage_bytes.sql"),
					"utf8",
				);

				await pg.exec(m007);
				await pg.exec(m008);
				await pg.exec(
					"ALTER TABLE session_replay_metadata ADD COLUMN project_id TEXT DEFAULT 'default';",
				);
				await pg.exec(
					"CREATE INDEX IF NOT EXISTS idx_replay_project_last ON session_replay_metadata (project_id, last_chunk_at DESC);",
				);

				// 2. Insert existing row before migration 042
				await pg.query(
					`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[
						"proj-existing",
						"sess-123",
						"vis-1",
						"2026-06-01T10:00:00Z",
						"2026-06-01T10:02:00Z",
						2,
						20,
						2048,
					],
				);

				// 3. Before 042, inserting a row in another project with duplicate session_id fails due to single-column PK
				let insertFailedBefore = false;
				try {
					await pg.query(
						`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
						 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
						[
							"proj-other",
							"sess-123",
							"vis-2",
							"2026-06-01T12:00:00Z",
							"2026-06-01T12:00:00Z",
							1,
							10,
							1024,
						],
					);
				} catch (err) {
					insertFailedBefore = true;
					expect((err as Error).message).toMatch(/unique|primary/i);
				}
				expect(insertFailedBefore).toBe(true);

				// 4. Execute migration 042
				const m042 = readFileSync(
					resolve(pgMigrationsDir, "042_session_replay_project_composite_pk.sql"),
					"utf8",
				);
				await pg.exec(m042);

				// 5. Verify existing row is preserved intact
				const preserved = await pg.query<{
					project_id: string;
					session_id: string;
					visitor_id: string;
					first_chunk_at: string;
					last_chunk_at: string;
					chunk_count: number;
					events_count: number;
					storage_bytes: number;
				}>(
					"SELECT * FROM session_replay_metadata WHERE project_id = $1 AND session_id = $2",
					["proj-existing", "sess-123"],
				);
				expect(preserved.rows).toHaveLength(1);
				expect(preserved.rows[0]).toEqual({
					project_id: "proj-existing",
					session_id: "sess-123",
					visitor_id: "vis-1",
					first_chunk_at: "2026-06-01T10:00:00Z",
					last_chunk_at: "2026-06-01T10:02:00Z",
					chunk_count: 2,
					events_count: 20,
					storage_bytes: 2048,
				});

				// 6. Verify duplicate session_id in proj-other now succeeds
				await pg.query(
					`INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
					[
						"proj-other",
						"sess-123",
						"vis-2",
						"2026-06-01T12:00:00Z",
						"2026-06-01T12:00:00Z",
						1,
						10,
						1024,
					],
				);

				// 7. Verify ON CONFLICT(project_id, session_id) DO UPDATE SET ... updates only the target project
				const upsertSql = `
					INSERT INTO session_replay_metadata (
						project_id, session_id, visitor_id, first_chunk_at, last_chunk_at,
						chunk_count, events_count, storage_bytes
					) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
					ON CONFLICT(project_id, session_id) DO UPDATE SET
						last_chunk_at = EXCLUDED.last_chunk_at,
						chunk_count = session_replay_metadata.chunk_count + 1,
						events_count = session_replay_metadata.events_count + EXCLUDED.events_count,
						storage_bytes = session_replay_metadata.storage_bytes + EXCLUDED.storage_bytes
				`;
				await pg.query(upsertSql, [
					"proj-other",
					"sess-123",
					"vis-2",
					"2026-06-01T12:00:00Z",
					"2026-06-01T12:05:00Z",
					1,
					15,
					1500,
				]);

				const afterExisting = await pg.query<{
					chunk_count: number;
					events_count: number;
					storage_bytes: number;
					last_chunk_at: string;
				}>(
					"SELECT chunk_count, events_count, storage_bytes, last_chunk_at FROM session_replay_metadata WHERE project_id = $1 AND session_id = $2",
					["proj-existing", "sess-123"],
				);
				const afterOther = await pg.query<{
					chunk_count: number;
					events_count: number;
					storage_bytes: number;
					last_chunk_at: string;
				}>(
					"SELECT chunk_count, events_count, storage_bytes, last_chunk_at FROM session_replay_metadata WHERE project_id = $1 AND session_id = $2",
					["proj-other", "sess-123"],
				);

				// proj-existing remains unchanged
				expect(afterExisting.rows[0]?.chunk_count).toBe(2);
				expect(afterExisting.rows[0]?.events_count).toBe(20);
				expect(afterExisting.rows[0]?.storage_bytes).toBe(2048);
				expect(afterExisting.rows[0]?.last_chunk_at).toBe("2026-06-01T10:02:00Z");

				// proj-other has its chunk count and bytes incremented
				expect(afterOther.rows[0]?.chunk_count).toBe(2);
				expect(afterOther.rows[0]?.events_count).toBe(25);
				expect(afterOther.rows[0]?.storage_bytes).toBe(2524);
				expect(afterOther.rows[0]?.last_chunk_at).toBe("2026-06-01T12:05:00Z");

				// 8. Re-running migration 042 is idempotent
				await pg.exec(m042);
				const afterRerun = await pg.query<{ count: string | number }>(
					"SELECT COUNT(*) AS count FROM session_replay_metadata",
				);
				expect(Number(afterRerun.rows[0]?.count)).toBe(2);
			} finally {
				await pg.close();
			}
		},
	);

	it.runIf(hasPgHarness)(
		"applies all PostgreSQL migrations sequentially on fresh install without errors and establishes composite PK",
		async () => {
			const pg = await createPgTestHarness();
			if (!pg) return;

			try {
				const files = readdirSync(pgMigrationsDir)
					.filter((f) => f.endsWith(".sql"))
					.sort((a, b) => a.localeCompare(b));

				for (const file of files) {
					const sql = readFileSync(resolve(pgMigrationsDir, file), "utf8");
					await pg.exec(sql);
				}

				const pkInfo = await pg.query<{ column_name: string }>(
					`SELECT kcu.column_name
					 FROM information_schema.table_constraints tc
					 JOIN information_schema.key_column_usage kcu
					   ON tc.constraint_name = kcu.constraint_name
					  AND tc.table_schema = kcu.table_schema
					 WHERE tc.table_schema = current_schema()
					   AND tc.table_name = 'session_replay_metadata'
					   AND tc.constraint_type = 'PRIMARY KEY'
					 ORDER BY kcu.column_name ASC`,
				);
				expect(pkInfo.rows.map((r) => r.column_name)).toEqual([
					"project_id",
					"session_id",
				]);
			} finally {
				await pg.close();
			}
		},
	);

	it("proves complete write/read/delete isolation across projects with identical session IDs", async () => {
		const rawDb = new DatabaseSync(":memory:");

		// Run all migrations to establish latest schema
		for (const file of readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()) {
			rawDb.exec(readFileSync(resolve(migrationsDir, file), "utf8"));
		}

		const sqlDb = new SyncSqliteDb(rawDb);
		const bucket = new MemR2Bucket();

		const setProjectMiddleware: MiddlewareHandler<{
			Bindings: CollectorEnv;
			Variables: { projectId: string };
		}> = async (c, next) => {
			const projectHeader = c.req.header("x-project-id");
			if (projectHeader) {
				c.set("projectId", projectHeader);
			}
			await next();
		};

		const app = createTelemetryCollectorApp({
			plugins: [replayReceiverPlugin, replayQueryRoutesPlugin],
			auth: {
				middleware: setProjectMiddleware,
			},
			dashboardAuth: {
				middleware: setProjectMiddleware,
				registerRoutes: () => {},
			},
		});

		const env = {
			DB: sqlDb as unknown as D1Database,
			REPLAYS_BUCKET: bucket as unknown as R2Bucket,
		} as CollectorEnv;

		const sessionId = "colliding-session-id";

		// 1. Project Alpha ingests chunk 1
		const resAlpha1 = await app.request(
			"/v1/replays",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-project-id": "project-alpha",
				},
				body: JSON.stringify({
					sessionId,
					visitorId: "vis-alpha",
					sequenceNumber: 0,
					events: [{ type: 1, data: "alpha-event-1" }],
				}),
			},
			env,
		);
		expect(resAlpha1.status).toBe(200);

		// 2. Project Beta ingests chunk 1 with the EXACT SAME session ID
		const resBeta1 = await app.request(
			"/v1/replays",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-project-id": "project-beta",
				},
				body: JSON.stringify({
					sessionId,
					visitorId: "vis-beta",
					sequenceNumber: 0,
					events: [
						{ type: 2, data: "beta-event-1" },
						{ type: 2, data: "beta-event-2" },
					],
				}),
			},
			env,
		);
		expect(resBeta1.status).toBe(200);

		// 3. Project Alpha ingests chunk 2
		const resAlpha2 = await app.request(
			"/v1/replays",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-project-id": "project-alpha",
				},
				body: JSON.stringify({
					sessionId,
					visitorId: "vis-alpha",
					sequenceNumber: 1,
					events: [{ type: 1, data: "alpha-event-2" }],
				}),
			},
			env,
		);
		expect(resAlpha2.status).toBe(200);

		// 4. Verify storage isolation: bucket prefixes are scoped by project
		const alphaChunkKeys = Array.from(bucket.objects.keys()).filter((k) =>
			k.startsWith(`replays/project-alpha/${sessionId}/`),
		);
		const betaChunkKeys = Array.from(bucket.objects.keys()).filter((k) =>
			k.startsWith(`replays/project-beta/${sessionId}/`),
		);
		expect(alphaChunkKeys).toHaveLength(2);
		expect(betaChunkKeys).toHaveLength(1);

		// 5. Query /internal/replays for Alpha
		const listAlphaRes = await app.request(
			"/internal/replays",
			{
				method: "GET",
				headers: { "x-project-id": "project-alpha" },
			},
			env,
		);
		expect(listAlphaRes.status).toBe(200);
		const listAlphaBody = (await listAlphaRes.json()) as {
			replays: Array<Record<string, unknown>>;
		};
		expect(listAlphaBody.replays).toHaveLength(1);
		expect(listAlphaBody.replays[0].project_id).toBe("project-alpha");
		expect(listAlphaBody.replays[0].chunk_count).toBe(2);
		expect(listAlphaBody.replays[0].events_count).toBe(2);

		// Query /internal/replays for Beta
		const listBetaRes = await app.request(
			"/internal/replays",
			{
				method: "GET",
				headers: { "x-project-id": "project-beta" },
			},
			env,
		);
		expect(listBetaRes.status).toBe(200);
		const listBetaBody = (await listBetaRes.json()) as {
			replays: Array<Record<string, unknown>>;
		};
		expect(listBetaBody.replays).toHaveLength(1);
		expect(listBetaBody.replays[0].project_id).toBe("project-beta");
		expect(listBetaBody.replays[0].chunk_count).toBe(1);
		expect(listBetaBody.replays[0].events_count).toBe(2);

		// 6. Query detail /internal/replays/:sessionId for Alpha
		const detailAlphaRes = await app.request(
			`/internal/replays/${sessionId}`,
			{
				method: "GET",
				headers: { "x-project-id": "project-alpha" },
			},
			env,
		);
		expect(detailAlphaRes.status).toBe(200);
		const detailAlpha = (await detailAlphaRes.json()) as {
			metadata: Record<string, unknown>;
			events: Array<{ data: string }>;
		};
		expect(detailAlpha.metadata.project_id).toBe("project-alpha");
		expect(detailAlpha.events.map((e) => e.data)).toEqual([
			"alpha-event-1",
			"alpha-event-2",
		]);

		// Query detail /internal/replays/:sessionId for Beta
		const detailBetaRes = await app.request(
			`/internal/replays/${sessionId}`,
			{
				method: "GET",
				headers: { "x-project-id": "project-beta" },
			},
			env,
		);
		expect(detailBetaRes.status).toBe(200);
		const detailBeta = (await detailBetaRes.json()) as {
			metadata: Record<string, unknown>;
			events: Array<{ data: string }>;
		};
		expect(detailBeta.metadata.project_id).toBe("project-beta");
		expect(detailBeta.events.map((e) => e.data)).toEqual([
			"beta-event-1",
			"beta-event-2",
		]);

		// 7. Delete replay from Project Alpha
		const deleteAlphaRes = await app.request(
			`/internal/replays/${sessionId}`,
			{
				method: "DELETE",
				headers: { "x-project-id": "project-alpha" },
			},
			env,
		);
		expect(deleteAlphaRes.status).toBe(200);

		// Project Alpha now gets 404
		const detailAlphaAfterDelete = await app.request(
			`/internal/replays/${sessionId}`,
			{
				method: "GET",
				headers: { "x-project-id": "project-alpha" },
			},
			env,
		);
		expect(detailAlphaAfterDelete.status).toBe(404);

		// Project Beta is completely unaffected!
		const detailBetaAfterDelete = await app.request(
			`/internal/replays/${sessionId}`,
			{
				method: "GET",
				headers: { "x-project-id": "project-beta" },
			},
			env,
		);
		expect(detailBetaAfterDelete.status).toBe(200);
		const detailBetaStillValid = (await detailBetaAfterDelete.json()) as {
			metadata: Record<string, unknown>;
			events: Array<{ data: string }>;
		};
		expect(detailBetaStillValid.metadata.project_id).toBe("project-beta");
		expect(detailBetaStillValid.events).toHaveLength(2);

		// Project Beta's storage chunks still exist
		const betaChunksAfterDelete = Array.from(bucket.objects.keys()).filter(
			(k) => k.startsWith(`replays/project-beta/${sessionId}/`),
		);
		expect(betaChunksAfterDelete).toHaveLength(1);
	});

	it("proves identity index lookups scope session replay by project_id", async () => {
		const rawDb = new DatabaseSync(":memory:");
		for (const file of readdirSync(migrationsDir)
			.filter((f) => f.endsWith(".sql"))
			.sort()) {
			rawDb.exec(readFileSync(resolve(migrationsDir, file), "utf8"));
		}

		// Insert 2 replays with same sessionId across two projects
		rawDb
			.prepare(`
			INSERT INTO session_replay_metadata (project_id, session_id, visitor_id, first_chunk_at, last_chunk_at, chunk_count, events_count, storage_bytes)
			VALUES ('proj-1', 'sess-collision', 'vis-1', '2026-06-01T10:00:00Z', '2026-06-01T10:05:00Z', 1, 10, 100),
			       ('proj-2', 'sess-collision', 'vis-2', '2026-06-01T11:00:00Z', '2026-06-01T11:05:00Z', 2, 20, 200)
		`)
			.run();

		const sqlDb = new SyncSqliteDb(rawDb);
		const index = new IdentityIndex(sqlDb);

		// bySession for proj-1 returns proj-1 replay
		const manifest1 = await index.bySession("proj-1", "sess-collision");
		expect(manifest1.replay).toEqual({
			sessionId: "sess-collision",
			firstChunkAt: "2026-06-01T10:00:00Z",
			lastChunkAt: "2026-06-01T10:05:00Z",
			chunkCount: 1,
			eventsCount: 10,
		});

		// bySession for proj-2 returns proj-2 replay
		const manifest2 = await index.bySession("proj-2", "sess-collision");
		expect(manifest2.replay).toEqual({
			sessionId: "sess-collision",
			firstChunkAt: "2026-06-01T11:00:00Z",
			lastChunkAt: "2026-06-01T11:05:00Z",
			chunkCount: 2,
			eventsCount: 20,
		});

		// bySession for unknown project returns null replay
		const manifest3 = await index.bySession("proj-3", "sess-collision");
		expect(manifest3.replay).toBeNull();
	});
});
