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
 * `timestamptz`, and SQLite built-ins in the shared analysis SQL.
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
import { getAICallsOverview, ingestAICallBatch } from "./ai-store/calls";
import { purgeExpiredAIData } from "./ai-store/retention";
import { AlertsStore } from "./alerts-store";
import { runSqlAnalysis } from "./analyses-runner";
import { sha256Hex } from "./hash";
import { ProjectsStore } from "./projects-store";
import {
	configurePostgresTypeParsers,
	PostgresAdapter,
} from "./sql-db-postgres";
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
