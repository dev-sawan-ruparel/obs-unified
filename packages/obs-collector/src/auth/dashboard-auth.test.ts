import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { CollectorEnv } from "../framework/env";
import { createDefaultCollectorApp } from "../index";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import {
	createDashboardAuth,
	resetDashboardProjectCache,
} from "./dashboard-auth";
import { createIngestAuth, resetIngestAuthCache } from "./ingest-auth";

const TEST_PASSWORD = "test-dashboard-secret-password-123";
const TEST_TOKEN = "obs_admin_test_token_abcdef123456";
const TEST_INGEST_KEY = "obs_ingest_test_key_987654321";

async function createValidCookie(
	password: string,
	expOffsetSec = 3600,
): Promise<string> {
	const expiresAt = Math.floor(Date.now() / 1000) + expOffsetSec;
	const payload = JSON.stringify({ exp: expiresAt });
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(password),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(payload),
	);
	const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
	return `obs_session=${encodeURIComponent(`${payload}.${sig}`)}`;
}

function createTestDb(
	knownProjects: string[] = ["default", "tenant-a", "tenant-b"],
) {
	return new MemSqlDb({
		all: (sql) => {
			if (sql.includes("projects")) {
				return knownProjects.map((id) => ({
					id,
					name: id.toUpperCase(),
					slug: id,
					created_at: "2026-01-01T00:00:00Z",
					payload_capture_enabled: 0,
				}));
			}
			return [];
		},
		first: () => null,
	});
}

function makeEnv(
	db: MemSqlDb,
	overrides: Partial<CollectorEnv> = {},
): CollectorEnv {
	return {
		DB: db as unknown as D1Database,
		DASHBOARD_PASSWORD: TEST_PASSWORD,
		DASHBOARD_TOKEN: TEST_TOKEN,
		INGEST_KEY: TEST_INGEST_KEY,
		...overrides,
	};
}

