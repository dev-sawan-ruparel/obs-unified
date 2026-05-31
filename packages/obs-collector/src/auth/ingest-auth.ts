import type { MiddlewareHandler } from "hono";
import type { CollectorEnv } from "../framework/env";
import { sha256Hex } from "../lib/hash";
import { ProjectsStore } from "../lib/projects-store";
import { sqlDbFor } from "../lib/sql-db";

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
	projectId: string;
	expiresAt: number;
}

let keyCaches = new WeakMap<object, Map<string, CacheEntry>>();
let bootstrapDone = false;

function cacheFor(dbKey: object): Map<string, CacheEntry> {
	let cache = keyCaches.get(dbKey);
	if (!cache) {
		cache = new Map();
		keyCaches.set(dbKey, cache);
	}
	return cache;
}

function getCached(
	cache: Map<string, CacheEntry>,
	hash: string,
	now: number,
): string | null {
	pruneKeyCache(cache, now);
	const entry = cache.get(hash);
	if (!entry) return null;
	if (entry.expiresAt <= now) {
		cache.delete(hash);
		return null;
	}
	return entry.projectId;
}

function setCached(
	cache: Map<string, CacheEntry>,
	hash: string,
	projectId: string,
	now: number,
): void {
	pruneKeyCache(cache, now);
	while (cache.size >= CACHE_MAX_ENTRIES) {
		const oldestKey = cache.keys().next().value;
		if (!oldestKey) break;
		cache.delete(oldestKey);
	}
	cache.set(hash, { projectId, expiresAt: now + CACHE_TTL_MS });
}

function pruneKeyCache(cache: Map<string, CacheEntry>, now: number): void {
	for (const [hash, entry] of cache) {
		if (entry.expiresAt <= now) cache.delete(hash);
	}
}

/** Test helper — clears the in-memory cache and bootstrap flag. */
export function resetIngestAuthCache(): void {
	keyCaches = new WeakMap();
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
			const legacy = c.env.INGEST_KEY || c.env.TELEMETRY_INGEST_TOKEN;
			if (legacy) {
				const store = new ProjectsStore(sqlDbFor(c.env));
				try {
					await store.bootstrapEnvKey(legacy);
					// Latch only after success: a transient DB error on the first
					// request must not permanently disable legacy-key bootstrap for
					// the isolate. bootstrapEnvKey is idempotent, so concurrent
					// first-requests racing here are harmless.
					bootstrapDone = true;
				} catch (err) {
					console.error("[ingest-auth] bootstrap failed:", err);
				}
			} else {
				// Nothing to bootstrap — don't keep re-checking on every request.
				bootstrapDone = true;
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
		const cache = cacheFor(c.env.DB);
		const cached = getCached(cache, hash, now);
		if (cached) {
			c.set("projectId", cached);
			return next();
		}

		const store = new ProjectsStore(sqlDbFor(c.env));
		const match = await store.findByKeyHash(hash);
		if (!match) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		setCached(cache, hash, match.projectId, now);
		c.set("projectId", match.projectId);
		return next();
	};
}
