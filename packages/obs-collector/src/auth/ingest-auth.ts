import type { CollectorEnv } from "@obs/types";
import type { MiddlewareHandler } from "hono";

/**
 * Creates middleware that validates ingest API keys on /v1/* routes.
 *
 * Accepts the key from either:
 *   - Authorization: Bearer <key>
 *   - X-API-Key: <key>
 *
 * If INGEST_KEY is not configured and allowUnauthenticated is not true,
 * returns 500 to prevent accidental open deployments.
 */
export function createIngestAuth(config: {
	secret: string;
	allowUnauthenticated?: boolean;
}): MiddlewareHandler<{ Bindings: CollectorEnv }> {
	return async (c, next) => {
		if (!config.secret) {
			if (config.allowUnauthenticated) return next();
			return c.json(
				{
					error:
						"Collector INGEST_KEY is not configured. Set the INGEST_KEY environment variable.",
				},
				500,
			);
		}

		const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
		const apiKey = c.req.header("X-API-Key");
		const token = bearer || apiKey;

		if (token !== config.secret) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		await next();
	};
}
