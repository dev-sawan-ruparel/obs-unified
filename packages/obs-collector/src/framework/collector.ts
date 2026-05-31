import type { StoredSpan, UsageEventRecord } from "@obs-unified/types";
import { getConfiguredRetentionHours } from "@obs-unified/types/constants";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { AIStore } from "../lib/ai-store";
import { runAllDueAnalyses } from "../lib/analyses-runner";
import { AnalysesStore } from "../lib/analyses-store";
import { LogsStore } from "../lib/logs-store";
import { MetricsStore } from "../lib/metrics-store";
import { aggregatePropagation } from "../lib/propagation-metric";
import { D1Adapter, type SqlDb, sqlDbFor } from "../lib/sql-db";
import { TelemetryStore } from "../lib/store";
import { UsageStore } from "../lib/usage-store";
import type { CollectorEnv, CollectorRouteContext } from "./env";
import {
	type ChildSpanRunner,
	consoleLogger,
	type Logger,
	passthroughChildSpan,
} from "./logger";

/**
 * Factory that materializes an `SqlDb` for the request's `env`. Per-request
 * because Cloudflare's `D1Database` binding only exists once `env` is in
 * scope; on Workers this is essentially free since `D1Adapter` is a thin
 * wrapper. Hosts override this to inject a fake DB in tests, a different
 * engine in alternate runtimes, or a tracing wrapper at the storage layer.
 */
export type SqlDbFactory = (env: CollectorEnv) => SqlDb;

const defaultSqlDbFactory: SqlDbFactory = (env) => new D1Adapter(env.DB);

export interface SpanProcessorPlugin {
	name: string;
	process(
		spans: StoredSpan[],
		context: CollectorRouteContext,
	): Promise<StoredSpan[]> | StoredSpan[];
}

export interface UsageEventProcessorPlugin {
	name: string;
	process(
		events: UsageEventRecord[],
		context: CollectorRouteContext,
	): Promise<UsageEventRecord[]> | UsageEventRecord[];
}

export interface CollectorPluginContext {
	addSpanProcessor(processor: SpanProcessorPlugin): void;
	addUsageEventProcessor(processor: UsageEventProcessorPlugin): void;
	getRegisteredPluginNames(): string[];
}

export interface CollectorPlugin {
	name: string;
	register(
		app: Hono<{ Bindings: CollectorEnv }>,
		context: CollectorRuntime,
	): void;
}

export interface CollectorAuthConfig {
	/** Single middleware applied to both /v1/* (ingest) and /internal/* (query) routes */
	middleware?: MiddlewareHandler<{ Bindings: CollectorEnv }>;
	/** @deprecated Use middleware instead. Ingest-only auth for /v1/* routes. */
	ingest?: MiddlewareHandler<{ Bindings: CollectorEnv }>;
	/** @deprecated Use middleware instead. Query-only auth for /internal/* routes. */
	query?: MiddlewareHandler<{ Bindings: CollectorEnv }>;
}

export interface CollectorConfig {
	plugins: CollectorPlugin[];
	auth?: CollectorAuthConfig;
	/** Comma-separated allowed origins for CORS on ingest endpoints */
	allowedOrigins?: string;
	/** Register dashboard auth routes and middleware */
	dashboardAuth?: {
		middleware: MiddlewareHandler<{ Bindings: CollectorEnv }>;
		registerRoutes: (app: Hono<{ Bindings: CollectorEnv }>) => void;
	};
	/**
	 * Pluggable structured logger. Defaults to console output. Pass a logger
	 * from `@obs-unified/telemetry-sdk` to ship the collector's own log output as
	 * OTLP — see apps/collector/SELF_INSTRUMENTATION.md.
	 */
	logger?: Logger;
	/**
	 * Wraps async work in a child span on the active request span. Wire this
	 * to `@obs-unified/telemetry-sdk`'s `withChildSpan` from the worker entrypoint to
	 * surface LLM hops + DB-heavy paths as nested spans. Defaults to
	 * pass-through.
	 */
	withChildSpan?: ChildSpanRunner;
	/**
	 * RFC 0008 — override the storage adapter. Per-request factory because
	 * `env.DB` only exists once a request lands. Defaults to wrapping
	 * `env.DB` in `D1Adapter`. Override in tests (use `MemSqlDb`) or to add
	 * a tracing layer at the storage seam.
	 */
	sqlDb?: SqlDbFactory;
}

