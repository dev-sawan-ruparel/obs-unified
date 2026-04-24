import {
	createDefaultCollectorApp,
	createRetentionCleanupHandler,
	createIngestAuth,
	createDashboardAuth,
	evaluateAllRules,
} from "@obs/collector";
import type { CollectorEnv } from "@obs/types";

export { TailHub } from "@obs/collector";

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
	// Ingest auth now validates against the ingest_keys table. On first request,
	// any legacy env.INGEST_KEY is auto-registered as a bootstrap key on the
	// default project (see auth/ingest-auth.ts) so existing deployments keep
	// working without manual migration.
	const ingestAuth = createIngestAuth({
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

// Cron dispatcher: route each trigger to the appropriate handler by event.cron.
// - "0 * * * *"    → hourly retention cleanup
// - "*/5 * * * *"  → alert evaluator
async function scheduled(
	event: ScheduledEvent,
	env: CollectorEnv,
	ctx: ExecutionContext,
): Promise<void> {
	if (event.cron === "*/5 * * * *") {
		ctx.waitUntil(evaluateAllRules(env));
		return;
	}
	await cleanup.scheduled(event, env, ctx);
}

export default {
	async fetch(request: Request, env: CollectorEnv, ctx: ExecutionContext) {
		if (!app) app = createApp(env);
		return app.fetch(request, env, ctx);
	},
	scheduled,
};
