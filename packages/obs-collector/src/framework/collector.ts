import type { StoredSpan, UsageEventRecord } from "@obsunified/types";
import { getConfiguredRetentionHours } from "@obsunified/types/constants";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
	type ActionGraphPurgeSummary,
	purgeExpiredActionGraph,
} from "../lib/action-retention";
import { AIStore } from "../lib/ai-store";
import { runAllDueAnalyses } from "../lib/analyses-runner";
import { AnalysesStore } from "../lib/analyses-store";
import {
	type HousekeepingSummary,
	purgeSecondaryRows,
} from "../lib/housekeeping";
import { LogsStore } from "../lib/logs-store";
import { MetricsStore } from "../lib/metrics-store";
import { aggregatePropagation } from "../lib/propagation-metric";
import { D1Adapter, dialectFor, type SqlDb, sqlDbFor } from "../lib/sql-db";
import { TelemetryStore } from "../lib/store";
import { UsageStore } from "../lib/usage-store";
import type { CollectorEnv, CollectorRouteContext } from "./env";
import { DEFAULT_MAX_BODY_BYTES, parseByteLimit } from "./limits";
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
	// biome-ignore lint/suspicious/noExplicitAny: Hono generic middleware variables require any for contravariant compatibility
	middleware?: MiddlewareHandler<{ Bindings: CollectorEnv; Variables: any }>;
	/** @deprecated Use middleware instead. Ingest-only auth for /v1/* routes. */
	// biome-ignore lint/suspicious/noExplicitAny: Hono generic middleware variables require any for contravariant compatibility
	ingest?: MiddlewareHandler<{ Bindings: CollectorEnv; Variables: any }>;
	/** @deprecated Use middleware instead. Query-only auth for /internal/* routes. */
	// biome-ignore lint/suspicious/noExplicitAny: Hono generic middleware variables require any for contravariant compatibility
	query?: MiddlewareHandler<{ Bindings: CollectorEnv; Variables: any }>;
}

export interface CollectorConfig {
	plugins: CollectorPlugin[];
	auth?: CollectorAuthConfig;
	/** Comma-separated allowed origins for CORS on ingest endpoints */
	allowedOrigins?: string;
	/** Register dashboard auth routes and middleware */
	dashboardAuth?: {
		// biome-ignore lint/suspicious/noExplicitAny: Hono generic middleware variables require any for contravariant compatibility
		middleware: MiddlewareHandler<{ Bindings: CollectorEnv; Variables: any }>;
		registerRoutes: (app: Hono<{ Bindings: CollectorEnv }>) => void;
	};
	/**
	 * Pluggable structured logger. Defaults to console output. Pass a logger
	 * from `@obsunified/telemetry-sdk` to ship the collector's own log output as
	 * OTLP — see apps/collector/SELF_INSTRUMENTATION.md.
	 */
	logger?: Logger;
	/**
	 * Wraps async work in a child span on the active request span. Wire this
	 * to `@obsunified/telemetry-sdk`'s `withChildSpan` from the worker entrypoint to
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
	/**
	 * Raw request body cap for `/v1/*` and `/internal/*` in bytes. Defaults
	 * to `MAX_BODY_BYTES` from the environment, then 10 MiB. Oversized
	 * requests get a 413 before any handler buffers the body.
	 */
	maxBodyBytes?: number;
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

/** `/dashboard/login` and anything beneath it (the SPA's login route). */
export const isDashboardLoginPath = (path: string): boolean =>
	path === "/dashboard/login" || path.startsWith("/dashboard/login/");

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

	const allowedCorsOrigin = (origin: string | undefined, env: CollectorEnv) => {
		const allowedOrigins = config.allowedOrigins || env.ALLOWED_ORIGINS || "";
		const allowList = allowedOrigins
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		return origin && allowList.includes(origin) ? origin : undefined;
	};