export class CollectorRuntime implements CollectorPluginContext {
	private readonly spanProcessors: SpanProcessorPlugin[] = [];
	private readonly usageEventProcessors: UsageEventProcessorPlugin[] = [];
	private readonly plugins: string[] = [];
	private readonly sqlDbFactory: SqlDbFactory;
	readonly logger: Logger;
	readonly withChildSpan: ChildSpanRunner;

	constructor(
		logger: Logger = consoleLogger,
		withChildSpan: ChildSpanRunner = passthroughChildSpan,
		sqlDbFactory: SqlDbFactory = defaultSqlDbFactory,
	) {
		this.logger = logger;
		this.withChildSpan = withChildSpan;
		this.sqlDbFactory = sqlDbFactory;
	}

	/**
	 * Materialize an `SqlDb` for this request. Stores will accept this
	 * directly once Phase 1.5 of RFC 0008 lands; until then plugins that
	 * want to bypass `c.env.DB` can call this to opt in early.
	 */
	getSqlDb(env: CollectorEnv): SqlDb {
		return this.sqlDbFactory(env);
	}

	registerPlugin(plugin: CollectorPlugin): void {
		this.plugins.push(plugin.name);
	}

	addSpanProcessor(processor: SpanProcessorPlugin): void {
		this.spanProcessors.push(processor);
	}

	addUsageEventProcessor(processor: UsageEventProcessorPlugin): void {
		this.usageEventProcessors.push(processor);
	}

	getRegisteredPluginNames(): string[] {
		return [...this.plugins];
	}

	createRouteContext(
		env: CollectorEnv,
		hono: CollectorRouteContext["hono"],
	): CollectorRouteContext {
		return {
			hono,
			env,
			now: new Date(),
			logger: this.logger,
		};
	}

	createStore(env: CollectorEnv): TelemetryStore {
		return new TelemetryStore(this.getSqlDb(env));
	}

	createUsageStore(env: CollectorEnv): UsageStore {
		return new UsageStore(this.getSqlDb(env));
	}

	async runSpanProcessors(
		spans: StoredSpan[],
		context: CollectorRouteContext,
	): Promise<StoredSpan[]> {
		let nextSpans = spans;

		for (const processor of this.spanProcessors) {
			const inputCount = nextSpans.length;
			nextSpans = await this.withChildSpan(
				`process.${processor.name}`,
				async (span) => {
					const out = await processor.process(nextSpans, context);
					span.setAttribute("processor.kind", "span");
					span.setAttribute("processor.name", processor.name);
					span.setAttribute("processor.input_count", inputCount);
					span.setAttribute("processor.output_count", out.length);
					if (out.length !== inputCount)
						span.setAttribute("processor.delta_count", out.length - inputCount);
					return out;
				},
			);
		}

		return nextSpans;
	}

	async runUsageEventProcessors(
		events: UsageEventRecord[],
		context: CollectorRouteContext,
	): Promise<UsageEventRecord[]> {
		let nextEvents = events;

		for (const processor of this.usageEventProcessors) {
			const inputCount = nextEvents.length;
			nextEvents = await this.withChildSpan(
				`process.${processor.name}`,
				async (span) => {
					const out = await processor.process(nextEvents, context);
					span.setAttribute("processor.kind", "usage");
					span.setAttribute("processor.name", processor.name);
					span.setAttribute("processor.input_count", inputCount);
					span.setAttribute("processor.output_count", out.length);
					if (out.length !== inputCount)
						span.setAttribute("processor.delta_count", out.length - inputCount);
					return out;
				},
			);
		}

		return nextEvents;
	}
}

