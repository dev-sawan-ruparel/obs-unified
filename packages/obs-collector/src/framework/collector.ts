import type {
	CollectorEnv,
	CollectorRouteContext,
	StoredSpan,
	UsageEventRecord,
} from "@obs/types";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { AIStore } from "../lib/ai-store";
import { LogsStore } from "../lib/logs-store";
import { MetricsStore } from "../lib/metrics-store";
import { TelemetryStore } from "../lib/store";
import { UsageStore } from "../lib/usage-store";

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
}

export class CollectorRuntime implements CollectorPluginContext {
	private readonly spanProcessors: SpanProcessorPlugin[] = [];
	private readonly usageEventProcessors: UsageEventProcessorPlugin[] = [];
	private readonly plugins: string[] = [];

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
		};
	}

	createStore(env: CollectorEnv): TelemetryStore {
		return new TelemetryStore(env.DB);
	}

	createUsageStore(env: CollectorEnv): UsageStore {
		return new UsageStore(env.DB);
	}

	async runSpanProcessors(
		spans: StoredSpan[],
		context: CollectorRouteContext,
	): Promise<StoredSpan[]> {
		let nextSpans = spans;

		for (const processor of this.spanProcessors) {
			nextSpans = await processor.process(nextSpans, context);
		}

		return nextSpans;
	}

	async runUsageEventProcessors(
		events: UsageEventRecord[],
		context: CollectorRouteContext,
	): Promise<UsageEventRecord[]> {
		let nextEvents = events;

		for (const processor of this.usageEventProcessors) {
			nextEvents = await processor.process(nextEvents, context);
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
	const runtime = new CollectorRuntime();

	// Health endpoint — no auth required
	app.get("/health", (c) => c.json({ status: "ok" }));

	// CORS for ingest endpoints (browser SDK sends directly)
	app.use("/v1/*", async (c, next) => {
		const origin = c.req.header("Origin");
		const allowedOrigins = config.allowedOrigins || c.env.ALLOWED_ORIGINS || "";
		const allowList = allowedOrigins.split(",").map((s) => s.trim()).filter(Boolean);

		if (c.req.method === "OPTIONS") {
			const headers: Record<string, string> = {
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers":
					"Content-Type, Authorization, X-API-Key, X-Project-Id, Cache-Control",
				"Access-Control-Max-Age": "86400",
			};
			if (allowList.length === 0 || (origin && allowList.includes(origin))) {
				headers["Access-Control-Allow-Origin"] = origin || "*";
			}
			return new Response(null, { status: 204, headers });
		}

		await next();

		if (origin && (allowList.length === 0 || allowList.includes(origin))) {
			c.header("Access-Control-Allow-Origin", origin);
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
export const createRetentionCleanupHandler = () => ({
	async scheduled(
		_event: ScheduledEvent,
		env: CollectorEnv,
		_ctx: ExecutionContext,
	): Promise<void> {
		const telemetryStore = new TelemetryStore(env.DB);
		const usageStore = new UsageStore(env.DB);
		const logsStore = new LogsStore(env.DB);
		const aiStore = new AIStore(env.DB);
		const metricsStore = new MetricsStore(env.DB);

		const [
			telemetryPurged,
			usagePurged,
			logsPurged,
			aiPurged,
			metricsPurged,
		] = await Promise.all([
			telemetryStore.purgeExpired(),
			usageStore.purgeExpired(),
			logsStore.purgeExpired(),
			aiStore.purgeExpired(),
			metricsStore.purgeExpired(),
		]);

		console.log(
			`[retention-cleanup] Purged ${telemetryPurged} spans, ${usagePurged} usage, ${logsPurged} logs, ${aiPurged} ai calls, ${metricsPurged} metric points`,
		);
	},
});
