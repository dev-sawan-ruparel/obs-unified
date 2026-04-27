import type { Context, Hono } from "hono";

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
	 * - ANTHROPIC_API_KEY: enables LLM-generated narratives. When unset, the
	 *   narrate pass is skipped entirely; data still flows.
	 * - NARRATIVE_MODEL: Anthropic model id (default "claude-haiku-4-5").
	 * - NARRATIVE_BUDGET_PER_HOUR: max narrative writes per project per hour.
	 *   Acts as a safety rail against a flapping panel running up cost.
	 */
	ANTHROPIC_API_KEY?: string;
	NARRATIVE_MODEL?: string;
	NARRATIVE_BUDGET_PER_HOUR?: string;
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
}

export type CollectorApp = Hono<{ Bindings: CollectorEnv }>;
