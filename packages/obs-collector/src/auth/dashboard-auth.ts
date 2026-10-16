import type { Context, MiddlewareHandler } from "hono";
import type { CollectorEnv } from "../framework/env";
import { ProjectsStore } from "../lib/projects-store";
import { type SqlDb, sqlDbFor } from "../lib/sql-db";
import {
	LoginRateLimiter,
	type LoginRateLimitOptions,
	loginClientKey,
	UNKEYED_LOGIN_CLIENT_WARNING,
} from "./login-rate-limit";

const SESSION_COOKIE = "obs_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const PROJECT_CACHE_TTL_MS = 30_000;

interface ProjectCacheEntry {
	ids: Set<string>;
	expiresAt: number;
}

let projectCache = new WeakMap<object, ProjectCacheEntry>();

async function knownProjectIds(
	dbKey: object,
	db: SqlDb,
	now: number,
): Promise<Set<string>> {
	const cached = projectCache.get(dbKey);
	if (cached && cached.expiresAt > now) {
		return cached.ids;
	}
	const store = new ProjectsStore(db);
	const projects = await store.listProjects();
	const ids = new Set(projects.map((p) => p.id));
	projectCache.set(dbKey, { ids, expiresAt: now + PROJECT_CACHE_TTL_MS });
	return ids;
}

/** Test helper — clears the project list cache. */
export function resetDashboardProjectCache(): void {
	projectCache = new WeakMap();
}

/**
 * Sign a payload using HMAC-SHA256.
 * Works across all runtimes that support Web Crypto API (CF Workers, Node 20+, Deno, Bun).
 */
async function sign(payload: string, secret: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(payload),
	);
	return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verify(
	payload: string,
	signature: string,
	secret: string,
): Promise<boolean> {
	const expected = await sign(payload, secret);
	return timingSafeEqualStr(expected, signature);
}

// Constant-time comparison. Both inputs are SHA-256-digested first so the
// XOR loop runs over fixed-length (32-byte) buffers — this removes the
// early-exit timing oracle of `===` and any length-based side channel.
async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
	const enc = new TextEncoder();
	const [da, db] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(a)),
		crypto.subtle.digest("SHA-256", enc.encode(b)),
	]);
	const ha = new Uint8Array(da);
	const hb = new Uint8Array(db);
	let diff = 0;
	for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
	return diff === 0;
}

function createSessionToken(expiresAt: number): string {
	return JSON.stringify({ exp: expiresAt });
}

function parseSessionToken(token: string): { exp: number } | null {
	try {
		const parsed = JSON.parse(token);
		if (typeof parsed.exp === "number") return parsed;
		return null;
	} catch {
		return null;
	}
}

function getCookie(
	cookieHeader: string | undefined,
	name: string,
): string | undefined {
	if (!cookieHeader) return undefined;
	const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match ? decodeURIComponent(match[1]) : undefined;
}

export interface DashboardAuthConfig {
	password?: string;
	token?: string;
	/**
	 * Failed-login limiter for POST /auth/login (see login-rate-limit.ts).
	 * Pass `false` to disable; defaults to 10 failures per 15 minutes.
	 * `clientAddress` lets the host supply the connection's peer address;
	 * `trustProxyHeaders` honours forwarding headers from a trusted proxy.
	 * Without either, Workers use the edge-set client IP and every other
	 * runtime has no trustworthy identity: limiting is then skipped (never a
	 * shared bucket, which would let one client lock everyone out) and a
	 * warning is logged once via `warn` (default `console.warn`).
	 */
	loginRateLimit?:
		| (LoginRateLimitOptions & {
				clientAddress?: (
					c: Context<{ Bindings: CollectorEnv }>,
				) => string | undefined;
				trustProxyHeaders?: boolean;
				/** Sink for the one-time "limiter inactive" warning. */
				warn?: (message: string) => void;
		  })
		| false;
}

/**
 * Creates auth routes and middleware for dashboard password login and
 * programmatic read/admin bearer token authentication.
 *
 * Routes added:
 *   POST /auth/login  — accepts { password }, sets session cookie
 *   GET  /auth/check  — returns { authenticated: true/false } (supports cookie and Bearer token)
 *   POST /auth/logout — clears session cookie
 *
 * The returned middleware validates either:
 *   1. Authorization: Bearer <token> (programmatic read/admin token for MCP/API)
 *   2. obs_session cookie (human dashboard user session)
 *
 * Ingest keys are rejected on dashboard/internal routes — they are write-only.
 */