export const createTelemetryCollectorApp = (
	pluginsOrConfig: CollectorPlugin[] | CollectorConfig,
): Hono<{ Bindings: CollectorEnv }> => {
	const config: CollectorConfig = Array.isArray(pluginsOrConfig)
		? { plugins: pluginsOrConfig }
		: pluginsOrConfig;

	const app = new Hono<{ Bindings: CollectorEnv }>();
	const runtime = new CollectorRuntime(
		config.logger,
		config.withChildSpan,
		config.sqlDb,
	);

	// Health endpoint — no auth required
	app.get("/health", (c) => c.json({ status: "ok" }));

	// CORS for ingest endpoints (browser SDK sends directly)
	app.use("/v1/*", async (c, next) => {
		const origin = c.req.header("Origin");
		const allowedOrigins = config.allowedOrigins || c.env.ALLOWED_ORIGINS || "";
		const allowList = allowedOrigins
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		const allowedOrigin =
			origin && allowList.includes(origin) ? origin : undefined;

		if (c.req.method === "OPTIONS") {
			const headers: Record<string, string> = {
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers":
					"Content-Type, Authorization, X-API-Key, X-Project-Id, Cache-Control, X-Telemetry-Self",
				"Access-Control-Max-Age": "86400",
			};
			if (allowedOrigin) {
				headers["Access-Control-Allow-Origin"] = allowedOrigin;
			}
			return new Response(null, { status: 204, headers });
		}

		await next();

		// Mutate the response headers directly rather than using c.header(),
		// which queues the header for a response Hono is about to construct —
		// no-op when downstream middleware already finalized the response via
		// `c.json(...)` (e.g. auth returning 401). Without this, error
		// responses ship CORS-naked and browsers misreport them as CORS
		// blocks instead of the underlying status.
		if (allowedOrigin) {
			c.res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
		}
	});

	// Ingest auth (API key) — always on /v1/* when configured.
	if (config.auth?.middleware) {
		app.use("/v1/*", config.auth.middleware);
	} else if (config.auth?.ingest) {
		// Legacy: explicit ingest-only middleware
		app.use("/v1/*", config.auth.ingest);
	}

	// Dashboard auth (session cookie) — owns /internal/* when configured.
	// Routes for login/check/logout are always registered so the dashboard
	// can authenticate regardless of subsequent middleware placement.
	if (config.dashboardAuth) {
		config.dashboardAuth.registerRoutes(app);
		app.use("/dashboard/*", config.dashboardAuth.middleware);
		app.use("/internal/*", config.dashboardAuth.middleware);
	} else if (config.auth?.middleware) {
		// No dashboard auth configured — fall back to applying the unified
		// ingest auth to /internal/* too, preserving the earlier single-auth
		// contract for deployments that haven't adopted dashboard auth yet.
		app.use("/internal/*", config.auth.middleware);
	} else if (config.auth?.query) {
		app.use("/internal/*", config.auth.query);
	}

	for (const plugin of config.plugins) {
		runtime.registerPlugin(plugin);
		plugin.register(app, runtime);
	}

	app.get("/internal/collector/plugins", (c) => {
		return c.json({
			plugins: runtime.getRegisteredPluginNames(),
			timestamp: new Date().toISOString(),
		});
	});

	return app;
};

/**
 * Scheduled handler that purges expired telemetry and usage rows.
 * Wire into wrangler.toml: `[triggers] crons = ["0 * * * *"]`
 * Source: AgentOwl + DecisionOps
 */
