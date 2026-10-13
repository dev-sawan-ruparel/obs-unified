import type { CollectorEnv, Logger } from "@obsunified/collector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCollectorMaintenance,
	createCollectorMaintenanceTasks,
	DEFAULT_MAINTENANCE_INTERVALS_MS,
	readMaintenanceConfig,
} from "./maintenance";

const MINUTE = 60_000;

const makeLogger = () =>
	({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	}) satisfies Logger;

/**
 * Structural `SqlDb` double with the Postgres dialect, standing in for the
 * `PostgresAdapter` the Node server places in `env.DB`. Records every SQL
 * string so tests can prove which tables each task touched. Returns empty
 * result sets, so each task exercises its "nothing due / nothing expired"
 * path end to end.
 */
const makePostgresLikeDb = () => {
	const calls: string[] = [];
	const statement = (sql: string) => ({
		bind: () => statement(sql),
		first: async () => {
			calls.push(sql);
			return null;
		},
		all: async () => {
			calls.push(sql);
			return { results: [] };
		},
		run: async () => {
			calls.push(sql);
			return { meta: { changes: 0 } };
		},
	});
	const db = {
		dialect: {
			name: "postgres" as const,
			now: () => "CURRENT_TIMESTAMP",
			sinceHours: (p: string) =>
				`(CURRENT_TIMESTAMP - (${p}::text || ' hours')::interval)`,
			sinceMinutes: (p: string) =>
				`(CURRENT_TIMESTAMP - (${p}::text || ' minutes')::interval)`,
			jsonText: (expr: string, path: string) =>
				`(${expr}::jsonb ->> '${path.replace(/^\$\./, "")}')`,
		},
		prepare: statement,
		batch: async (stmts: Array<{ run: () => Promise<unknown> }>) =>
			Promise.all(stmts.map((s) => s.run())),
	};
	return { db, calls };
};

const makeEnv = (db: unknown): CollectorEnv =>
	({ DB: db }) as unknown as CollectorEnv;

describe("readMaintenanceConfig", () => {
	it("defaults to the Worker cron cadences with the scheduler enabled", () => {
		expect(readMaintenanceConfig({})).toEqual({
			enabled: true,
			analysesIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.analyses,
			alertsIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.alerts,
			retentionIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.retention,
		});
		expect(readMaintenanceConfig({})).toMatchObject({
			analysesIntervalMs: 60_000,
			alertsIntervalMs: 300_000,
			retentionIntervalMs: 3_600_000,
		});
	});

	it("reads overrides in seconds and the enabled flag", () => {
		expect(
			readMaintenanceConfig({
				MAINTENANCE_ENABLED: "false",
				MAINTENANCE_ANALYSES_INTERVAL_SECONDS: "2",
				MAINTENANCE_ALERTS_INTERVAL_SECONDS: "7.5",
				MAINTENANCE_RETENTION_INTERVAL_SECONDS: "600",
			}),
		).toEqual({
			enabled: false,
			analysesIntervalMs: 2_000,
			alertsIntervalMs: 7_500,
			retentionIntervalMs: 600_000,
		});
		expect(readMaintenanceConfig({ MAINTENANCE_ENABLED: "0" }).enabled).toBe(
			false,
		);
		expect(readMaintenanceConfig({ MAINTENANCE_ENABLED: "TRUE" }).enabled).toBe(
			true,
		);
	});

	it("falls back to defaults for blank, non-numeric, or non-positive values", () => {
		expect(
			readMaintenanceConfig({
				MAINTENANCE_ANALYSES_INTERVAL_SECONDS: "",
				MAINTENANCE_ALERTS_INTERVAL_SECONDS: "soon",
				MAINTENANCE_RETENTION_INTERVAL_SECONDS: "-5",
			}),
		).toMatchObject({
			analysesIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.analyses,
			alertsIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.alerts,
			retentionIntervalMs: DEFAULT_MAINTENANCE_INTERVALS_MS.retention,
		});
	});
});

