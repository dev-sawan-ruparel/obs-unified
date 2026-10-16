/**
 * Workstream 4 (RFC 0014): Native-engine migration and query parity suite.
 *
 * Executes all 53 SQLite migrations on `node:sqlite` (`DatabaseSync`) and all
 * 53 Postgres migrations on a live PostgreSQL instance (`OBS_PG_TEST_URL` or an
 * ephemeral `postgres:15` Docker container), then verifies:
 *   1. Full 53-migration schema semantic parity (`compareDatabaseSchemas`).
 *   2. Negative regression fixtures proving the gate catches:
 *      - a missing UNIQUE or CHECK constraint,
 *      - a modified partial-index WHERE predicate,
 *      - invalid Postgres queries (SQLSTATE 42P10 SELECT DISTINCT ... ORDER BY
 *        and SQLSTATE 42803 ungrouped correlated subquery).
 *   3. Upgrade data-preservation fixtures across 050 -> 053 (including 051
 *      duplicate active-incident collapse and partial unique index enforcement).
 *   4. Dual-engine application query parity across `/internal/connected/change/:id`,
 *      `/internal/usage/sessions`, `recordChangeEvent`, `computeChangeBlastRadius`,
 *      `openOrDeduplicateIncident`, `recordInvestigationFinding`, and
 *      `proposeRemediationAction`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { StoredSpan, UsageEventRecord } from "@obsunified/types";
import { AgentAutonomyLevel } from "@obsunified/types/constants";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import {
	computeChangeBlastRadius,
	listChangeEvents,
	recordChangeEvent,
} from "../lib/autosre-change-correlation";
import {
	getInvestigationFinding,
	recordInvestigationFinding,
	searchInvestigationFindings,
} from "../lib/autosre-findings";
import {
	acquireIncidentLease,
	approveRemediationProposal,
	claimRemediationGrant,
	openOrDeduplicateIncident,
	proposeRemediationAction,
} from "../lib/autosre-remediation-gate";
import {
	compareDatabaseSchemas,
	introspectPostgresSchema,
	introspectSqliteSchema,
} from "../lib/db-parity";
import type { SqlDb } from "../lib/sql-db";
import {
	configurePostgresTypeParsers,
	PostgresAdapter,
} from "../lib/sql-db-postgres";
import { ingestTelemetrySpans } from "../lib/store/ingest";
import {
	applySqliteMigrations,
	createMigratedSqliteDb,
	type NodeSqliteDb,
} from "../lib/test-utils/node-sqlite-db";
import { UsageStore } from "../lib/usage-store";
import { connectedRoutesPlugin } from "../plugins/connected-routes";
import { usageQueryRoutesPlugin } from "../plugins/usage-query-routes";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgMigrationsDir = path.resolve(here, "../migrations-postgres");

type PgModule = typeof import("pg");
type PgPool = import("pg").Pool;
type PgClient = import("pg").Client;

function resolveDockerEnv(): NodeJS.ProcessEnv | null {
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (!env.DOCKER_HOST) {
		const colimaSock = path.join(
			os.homedir(),
			".colima/obs-unified-smoke/docker.sock",
		);
		if (existsSync(colimaSock)) {
			env.DOCKER_HOST = `unix://${colimaSock}`;
		}
	}
	try {
		execFileSync("docker", ["info"], {
			env,
			stdio: "ignore",
			timeout: 5_000,
		});
		return env;
	} catch {
		return null;
	}
}

const configuredPgUrl = process.env.OBS_PG_TEST_URL;
const dockerEnv = configuredPgUrl ? null : resolveDockerEnv();
const canRunPostgres = Boolean(configuredPgUrl || dockerEnv);

if (process.env.OBS_REQUIRE_PG_PARITY === "1" && !canRunPostgres) {
	throw new Error(
		"OBS_REQUIRE_PG_PARITY=1 requires either OBS_PG_TEST_URL or a reachable Docker daemon to run native-engine Postgres parity tests.",
	);
}

describe.skipIf(!canRunPostgres)(
	"Workstream 4: Native-engine SQLite and Postgres schema & query parity",
	() => {
		const runSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
		const mainPgSchema = `obs_parity_main_${runSuffix}`;
		const negPgSchema = `obs_parity_neg_${runSuffix}`;
		const upgPgSchema = `obs_parity_upg_${runSuffix}`;

		let startedContainerId: string | null = null;
		let activePgUrl = configuredPgUrl ?? "";
		let pg: PgModule;
		let pool: PgPool;
		let pgDb: PostgresAdapter;
		let sqliteDb: NodeSqliteDb;
		let pgMigrationFiles: string[] = [];
		let sqliteVersion = "";
		let postgresVersion = "";

		const connectClient = async (schema?: string): Promise<PgClient> => {
			const client = new pg.Client({ connectionString: activePgUrl });
			await client.connect();
			if (schema) {
				await client.query(`SET search_path TO ${schema}`);
			}
			return client;
		};

		const applyPgMigrationsToSchema = async (
			schema: string,
			options: { from?: string; upTo?: string } = {},
		): Promise<string[]> => {
			const client = await connectClient();
			const applied: string[] = [];
			try {
				await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
				await client.query(`SET search_path TO ${schema}`);
				for (const file of pgMigrationFiles) {
					const prefix = file.slice(0, 3);
					if (options.from && prefix < options.from) continue;
					if (options.upTo && prefix > options.upTo) continue;
					const sql = await readFile(path.join(pgMigrationsDir, file), "utf8");
					await client.query("BEGIN");
					try {
						await client.query(sql);
						await client.query("COMMIT");
						applied.push(file);
					} catch (err) {
						await client.query("ROLLBACK");
						throw new Error(
							`Postgres migration ${file} failed in ${schema}: ${(err as Error).message}`,
						);
					}
				}
			} finally {
				await client.query("RESET search_path").catch(() => {});
				await client.end();
			}
			return applied;
		};

		beforeAll(async () => {
			if (!activePgUrl && dockerEnv) {
				startedContainerId = execFileSync(
					"docker",
					[
						"run",
						"-d",
						"--rm",
						"-e",
						"POSTGRES_USER=obs",
						"-e",
						"POSTGRES_PASSWORD=obs",
						"-e",
						"POSTGRES_DB=obs_parity",
						"-p",
						"127.0.0.1::5432",
						"postgres:15",
					],
					{ env: dockerEnv, encoding: "utf8" },
				).trim();

				const portOut = execFileSync(
					"docker",
					["port", startedContainerId, "5432/tcp"],
					{ env: dockerEnv, encoding: "utf8" },
				).trim();
				const hostPort = portOut.split(":").pop()?.trim();
				if (!hostPort) {
					throw new Error(
						`Could not determine mapped port for postgres:15 container (${portOut})`,
					);
				}
				activePgUrl = `postgres://obs:obs@127.0.0.1:${hostPort}/obs_parity`;
			}

			pg = (await import("pg")).default as unknown as PgModule;
			configurePostgresTypeParsers(pg.types);

			// Wait for Postgres readiness if we just launched a container
			let ready = false;
			for (let attempt = 0; attempt < 50; attempt += 1) {
				try {
					const probe = new pg.Client({ connectionString: activePgUrl });
					await probe.connect();
					const ver = await probe.query<{ server_version: string }>(
						"SHOW server_version",
					);
					postgresVersion = ver.rows[0]?.server_version ?? "unknown";
					await probe.end();
					ready = true;
					break;
				} catch {
					await new Promise((r) => setTimeout(r, 250));
				}
			}
			if (!ready) {
				throw new Error(
					`Postgres at ${activePgUrl} did not become ready within timeout`,
				);
			}

			pgMigrationFiles = (await readdir(pgMigrationsDir))
				.filter((f) => f.endsWith(".sql"))
				.sort();

			await applyPgMigrationsToSchema(mainPgSchema);

			pool = new pg.Pool({
				connectionString: activePgUrl,
				max: 1,
			});
			await pool.query(`SET search_path TO ${mainPgSchema}`);
			pgDb = new PostgresAdapter(pool);

			sqliteDb = createMigratedSqliteDb();
			const sVer = sqliteDb.raw
				.prepare("SELECT sqlite_version() AS v")
				.get() as { v: string };
			sqliteVersion = sVer.v;
		}, 120_000);

		afterAll(async () => {
			sqliteDb?.close();
			if (pool) {
				await pool.query("RESET search_path").catch(() => {});
				await pool.end().catch(() => {});
			}
			if (pg && activePgUrl && !startedContainerId) {
				const cleanup = await connectClient().catch(() => null);
				if (cleanup) {
					try {
						for (const s of [mainPgSchema, negPgSchema, upgPgSchema]) {
							await cleanup.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
						}
					} finally {
						await cleanup.end().catch(() => {});
					}
				}
			}
			if (startedContainerId && dockerEnv) {
				try {
					execFileSync("docker", ["rm", "-f", startedContainerId], {
						env: dockerEnv,
						stdio: "ignore",
					});
				} catch {
					// Ignore container cleanup errors on teardown
				}
			}
		});

		it("1. verifies full 53-migration schema semantic parity between SQLite and Postgres", async () => {
			expect(sqliteVersion).toMatch(/^\d+\.\d+/);
			expect(postgresVersion).toMatch(/^\d+/);
			expect(pgMigrationFiles.length).toBeGreaterThanOrEqual(53);

			const sqliteSchema = introspectSqliteSchema(sqliteDb.raw);
			const client = await connectClient(mainPgSchema);
			try {
				const postgresSchema = await introspectPostgresSchema(
					client,
					mainPgSchema,
				);
				const report = compareDatabaseSchemas(sqliteSchema, postgresSchema);
				expect(report.differences).toEqual([]);
				expect(report.ok).toBe(true);
				expect(report.tableCount).toBe(38);

				// Explicitly spot-check critical AutoSRE constraints and partial indexes
				const sIncidents = sqliteSchema.tables.incident_investigations;
				const pIncidents = postgresSchema.tables.incident_investigations;
				expect(sIncidents.indexes.uq_incidents_active_dedup).toEqual({
					name: "uq_incidents_active_dedup",
					unique: true,
					method: "btree",
					columns: ["project_id ASC", "environment ASC", "dedup_key ASC"],
					where:
						"status IN ('open', 'dispatched', 'leased', 'remediating', 'verifying')",
				});
				expect(pIncidents.indexes.uq_incidents_active_dedup).toEqual(
					sIncidents.indexes.uq_incidents_active_dedup,
				);

				expect(
					sqliteSchema.tables.remediation_proposals.uniqueConstraints,
				).toEqual([["project_id", "environment", "idempotency_key"]]);
				expect(
					postgresSchema.tables.remediation_proposals.uniqueConstraints,
				).toEqual([["project_id", "environment", "idempotency_key"]]);
			} finally {
				await client.end();
			}
		});

		it("2. fails negative regression fixtures when a constraint is removed, a partial-index predicate changes, or a query violates Postgres SQL rules", async () => {
			const sNeg = new DatabaseSync(":memory:");
			const client = await connectClient();
			try {
				await client.query(`CREATE SCHEMA IF NOT EXISTS ${negPgSchema}`);
				await client.query(`SET search_path TO ${negPgSchema}`);

				// SQLite has UNIQUE (project_id, idempotency_key), CHECK (confidence >= 0),
				// and the full partial index WHERE predicate.
				sNeg.exec(`
					CREATE TABLE regression_proposals (
						project_id TEXT NOT NULL,
						id TEXT NOT NULL,
						idempotency_key TEXT NOT NULL,
						confidence REAL NOT NULL,
						status TEXT NOT NULL DEFAULT 'open',
						PRIMARY KEY (project_id, id),
						UNIQUE (project_id, idempotency_key),
						CHECK (confidence >= 0)
					);
					CREATE UNIQUE INDEX uq_regression_active
						ON regression_proposals (project_id, idempotency_key)
						WHERE status IN ('open', 'dispatched', 'verifying');
				`);

				// Postgres is missing the UNIQUE constraint, missing the CHECK constraint,
				// and omits 'verifying' from the partial index WHERE predicate.
				await client.query(`
					CREATE TABLE regression_proposals (
						project_id TEXT NOT NULL,
						id TEXT NOT NULL,
						idempotency_key TEXT NOT NULL,
						confidence DOUBLE PRECISION NOT NULL,
						status TEXT NOT NULL DEFAULT 'open',
						PRIMARY KEY (project_id, id)
					);
					CREATE UNIQUE INDEX uq_regression_active
						ON regression_proposals (project_id, idempotency_key)
						WHERE status IN ('open', 'dispatched');
				`);

				const sSchema = introspectSqliteSchema(sNeg);
				const pSchema = await introspectPostgresSchema(client, negPgSchema);
				const report = compareDatabaseSchemas(sSchema, pSchema);

				expect(report.ok).toBe(false);
				const kinds = report.differences.map((d) => d.kind);
				expect(kinds).toContain("unique_constraint");
				expect(kinds).toContain("check_constraint");
				expect(kinds).toContain("index_where");

				// Dialect-specific invalid Postgres queries that SQLite silently permits:
				// (a) SQLSTATE 42P10: SELECT DISTINCT ... ORDER BY non-selected column
				const distinctOrderBySql = `
					SELECT DISTINCT trace_id, span_id
					FROM telemetry_spans
					WHERE project_id = ?
					ORDER BY start_time DESC
				`;
				await expect(
					sqliteDb.prepare(distinctOrderBySql).bind("default").all(),
				).resolves.toEqual({ results: [] });
				await expect(
					pgDb.prepare(distinctOrderBySql).bind("default").all(),
				).rejects.toThrow(
					/SELECT DISTINCT, ORDER BY expressions must appear in select list/i,
				);

				// (b) SQLSTATE 42803: correlated subquery referencing ungrouped outer column
				const ungroupedSubquerySql = `
					SELECT session_id,
					       (SELECT page_path FROM usage_events u2 WHERE u2.event_id = usage_events.event_id LIMIT 1) AS bad_col
					FROM usage_events
					WHERE project_id = ?
					GROUP BY session_id
				`;
				await expect(
					sqliteDb.prepare(ungroupedSubquerySql).bind("default").all(),
				).resolves.toEqual({ results: [] });
				await expect(
					pgDb.prepare(ungroupedSubquerySql).bind("default").all(),
				).rejects.toThrow(
					/subquery uses ungrouped column|must appear in the GROUP BY clause/i,
				);
			} finally {
				sNeg.close();
				await client
					.query(`DROP SCHEMA IF EXISTS ${negPgSchema} CASCADE`)
					.catch(() => {});
				await client.end();
			}
		});

		it("3. preserves rows, tenant isolation, and collapses duplicate active incidents during 050 -> 053 upgrades on both engines", async () => {
			const sUpg = createMigratedSqliteDb({ upTo: "050" });
			await applyPgMigrationsToSchema(upgPgSchema, { upTo: "050" });
			const upgPool = new pg.Pool({ connectionString: activePgUrl, max: 1 });
			await upgPool.query(`SET search_path TO ${upgPgSchema}`);
			const pUpg = new PostgresAdapter(upgPool);

			try {
				const seedPre051 = async (db: SqlDb) => {
					const insertIncident = db.prepare(`
						INSERT INTO incident_investigations (
							project_id, environment, id, dedup_key, status, target_node_id,
							symptom_anchor_kind, symptom_anchor_id, alert_count, opened_at, updated_at
						) VALUES (?, ?, ?, ?, ?, 'service:default:default:checkout', 'trace', 'trace-1', 1, ?, ?)
					`);
					await db.batch([
						// Duplicate active incidents for tenant-a (pre-051 race condition)
						insertIncident.bind(
							"tenant-a",
							"default",
							"inc-older",
							"dedup-shared",
							"open",
							"2026-06-01T00:00:00.000Z",
							"2026-06-01T00:00:00.000Z",
						),
						insertIncident.bind(
							"tenant-a",
							"default",
							"inc-newer",
							"dedup-shared",
							"leased",
							"2026-06-01T00:05:00.000Z",
							"2026-06-01T00:05:00.000Z",
						),
						// Resolved incident with same dedup_key (must stay resolved)
						insertIncident.bind(
							"tenant-a",
							"default",
							"inc-resolved",
							"dedup-shared",
							"resolved",
							"2026-05-31T23:00:00.000Z",
							"2026-05-31T23:30:00.000Z",
						),
						// Active incident in tenant-b with same dedup_key (must stay isolated & open)
						insertIncident.bind(
							"tenant-b",
							"default",
							"inc-older",
							"dedup-shared",
							"open",
							"2026-06-01T00:00:00.000Z",
							"2026-06-01T00:00:00.000Z",
						),
						db.prepare(`
								INSERT INTO investigation_findings (
									project_id, environment, id, incident_id, fingerprint,
									fingerprint_input_json, title, summary, causal_proof_tier,
									confidence, confidence_breakdown_json, symptom_entity_kind,
									symptom_entity_id, fault_locus_entity_kind, fault_locus_entity_id,
									causal_chain_json, cited_evidence_ids_json, actor_type, actor_id,
									created_at, updated_at
								) VALUES (
									'tenant-a', 'default', 'fnd-pre-051', 'inc-newer', 'fp-1',
									'{}', 'Checkout 500s', 'DB timeout', 'unverified_locus',
									0.6, '{}', 'trace', 'trace-1', 'service', 'service:default:default:checkout',
									'[]', '["trace-1"]', 'agent', 'sre-agent',
									'2026-06-01T00:06:00.000Z', '2026-06-01T00:06:00.000Z'
								)
							`),
					]);
				};

				await seedPre051(sUpg);
				await seedPre051(pUpg);

				// Apply 051-053 on both engines
				applySqliteMigrations(sUpg.raw, { from: "051", upTo: "053" });
				await applyPgMigrationsToSchema(upgPgSchema, {
					from: "051",
					upTo: "053",
				});
				// Re-applying 051-053 on Postgres is a no-op (IF NOT EXISTS)
				await applyPgMigrationsToSchema(upgPgSchema, {
					from: "051",
					upTo: "053",
				});

				const inspectUpgradedState = async (db: SqlDb) => {
					const incidents = await db
						.prepare(
							`SELECT project_id, id, status
							 FROM incident_investigations
							 ORDER BY project_id, id`,
						)
						.all<{ project_id: string; id: string; status: string }>();
					const finding = await db
						.prepare(
							`SELECT id, consecutive_ok_checks
							 FROM investigation_findings
							 WHERE project_id = 'tenant-a' AND id = 'fnd-pre-051'`,
						)
						.first<{ id: string; consecutive_ok_checks: number }>();

					// Partial unique index uq_incidents_active_dedup must reject a direct duplicate active insert
					let duplicateRejected = false;
					try {
						await db
							.prepare(
								`INSERT INTO incident_investigations (
									project_id, environment, id, dedup_key, status, target_node_id,
									symptom_anchor_kind, symptom_anchor_id, alert_count, opened_at, updated_at
								) VALUES ('tenant-a', 'default', 'inc-dup-after-051', 'dedup-shared', 'open', 'service:default:default:checkout', 'trace', 'trace-2', 1, '2026-06-01T00:10:00.000Z', '2026-06-01T00:10:00.000Z')`,
							)
							.run();
					} catch {
						duplicateRejected = true;
					}

					return {
						incidents: incidents.results,
						finding: {
							id: finding?.id,
							consecutive_ok_checks: Number(finding?.consecutive_ok_checks),
						},
						duplicateRejected,
					};
				};

				const sqliteState = await inspectUpgradedState(sUpg);
				const pgState = await inspectUpgradedState(pUpg);

				expect(sqliteState).toEqual({
					incidents: [
						{ project_id: "tenant-a", id: "inc-newer", status: "leased" },
						{ project_id: "tenant-a", id: "inc-older", status: "escalated" },
						{ project_id: "tenant-a", id: "inc-resolved", status: "resolved" },
						{ project_id: "tenant-b", id: "inc-older", status: "open" },
					],
					finding: { id: "fnd-pre-051", consecutive_ok_checks: 0 },
					duplicateRejected: true,
				});
				expect(pgState).toEqual(sqliteState);
			} finally {
				sUpg.close();
				await upgPool.query("RESET search_path").catch(() => {});
				await upgPool.end().catch(() => {});
			}
		});

		it("4. produces matching logical results across SQLite and Postgres for connected routes, usage sessions, and AutoSRE flows", async () => {
			const projectId = "parity-proj";
			const environment = "prod";
			const baseMs = Date.parse("2026-07-01T12:00:00.000Z");
			const changeTimeIso = new Date(baseMs).toISOString();
			const preTimeIso = new Date(baseMs - 10 * 60_000).toISOString();
			const postTime1Iso = new Date(baseMs + 60_000).toISOString();
			const nowIso = new Date().toISOString();
			const expiresIso = new Date(Date.now() + 24 * 3600_000).toISOString();

			const runFlowOnEngine = async (db: SqlDb) => {
				// 1. Record an explicit deployment change event
				const change = await recordChangeEvent(db, projectId, {
					id: "chg-parity-1",
					environment,
					kind: "deploy",
					source: "explicit_api",
					serviceName: "checkout",
					version: "v2.0.0",
					previousVersion: "v1.0.0",
					commitSha: "bbbb2222",
					previousCommitSha: "aaaa1111",
					summary: "Deploy checkout v2.0.0",
					touchedPaths: ["src/checkout/pay.ts"],
					occurredAt: changeTimeIso,
				});

				// 2. Seed spans:
				// - 55 healthy v1.0.0 spans pre-deploy and 55 healthy v1.0.0 spans post-deploy
				// - 55 failing v2.0.0 spans post-deploy (to satisfy minComparableSample=50 and isolate cohort lift)
				const makeSpan = (
					idx: number,
					version: string,
					statusCode: number,
					startTime: string,
				): StoredSpan => ({
					projectId,
					environment,
					traceId: `trace-${version}-${idx}`,
					spanId: `span-${version}-${idx}`,
					parentSpanId: null,
					traceState: null,
					serviceName: "checkout",
					serviceVersion: version,
					scopeName: null,
					scopeVersion: null,
					spanName: "POST /checkout/pay",
					spanKind: 1,
					statusCode,
					statusMessage: statusCode === 2 ? "PoolExhaustedError" : null,
					errorSignature: statusCode === 2 ? "PoolExhaustedError" : null,
					startTime,
					endTime: startTime,
					durationMs: statusCode === 2 ? 450 : 25,
					attributesJson: JSON.stringify({
						"code.filepath": "src/checkout/pay.ts",
					}),
					droppedAttributesCount: 0,
					resourceAttributesJson: JSON.stringify({
						"service.name": "checkout",
						"service.version": version,
						"deployment.environment": environment,
					}),
					eventsJson: "[]",
					droppedEventsCount: 0,
					linksJson: "[]",
					droppedLinksCount: 0,
					receivedAt: nowIso,
					expiresAt: expiresIso,
					sessionId: null,
					interactionId: null,
				});

				const spans: StoredSpan[] = [];
				for (let i = 0; i < 55; i += 1) {
					const preSpanTime = new Date(
						baseMs - 10 * 60_000 + i * 1000,
					).toISOString();
					const postSpanTime = new Date(
						baseMs + 60_000 + i * 1000,
					).toISOString();
					spans.push(makeSpan(i, "v1.0.0", 1, preSpanTime));
					spans.push(makeSpan(i + 100, "v1.0.0", 1, postSpanTime));
					spans.push(makeSpan(i, "v2.0.0", 2, postSpanTime));
				}
				await ingestTelemetrySpans(db, spans);

				// 3. Seed usage events for /internal/usage/sessions (tests 42803 correlated subquery parity)
				const usageStore = new UsageStore(db);
				const makeUsage = (
					over: Partial<UsageEventRecord>,
				): UsageEventRecord => ({
					projectId,
					eventId: "evt-1",
					sessionId: "sess-alpha",
					visitorId: "vis-1",
					eventType: "page_view",
					eventName: "page_view",
					pagePath: "/home",
					pageTitle: "Home",
					referrer: null,
					severity: "info",
					source: "web",
					contextJson: "{}",
					propertiesJson: "{}",
					userAgent: "Mozilla/5.0",
					occurredAt: preTimeIso,
					receivedAt: nowIso,
					expiresAt: expiresIso,
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
				await usageStore.ingest([
					makeUsage({
						eventId: "evt-1",
						sessionId: "sess-alpha",
						pagePath: "/cart",
						occurredAt: preTimeIso,
					}),
					makeUsage({
						eventId: "evt-2",
						sessionId: "sess-alpha",
						pagePath: "/checkout",
						eventType: "frontend_error",
						severity: "error",
						occurredAt: postTime1Iso,
					}),
				]);

				// 4. Compute change blast radius
				const blast = await computeChangeBlastRadius(db, projectId, change.id, {
					environment,
					minComparableSample: 50,
				});

				// 5. Open incident + deduplicate + acquire lease
				const opened1 = await openOrDeduplicateIncident(db, projectId, {
					id: "inc-parity-1",
					environment,
					targetNodeId: change.targetNodeId,
					symptomCategory: "PoolExhaustedError",
					symptomAnchorKind: "trace",
					symptomAnchorId: "trace-v2.0.0-54",
				});
				const opened2 = await openOrDeduplicateIncident(db, projectId, {
					id: "inc-parity-2",
					environment,
					targetNodeId: change.targetNodeId,
					symptomCategory: "PoolExhaustedError",
					symptomAnchorKind: "trace",
					symptomAnchorId: "trace-v2.0.0-54",
				});
				const lease = await acquireIncidentLease(
					db,
					projectId,
					opened1.incident.id,
					{
						environment,
						runnerId: "runner-1",
						leaseDurationSeconds: 120,
						nowIso,
					},
				);

				// 6. Record investigation finding linked to the change & span fault locus
				const finding = await recordInvestigationFinding(db, projectId, {
					idempotencyKey: "idem-finding-parity-1",
					environment,
					incidentId: opened1.incident.id,
					title: "POST /checkout/pay PoolExhaustedError after v2.0.0 deploy",
					summary: "v2.0.0 introduced connection pool leak in pay.ts",
					symptomEntityKind: "trace",
					symptomEntityId: "trace-v2.0.0-54",
					faultLocusEntityKind: "span",
					faultLocusEntityId: "trace-v2.0.0-54:span-v2.0.0-54",
					rootCauseEntityKind: "change",
					rootCauseEntityId: change.id,
					contributingChangeId: change.id,
					causalChain: [
						{
							subjectKind: "change",
							subjectId: change.id,
							predicate: "isolated_to_version_cohort",
							objectKind: "service",
							objectId: change.targetNodeId,
							relationshipCertainty: "exact",
							causalProofTier: "cohort_rate_isolated",
							confidence: 0.9,
							reason: "Isolated to v2.0.0 cohort",
						},
					],
					citedEvidenceIds: ["trace-v2.0.0-54:span-v2.0.0-54", change.id],
					codeReferences: [
						{
							relativePath: "src/checkout/pay.ts",
							symbolName: "processPayment",
							lineNumber: 42,
						},
					],
					actorType: "agent",
					actorId: "autosre-investigator",
				});

				// 7. Propose remediation action, approve, and claim grant
				const proposal = await proposeRemediationAction(db, projectId, {
					environment,
					incidentId: opened1.incident.id,
					findingId: finding.id,
					idempotencyKey: "idem-rem-parity-1",
					actionKind: "rollback_deploy",
					targetNodeId: change.targetNodeId,
					expectedCurrentState: { version: "v2.0.0" },
					desiredTargetState: { version: "v1.0.0" },
					requestedAutonomy: AgentAutonomyLevel.HumanApprovedWrite,
				});
				const approved = await approveRemediationProposal(
					db,
					projectId,
					proposal.id,
					{
						environment,
						approvedByUserId: "oncall@example.com",
					},
				);
				const claimed = await claimRemediationGrant(
					db,
					projectId,
					proposal.id,
					{
						environment,
						grantToken: approved.grantToken ?? "",
						runnerId: "runner-1",
					},
				);

				// 8. Query HTTP routes (/internal/connected/change/:id & /internal/usage/sessions)
				const app = new Hono<{ Bindings: CollectorEnv }>();
				app.use("*", async (c, next) => {
					(c as unknown as { set: (k: string, v: string) => void }).set(
						"projectId",
						projectId,
					);
					await next();
				});
				const runtime = new CollectorRuntime();
				connectedRoutesPlugin.register(app, runtime);
				usageQueryRoutesPlugin.register(app, runtime);
				const env = { DB: db as unknown as D1Database } as CollectorEnv;

				const connectedRes = await app.request(
					`/internal/connected/change/${change.id}?environment=${environment}`,
					{},
					env,
				);
				expect(connectedRes.status).toBe(200);
				const connectedBody = (await connectedRes.json()) as {
					anchor: { entityId: string };
					across: Array<{
						kind: string;
						links: Array<{ entityKind: string; entityId: string }>;
					}>;
				};

				const sessionsRes = await app.request(
					`/internal/usage/sessions?hours=24`,
					{},
					env,
				);
				expect(sessionsRes.status).toBe(200);
				const sessionsBody = (await sessionsRes.json()) as {
					sessions: Array<{
						sessionId: string;
						eventCount: number;
						errorCount: number;
						lastPath: string | null;
					}>;
				};

				const changesList = await listChangeEvents(db, {
					projectId,
					environment,
				});
				const findingsList = await searchInvestigationFindings(db, {
					projectId,
					environment,
					fingerprint: finding.fingerprint,
				});
				const loadedFinding = await getInvestigationFinding(
					db,
					projectId,
					finding.id,
					environment,
				);

				return {
					changeTargetNodeId: change.targetNodeId,
					changesCount: changesList.length,
					blast: blast
						? {
								cohortVerdict: blast.cohortVerdict,
								causalProofTier: blast.causalProofTier,
								newErrorCount: blast.newCohort.errorCount,
								newRequestCount: blast.newCohort.requestCount,
								oldErrorCount: blast.oldCohort.errorCount,
								oldRequestCount: blast.oldCohort.requestCount,
								overlappingCodePaths: blast.overlappingCodePaths,
							}
						: null,
					incident: {
						firstDeduplicated: opened1.deduplicated,
						secondDeduplicated: opened2.deduplicated,
						alertCount: opened2.incident.alertCount,
						leaseAcquired: lease.acquired,
					},
					finding: {
						id: finding.id,
						fingerprint: finding.fingerprint,
						causalProofTier: finding.causalProofTier,
						cohortVerdict: finding.cohortVerdict,
						confidenceBreakdown: finding.confidenceBreakdown,
						matchesLoaded: loadedFinding?.id === finding.id,
						searchCount: findingsList.length,
					},
					remediation: {
						initialStatus: proposal.status,
						effectiveAutonomy: proposal.effectiveAutonomy,
						approvedStatus: approved.status,
						hasGrantToken: Boolean(approved.grantToken?.startsWith("rgt_")),
						claimedStatus: claimed.status,
						claimedByRunnerId: claimed.claimedByRunnerId,
					},
					connectedSpanLinks: connectedBody.across.flatMap((g) =>
						g.links.map((l) => `${l.entityKind}:${l.entityId}`),
					),
					sessions: sessionsBody.sessions.map((s) => ({
						sessionId: s.sessionId,
						eventCount: s.eventCount,
						errorCount: s.errorCount,
						lastPath: s.lastPath,
					})),
				};
			};

			const sqliteResult = await runFlowOnEngine(sqliteDb);
			const postgresResult = await runFlowOnEngine(pgDb);

			expect(postgresResult).toEqual(sqliteResult);
			expect(sqliteResult.blast).toEqual({
				cohortVerdict: "isolated_to_new_version",
				causalProofTier: "cohort_rate_isolated",
				newErrorCount: 55,
				newRequestCount: 55,
				oldErrorCount: 0,
				oldRequestCount: 55,
				overlappingCodePaths: ["src/checkout/pay.ts"],
			});
			expect(sqliteResult.finding.causalProofTier).toBe("cohort_rate_isolated");
			expect(sqliteResult.incident).toEqual({
				firstDeduplicated: false,
				secondDeduplicated: true,
				alertCount: 2,
				leaseAcquired: true,
			});
			expect(sqliteResult.remediation).toEqual({
				initialStatus: "pending_human_approval",
				effectiveAutonomy: "human_approved_write",
				approvedStatus: "grant_issued",
				hasGrantToken: true,
				claimedStatus: "claimed_executing",
				claimedByRunnerId: "runner-1",
			});
			// Most recent span first (trace-v2.0.0-54 at postTime2Iso)
			expect(sqliteResult.connectedSpanLinks[0]).toBe(
				"span:trace-v2.0.0-54:span-v2.0.0-54",
			);
			expect(sqliteResult.sessions).toEqual([
				{
					sessionId: "sess-alpha",
					eventCount: 2,
					errorCount: 1,
					lastPath: "/checkout",
				},
			]);
		});
	},
);
