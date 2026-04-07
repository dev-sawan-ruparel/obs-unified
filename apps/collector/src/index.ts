import {
	createDefaultCollectorApp,
	createRetentionCleanupHandler,
} from "@obs/collector";
import type { CollectorEnv } from "@obs/types";
import type { Context, Next } from "hono";

/**
 * Bearer token auth for ingest routes.
 * In dev, allow everything if no token is configured.
 */
const ingestAuth = async (
	c: Context<{ Bindings: CollectorEnv }>,
	next: Next,
) => {
	const expected = c.env.TELEMETRY_INGEST_TOKEN;
	if (!expected) return next();
	const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
	if (token !== expected) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};

/**
 * Token auth for query routes.
 */
const queryAuth = async (
	c: Context<{ Bindings: CollectorEnv }>,
	next: Next,
) => {
	const expected = c.env.TELEMETRY_QUERY_TOKEN;
	if (!expected) return next();
	const token = c.req.header("X-Collector-Token");
	if (token !== expected) {
		return c.json({ error: "Unauthorized" }, 401);
	}
	await next();
};

const app = createDefaultCollectorApp({
	auth: {
		ingest: ingestAuth,
		query: queryAuth,
	},
});

const cleanup = createRetentionCleanupHandler();

export default {
	fetch: app.fetch,
	scheduled: cleanup.scheduled,
};