describe("createCollectorMaintenance", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("schedules analyses/alerts/retention at the configured cadence against the server env", async () => {
		const env = makeEnv({});
		const tasks = {
			runAnalyses: vi.fn(async () => {}),
			evaluateAlerts: vi.fn(async () => {}),
			runRetention: vi.fn(async () => {}),
		};
		const scheduler = createCollectorMaintenance({
			env,
			config: readMaintenanceConfig({}),
			logger: makeLogger(),
			tasks,
		});
		scheduler.start();

		// Staggered first runs: analyses 15s, alerts 30s, retention 60s.
		await vi.advanceTimersByTimeAsync(14_999);
		expect(tasks.runAnalyses).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(tasks.runAnalyses).toHaveBeenCalledTimes(1);
		expect(tasks.runAnalyses).toHaveBeenCalledWith(env);
		expect(tasks.evaluateAlerts).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(15_000);
		expect(tasks.evaluateAlerts).toHaveBeenCalledTimes(1);
		expect(tasks.evaluateAlerts).toHaveBeenCalledWith(env);
		expect(tasks.runRetention).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(30_000);
		expect(tasks.runRetention).toHaveBeenCalledTimes(1);
		expect(tasks.runRetention).toHaveBeenCalledWith(env);

		// One hour in: 60 analyses runs, 12 alert evaluations, 1 retention sweep.
		await vi.advanceTimersByTimeAsync(60 * MINUTE - 60_000);
		expect(tasks.runAnalyses).toHaveBeenCalledTimes(60);
		expect(tasks.evaluateAlerts).toHaveBeenCalledTimes(12);
		expect(tasks.runRetention).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(tasks.runRetention).toHaveBeenCalledTimes(2);

		expect(scheduler.status().map((s) => [s.name, s.intervalMs])).toEqual([
			["analyses_run", 60_000],
			["alerts_evaluate", 300_000],
			["retention_cleanup", 3_600_000],
		]);
		await scheduler.stop();
	});

	it("caps the initial delay at the interval when intervals are shortened", async () => {
		const tasks = {
			runAnalyses: vi.fn(async () => {}),
			evaluateAlerts: vi.fn(async () => {}),
			runRetention: vi.fn(async () => {}),
		};
		const scheduler = createCollectorMaintenance({
			env: makeEnv({}),
			config: readMaintenanceConfig({
				MAINTENANCE_ANALYSES_INTERVAL_SECONDS: "2",
				MAINTENANCE_ALERTS_INTERVAL_SECONDS: "3",
				MAINTENANCE_RETENTION_INTERVAL_SECONDS: "5",
			}),
			logger: makeLogger(),
			tasks,
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(tasks.runAnalyses).toHaveBeenCalledTimes(2);
		expect(tasks.evaluateAlerts).toHaveBeenCalledTimes(1);
		expect(tasks.runRetention).toHaveBeenCalledTimes(1);
		await scheduler.stop();
	});

	it("a rejecting task is logged and the other tasks keep running", async () => {
		const logger = makeLogger();
		const tasks = {
			runAnalyses: vi.fn(async () => {}),
			evaluateAlerts: vi.fn(async () => {
				throw new Error("alert_rules does not exist");
			}),
			runRetention: vi.fn(async () => {}),
		};
		const scheduler = createCollectorMaintenance({
			env: makeEnv({}),
			config: readMaintenanceConfig({}),
			logger,
			tasks,
		});
		scheduler.start();
		await vi.advanceTimersByTimeAsync(10 * MINUTE);
		expect(tasks.evaluateAlerts).toHaveBeenCalledTimes(2);
		expect(tasks.runAnalyses).toHaveBeenCalledTimes(10);
		expect(logger.error).toHaveBeenCalledWith(
			"[maintenance] task failed",
			expect.objectContaining({
				task: "alerts_evaluate",
				error: "alert_rules does not exist",
			}),
		);
		expect(scheduler.status()[1]).toMatchObject({ failures: 2 });
		await scheduler.stop();
	});
});

describe("createCollectorMaintenanceTasks (real collector handlers)", () => {
	it("runs retention cleanup through the SqlDb in env.DB without a ScheduledEvent", async () => {
		const logger = makeLogger();
		const { db, calls } = makePostgresLikeDb();
		const tasks = createCollectorMaintenanceTasks(logger);

		const summary = await tasks.runRetention(makeEnv(db));

		expect(summary).toEqual({
			spans: 0,
			usage: 0,
			logs: 0,
			ai_calls: 0,
			metric_points: 0,
			analysis_results: 0,
			profile_blobs: 0,
			actions: 0,
			action_leaves: 0,
			housekeeping: {
				alert_evaluations: 0,
				ask_evidence_events: 0,
				metric_series: 0,
				evidence_refs: 0,
				evidence_ref_expansions: 0,
			},
		});
		// The action graph sweep ran through the same SqlDb, scoped by the
		// dialect-neutral started_at cutoff rather than a SQLite built-in.
		expect(calls.some((sql) => /FROM actions a/i.test(sql))).toBe(true);
		// Postgres dialect flowed through: the expired-profile scan uses
		// CURRENT_TIMESTAMP rather than SQLite's datetime('now'). (Rows are
		// then deleted by id, after their blobs.)
		expect(
			calls.some(
				(sql) =>
					sql.includes("FROM profile_blobs") &&
					sql.includes("CURRENT_TIMESTAMP"),
			),
		).toBe(true);
		expect(calls.some((sql) => sql.includes("datetime('now')"))).toBe(false);
		expect(logger.info).toHaveBeenCalledWith(
			"[retention-cleanup] purged expired rows",
			expect.objectContaining({ spans: 0, profile_blobs: 0 }),
		);
	});

	it("runs the analyses pass and reports a summary", async () => {
		const logger = makeLogger();
		const { db, calls } = makePostgresLikeDb();
		const tasks = createCollectorMaintenanceTasks(logger);

		const summary = await tasks.runAnalyses(makeEnv(db));

		expect(summary).toMatchObject({ ran: 0, failed: 0, narrated: 0 });
		expect(calls.some((sql) => /analysis_definitions/i.test(sql))).toBe(true);
		expect(logger.info).toHaveBeenCalledWith(
			"[analyses] scheduled run summary",
			expect.objectContaining({ ran: 0 }),
		);
	});

	it("evaluates alert rules and logs the summary", async () => {
		const logger = makeLogger();
		const { db, calls } = makePostgresLikeDb();
		const tasks = createCollectorMaintenanceTasks(logger);

		const summary = await tasks.evaluateAlerts(makeEnv(db));

		expect(summary).toEqual({ evaluated: 0, fired: 0, resolved: 0 });
		expect(calls.some((sql) => /FROM alert_rules/i.test(sql))).toBe(true);
		expect(logger.info).toHaveBeenCalledWith(
			"[alerts] scheduled evaluation summary",
			{ evaluated: 0, fired: 0, resolved: 0 },
		);
	});

	it("surfaces a database failure from alert evaluation as a rejection (so the scheduler logs it)", async () => {
		const logger = makeLogger();
		const tasks = createCollectorMaintenanceTasks(logger);
		const failing = {
			dialect: { name: "postgres" },
			prepare: () => ({
				bind() {
					return this;
				},
				first: async () => {
					throw new Error("connection terminated");
				},
				all: async () => {
					throw new Error("connection terminated");
				},
				run: async () => {
					throw new Error("connection terminated");
				},
			}),
			batch: async () => [],
		};
		await expect(tasks.evaluateAlerts(makeEnv(failing))).rejects.toThrow(
			"connection terminated",
		);
	});
});
