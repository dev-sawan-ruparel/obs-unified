import type {
	CollectorEnv,
	CollectorRouteContext,
	StoredSpan,
	UsageEventRecord,
} from "@obs/types";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
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
	ingest?: MiddlewareHandler<{ Bindings: CollectorEnv }>;
	query?: MiddlewareHandler<{ Bindings: CollectorEnv }>;
}

export interface CollectorConfig {
	plugins: CollectorPlugin[];
	auth?: CollectorAuthConfig;
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

	if (config.auth?.ingest) {
		app.use("/v1/*", config.auth.ingest);
	}
	if (config.auth?.query) {
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

		const [telemetryPurged, usagePurged] = await Promise.all([
			telemetryStore.purgeExpired(),
			usageStore.purgeExpired(),
		]);

		console.log(
			`[retention-cleanup] Purged ${telemetryPurged} telemetry spans, ${usagePurged} usage events`,
		);
	},
});
