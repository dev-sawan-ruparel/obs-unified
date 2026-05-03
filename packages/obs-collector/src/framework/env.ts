import type { Context, Hono } from "hono";
import type { Logger } from "./logger";

/**
 * Collector worker bindings + env vars.
 *
 * Lives here, not in `@obs/types`, because it references Cloudflare
 * Workers ambient globals (`D1Database`, `R2Bucket`,
 * `DurableObjectNamespace`) that other packages — notably the web
 * dashboard — should not transitively depend on.
 */
export interface CollectorEnv {
	DB: D1Database;
	REPLAYS_BUCKET?: R2Bucket;
	/** Durable Object namespace for live-tail SSE pub/sub. Optional — when
	 *  unbound the /internal/telemetry/tail endpoint returns 503. */
	TAIL_HUB?: DurableObjectNamespace;
	/** Write-only API key for SDK ingest endpoints (/v1/*) */
	INGEST_KEY?: string;
	/** Password for dashboard login */
	DASHBOARD_PASSWORD?: string;
	/** Comma-separated allowed origins for CORS (e.g. "https://my-app.com,https://staging.my-app.com") */
	ALLOWED_ORIGINS?: string;
	/** Set to "true" to allow unauthenticated ingest (local dev only) */
	ALLOW_UNAUTHENTICATED?: string;
	TELEMETRY_REDACT_FIELDS?: string;
	RETENTION_HOURS?: string;
	/**
	 * Stage 3 narrative pipeline (RFC 0002).
	 * Either ANTHROPIC_API_KEY or OPENAI_API_KEY enables the narrate pass +
	 * Ask box. When neither is set, panels remain data-only.
	 *
	 * If both are set, OpenAI wins — configuring both is presumed deliberate.
	 *
	 * - ANTHROPIC_API_KEY: enables Anthropic /messages.
	 * - OPENAI_API_KEY: enables OpenAI /chat/completions. Use OPENAI_BASE_URL
	 *   to point at compatible endpoints (openrouter, vLLM, azure, ollama).
	 * - NARRATIVE_MODEL: model id. Defaults are provider-specific
	 *   (claude-haiku-4-5 for anthropic, gpt-4o-mini for openai).
	 * - NARRATIVE_BUDGET_PER_HOUR: max narrative writes per project per hour.
	 *   Acts as a safety rail against a flapping panel running up cost.
	 */
	ANTHROPIC_API_KEY?: string;
	OPENAI_API_KEY?: string;
	OPENAI_BASE_URL?: string;
	NARRATIVE_MODEL?: string;
	NARRATIVE_BUDGET_PER_HOUR?: string;
	/**
	 * Self-instrumentation — collector dogfoods itself into the `obs-dashboard`
	 * project via @obs/telemetry-sdk. When unset, self-instrumentation is a
	 * no-op (collector still runs normally). See apps/collector/SELF_INSTRUMENTATION.md.
	 */
	OBS_DASHBOARD_INGEST_KEY?: string;
	/** Self-URL for cron-time telemetry exports (no inbound request to derive from). */
	OBS_COLLECTOR_SELF_URL?: string;
	/**
	 * When "true", the worker's self-instrumentation middleware awaits its
	 * span/log export instead of using `ctx.waitUntil`. Miniflare drops
	 * waitUntil after the response, losing post-async telemetry. Set in
	 * `.dev.vars` only; production CF Workers should leave this unset.
	 */
	OBS_SELF_AWAIT_EXPORTS?: string;
	/** @deprecated Use INGEST_KEY instead */
	TELEMETRY_INGEST_TOKEN?: string;
	/** @deprecated Use INGEST_KEY instead */
	USAGE_INGEST_TOKEN?: string;
	/** @deprecated Use DASHBOARD_PASSWORD instead */
	TELEMETRY_QUERY_TOKEN?: string;
}

export interface CollectorRouteContext {
	hono: Context<{ Bindings: CollectorEnv }>;
	env: CollectorEnv;
	now: Date;
	logger: Logger;
}

export type CollectorApp = Hono<{ Bindings: CollectorEnv }>;