export const createRetentionCleanupHandler = (options?: {
	logger?: Logger;
}) => {
	const logger = options?.logger ?? consoleLogger;
	return {
		async scheduled(
			_event: ScheduledEvent,
			env: CollectorEnv,
			_ctx: ExecutionContext,
		): Promise<void> {
			const db = sqlDbFor(env);
			const telemetryStore = new TelemetryStore(db);
			const usageStore = new UsageStore(db);
			const logsStore = new LogsStore(db);
			const aiStore = new AIStore(db);
			const metricsStore = new MetricsStore(db);
			const analysesStore = new AnalysesStore(db);

			const [
				telemetryPurged,
				usagePurged,
				logsPurged,
				aiPurged,
				metricsPurged,
				analysesPurged,
			] = await Promise.all([
				telemetryStore.purgeExpired(),
				usageStore.purgeExpired(),
				logsStore.purgeExpired(),
				aiStore.purgeExpired(),
				metricsStore.purgeExpired(),
				analysesStore.purgeExpired(),
			]);

			// RFC 0007 Phase 4.10 — profile_blobs retention. Cascade
			// foreign key on profile_trace_index handles the join rows;
			// we still need to delete the R2 blobs, which we do
			// best-effort by reading the URLs first.
			let profilesPurged = 0;
			try {
				const expiredProfiles = await db
					.prepare(
						`SELECT id, blob_url FROM profile_blobs WHERE expires_at < datetime('now') LIMIT 500`,
					)
					.all<{ id: string; blob_url: string }>();
				if (expiredProfiles.results.length > 0 && env.PROFILES_BUCKET) {
					await Promise.allSettled(
						expiredProfiles.results.map((p) =>
							env.PROFILES_BUCKET?.delete(p.blob_url),
						),
					);
				}
				const deleted = await db
					.prepare(
						`DELETE FROM profile_blobs WHERE expires_at < datetime('now')`,
					)
					.run();
				profilesPurged = deleted.meta.changes;
			} catch (err) {
				logger.error("[retention-cleanup] profile purge failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			}

			logger.info("[retention-cleanup] purged expired rows", {
				spans: telemetryPurged,
				usage: usagePurged,
				logs: logsPurged,
				ai_calls: aiPurged,
				metric_points: metricsPurged,
				analysis_results: analysesPurged,
				profile_blobs: profilesPurged,
			});

			// RFC 0004 Phase 1.8 — emit interaction_id propagation counters.
			// Hourly aggregation rides the retention cron because cadence
			// matches and both touch the same projects' tables.
			try {
				const propagation = await aggregatePropagation(db, new Date(), logger);
				logger.info("[propagation-metric] hourly aggregation complete", {
					projects: propagation.projects,
					points_written: propagation.pointsWritten,
				});
			} catch (err) {
				logger.error("[propagation-metric] aggregation failed", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		},
	};
};

/**
 * RFC 0002 Stage 1 — run any due Analyses. Cheap to call frequently because
 * `runAllDueAnalyses` filters by `last_run + refreshSeconds < now` before
 * touching D1.
 *
 * Wire to a per-minute trigger in wrangler.toml: `crons = ["* * * * *"]`.
 * Kept distinct from retention so the per-minute tick doesn't sweep every
 * retention table every cycle.
 */
export const createAnalysesRunHandler = (options?: {
	logger?: Logger;
	tracer?: ChildSpanRunner;
}) => {
	const logger = options?.logger ?? consoleLogger;
	const tracer = options?.tracer;
	return {
		async scheduled(
			_event: ScheduledEvent,
			env: CollectorEnv,
			_ctx: ExecutionContext,
		): Promise<void> {
			try {
				const retentionHours = getConfiguredRetentionHours(env.RETENTION_HOURS);
				const summary = await runAllDueAnalyses({
					env,
					retentionHours,
					logger,
					tracer,
				});
				logger.info("[analyses] scheduled run summary", {
					refreshed: summary.refreshed,
					ran: summary.ran,
					failed: summary.failed,
					narrated: summary.narrated,
				});
			} catch (error) {
				logger.error("[analyses] scheduled run failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
	};
};
