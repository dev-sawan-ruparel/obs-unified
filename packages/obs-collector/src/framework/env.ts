import type { Context, Hono } from "hono";
import type { Logger } from "./logger";

/**
 * Collector worker bindings + env vars.
 *
 * Lives here, not in `@obsunified/types`, because it references Cloudflare
 * Workers ambient globals (`D1Database`, `R2Bucket`,
 * `DurableObjectNamespace`) that other packages — notably the web
 * dashboard — should not transitively depend on.
 */
export interface CollectorEnv {
	DB: D1Database;
	REPLAYS_BUCKET?: R2Bucket;
	/**
	 * RFC 0007 — pprof profile blob storage. Keyed by `${projectId}/${ts}/${profileId}.pprof.gz`.
	 * Same dispatch pattern as REPLAYS_BUCKET — when unbound, the receiver
	 * falls back to filesystem under `PROFILE_BLOB_DIR` (Node) or returns
	 * 503 (Workers).
	 */
	PROFILES_BUCKET?: R2Bucket;
	/** Durable Object namespace for live-tail SSE pub/sub. Optional — when
	 *  unbound the /internal/telemetry/tail endpoint returns 503. */
	TAIL_HUB?: DurableObjectNamespace;
	/** Write-only API key for SDK ingest endpoints (/v1/*) */
	INGEST_KEY?: string;
	/** Password for dashboard login */
	DASHBOARD_PASSWORD?: string;
	/** Programmatic read/admin bearer token for /internal/* endpoints (e.g. MCP server) */
	DASHBOARD_TOKEN?: string;
	/** Comma-separated allowed origins for CORS (e.g. "https://my-app.com,https://staging.my-app.com") */
	ALLOWED_ORIGINS?: string;
	/** Set to "true" to allow unauthenticated ingest (local dev only) */
	ALLOW_UNAUTHENTICATED?: string;
	/** Raw request body cap in bytes for /v1/* and /internal/* (default 10 MiB). */
	MAX_BODY_BYTES?: string;
	/**
	 * Set to "true" to let alert webhooks target loopback / private / link-local
	 * hosts (self-hosted receivers). Off by default to block SSRF.
	 */
	ALERT_WEBHOOK_ALLOW_PRIVATE?: string;
	TELEMETRY_REDACT_FIELDS?: string;
	/**
	 * Local/test escape hatch for payload capture. Production should prefer the
	 * per-project `payload_capture_enabled` flag, which defaults to false.
	 */
	OBS_PAYLOAD_CAPTURE_DEFAULT?: string;
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
	 * project via @obsunified/telemetry-sdk. When unset, self-instrumentation is a
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

/**
 * Optional string settings on `CollectorEnv` that host adapters (such as
 * `apps/collector-node`) forward directly from the process environment after
 * trimming whitespace and coercing blank strings to `undefined`.
 */
export const COLLECTOR_OPTIONAL_STRING_ENV_KEYS = [
	"RETENTION_HOURS",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENAI_BASE_URL",
	"NARRATIVE_MODEL",
	"NARRATIVE_BUDGET_PER_HOUR",
	"ALERT_WEBHOOK_ALLOW_PRIVATE",
	"MAX_BODY_BYTES",
	"TELEMETRY_REDACT_FIELDS",
	"OBS_PAYLOAD_CAPTURE_DEFAULT",
] as const;

/**
 * String settings on `CollectorEnv` that require explicit host handling (e.g.
 * required auth secrets, CORS origin parsing, Worker-only self-instrumentation
 * vars, or deprecated Worker tokens) and must not be blindly forwarded by the
 * generic optional-env loop.
 */
export const COLLECTOR_HOST_MANAGED_ENV_KEYS = [
	"INGEST_KEY",
	"DASHBOARD_PASSWORD",
	"DASHBOARD_TOKEN",
	"ALLOWED_ORIGINS",
	"ALLOW_UNAUTHENTICATED",
	"OBS_DASHBOARD_INGEST_KEY",
	"OBS_COLLECTOR_SELF_URL",
	"OBS_SELF_AWAIT_EXPORTS",
	"TELEMETRY_INGEST_TOKEN",
	"USAGE_INGEST_TOKEN",
	"TELEMETRY_QUERY_TOKEN",
] as const;

export const COLLECTOR_STRING_ENV_MANIFEST = {
	forwarded: COLLECTOR_OPTIONAL_STRING_ENV_KEYS,
	hostManaged: COLLECTOR_HOST_MANAGED_ENV_KEYS,
} as const;

export type CollectorOptionalStringEnvKey =
	(typeof COLLECTOR_OPTIONAL_STRING_ENV_KEYS)[number];

export type CollectorHostManagedEnvKey =
	(typeof COLLECTOR_HOST_MANAGED_ENV_KEYS)[number];

export type CollectorManifestStringEnvKey =
	| CollectorOptionalStringEnvKey
	| CollectorHostManagedEnvKey;

export type CollectorObjectBindingKey =
	| "DB"
	| "REPLAYS_BUCKET"
	| "PROFILES_BUCKET"
	| "TAIL_HUB";

export type CollectorStringEnvKey = Exclude<
	keyof CollectorEnv,
	CollectorObjectBindingKey
>;

type AssertNever<T extends never> = T;
type _UnaccountedCollectorStringEnvKeys = AssertNever<
	Exclude<CollectorStringEnvKey, CollectorManifestStringEnvKey>
>;
type _UnknownManifestStringEnvKeys = AssertNever<
	Exclude<CollectorManifestStringEnvKey, CollectorStringEnvKey>
>;
type _OverlappingManifestStringEnvKeys = AssertNever<
	Extract<CollectorOptionalStringEnvKey, CollectorHostManagedEnvKey>
>;

/**
 * Verifies that every string key in `declaredKeys` is categorized in either
 * `COLLECTOR_OPTIONAL_STRING_ENV_KEYS` or `COLLECTOR_HOST_MANAGED_ENV_KEYS`
 * without overlap. Throws if any key is uncategorized or duplicated.
 */
export function assertCollectorEnvManifestCompleteness(
	declaredKeys: readonly string[],
	manifest: {
		readonly forwarded: readonly string[];
		readonly hostManaged: readonly string[];
	} = COLLECTOR_STRING_ENV_MANIFEST,
): void {
	const forwardedSet = new Set(manifest.forwarded);
	const hostManagedSet = new Set(manifest.hostManaged);
	const overlap = manifest.forwarded.filter((k) => hostManagedSet.has(k));
	if (overlap.length > 0) {
		throw new Error(
			`CollectorEnv manifest keys cannot be both forwarded and host-managed: ${overlap.join(", ")}`,
		);
	}
	const unaccounted = declaredKeys.filter(
		(k) => !forwardedSet.has(k) && !hostManagedSet.has(k),
	);
	if (unaccounted.length > 0) {
		throw new Error(
			`Uncategorized CollectorEnv string setting(s): ${unaccounted.join(", ")}. Add each key to COLLECTOR_OPTIONAL_STRING_ENV_KEYS or COLLECTOR_HOST_MANAGED_ENV_KEYS.`,
		);
	}
}

export interface CollectorRouteContext {
	hono: Context<{ Bindings: CollectorEnv }>;
	env: CollectorEnv;
	now: Date;
	logger: Logger;
}

export type CollectorApp = Hono<{ Bindings: CollectorEnv }>;
