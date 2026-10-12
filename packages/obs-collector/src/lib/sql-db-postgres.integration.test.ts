/**
 * Live-Postgres integration checks for the standalone Node collector path
 * (RFC 0008 `PostgresAdapter`). Skipped unless `OBS_PG_TEST_URL` is set:
 *
 *   OBS_PG_TEST_URL=postgres://obs:obs@127.0.0.1:5432/obs_unified \
 *     pnpm --filter @obsunified/collector exec vitest run \
 *       src/lib/sql-db-postgres.integration.test.ts
 *
 * Point it at an EMPTY scratch database: the run applies
 * `migrations-postgres/` into the connection's default schema, refuses to
 * start if the schema already contains any table, and drops every table it
 * created afterwards. (Session state such as `search_path` is deliberately not
 * relied upon so the suite also runs against single-session servers like
 * PGlite's socket bridge.)
 *
 * Each test pins a Postgres-only failure that D1 never surfaced: BYTEA vs
 * hex `key_hash`, BOOLEAN flags, TEXT timestamps compared to
 * `timestamptz` (including the `metric_exemplars` TIMESTAMPTZ columns that
 * 043 converts), and SQLite built-ins in the shared analysis SQL.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
	AICallRecord,
	AlertRule,
	UsageEventRecord,
} from "@obsunified/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveAnalysesForProject } from "../analyses/derive";
import { INVESTIGATION_ANALYSES } from "../analyses/investigations";
import { TIER0_ANALYSES } from "../analyses/tier0";
import type { DecodedMetricPoint } from "../otlp/decode";
import { purgeExpiredActionGraph } from "./action-retention";
import { getAICallsOverview, ingestAICallBatch } from "./ai-store/calls";
import { purgeExpiredAIData } from "./ai-store/retention";
import { AlertsStore } from "./alerts-store";
import { runSqlAnalysis } from "./analyses-runner";
import { sha256Hex } from "./hash";
import { MetricsStore } from "./metrics-store";
import { ProjectsStore } from "./projects-store";
import {
	configurePostgresTypeParsers,
	PostgresAdapter,
} from "./sql-db-postgres";
import {
	countActionGraph,
	FIXTURE_NOW_MS,
	FIXTURE_RETENTION_HOURS,
	FRESH_START,
	seedEvalCase,
	seedTree,
} from "./test-utils/action-graph-fixtures";
import { UsageStore } from "./usage-store";

const databaseUrl = process.env.OBS_PG_TEST_URL;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations-postgres");

/** Plaintext lives in apps/web/.env.development.local; this is its SHA-256. */
const DASHBOARD_SEED_HASH =
	"6aa18dc1261b312e98b236d5a7dae698d1a90ecbe33d8024744063a066a35b9b";

const VALID_STATUSES = new Set(["ok", "warn", "critical", "unknown"]);

type PgModule = typeof import("pg");
type PgPool = import("pg").Pool;
type PgClient = import("pg").Client;

const isoNow = () => new Date().toISOString();
const isoIn = (ms: number) => new Date(Date.now() + ms).toISOString();

const aiCall = (over: Partial<AICallRecord>): AICallRecord => ({
	projectId: "default",
	callId: `call-${Math.random().toString(36).slice(2)}`,
	traceId: null,
	spanId: null,
	serviceName: "checkout",
	modelName: "gpt-test",
	provider: "openai",
	callType: "chat",
	requestJson: JSON.stringify({ messages: [] }),
	responseJson: null,
	promptTokens: 10,
	completionTokens: 5,
	totalCostUsd: 0.01,
	latencyMs: 120,
	isError: false,
	errorMessage: null,
	occurredAt: isoNow(),
	receivedAt: isoNow(),
	expiresAt: isoIn(60 * 60 * 1000),
	...over,
});