describe("dashboard-auth middleware & programmatic token contract", () => {
	beforeEach(() => {
		resetDashboardProjectCache();
		resetIngestAuthCache();
	});

	describe("Bearer token authentication", () => {
		it("accepts a valid Bearer token configured in config", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) =>
				c.json({ ok: true, project: c.get("projectId") }),
			);

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: `Bearer ${TEST_TOKEN}` },
				}),
				env,
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true, project: "default" });
		});

		it("accepts a valid Bearer token from env.DASHBOARD_TOKEN when not in config", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({ password: TEST_PASSWORD });

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) =>
				c.json({ ok: true, project: c.get("projectId") }),
			);

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: `Bearer ${TEST_TOKEN}` },
				}),
				env,
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true, project: "default" });
		});

		it("rejects an invalid Bearer token with 401 Unauthorized", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: "Bearer wrong-token-xyz" },
				}),
				env,
			);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Unauthorized" });
		});

		it("rejects malformed Authorization headers", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			for (const header of [
				"Basic dXNlcjpwYXNz",
				"Bearer",
				"Bearer   ",
				"Token xyz",
			]) {
				const res = await app.fetch(
					new Request("http://localhost/internal/test", {
						headers: { Authorization: header },
					}),
					env,
				);
				expect(res.status).toBe(401);
			}
		});

		it("fails closed when no programmatic token is configured on the collector", async () => {
			const db = createTestDb();
			const env = makeEnv(db, { DASHBOARD_TOKEN: undefined });
			const auth = createDashboardAuth({ password: TEST_PASSWORD });

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: `Bearer ${TEST_TOKEN}` },
				}),
				env,
			);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Unauthorized" });
		});
	});

	describe("Ingest key rejection on /internal/*", () => {
		it("rejects INGEST_KEY sent as Bearer token on /internal/*", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: `Bearer ${TEST_INGEST_KEY}` },
				}),
				env,
			);

			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: string };
			expect(body.error).toMatch(/ingest keys cannot be used/i);
		});

		it("rejects X-API-Key ingest key on /internal/*", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { "X-API-Key": TEST_INGEST_KEY },
				}),
				env,
			);

			expect(res.status).toBe(401);
		});
	});

	describe("Cookie login preservation", () => {
		it("accepts a valid HMAC-SHA256 signed obs_session cookie", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const cookie = await createValidCookie(TEST_PASSWORD);
			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Cookie: cookie },
				}),
				env,
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body).toEqual({ ok: true });
		});

		it("rejects a cookie with invalid signature", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const cookie = await createValidCookie("wrong-signing-password");
			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Cookie: cookie },
				}),
				env,
			);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Invalid session" });
		});

		it("rejects an expired cookie", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			// Expired 100 seconds ago
			const cookie = await createValidCookie(TEST_PASSWORD, -100);
			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Cookie: cookie },
				}),
				env,
			);

			expect(res.status).toBe(401);
			const body = await res.json();
			expect(body).toEqual({ error: "Session expired" });
		});

		it("redirects unauthenticated HTML requests to /dashboard/login", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/page", (c) => c.text("html"));

			const res = await app.fetch(
				new Request("http://localhost/internal/page", {
					headers: { Accept: "text/html,application/xhtml+xml" },
				}),
				env,
			);

			expect(res.status).toBe(302);
			expect(res.headers.get("Location")).toBe("/dashboard/login");
		});

		it("allows login via POST /auth/login and validation via GET /auth/check", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{ Bindings: CollectorEnv }>();
			auth.registerRoutes(app);

			// Valid login
			const loginRes = await app.fetch(
				new Request("http://localhost/auth/login", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ password: TEST_PASSWORD }),
				}),
				env,
			);
			expect(loginRes.status).toBe(200);
			const setCookie = loginRes.headers.get("Set-Cookie");
			expect(setCookie).toBeTruthy();
			expect(setCookie).toContain("obs_session=");

			// Check auth with session cookie
			const cookieValue = setCookie?.split(";")[0] ?? "";
			const checkRes = await app.fetch(
				new Request("http://localhost/auth/check", {
					headers: { Cookie: cookieValue },
				}),
				env,
			);
			expect(checkRes.status).toBe(200);
			expect(await checkRes.json()).toEqual({ authenticated: true });
		});

		it("GET /auth/check validates Bearer token and rejects ingest key", async () => {
			const db = createTestDb();
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{ Bindings: CollectorEnv }>();
			auth.registerRoutes(app);

			// Valid Bearer token
			const validRes = await app.fetch(
				new Request("http://localhost/auth/check", {
					headers: { Authorization: `Bearer ${TEST_TOKEN}` },
				}),
				env,
			);
			expect(await validRes.json()).toEqual({ authenticated: true });

			// Ingest key as Bearer
			const ingestRes = await app.fetch(
				new Request("http://localhost/auth/check", {
					headers: { Authorization: `Bearer ${TEST_INGEST_KEY}` },
				}),
				env,
			);
			expect(await ingestRes.json()).toEqual({ authenticated: false });

			// Invalid token
			const invalidRes = await app.fetch(
				new Request("http://localhost/auth/check", {
					headers: { Authorization: "Bearer bad-token" },
				}),
				env,
			);
			expect(await invalidRes.json()).toEqual({ authenticated: false });
		});
	});

	describe("Project isolation & scoping", () => {
		it("scopes to valid tenant project specified in X-Project-Id", async () => {
			const db = createTestDb(["default", "tenant-a", "tenant-b"]);
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/data", (c) => c.json({ project: c.get("projectId") }));

			const res = await app.fetch(
				new Request("http://localhost/internal/data", {
					headers: {
						Authorization: `Bearer ${TEST_TOKEN}`,
						"X-Project-Id": "tenant-a",
					},
				}),
				env,
			);

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ project: "tenant-a" });
		});

		it("rejects unknown project in X-Project-Id with 400 Bad Request", async () => {
			const db = createTestDb(["default", "tenant-a"]);
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/data", (c) => c.json({ project: c.get("projectId") }));

			const res = await app.fetch(
				new Request("http://localhost/internal/data", {
					headers: {
						Authorization: `Bearer ${TEST_TOKEN}`,
						"X-Project-Id": "unknown-corp",
					},
				}),
				env,
			);

			expect(res.status).toBe(400);
			expect(await res.json()).toEqual({
				error: "Unknown project: unknown-corp",
			});
		});

		it("exempts /internal/projects/* from requiring a pre-existing project", async () => {
			const db = createTestDb(["default"]);
			const env = makeEnv(db);
			const auth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/projects", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/projects", {
					headers: {
						Authorization: `Bearer ${TEST_TOKEN}`,
						"X-Project-Id": "not-seeded-yet",
					},
				}),
				env,
			);

			expect(res.status).toBe(200);
		});
	});

	describe("Fail closed when unconfigured", () => {
		it("returns 500 when neither password nor token is configured", async () => {
			const db = createTestDb();
			const env = makeEnv(db, {
				DASHBOARD_PASSWORD: undefined,
				DASHBOARD_TOKEN: undefined,
			});
			const auth = createDashboardAuth();

			const app = new Hono<{
				Bindings: CollectorEnv;
				Variables: { projectId: string };
			}>();
			app.use("/internal/*", auth.middleware);
			app.get("/internal/test", (c) => c.json({ ok: true }));

			const res = await app.fetch(
				new Request("http://localhost/internal/test", {
					headers: { Authorization: `Bearer ${TEST_TOKEN}` },
				}),
				env,
			);

			expect(res.status).toBe(500);
			const body = (await res.json()) as { error: string };
			expect(body.error).toContain(
				"Neither DASHBOARD_PASSWORD nor DASHBOARD_TOKEN",
			);
		});
	});

	describe("Full collector app wiring", () => {
		it("verifies end-to-end /internal/* and /v1/* route protection", async () => {
			const db = createTestDb();
			const env = makeEnv(db);

			const ingestAuth = createIngestAuth();
			const dashboardAuth = createDashboardAuth({
				password: TEST_PASSWORD,
				token: TEST_TOKEN,
			});

			const app = createDefaultCollectorApp({
				auth: { middleware: ingestAuth },
				dashboardAuth,
				sqlDb: () => db,
			});

			// 1. Valid Bearer token to /internal/* succeeds
			const internalValidRes = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview", {
					headers: {
						Authorization: `Bearer ${TEST_TOKEN}`,
						"X-Project-Id": "default",
					},
				}),
				env,
			);
			expect(internalValidRes.status).toBe(200);

			// 2. Ingest key to /internal/* is rejected with 401
			const internalIngestRes = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview", {
					headers: {
						Authorization: `Bearer ${TEST_INGEST_KEY}`,
					},
				}),
				env,
			);
			expect(internalIngestRes.status).toBe(401);

			// 3. Invalid token to /internal/* is rejected with 401
			const internalInvalidRes = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview", {
					headers: {
						Authorization: "Bearer invalid-token",
					},
				}),
				env,
			);
			expect(internalInvalidRes.status).toBe(401);

			// 4. Valid session cookie to /internal/* succeeds
			const cookie = await createValidCookie(TEST_PASSWORD);
			const internalCookieRes = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview", {
					headers: {
						Cookie: cookie,
					},
				}),
				env,
			);
			expect(internalCookieRes.status).toBe(200);

			// 5. Unauthenticated request to /internal/* is rejected with 401
			const internalUnauthRes = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview"),
				env,
			);
			expect(internalUnauthRes.status).toBe(401);
		});

		it("fails closed on /internal/* if dashboardAuth was not configured on app", async () => {
			const db = createTestDb();
			const env = makeEnv(db);

			const ingestAuth = createIngestAuth();
			// No dashboardAuth provided!
			const app = createDefaultCollectorApp({
				auth: { middleware: ingestAuth },
				sqlDb: () => db,
			});

			// Even with valid ingest key, /internal/* must fail closed
			const res = await app.fetch(
				new Request("http://localhost/internal/telemetry/overview", {
					headers: {
						Authorization: `Bearer ${TEST_INGEST_KEY}`,
					},
				}),
				env,
			);
			expect(res.status).toBe(401);
		});
	});
});
