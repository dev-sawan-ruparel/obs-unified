/**
 * Background maintenance for the standalone Node collector.
 *
 * Mirrors the Cloudflare Worker's cron triggers (`apps/collector/wrangler.toml`):
 *
 *   - `* * * * *`   → run due analyses   (`analyses_run`)
 *   - `*\/5 * * * *` → evaluate alert rules (`alerts_evaluate`)
 *   - `0 * * * *`   → retention cleanup  (`retention_cleanup`)
 *
 * The collector package exposes each task as a runtime-neutral `run(env)`
 * (`ScheduledTaskHandler`) — the Worker's `scheduled(event, env, ctx)` is a
 * thin adapter over the same function. We call `run` directly with the Node
 * server's `CollectorEnv`, so the tasks hit the same `PostgresAdapter` and
 * blob store as HTTP traffic. No Cloudflare `ScheduledEvent` or
 * `ExecutionContext` is fabricated.
 */

import dns from "node:dns/promises";
import {
	type CollectorEnv,
	consoleLogger,
	createAnalysesRunHandler,
	createRetentionCleanupHandler,
	evaluateAllRules,
	type Logger,
} from "@obsunified/collector";
import {
	createMaintenanceScheduler,
	type MaintenanceScheduler,
	type ScheduledTask,
} from "./scheduler.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** Cadences matching the Worker's cron triggers. */
export const DEFAULT_MAINTENANCE_INTERVALS_MS = {
	analyses: 1 * MINUTE,
	alerts: 5 * MINUTE,
	retention: 60 * MINUTE,
} as const;

/**
 * First-run delays after process start. Short enough that dashboards
 * repopulate quickly after a restart and retention still runs on hosts that
 * restart more often than hourly; staggered so the three tasks don't all
 * hit Postgres in the same second. Each is capped at the task's interval.
 */
export const DEFAULT_INITIAL_DELAYS_MS = {
	analyses: 15 * SECOND,
	alerts: 30 * SECOND,
	retention: 60 * SECOND,
} as const;

export interface MaintenanceConfig {
	/** `false` disables the in-process scheduler (`MAINTENANCE_ENABLED=false`). */
	enabled: boolean;
	analysesIntervalMs: number;
	alertsIntervalMs: number;
	retentionIntervalMs: number;
}

/**
 * Reads scheduler settings from the environment.
 *
 *   MAINTENANCE_ENABLED                     default "true"
 *   MAINTENANCE_ANALYSES_INTERVAL_SECONDS   default 60
 *   MAINTENANCE_ALERTS_INTERVAL_SECONDS     default 300
 *   MAINTENANCE_RETENTION_INTERVAL_SECONDS  default 3600
 *
 * Non-numeric or non-positive intervals fall back to the default, matching
 * the lenient parsing used for the rest of the server's numeric settings.
 */
export function readMaintenanceConfig(
	env: Record<string, string | undefined> = process.env,
): MaintenanceConfig {
	const seconds = (name: string, fallbackMs: number): number => {
		const raw = env[name];
		if (raw === undefined || raw.trim() === "") return fallbackMs;
		const parsed = Number(raw);
		if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
		return Math.round(parsed * SECOND);
	};
	const enabledRaw = env.MAINTENANCE_ENABLED?.trim().toLowerCase();
	return {
		enabled: !(enabledRaw === "false" || enabledRaw === "0"),
		analysesIntervalMs: seconds(
			"MAINTENANCE_ANALYSES_INTERVAL_SECONDS",
			DEFAULT_MAINTENANCE_INTERVALS_MS.analyses,
		),
		alertsIntervalMs: seconds(
			"MAINTENANCE_ALERTS_INTERVAL_SECONDS",
			DEFAULT_MAINTENANCE_INTERVALS_MS.alerts,
		),
		retentionIntervalMs: seconds(
			"MAINTENANCE_RETENTION_INTERVAL_SECONDS",
			DEFAULT_MAINTENANCE_INTERVALS_MS.retention,
		),
	};
}

/** The three maintenance tasks, each taking the collector env. */
export interface CollectorMaintenanceTasks {
	runAnalyses(env: CollectorEnv): Promise<unknown>;
	evaluateAlerts(env: CollectorEnv): Promise<unknown>;
	runRetention(env: CollectorEnv): Promise<unknown>;
}

/**
 * Binds the collector package's maintenance handlers. Kept separate from
 * the scheduler wiring so tests can substitute fakes while still proving
 * the real handlers work against a `SqlDb`-shaped `env.DB`.
 */
export function createCollectorMaintenanceTasks(
	logger: Logger = consoleLogger,
): CollectorMaintenanceTasks {
	const analyses = createAnalysesRunHandler({ logger });
	const retention = createRetentionCleanupHandler({ logger });
	return {
		runAnalyses: (env) => analyses.run(env),
		evaluateAlerts: async (env) => {
			const summary = await evaluateAllRules(env, {
				logger,
				// Public names that resolve to private addresses are refused
				// before the POST (see lib/webhook-url.ts for the residual
				// rebinding window).
				hostLookup: async (hostname) =>
					(await dns.lookup(hostname, { all: true, verbatim: true })).map(
						(a) => a.address,
					),
			});
			logger.info("[alerts] scheduled evaluation summary", {
				evaluated: summary.evaluated,
				fired: summary.fired,
				resolved: summary.resolved,
			});
			return summary;
		},
		runRetention: (env) => retention.run(env),
	};
}

export interface CollectorMaintenanceOptions {
	/** The same env the HTTP handlers receive — `DB` must be the SqlDb adapter. */
	env: CollectorEnv;
	config: MaintenanceConfig;
	logger?: Logger;
	/** Override the task implementations (tests). Defaults to the real handlers. */
	tasks?: CollectorMaintenanceTasks;
}

/**
 * Builds the scheduler for the three collector maintenance tasks. Call
 * `.start()` to arm it and `.stop()` during shutdown. Does not start by
 * itself so the host can honour `config.enabled`.
 */
export function createCollectorMaintenance(
	options: CollectorMaintenanceOptions,
): MaintenanceScheduler {
	const logger = options.logger ?? consoleLogger;
	const tasks = options.tasks ?? createCollectorMaintenanceTasks(logger);
	const { env, config } = options;

	const scheduled: ScheduledTask[] = [
		{
			name: "analyses_run",
			intervalMs: config.analysesIntervalMs,
			initialDelayMs: Math.min(
				DEFAULT_INITIAL_DELAYS_MS.analyses,
				config.analysesIntervalMs,
			),
			run: () => tasks.runAnalyses(env),
		},
		{
			name: "alerts_evaluate",
			intervalMs: config.alertsIntervalMs,
			initialDelayMs: Math.min(
				DEFAULT_INITIAL_DELAYS_MS.alerts,
				config.alertsIntervalMs,
			),
			run: () => tasks.evaluateAlerts(env),
		},
		{
			name: "retention_cleanup",
			intervalMs: config.retentionIntervalMs,
			initialDelayMs: Math.min(
				DEFAULT_INITIAL_DELAYS_MS.retention,
				config.retentionIntervalMs,
			),
			run: () => tasks.runRetention(env),
		},
	];

	return createMaintenanceScheduler({ tasks: scheduled, logger });
}