export function createDashboardAuth(config?: DashboardAuthConfig): {
	middleware: MiddlewareHandler<{
		Bindings: CollectorEnv;
		Variables: { projectId: string };
	}>;
	registerRoutes: (
		app: import("hono").Hono<{ Bindings: CollectorEnv }>,
	) => void;
} {
	const middleware: MiddlewareHandler<{
		Bindings: CollectorEnv;
		Variables: { projectId: string };
	}> = async (c, next) => {
		const configuredPassword = config?.password ?? c.env.DASHBOARD_PASSWORD;
		const configuredToken =
			config?.token ??
			c.env.DASHBOARD_TOKEN ??
			(c.env as unknown as Record<string, string | undefined>)
				.OBS_DASHBOARD_TOKEN;

		if (!configuredPassword && !configuredToken) {
			return c.json(
				{
					error:
						"Neither DASHBOARD_PASSWORD nor DASHBOARD_TOKEN is configured. Set at least one environment variable.",
				},
				500,
			);
		}

		let authenticated = false;

		const authHeader = c.req.header("Authorization");
		if (authHeader) {
			const match = authHeader.match(/^Bearer\s+(.+)$/i);
			if (!match) {
				return c.json({ error: "Unauthorized" }, 401);
			}
			const bearerToken = match[1].trim();
			if (!bearerToken) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			// Ingest keys must never grant read/admin access to dashboard/internal endpoints.
			const ingestKey = c.env.INGEST_KEY;
			if (ingestKey && (await timingSafeEqualStr(bearerToken, ingestKey))) {
				return c.json(
					{
						error:
							"Unauthorized: ingest keys cannot be used for dashboard/internal access",
					},
					401,
				);
			}

			// Fail closed if no programmatic read/admin token is configured.
			if (!configuredToken) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			// Verify bearer token in constant time.
			const valid = await timingSafeEqualStr(bearerToken, configuredToken);
			if (!valid) {
				return c.json({ error: "Unauthorized" }, 401);
			}

			authenticated = true;
		} else {
			// Check session cookie for browser dashboard users.
			const cookieHeader = c.req.header("Cookie");
			const sessionValue = getCookie(cookieHeader, SESSION_COOKIE);

			if (sessionValue) {
				if (!configuredPassword) {
					return c.json({ error: "Unauthorized" }, 401);
				}

				const dotIndex = sessionValue.lastIndexOf(".");
				if (dotIndex === -1) {
					return c.json({ error: "Invalid session" }, 401);
				}

				const payload = sessionValue.substring(0, dotIndex);
				const sig = sessionValue.substring(dotIndex + 1);

				const valid = await verify(payload, sig, configuredPassword);
				if (!valid) {
					return c.json({ error: "Invalid session" }, 401);
				}

				const token = parseSessionToken(payload);
				if (!token || token.exp < Math.floor(Date.now() / 1000)) {
					return c.json({ error: "Session expired" }, 401);
				}

				authenticated = true;
			}
		}

		if (!authenticated) {
			// For API requests, return 401. For page requests, redirect to login.
			const accept = c.req.header("Accept") || "";
			if (accept.includes("text/html")) {
				return c.redirect("/dashboard/login");
			}
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Resolve project for data-scoped routes. /internal/projects/* is exempt
		// because that's where projects are managed (and where the first
		// project is created before the user has selected anything).
		const path = c.req.path;
		const needsProject =
			path.startsWith("/internal/") && !path.startsWith("/internal/projects");

		if (needsProject) {
			const headerProject = c.req.header("X-Project-Id");
			const projectId = headerProject?.trim() || "default";
			const known = await knownProjectIds(
				c.env.DB,
				sqlDbFor(c.env),
				Date.now(),
			);
			// Always allow 'default' so fresh installs don't 400 before any
			// project is seeded (ensure_default_project runs via migration).
			if (projectId !== "default" && !known.has(projectId)) {
				return c.json({ error: `Unknown project: ${projectId}` }, 400);
			}
			c.set("projectId", projectId);
		}

		await next();
	};

	const registerRoutes = (
		app: import("hono").Hono<{ Bindings: CollectorEnv }>,
	) => {
		const limiter =
			config?.loginRateLimit === false
				? null
				: new LoginRateLimiter(config?.loginRateLimit ?? {});
		let warnedUnkeyedClient = false;

		// `Secure` when the request itself is https, or when the operator
		// declared a trusted TLS-terminating proxy (`trustProxyHeaders`, i.e.
		// TRUST_PROXY) that reports `X-Forwarded-Proto: https`.
		const isSecureRequest = (
			c: Context<{ Bindings: CollectorEnv }>,
			limitConfig: { trustProxyHeaders?: boolean } | undefined,
		): boolean =>
			c.req.url.startsWith("https:") ||
			(limitConfig?.trustProxyHeaders === true &&
				c.req
					.header("x-forwarded-proto")
					?.split(",")[0]
					?.trim()
					.toLowerCase() === "https");

		app.post("/auth/login", async (c) => {
			const configuredPassword = config?.password ?? c.env.DASHBOARD_PASSWORD;
			if (!configuredPassword) {
				return c.json({ error: "Dashboard password not configured" }, 500);
			}

			const limitConfig = config?.loginRateLimit || undefined;
			const clientKey = limiter
				? loginClientKey(c.req.raw.headers, {
						clientAddress: limitConfig?.clientAddress?.(c),
						trustProxyHeaders: limitConfig?.trustProxyHeaders,
					})
				: null;
			if (limiter && clientKey === null && !warnedUnkeyedClient) {
				warnedUnkeyedClient = true;
				(limitConfig?.warn ?? console.warn)(UNKEYED_LOGIN_CLIENT_WARNING);
			}
			const verdict = clientKey === null ? null : limiter?.check(clientKey);
			if (verdict && !verdict.allowed) {
				c.header("Retry-After", String(verdict.retryAfterSeconds));
				return c.json({ error: "Too many failed login attempts" }, 429);
			}

			let body: { password?: string } | null = null;
			try {
				body = await c.req.json<{ password?: string }>();
			} catch (err) {
				// The framework's body cap (hono/body-limit) surfaces an oversized
				// streamed body as an error from the read; let it propagate so the
				// middleware answers 413 instead of this handler calling it a bad
				// password. Anything else is malformed JSON → 401 below.
				if (err instanceof Error && err.name === "BodyLimitError") throw err;
				body = null;
			}
			if (
				!body?.password ||
				typeof body.password !== "string" ||
				!(await timingSafeEqualStr(body.password, configuredPassword))
			) {
				if (clientKey !== null) limiter?.recordFailure(clientKey);
				return c.json({ error: "Invalid password" }, 401);
			}
			if (clientKey !== null) limiter?.reset(clientKey);

			const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
			const payload = createSessionToken(expiresAt);
			const sig = await sign(payload, configuredPassword);
			const cookieValue = `${payload}.${sig}`;

			const isSecure = isSecureRequest(c, config?.loginRateLimit || undefined);
			c.header(
				"Set-Cookie",
				`${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${isSecure ? "; Secure" : ""}`,
			);

			return c.json({ success: true });
		});

		app.get("/auth/check", async (c) => {
			const configuredPassword = config?.password ?? c.env.DASHBOARD_PASSWORD;
			const configuredToken =
				config?.token ??
				c.env.DASHBOARD_TOKEN ??
				(c.env as unknown as Record<string, string | undefined>)
					.OBS_DASHBOARD_TOKEN;

			const authHeader = c.req.header("Authorization");
			if (authHeader) {
				const match = authHeader.match(/^Bearer\s+(.+)$/i);
				if (match && configuredToken) {
					const bearerToken = match[1].trim();
					const ingestKey = c.env.INGEST_KEY;
					if (ingestKey && (await timingSafeEqualStr(bearerToken, ingestKey))) {
						return c.json({ authenticated: false });
					}
					const valid = await timingSafeEqualStr(bearerToken, configuredToken);
					if (valid) {
						return c.json({ authenticated: true });
					}
				}
				return c.json({ authenticated: false });
			}

			const cookieHeader = c.req.header("Cookie");
			const sessionValue = getCookie(cookieHeader, SESSION_COOKIE);

			if (!sessionValue || !configuredPassword) {
				return c.json({ authenticated: false });
			}

			const dotIndex = sessionValue.lastIndexOf(".");
			if (dotIndex === -1) {
				return c.json({ authenticated: false });
			}

			const payload = sessionValue.substring(0, dotIndex);
			const sig = sessionValue.substring(dotIndex + 1);

			const valid = await verify(payload, sig, configuredPassword);
			if (!valid) {
				return c.json({ authenticated: false });
			}

			const token = parseSessionToken(payload);
			if (!token || token.exp < Math.floor(Date.now() / 1000)) {
				return c.json({ authenticated: false });
			}

			return c.json({ authenticated: true });
		});

		app.post("/auth/logout", (c) => {
			const isSecure = isSecureRequest(c, config?.loginRateLimit || undefined);
			c.header(
				"Set-Cookie",
				`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? "; Secure" : ""}`,
			);
			return c.json({ success: true });
		});
	};

	return { middleware, registerRoutes };
}
