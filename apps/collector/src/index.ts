import {
	createDefaultCollectorApp,
	createRetentionCleanupHandler,
	createIngestAuth,
	createDashboardAuth,
} from "@obs/collector";
import type { CollectorEnv } from "@obs/types";

/**
 * Collector worker.
 *
 * Environment variables:
 *   INGEST_KEY        — Write-only API key for SDK ingest (required in production)
 *   DASHBOARD_PASSWORD — Password for the dashboard login
 *   ALLOWED_ORIGINS    — Comma-separated allowed origins for CORS
 *   RETENTION_HOURS    — Data retention window in hours (default: 72)
 *
 * For local dev, set ALLOW_UNAUTHENTICATED="true" to bypass ingest auth.
 */

const createApp = (env: CollectorEnv) => {
	const ingestAuth = createIngestAuth({
		secret: env.INGEST_KEY || env.TELEMETRY_INGEST_TOKEN || "",
		allowUnauthenticated: env.ALLOW_UNAUTHENTICATED === "true",
	});

	const dashboardAuth = env.DASHBOARD_PASSWORD
		? createDashboardAuth({ password: env.DASHBOARD_PASSWORD })
		: undefined;

	return createDefaultCollectorApp({
		auth: { middleware: ingestAuth },
		allowedOrigins: env.ALLOWED_ORIGINS,
		dashboardAuth,
	});
};

// Lazily create the app on first request to access env
let app: ReturnType<typeof createApp> | null = null;

const cleanup = createRetentionCleanupHandler();

export default {
	async fetch(request: Request, env: CollectorEnv, ctx: ExecutionContext) {
		if (!app) app = createApp(env);
		return app.fetch(request, env, ctx);
	},
	scheduled: cleanup.scheduled,
};
