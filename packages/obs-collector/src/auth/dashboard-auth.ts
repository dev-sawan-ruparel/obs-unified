import type { MiddlewareHandler } from "hono";
import type { CollectorEnv } from "../framework/env";
import { ProjectsStore } from "../lib/projects-store";
import { type SqlDb, sqlDbFor } from "../lib/sql-db";

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

/**
 * Creates auth routes and middleware for dashboard password login.
 *
 * Routes added:
 *   POST /auth/login  — accepts { password }, sets session cookie
 *   GET  /auth/check  — returns { authenticated: true/false }
 *   POST /auth/logout — clears session cookie
 *
 * The returned middleware validates the session cookie on protected routes.
 */
export function createDashboardAuth(config: { password: string }): {
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
		if (!config.password) {
			return c.json(
				{
					error:
						"DASHBOARD_PASSWORD is not configured. Set the DASHBOARD_PASSWORD environment variable.",
				},
				500,
			);
		}

		const cookieHeader = c.req.header("Cookie");
		const sessionValue = getCookie(cookieHeader, SESSION_COOKIE);

		if (!sessionValue) {
			// For API requests, return 401. For page requests, redirect to login.
			const accept = c.req.header("Accept") || "";
			if (accept.includes("text/html")) {
				return c.redirect("/dashboard/login");
			}
			return c.json({ error: "Unauthorized" }, 401);
		}

		// Session cookie format: payload.signature
		const dotIndex = sessionValue.lastIndexOf(".");
		if (dotIndex === -1) {
			return c.json({ error: "Invalid session" }, 401);
		}

		const payload = sessionValue.substring(0, dotIndex);
		const sig = sessionValue.substring(dotIndex + 1);

		const valid = await verify(payload, sig, config.password);
		if (!valid) {
			return c.json({ error: "Invalid session" }, 401);
		}

		const token = parseSessionToken(payload);
		if (!token || token.exp < Math.floor(Date.now() / 1000)) {
			return c.json({ error: "Session expired" }, 401);
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
		app.post("/auth/login", async (c) => {
			if (!config.password) {
				return c.json({ error: "Dashboard password not configured" }, 500);
			}

			const body = await c.req
				.json<{ password?: string }>()
				.catch(() => ({ password: undefined }));
			if (
				!body.password ||
				!(await timingSafeEqualStr(body.password, config.password))
			) {
				return c.json({ error: "Invalid password" }, 401);
			}

			const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
			const payload = createSessionToken(expiresAt);
			const sig = await sign(payload, config.password);
			const cookieValue = `${payload}.${sig}`;

			const isSecure = c.req.url.startsWith("https:");
			c.header(
				"Set-Cookie",
				`${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE}${isSecure ? "; Secure" : ""}`,
			);

			return c.json({ success: true });
		});

		app.get("/auth/check", async (c) => {
			const cookieHeader = c.req.header("Cookie");
			const sessionValue = getCookie(cookieHeader, SESSION_COOKIE);

			if (!sessionValue) {
				return c.json({ authenticated: false });
			}

			const dotIndex = sessionValue.lastIndexOf(".");
			if (dotIndex === -1) {
				return c.json({ authenticated: false });
			}

			const payload = sessionValue.substring(0, dotIndex);
			const sig = sessionValue.substring(dotIndex + 1);

			const valid = await verify(payload, sig, config.password);
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
			const isSecure = c.req.url.startsWith("https:");
			c.header(
				"Set-Cookie",
				`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${isSecure ? "; Secure" : ""}`,
			);
			return c.json({ success: true });
		});
	};

	return { middleware, registerRoutes };
}
