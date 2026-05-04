import type { CollectorEnv } from "../framework/env";
import type { MiddlewareHandler } from "hono";
import { sha256Hex } from "../lib/hash";
import { ProjectsStore } from "../lib/projects-store";
import { sqlDbFor } from "../lib/sql-db";

const CACHE_TTL_MS = 60_000; // 60 seconds

interface CacheEntry {
	projectId: string;
	expiresAt: number;
}

const keyCache = new Map<string, CacheEntry>();
let bootstrapDone = false;

function getCached(hash: string, now: number): string | null {
	const entry = keyCache.get(hash);
	if (!entry) return null;
	if (entry.expiresAt <= now) {
		keyCache.delete(hash);
		return null;
	}
	return entry.projectId;
}

function setCached(hash: string, projectId: string, now: number): void {
	keyCache.set(hash, { projectId, expiresAt: now + CACHE_TTL_MS });
}

/** Test helper — clears the in-memory cache and bootstrap flag. */
export function resetIngestAuthCache(): void {
	keyCache.clear();
	bootstrapDone = false;
}

/**
 * Creates middleware that validates ingest API keys against the ingest_keys table.
 *
 * Accepts the key from either:
 *   - Authorization: Bearer <key>
 *   - X-API-Key: <key>
 *
 * On success, sets `projectId` on the Hono context via `c.set('projectId', ...)`.
 *
 * On the first request per isolate, if `env.INGEST_KEY` is set, the middleware
 * registers it as a `bootstrap` key on the default project — so existing
 * single-tenant deployments continue to work without manual migration.
 */
export function createIngestAuth(config?: {
	allowUnauthenticated?: boolean;
}): MiddlewareHandler<{
	Bindings: CollectorEnv;
	Variables: { projectId: string };
}> {
	return async (c, next) => {
		// Lazy bootstrap of legacy env key (idempotent).
		if (!bootstrapDone) {
			bootstrapDone = true;
			const legacy = c.env.INGEST_KEY || c.env.TELEMETRY_INGEST_TOKEN;
			if (legacy) {
				const store = new ProjectsStore(sqlDbFor(c.env));
				try {
					await store.bootstrapEnvKey(legacy);
				} catch (err) {
					console.error("[ingest-auth] bootstrap failed:", err);
				}
			}
		}

		const bearer = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
		const apiKey = c.req.header("X-API-Key");
		const token = bearer || apiKey;

		if (!token) {
			if (
				config?.allowUnauthenticated ||
				c.env.ALLOW_UNAUTHENTICATED === "true"
			) {
				c.set("projectId", "default");
				return next();
			}
			return c.json({ error: "Unauthorized" }, 401);
		}

		const now = Date.now();
		const hash = await sha256Hex(token);
		const cached = getCached(hash, now);
		if (cached) {
			c.set("projectId", cached);
			return next();
		}

		const store = new ProjectsStore(sqlDbFor(c.env));
		const match = await store.findByKeyHash(hash);
		if (!match) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		setCached(hash, match.projectId, now);
		c.set("projectId", match.projectId);
		return next();
	};
}
