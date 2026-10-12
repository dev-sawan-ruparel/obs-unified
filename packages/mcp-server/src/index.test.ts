import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollectorClient, readConfig } from "./index";

const ORIGINAL_ENV = { ...process.env };

describe("mcp-server configuration & auth contract", () => {
	beforeEach(() => {
		process.env = { ...ORIGINAL_ENV };
		delete process.env.OBS_COLLECTOR_URL;
		delete process.env.OBS_DASHBOARD_TOKEN;
		delete process.env.OBS_INGEST_KEY;
		delete process.env.OBS_SESSION_COOKIE;
		delete process.env.OBS_PROJECT_ID;
		delete process.env.OBS_DASHBOARD_URL;
		delete process.env.OBS_MCP_TIMEOUT_MS;
	});

	afterEach(() => {
		process.env = { ...ORIGINAL_ENV };
	});

	describe("readConfig()", () => {
		it("throws when OBS_COLLECTOR_URL is missing", () => {
			process.env.OBS_DASHBOARD_TOKEN = "test-token";
			expect(() => readConfig()).toThrow(/OBS_COLLECTOR_URL is required/);
		});

		it("configures Authorization: Bearer header when OBS_DASHBOARD_TOKEN is set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790/";
			process.env.OBS_DASHBOARD_TOKEN = "my-secret-admin-token";

			const config = readConfig();
			expect(config.baseUrl).toBe("http://localhost:8790");
			expect(config.authHeaders).toEqual({
				Accept: "application/json",
				Authorization: "Bearer my-secret-admin-token",
			});
			expect(config.projectId).toBeUndefined();
			expect(config.timeoutMs).toBe(30_000);
		});

		it("configures Cookie header when OBS_SESSION_COOKIE is set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_SESSION_COOKIE = "payload.signature";

			const config = readConfig();
			expect(config.authHeaders).toEqual({
				Accept: "application/json",
				Cookie: "obs_session=payload.signature",
			});

			// If already prefixed with obs_session=
			process.env.OBS_SESSION_COOKIE = "obs_session=already-prefixed";
			const config2 = readConfig();
			expect(config2.authHeaders.Cookie).toBe("obs_session=already-prefixed");
		});

		it("prefers OBS_DASHBOARD_TOKEN over OBS_SESSION_COOKIE if both are set", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_DASHBOARD_TOKEN = "my-secret-admin-token";
			process.env.OBS_SESSION_COOKIE = "obs_session=my-session";

			const config = readConfig();
			expect(config.authHeaders.Authorization).toBe(
				"Bearer my-secret-admin-token",
			);
			expect(config.authHeaders.Cookie).toBeUndefined();
		});

		it("explicitly rejects OBS_INGEST_KEY with a clear write-only explanation", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_INGEST_KEY = "obs_ingest_write_only_key";

			expect(() => readConfig()).toThrow(
				/OBS_INGEST_KEY is a write-only ingest key and cannot be used for collector read access/i,
			);
		});

		it("throws when no read auth credential is provided", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";

			expect(() => readConfig()).toThrow(
				/Set OBS_DASHBOARD_TOKEN or OBS_SESSION_COOKIE for collector read access/i,
			);
		});

		it("parses optional variables: OBS_PROJECT_ID, OBS_DASHBOARD_URL, OBS_MCP_TIMEOUT_MS", () => {
			process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
			process.env.OBS_DASHBOARD_TOKEN = "my-token";
			process.env.OBS_PROJECT_ID = "finance-prod";
			process.env.OBS_DASHBOARD_URL = "https://dashboard.example.com/";
			process.env.OBS_MCP_TIMEOUT_MS = "45000";

			const config = readConfig();
			expect(config.projectId).toBe("finance-prod");
			expect(config.dashboardUrl).toBe("https://dashboard.example.com");
			expect(config.timeoutMs).toBe(45_000);
		});
	});

	describe("CollectorClient end-to-end integration", () => {
		const TEST_TOKEN = "test-mcp-bearer-token-123";

		it("authenticates against collector using Bearer OBS_DASHBOARD_TOKEN and forwards X-Project-Id", async () => {
			const requestsReceived: Array<{
				path: string;
				headers: Record<string, string>;
			}> = [];

			// Mock fetch for client
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async (
				input: RequestInfo | URL,
				init?: RequestInit,
			) => {
				const url = String(input);
				const headers: Record<string, string> = {};
				if (init?.headers) {
					const h = init.headers as Record<string, string>;
					for (const [k, v] of Object.entries(h)) {
						headers[k.toLowerCase()] = v;
					}
				}
				requestsReceived.push({ path: url, headers });

				// Verify bearer token received
				if (headers.authorization !== `Bearer ${TEST_TOKEN}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), {
						status: 401,
						headers: { "Content-Type": "application/json" },
					});
				}

				return new Response(
					JSON.stringify({
						ok: true,
						project: headers["x-project-id"] || "default",
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				);
			}) as typeof fetch;

			try {
				process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
				process.env.OBS_DASHBOARD_TOKEN = TEST_TOKEN;
				process.env.OBS_PROJECT_ID = "payments";

				const config = readConfig();
				const client = new CollectorClient(config);

				const result = await client.get<{ ok: boolean; project: string }>(
					"/internal/telemetry/overview",
					{ hours: 24 },
				);

				expect(result).toEqual({ ok: true, project: "payments" });
				expect(requestsReceived.length).toBe(1);
				expect(requestsReceived[0].path).toBe(
					"http://localhost:8790/internal/telemetry/overview?hours=24",
				);
				expect(requestsReceived[0].headers.authorization).toBe(
					`Bearer ${TEST_TOKEN}`,
				);
				expect(requestsReceived[0].headers["x-project-id"]).toBe("payments");
			} finally {
				globalThis.fetch = originalFetch;
			}
		});

		it("throws descriptive error when collector rejects with 401", async () => {
			const originalFetch = globalThis.fetch;
			globalThis.fetch = (async () => {
				return new Response(JSON.stringify({ error: "Unauthorized" }), {
					status: 401,
					statusText: "Unauthorized",
					headers: { "Content-Type": "application/json" },
				});
			}) as typeof fetch;

			try {
				process.env.OBS_COLLECTOR_URL = "http://localhost:8790";
				process.env.OBS_DASHBOARD_TOKEN = "wrong-token";

				const config = readConfig();
				const client = new CollectorClient(config);

				await expect(
					client.get("/internal/telemetry/overview"),
				).rejects.toThrow(/Collector request failed: 401/i);
			} finally {
				globalThis.fetch = originalFetch;
			}
		});
	});
});