	// Health endpoint — no auth required. Includes millisecond server time so
	// browser SDKs can estimate clock offset without relying on coarse Date.
	app.get("/health", (c) => {
		const allowedOrigin = allowedCorsOrigin(c.req.header("Origin"), c.env);
		const res = c.json({ status: "ok", serverTimeMs: Date.now() });
		if (allowedOrigin)
			res.headers.set("Access-Control-Allow-Origin", allowedOrigin);
		return res;
	});

	// CORS for ingest endpoints (browser SDK sends directly)
	app.use("/v1/*", async (c, next) => {
		const origin = c.req.header("Origin");
		const allowedOrigin = allowedCorsOrigin(origin, c.env);

		if (c.req.method === "OPTIONS") {
			const headers: Record<string, string> = {
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers":
					"Content-Type, Authorization, X-API-Key, X-Project-Id, Cache-Control, X-Telemetry-Self, X-Obs-Interaction, X-Obs-Session-Id",
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

	// Body size cap — before auth and every handler, so an oversized body is
	// refused by Content-Length or cut off mid-stream instead of buffered.
	const bodyCap: MiddlewareHandler<{ Bindings: CollectorEnv }> = (c, next) => {
		const maxSize =
			config.maxBodyBytes ??
			parseByteLimit(c.env?.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
		return bodyLimit({
			maxSize,
			onError: (ctx) =>
				ctx.json({ error: `Payload too large (max ${maxSize} bytes)` }, 413),
		})(c, next);
	};
	app.use("/v1/*", bodyCap);
	app.use("/internal/*", bodyCap);

	// Ingest auth (API key) — always on /v1/* when configured.
	if (config.auth?.middleware) {
		app.use("/v1/*", config.auth.middleware);
	} else if (config.auth?.ingest) {
		// Legacy: explicit ingest-only middleware
		app.use("/v1/*", config.auth.ingest);
	}

	// Dashboard auth (session cookie or programmatic bearer token) — owns /internal/* and /dashboard/* when configured.
	// Routes for login/check/logout are always registered so the dashboard
	// can authenticate regardless of subsequent middleware placement.
	if (config.dashboardAuth) {
		const { middleware } = config.dashboardAuth;
		config.dashboardAuth.registerRoutes(app);
		// The login page is where unauthenticated HTML requests get sent;
		// guarding it with the same middleware redirects it to itself.
		const guard: MiddlewareHandler<{
			Bindings: CollectorEnv;
			// biome-ignore lint/suspicious/noExplicitAny: same contravariant Variables shape as CollectorConfig.dashboardAuth.middleware
			Variables: any;
		}> = async (c, next) =>
			isDashboardLoginPath(c.req.path) ? next() : middleware(c, next);
		app.use("/dashboard/*", guard);
		app.use("/internal/*", middleware);
	} else {
		// Fail closed for /internal/* and /dashboard/*: ingest keys must never grant read/admin access
		app.use("/internal/*", async (c) => c.json({ error: "Unauthorized" }, 401));
		app.use("/dashboard/*", async (c) =>
			c.json({ error: "Unauthorized" }, 401),
		);
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
 * Runtime-neutral entry point for a background maintenance task.
 *
 * `run(env)` does the work and needs nothing but a `CollectorEnv`, so any
 * host (Cloudflare cron, a Node `setInterval`, a Kubernetes CronJob hitting
 * a one-shot script) can drive it. `scheduled(event, env, ctx)` is the thin
 * Cloudflare Workers adapter over `run` — the event and context are accepted
 * for signature compatibility with `ExportedHandler.scheduled` but are never
 * consulted, so non-Workers hosts should call `run` directly rather than
 * fabricating placeholder event objects.
 */
export interface ScheduledTaskHandler<TSummary = void> {
	run(env: CollectorEnv): Promise<TSummary>;
	scheduled(
		event: ScheduledEvent,
		env: CollectorEnv,
		ctx: ExecutionContext,
	): Promise<void>;
}

/** Per-table purge counts reported by the retention cleanup task. */
export interface RetentionCleanupSummary {
	spans: number;
	usage: number;
	logs: number;
	ai_calls: number;
	metric_points: number;
	analysis_results: number;
	profile_blobs: number;
	/** RFC 0010 action spine rows removed (trees older than RETENTION_HOURS). */
	actions: number;
	/** Leaf rows removed with their actions: agent_runs, tool_calls,
	 *  retrieval_events, eval_results and artifacts. */
	action_leaves: number;
	/** Secondary tables (see lib/housekeeping.ts); zeros when that step failed. */
	housekeeping: HousekeepingSummary;
}

/**
 * Scheduled handler that purges expired telemetry and usage rows.
 * Wire into wrangler.toml: `[triggers] crons = ["0 * * * *"]`, or call
 * `.run(env)` from a non-Workers host scheduler.
 * Source: AgentOwl + DecisionOps
 */
/** Expired profile rows examined per sweep: pages × page size. */
const PROFILE_PURGE_PAGE_SIZE = 500;
const PROFILE_PURGE_MAX_PAGES = 10;

export const createRetentionCleanupHandler = (options?: {
	logger?: Logger;
}): ScheduledTaskHandler<RetentionCleanupSummary> => {
	const logger = options?.logger ?? consoleLogger;
	const run = async (env: CollectorEnv): Promise<RetentionCleanupSummary> => {
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
		// Rows go only for blobs whose delete settled, in pages, so a row never
		// outlives its blob reference while the object is still in storage
		// (previously one page of blobs was deleted and then every expired
		// row, orphaning anything past the page).
		let profilesPurged = 0;
		try {
			const dialect = dialectFor(db);
			if (!env.PROFILES_BUCKET) {
				logger.warn(
					"[retention-cleanup] PROFILES_BUCKET is not bound; expired profile rows are removed without deleting their blobs",
				);
			}
			for (let page = 0; page < PROFILE_PURGE_MAX_PAGES; page += 1) {
				const expired = await db
					.prepare(
						`SELECT id, blob_url FROM profile_blobs WHERE expires_at < ${dialect.now()} LIMIT ${PROFILE_PURGE_PAGE_SIZE}`,
					)
					.all<{ id: string; blob_url: string }>();
				if (expired.results.length === 0) break;
				const removable: string[] = [];
				if (env.PROFILES_BUCKET) {
					const bucket = env.PROFILES_BUCKET;
					const settled = await Promise.allSettled(
						expired.results.map((p) => bucket.delete(p.blob_url)),
					);
					settled.forEach((outcome, i) => {
						const row = expired.results[i];
						if (!row) return;
						if (outcome.status === "fulfilled") removable.push(row.id);
						else
							logger.warn(
								"[retention-cleanup] profile blob delete failed; row kept for retry",
								{
									profile_id: row.id,
									error:
										outcome.reason instanceof Error
											? outcome.reason.message
											: String(outcome.reason),
								},
							);
					});
				} else {
					removable.push(...expired.results.map((p) => p.id));
				}
				for (let i = 0; i < removable.length; i += 90) {
					const chunk = removable.slice(i, i + 90);
					const deleted = await db
						.prepare(
							`DELETE FROM profile_blobs WHERE id IN (${chunk.map(() => "?").join(", ")})`,
						)
						.bind(...chunk)
						.run();
					profilesPurged += deleted.meta.changes;
				}
				// A page with kept rows would be re-selected forever; stop here
				// and let the next sweep retry the failed blobs.
				if (
					expired.results.length < PROFILE_PURGE_PAGE_SIZE ||
					removable.length < expired.results.length
				)
					break;
			}
		} catch (err) {
			logger.error("[retention-cleanup] profile purge failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		let housekeeping: HousekeepingSummary = {
			alert_evaluations: 0,
			ask_evidence_events: 0,
			metric_series: 0,
			evidence_refs: 0,
			evidence_ref_expansions: 0,
		};
		try {
			housekeeping = await purgeSecondaryRows(db, {
				retentionHours: getConfiguredRetentionHours(env.RETENTION_HOURS),
			});
		} catch (err) {
			logger.error("[retention-cleanup] housekeeping purge failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		// RFC 0010 — action graph retention. Derived from `actions.started_at`
		// because the spine has no `expires_at`; whole causal trees go at once,
		// in bounded batches, and in-progress or eval-case-pinned trees stay.
		// Runs after the per-table purges so a slow sweep never delays them.
		let actionGraph: ActionGraphPurgeSummary | undefined;
		try {
			actionGraph = await purgeExpiredActionGraph(db, {
				retentionHours: getConfiguredRetentionHours(env.RETENTION_HOURS),
			});
			if (actionGraph.truncated) {
				logger.warn(
					"[retention-cleanup] action graph purge hit its batch cap; remaining expired trees wait for the next run",
					{ batches: actionGraph.batches, trees: actionGraph.trees },
				);
			}
			if (actionGraph.oversized_trees > 0) {
				// Retained on purpose: deleting them would exceed the per-batch
				// bound, and a partial tree is worse than an old one. Operators
				// can raise `maxActionsPerBatch` or remove them by hand.
				logger.warn(
					"[retention-cleanup] expired action trees retained because they exceed the per-batch action cap",
					{
						oversized_trees: actionGraph.oversized_trees,
						trees: actionGraph.oversized,
					},
				);
			}
		} catch (err) {
			logger.error("[retention-cleanup] action graph purge failed", {
				error: err instanceof Error ? err.message : String(err),
			});
		}

		const summary: RetentionCleanupSummary = {
			spans: telemetryPurged,
			usage: usagePurged,
			logs: logsPurged,
			ai_calls: aiPurged,
			metric_points: metricsPurged,
			analysis_results: analysesPurged,
			profile_blobs: profilesPurged,
			housekeeping,
			actions: actionGraph?.actions ?? 0,
			action_leaves: actionGraph
				? actionGraph.agent_runs +
					actionGraph.tool_calls +
					actionGraph.retrieval_events +
					actionGraph.eval_results +
					actionGraph.artifacts
				: 0,
		};
		logger.info("[retention-cleanup] purged expired rows", {
			...summary,
			...(actionGraph
				? {
						action_agent_runs: actionGraph.agent_runs,
						action_tool_calls: actionGraph.tool_calls,
						action_retrieval_events: actionGraph.retrieval_events,
						action_eval_results: actionGraph.eval_results,
						action_artifacts: actionGraph.artifacts,
						action_trees: actionGraph.trees,
						action_batches: actionGraph.batches,
						action_oversized_trees: actionGraph.oversized_trees,
					}
				: {}),
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

		return summary;
	};
	return {
		run,
		scheduled: async (_event, env, _ctx) => {
			await run(env);
		},
	};
};

/**
 * RFC 0002 Stage 1 — run any due Analyses. Cheap to call frequently because
 * `runAllDueAnalyses` filters by `last_run + refreshSeconds < now` before
 * touching D1.
 *
 * Wire to a per-minute trigger in wrangler.toml: `crons = ["* * * * *"]`,
 * or call `.run(env)` from a non-Workers host scheduler. Kept distinct from
 * retention so the per-minute tick doesn't sweep every retention table every
 * cycle.
 */
export const createAnalysesRunHandler = (options?: {
	logger?: Logger;
	tracer?: ChildSpanRunner;
}): ScheduledTaskHandler<AnalysesRunSummary | undefined> => {
	const logger = options?.logger ?? consoleLogger;
	const tracer = options?.tracer;
	/**
	 * Runs every due analysis. Resolves to the run summary, or `undefined`
	 * when the run failed — failures are logged rather than thrown so a
	 * transient DB hiccup never breaks a host's cron loop.
	 */
	const run = async (
		env: CollectorEnv,
	): Promise<AnalysesRunSummary | undefined> => {
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
			return summary;
		} catch (error) {
			logger.error("[analyses] scheduled run failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
	};
	return {
		run,
		scheduled: async (_event, env, _ctx) => {
			await run(env);
		},
	};
};

/** Shape returned by `runAllDueAnalyses` and surfaced via the run handler. */
export type AnalysesRunSummary = Awaited<ReturnType<typeof runAllDueAnalyses>>;