const usageEvent = (over: Partial<UsageEventRecord>): UsageEventRecord => ({
	projectId: "default",
	eventId: `evt-${Math.random().toString(36).slice(2)}`,
	sessionId: "sess-1",
	visitorId: "visitor-1",
	eventType: "page_view",
	eventName: "page_view",
	pagePath: "/",
	pageTitle: "Home",
	referrer: null,
	severity: "info",
	source: "web",
	contextJson: JSON.stringify({ viewport: "1280x720" }),
	propertiesJson: JSON.stringify({ loadTimeMs: 250 }),
	userAgent: "Mozilla/5.0",
	occurredAt: isoNow(),
	receivedAt: isoNow(),
	expiresAt: isoIn(60 * 60 * 1000),
	country: "US",
	browser: "Chrome",
	os: "macOS",
	deviceType: "desktop",
	isBot: false,
	utmSource: null,
	utmMedium: null,
	utmCampaign: null,
	...over,
});

const metricPoint = (
	over: Partial<DecodedMetricPoint>,
): DecodedMetricPoint => ({
	name: "http.server.duration",
	description: null,
	unit: "ms",
	type: "histogram",
	isMonotonic: null,
	temporality: 2,
	scopeName: "@opentelemetry/instrumentation-http",
	scopeVersion: "1.0.0",
	serviceName: "checkout",
	resourceAttrsJson: JSON.stringify({ "service.name": "checkout" }),
	attributesJson: JSON.stringify({ route: "/checkout" }),
	identity: `metric-${Math.random().toString(36).slice(2)}`,
	tsNs: "1800000000000000000",
	startTsNs: null,
	value: null,
	count: 1,
	sum: 42,
	min: null,
	max: null,
	boundsJson: JSON.stringify([50]),
	bucketCountsJson: JSON.stringify([1]),
	extraJson: null,
	exemplarsJson: null,
	...over,
});

const exemplarJson = (traceId: string, tsNs: string) =>
	JSON.stringify([{ value: 1, traceId, spanId: null, tsNs }]);

/** Same `to_char` shape `postgresDialect.now()` and 043 render. */
const ISO_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe.skipIf(!databaseUrl)("PostgresAdapter against a live Postgres", () => {
	const legacySchema = `obs_pg_test_legacy_${Date.now().toString(36)}`;
	let pg: PgModule;
	let pool: PgPool;
	let db: PostgresAdapter;
	let migrationFiles: string[] = [];
	let preexistingTables = new Set<string>();

	const adminClient = async (): Promise<PgClient> => {
		const client = new pg.Client({ connectionString: databaseUrl });
		await client.connect();
		return client;
	};

	const listTables = async (client: PgClient): Promise<Set<string>> => {
		const res = await client.query<{ table_name: string }>(
			`SELECT table_name FROM information_schema.tables
			 WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`,
		);
		return new Set(res.rows.map((r) => r.table_name));
	};

	beforeAll(async () => {
		pg = (await import("pg")).default as unknown as PgModule;
		configurePostgresTypeParsers(pg.types);

		const admin = await adminClient();
		try {
			preexistingTables = await listTables(admin);
			if (preexistingTables.size > 0) {
				// Refuse any non-empty schema, not just one with collector tables,
				// so the teardown below can never touch an unrelated database.
				throw new Error(
					`OBS_PG_TEST_URL must point at an empty scratch database (found ${preexistingTables.size} table(s): ${[...preexistingTables].sort().join(", ")})`,
				);
			}
			await admin.query(`CREATE SCHEMA ${legacySchema}`);

			// Apply every Postgres migration the same way
			// apps/collector-node/scripts/migrate-pg.mjs does (one transaction
			// per file).
			migrationFiles = (await readdir(migrationsDir))
				.filter((f) => f.endsWith(".sql"))
				.sort();
			for (const file of migrationFiles) {
				const sql = await readFile(path.join(migrationsDir, file), "utf8");
				await admin.query("BEGIN");
				try {
					await admin.query(sql);
					await admin.query("COMMIT");
				} catch (err) {
					await admin.query("ROLLBACK");
					throw new Error(`${file} failed: ${(err as Error).message}`);
				}
			}
		} finally {
			await admin.end();
		}

		// max: 1 keeps the run deterministic on single-session servers
		// (PGlite's socket bridge) and costs nothing against real Postgres.
		pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
		db = new PostgresAdapter(pool);
	}, 120_000);

	afterAll(async () => {
		await pool?.end();
		if (!pg) return;
		const admin = await adminClient();
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`);
			const created = [...(await listTables(admin))].filter(
				(t) => !preexistingTables.has(t),
			);
			for (const table of created) {
				await admin.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
			}
		} finally {
			await admin.end();
		}
	});

	it("applies every migration and leaves ingest_keys.key_hash as TEXT", async () => {
		expect(migrationFiles).toContain("041_ingest_key_hash_text.sql");
		const row = await db
			.prepare(
				`SELECT data_type FROM information_schema.columns
				 WHERE table_schema = current_schema() AND table_name = 'ingest_keys' AND column_name = 'key_hash'`,
			)
			.first<{ data_type: string }>();
		expect(row?.data_type).toBe("text");
	});

	it("resolves the seeded obs-dashboard key by its hex digest", async () => {
		const store = new ProjectsStore(db);
		await expect(store.findByKeyHash(DASHBOARD_SEED_HASH)).resolves.toEqual({
			projectId: "obs-dashboard",
			keyId: "obs-dashboard-bootstrap",
		});
	});

	it("bootstraps INGEST_KEY, mints and revokes keys through the hex digest", async () => {
		const store = new ProjectsStore(db);
		await store.bootstrapEnvKey("dev-ingest-key");
		await store.bootstrapEnvKey("dev-ingest-key"); // idempotent
		const bootstrapped = await store.findByKeyHash(
			await sha256Hex("dev-ingest-key"),
		);
		expect(bootstrapped?.projectId).toBe("default");

		const minted = await store.createKey("default", "ci");
		const found = await store.findByKeyHash(await sha256Hex(minted.key));
		expect(found).toEqual({ projectId: "default", keyId: minted.id });

		expect(await store.revokeKey(minted.id)).toBe(true);
		expect(await store.findByKeyHash(await sha256Hex(minted.key))).toBeNull();

		const listed = await store.listKeys("default");
		expect(listed.map((k) => k.name).sort()).toEqual(["bootstrap", "ci"]);
	});

	it("migration 041 converts a legacy BYTEA key_hash column in place", async () => {
		const legacy = await adminClient();
		try {
			await legacy.query(`SET search_path TO ${legacySchema}`);
			// Shape of migrations-postgres/009 before the fix.
			await legacy.query(`
				CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
				CREATE TABLE ingest_keys (
					id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key_hash BYTEA NOT NULL UNIQUE,
					key_prefix TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT,
					FOREIGN KEY (project_id) REFERENCES projects (id));
				CREATE INDEX idx_ingest_keys_hash ON ingest_keys (key_hash);
				INSERT INTO projects VALUES ('default', 'Default', 'default', 'x'), ('obs-dashboard', 'Obs Dashboard', 'obs-dashboard', 'x');
			`);
			// 026 seeded the raw 32 digest bytes …
			await legacy.query(
				`INSERT INTO ingest_keys VALUES ('seed', 'obs-dashboard', decode($1, 'hex'), 'obs_dashboard_65', 'bootstrap', 'x', NULL)`,
				[DASHBOARD_SEED_HASH],
			);
			// … while the collector bound the hex text, which BYTEA kept as 64 ASCII bytes.
			const bootstrapHash = await sha256Hex("dev-ingest-key");
			await legacy.query(
				`INSERT INTO ingest_keys VALUES ('boot', 'default', $1, 'dev-ingest-key', 'bootstrap', 'x', NULL)`,
				[bootstrapHash],
			);
			const before = await legacy.query(
				`SELECT id, octet_length(key_hash) AS len FROM ingest_keys ORDER BY id`,
			);
			expect(before.rows).toEqual([
				{ id: "boot", len: 64 },
				{ id: "seed", len: 32 },
			]);

			const sql = await readFile(
				path.join(migrationsDir, "041_ingest_key_hash_text.sql"),
				"utf8",
			);
			await legacy.query(sql);
			await legacy.query(sql); // re-running is a no-op

			const type = await legacy.query(
				`SELECT data_type FROM information_schema.columns
				 WHERE table_schema = $1 AND table_name = 'ingest_keys' AND column_name = 'key_hash'`,
				[legacySchema],
			);
			expect(type.rows[0]?.data_type).toBe("text");
			const after = await legacy.query(
				`SELECT id, key_hash FROM ingest_keys ORDER BY id`,
			);
			expect(after.rows).toEqual([
				{ id: "boot", key_hash: bootstrapHash },
				{ id: "seed", key_hash: DASHBOARD_SEED_HASH },
			]);
			const lookup = await legacy.query(
				`SELECT id FROM ingest_keys WHERE key_hash = $1`,
				[DASHBOARD_SEED_HASH],
			);
			expect(lookup.rows).toEqual([{ id: "seed" }]);
		} finally {
			// Single-session servers (PGlite) share GUCs across sockets, so put
			// search_path back before the pooled adapter runs again.
			await legacy.query("RESET search_path").catch(() => {});
			await legacy.end();
		}
	});

	it("creates metric_exemplars timestamps as TEXT and purges expired exemplars", async () => {
		expect(migrationFiles).toContain(
			"043_metric_exemplars_text_timestamps.sql",
		);
		const cols = await db
			.prepare(
				`SELECT column_name, data_type FROM information_schema.columns
				 WHERE table_schema = current_schema() AND table_name = 'metric_exemplars'
				   AND column_name IN ('received_at', 'expires_at')
				 ORDER BY column_name`,
			)
			.all<{ column_name: string; data_type: string }>();
		expect(cols.results).toEqual([
			{ column_name: "expires_at", data_type: "text" },
			{ column_name: "received_at", data_type: "text" },
		]);

		const metrics = new MetricsStore(db);
		await metrics.ingestBatch({
			projectId: "default",
			receivedAt: isoNow(),
			expiresAt: isoIn(-60_000),
			points: [
				metricPoint({ exemplarsJson: exemplarJson("trace-ex-expired", "1") }),
			],
		});
		await metrics.ingestBatch({
			projectId: "default",
			receivedAt: isoNow(),
			expiresAt: isoIn(3_600_000),
			points: [
				metricPoint({ exemplarsJson: exemplarJson("trace-ex-live", "2") }),
			],
		});

		// One expired exemplar + its expired point.
		expect(await metrics.purgeExpired()).toBe(2);
		const exemplars = await db
			.prepare(`SELECT trace_id FROM metric_exemplars ORDER BY trace_id`)
			.all<{ trace_id: string }>();
		expect(exemplars.results).toEqual([{ trace_id: "trace-ex-live" }]);
		const points = await db
			.prepare(`SELECT COUNT(*) AS n FROM metric_point`)
			.first<{ n: number }>();
		expect(points?.n).toBe(1);
		const live = await metrics.exemplarsForTrace("default", "trace-ex-live");
		expect(live.map((e) => e.traceId)).toEqual(["trace-ex-live"]);
		expect(live[0]?.receivedAt).toMatch(ISO_TEXT);
	});

	it("migration 043 converts legacy TIMESTAMPTZ metric_exemplars columns in place", async () => {
		// max: 1 pins SET search_path / timezone to the one client the
		// adapter will reuse, on PGlite and on real Postgres alike.
		const legacyPool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
		try {
			await legacyPool.query(`SET search_path TO ${legacySchema}`);
			// A non-UTC session zone must not leak into the converted text.
			await legacyPool.query(`SET timezone TO 'America/New_York'`);
			// Shape of migrations-postgres/035 before the fix (metric_series /
			// metric_point trimmed to the columns the FK and purge touch).
			await legacyPool.query(`
				CREATE TABLE metric_series (id TEXT PRIMARY KEY);
				CREATE TABLE metric_point (id TEXT PRIMARY KEY, expires_at TEXT NOT NULL);
				CREATE TABLE metric_exemplars (
					id TEXT PRIMARY KEY,
					point_id TEXT NOT NULL REFERENCES metric_point(id),
					series_id TEXT NOT NULL REFERENCES metric_series(id),
					project_id TEXT NOT NULL,
					metric_name TEXT NOT NULL,
					service_name TEXT,
					trace_id TEXT,
					span_id TEXT,
					ts_ns TEXT NOT NULL,
					value DOUBLE PRECISION NOT NULL,
					received_at TIMESTAMPTZ NOT NULL,
					expires_at TIMESTAMPTZ NOT NULL
				);
				CREATE INDEX idx_metric_exemplars_expires ON metric_exemplars (expires_at);
				INSERT INTO metric_series VALUES ('s1');
				INSERT INTO metric_point VALUES
					('p-expired', '2000-01-01T00:00:00.000Z'),
					('p-live', '2999-01-01T00:00:00.000Z');
			`);
			// The collector bound Date#toISOString() text, which Postgres
			// parsed into timestamptz. Include a non-UTC offset to prove the
			// conversion normalises to UTC rather than echoing input.
			const insert = `INSERT INTO metric_exemplars
				(id, point_id, series_id, project_id, metric_name, service_name, trace_id, span_id, ts_ns, value, received_at, expires_at)
				VALUES ($1, $2, 's1', 'default', 'http.server.duration', 'checkout', $3, NULL, '1', 1, $4::timestamptz, $5::timestamptz)`;
			await legacyPool.query(insert, [
				"ex-expired",
				"p-expired",
				"trace-legacy-expired",
				"2000-01-01T00:00:00.000Z",
				"2000-01-02T00:00:00.000Z",
			]);
			await legacyPool.query(insert, [
				"ex-live",
				"p-live",
				"trace-legacy-live",
				"2026-06-01T14:34:56.789+02:00",
				"2999-01-01T00:00:00.000Z",
			]);
			const before = await legacyPool.query(
				`SELECT data_type FROM information_schema.columns
				 WHERE table_schema = $1 AND table_name = 'metric_exemplars' AND column_name = 'expires_at'`,
				[legacySchema],
			);
			expect(before.rows[0]?.data_type).toBe("timestamp with time zone");

			const legacyDb = new PostgresAdapter(legacyPool);
			const metrics = new MetricsStore(legacyDb);
			// The launch blocker: TEXT now() against TIMESTAMPTZ columns.
			await expect(metrics.purgeExpired()).rejects.toThrow(
				/operator does not exist: timestamp with time zone < text/,
			);

			const sql = await readFile(
				path.join(migrationsDir, "043_metric_exemplars_text_timestamps.sql"),
				"utf8",
			);
			await legacyPool.query(sql);
			await legacyPool.query(sql); // re-running is a no-op

			const types = await legacyPool.query<{
				column_name: string;
				data_type: string;
			}>(
				`SELECT column_name, data_type FROM information_schema.columns
				 WHERE table_schema = $1 AND table_name = 'metric_exemplars'
				   AND column_name IN ('received_at', 'expires_at')
				 ORDER BY column_name`,
				[legacySchema],
			);
			expect(types.rows).toEqual([
				{ column_name: "expires_at", data_type: "text" },
				{ column_name: "received_at", data_type: "text" },
			]);
			const converted = await legacyPool.query(
				`SELECT id, received_at, expires_at FROM metric_exemplars ORDER BY id`,
			);
			expect(converted.rows).toEqual([
				{
					id: "ex-expired",
					received_at: "2000-01-01T00:00:00.000Z",
					expires_at: "2000-01-02T00:00:00.000Z",
				},
				{
					id: "ex-live",
					received_at: "2026-06-01T12:34:56.789Z",
					expires_at: "2999-01-01T00:00:00.000Z",
				},
			]);
			const indexes = await legacyPool.query<{ indexname: string }>(
				`SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'metric_exemplars'`,
				[legacySchema],
			);
			expect(indexes.rows.map((r) => r.indexname)).toContain(
				"idx_metric_exemplars_expires",
			);

			// Retention now runs through the real store: 1 exemplar + 1 point.
			expect(await metrics.purgeExpired()).toBe(2);
			const remaining = await legacyPool.query(
				`SELECT id FROM metric_exemplars ORDER BY id`,
			);
			expect(remaining.rows).toEqual([{ id: "ex-live" }]);
			const points = await legacyPool.query(
				`SELECT id FROM metric_point ORDER BY id`,
			);
			expect(points.rows).toEqual([{ id: "p-live" }]);
			const recent = await metrics.recentExemplars({ projectId: "default" });
			expect(recent.map((e) => [e.traceId, e.receivedAt])).toEqual([
				["trace-legacy-live", "2026-06-01T12:34:56.789Z"],
			]);
		} finally {
			// Single-session servers (PGlite) share GUCs across sockets, so put
			// search_path / timezone back before the pooled adapter runs again.
			await legacyPool.query("RESET timezone").catch(() => {});
			await legacyPool.query("RESET search_path").catch(() => {});
			await legacyPool.end();
		}
	});

	it("migration 044 creates idx_actions_started_at and is a no-op when re-applied", async () => {
		expect(migrationFiles).toContain("044_actions_started_at_index.sql");
		const indexed = () =>
			db
				.prepare(
					`SELECT indexname FROM pg_indexes
					 WHERE schemaname = current_schema() AND tablename = 'actions' AND indexname = 'idx_actions_started_at'`,
				)
				.first<{ indexname: string }>();
		expect((await indexed())?.indexname).toBe("idx_actions_started_at");

		// Upgrade path: an already-indexed database re-running 044 must not fail.
		const admin = await adminClient();
		try {
			await admin.query(
				await readFile(
					path.join(migrationsDir, "044_actions_started_at_index.sql"),
					"utf8",
				),
			);
		} finally {
			await admin.end();
		}
		expect((await indexed())?.indexname).toBe("idx_actions_started_at");
	});

	it("purges expired action trees by TEXT started_at and keeps fresh, in-progress and eval-pinned trees", async () => {
		const purge = (over: { batchSize?: number; maxBatches?: number } = {}) =>
			purgeExpiredActionGraph(db, {
				retentionHours: FIXTURE_RETENTION_HOURS,
				now: () => FIXTURE_NOW_MS,
				...over,
			});
		const count = (table: string, column: string, value: string) =>
			db
				.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
				.bind(value)
				.first<{ n: number | string }>()
				.then((r) => Number(r?.n ?? 0));

		const expired = await seedTree(db, {
			projectId: "pg-ret",
			rootId: "pg-old",
		});
		const fresh = await seedTree(db, {
			projectId: "pg-ret",
			rootId: "pg-new",
			rootStartedAt: FRESH_START,
		});
		await seedTree(db, {
			projectId: "pg-ret",
			rootId: "pg-hung",
			childEndedAt: null,
		});
		await seedTree(db, {
			projectId: "pg-ret",
			rootId: "pg-running",
			agentRunStatus: "running",
		});
		const pinned = await seedTree(db, {
			projectId: "pg-ret",
			rootId: "pg-pinned",
		});
		await seedEvalCase(db, {
			id: "pg-case",
			projectId: "pg-ret",
			sourceActionId: pinned.childId,
		});
		await seedTree(db, { projectId: "pg-ret-other", rootId: "pg-other-old" });
		// Several expired single-batch candidates to exercise batching + IN lists.
		for (let i = 0; i < 3; i += 1) {
			await seedTree(db, {
				projectId: "pg-ret",
				rootId: `pg-bulk-${i}`,
				withLeaves: false,
			});
		}

		const first = await purge({ batchSize: 4, maxBatches: 1 });
		expect(first).toMatchObject({ actions: 4, batches: 1, truncated: true });

		const rest = await purge({ batchSize: 4 });
		expect(rest.truncated).toBe(false);
		// 2 (pg-old) + 2 (pg-other-old) + 6 (bulk) spine rows in total.
		expect(first.actions + rest.actions).toBe(10);
		expect(first.agent_runs + rest.agent_runs).toBe(5);
		expect(first.tool_calls + rest.tool_calls).toBe(2);
		expect(first.artifacts + rest.artifacts).toBe(2);

		expect(await count("actions", "root_action_id", expired.rootId)).toBe(0);
		expect(await count("tool_calls", "id", expired.toolCallId)).toBe(0);
		expect(
			await count("retrieval_events", "id", expired.retrievalEventId),
		).toBe(0);
		expect(await count("eval_results", "id", expired.evalResultId)).toBe(0);
		expect(await count("artifacts", "id", expired.artifactId)).toBe(0);
		expect(await count("agent_runs", "id", expired.rootId)).toBe(0);
		expect(await count("actions", "root_action_id", "pg-other-old")).toBe(0);

		expect(await count("actions", "root_action_id", fresh.rootId)).toBe(2);
		expect(await count("tool_calls", "id", fresh.toolCallId)).toBe(1);
		expect(await count("actions", "root_action_id", "pg-hung")).toBe(2);
		expect(await count("actions", "root_action_id", "pg-running")).toBe(2);
		expect(await count("agent_runs", "id", "pg-running")).toBe(1);
		expect(await count("actions", "root_action_id", pinned.rootId)).toBe(2);
		expect(await count("eval_cases", "id", "pg-case")).toBe(1);
		expect(await countActionGraph(db, "pg-ret")).toEqual({
			actions: 8,
			agent_runs: 4,
			tool_calls: 4,
			retrieval_events: 4,
			eval_results: 4,
			artifacts: 4,
		});

		// Idempotent: nothing left to purge.
		expect(await purge()).toMatchObject({
			actions: 0,
			batches: 0,
			truncated: false,
		});
	});

	it("ingests AI calls and summarises BOOLEAN is_error inside a TEXT time window", async () => {
		await ingestAICallBatch(db, [
			aiCall({ callId: "ai-ok" }),
			aiCall({ callId: "ai-err", isError: true, errorMessage: "boom" }),
			aiCall({
				callId: "ai-old",
				receivedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
			}),
		]);

		const overview = await getAICallsOverview(db, {
			projectId: "default",
			hours: 24,
		});
		expect(overview.summary.totalCalls).toBe(2);
		expect(overview.summary.errorCalls).toBe(1);
		expect(overview.summary.totalPromptTokens).toBe(20);
		expect(typeof overview.summary.totalCostUsd).toBe("number");
		expect(overview.calls.map((c) => [c.callId, c.isError]).sort()).toEqual([
			["ai-err", true],
			["ai-ok", false],
		]);
		// JSONB columns must still come back as JSON text (JSONB normalises
		// whitespace, so compare the parsed value).
		expect(typeof overview.calls[0]?.requestJson).toBe("string");
		expect(JSON.parse(overview.calls[0]?.requestJson ?? "null")).toEqual({
			messages: [],
		});

		const errorsOnly = await getAICallsOverview(db, {
			projectId: "default",
			hours: 24,
			isError: true,
		});
		expect(errorsOnly.calls.map((c) => c.callId)).toEqual(["ai-err"]);

		const alerts = new AlertsStore(db);
		const rule = {
			id: "rule-ai-errors",
			projectId: "default",
			name: "AI errors",
			signal: "ai",
			query: { isError: true },
			threshold: 0,
			windowMins: 60,
			comparison: "gt",
			channels: [],
			enabled: true,
			createdAt: isoNow(),
			updatedAt: isoNow(),
		} as unknown as AlertRule;
		expect(await alerts.evaluateRule(rule)).toBe(1);
	});

	it("purges expired AI data using the dialect's text-rendered now()", async () => {
		await ingestAICallBatch(db, [
			aiCall({ callId: "ai-expired", expiresAt: isoIn(-60_000) }),
		]);
		expect(await purgeExpiredAIData(db)).toBe(1);
		const remaining = await db
			.prepare(`SELECT call_id FROM ai_calls WHERE call_id = ?`)
			.bind("ai-expired")
			.first();
		expect(remaining).toBeNull();
	});

	it("ingests usage events with BOOLEAN is_bot and reads them back as D1 flags", async () => {
		const usage = new UsageStore(db);
		await usage.ingest([
			usageEvent({ eventId: "u-human" }),
			usageEvent({ eventId: "u-bot", sessionId: "sess-bot", isBot: true }),
		]);
		const flags = await db
			.prepare(`SELECT event_id, is_bot FROM usage_events ORDER BY event_id`)
			.all<{ event_id: string; is_bot: unknown }>();
		expect(flags.results).toEqual([
			{ event_id: "u-bot", is_bot: 1 },
			{ event_id: "u-human", is_bot: 0 },
		]);

		const overview = await usage.getOverview({
			projectId: "default",
			hours: 24,
		});
		// Same semantics as D1: bots are counted (not dropped) by getOverview.
		expect(overview.botsFiltered).toBe(1);
		expect(overview.summary.totalEvents).toBe(2);
	});

	it("runs every built-in and derived analysis definition", async () => {
		// Seed two linked spans so Tier 1 derivation emits the service,
		// edge, messaging-topic and AI analyses (julianday, json_extract …).
		const now = isoNow();
		const span = db.prepare(`
			INSERT INTO telemetry_spans (project_id, trace_id, span_id, parent_span_id, service_name,
				span_name, span_kind, status_code, start_time, end_time, duration_ms, attributes_json,
				received_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
		await db.batch([
			span.bind(
				"default",
				"trace-1",
				"span-a",
				null,
				"svc-a",
				"publish orders",
				4,
				0,
				now,
				now,
				12.5,
				JSON.stringify({ "messaging.destination": "orders" }),
				now,
				isoIn(3_600_000),
			),
			db
				.prepare(`
			INSERT INTO telemetry_spans (project_id, trace_id, span_id, parent_span_id, service_name,
				span_name, span_kind, status_code, start_time, end_time, duration_ms, attributes_json,
				received_at, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.bind(
					"default",
					"trace-1",
					"span-b",
					"span-a",
					"svc-b",
					"consume orders",
					5,
					2,
					now,
					now,
					30,
					JSON.stringify({
						"messaging.destination": "orders",
						"gen_ai.system": "openai",
					}),
					now,
					isoIn(3_600_000),
				),
		]);

		const derived = await deriveAnalysesForProject("default", db);
		expect(derived.map((d) => d.id)).toEqual(
			expect.arrayContaining(["ai_error_rate", "messaging_lag::orders"]),
		);

		const defs = [...TIER0_ANALYSES, ...INVESTIGATION_ANALYSES, ...derived];
		for (const def of defs) {
			const result = await runSqlAnalysis(def, {
				db,
				projectId: "default",
				retentionHours: 24,
			}).catch((err: Error) => {
				throw new Error(`${def.id}: ${err.message}`);
			});
			expect(VALID_STATUSES.has(result.status), def.id).toBe(true);
		}

		const errorRate = await runSqlAnalysis(
			TIER0_ANALYSES.find((d) => d.id === "overall_error_rate") as never,
			{ db, projectId: "default", retentionHours: 24 },
		);
		expect(errorRate.primaryValue).toBe(0.5);
		expect(Array.isArray(errorRate.payload.sparkline)).toBe(true);
	});
});
