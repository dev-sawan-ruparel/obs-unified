/**
 * The framework caps request bodies on `/v1/*` and `/internal/*` before any
 * handler buffers them. Both the Content-Length fast path and the streamed
 * (chunked) path must refuse oversized bodies with a JSON 413.
 */

import { describe, expect, it } from "vitest";
import { createDashboardAuth } from "../auth/dashboard-auth";
import type { CollectorPlugin } from "./collector";
import { createTelemetryCollectorApp } from "./collector";
import type { CollectorEnv } from "./env";

const echoPlugin: CollectorPlugin = {
	name: "echo",
	register(app) {
		const echo = async (c: {
			req: { arrayBuffer(): Promise<ArrayBuffer> };
			json: (v: unknown) => Response;
		}) => c.json({ received: (await c.req.arrayBuffer()).byteLength });
		app.post("/v1/echo", echo);
		app.post("/internal/echo", echo);
	},
};

const streamOf = (bytes: number, chunk = 256): ReadableStream<Uint8Array> =>
	new ReadableStream({
		start(controller) {
			let sent = 0;
			while (sent < bytes) {
				const n = Math.min(chunk, bytes - sent);
				controller.enqueue(new Uint8Array(n).fill(120));
				sent += n;
			}
			controller.close();
		},
	});

const post = (
	app: ReturnType<typeof createTelemetryCollectorApp>,
	path: string,
	body: BodyInit,
	env: Partial<CollectorEnv> = {},
) =>
	app.request(
		path,
		{
			method: "POST",
			body,
			headers: { "content-type": "application/octet-stream" },
			// Required by undici for stream bodies; harmless for strings.
			duplex: "half",
		} as RequestInit,
		env as CollectorEnv,
	);

describe("request body cap", () => {
	it("refuses oversized bodies by Content-Length and when streamed", async () => {
		const app = createTelemetryCollectorApp({
			plugins: [echoPlugin],
			maxBodyBytes: 1024,
			// /internal/* fails closed without dashboard auth; a pass-through
			// keeps the cap, not the auth, under test.
			dashboardAuth: {
				middleware: async (_c, next) => next(),
				registerRoutes: () => {},
			},
		});
		for (const path of ["/v1/echo", "/internal/echo"]) {
			const byLength = await post(app, path, "x".repeat(2048));
			expect(byLength.status, path).toBe(413);
			await expect(byLength.json()).resolves.toEqual({
				error: "Payload too large (max 1024 bytes)",
			});

			const streamed = await post(app, path, streamOf(2048));
			expect(streamed.status, path).toBe(413);

			const ok = await post(app, path, "x".repeat(512));
			expect(ok.status, path).toBe(200);
			await expect(ok.json()).resolves.toEqual({ received: 512 });
		}
	});

	it("reads the cap from MAX_BODY_BYTES when the config leaves it unset", async () => {
		const app = createTelemetryCollectorApp({ plugins: [echoPlugin] });
		const env = { MAX_BODY_BYTES: "100" };
		expect((await post(app, "/v1/echo", "x".repeat(101), env)).status).toBe(
			413,
		);
		expect((await post(app, "/v1/echo", "x".repeat(100), env)).status).toBe(
			200,
		);
		// Garbage values fall back to the 10 MiB default.
		expect(
			(await post(app, "/v1/echo", "x".repeat(101), { MAX_BODY_BYTES: "lots" }))
				.status,
		).toBe(200);
	});

	it("caps unauthenticated /auth/login bodies independently of the ingest cap", async () => {
		const app = createTelemetryCollectorApp({
			plugins: [],
			// A generous ingest cap must not widen what an anonymous client
			// can make the host buffer on the login route.
			maxBodyBytes: 1024 * 1024,
			maxAuthBodyBytes: 256,
			dashboardAuth: createDashboardAuth({
				password: "correct-horse-battery-staple",
				loginRateLimit: false,
			}),
		});
		const login = (body: BodyInit) =>
			app.request(
				"/auth/login",
				{
					method: "POST",
					body,
					headers: { "content-type": "application/json" },
					duplex: "half",
				} as RequestInit,
				{} as CollectorEnv,
			);

		const padded = JSON.stringify({ password: "x".repeat(512) });
		const byLength = await login(padded);
		expect(byLength.status).toBe(413);
		await expect(byLength.json()).resolves.toEqual({
			error: "Payload too large (max 256 bytes)",
		});
		expect((await login(streamOf(512))).status).toBe(413);

		// Normal-sized bodies still reach the handler.
		const wrong = await login(JSON.stringify({ password: "nope" }));
		expect(wrong.status).toBe(401);
		const right = await login(
			JSON.stringify({ password: "correct-horse-battery-staple" }),
		);
		expect(right.status).toBe(200);
	});

	it("applies the 16 KiB default to /auth/* when the config leaves it unset", async () => {
		const app = createTelemetryCollectorApp({
			plugins: [],
			dashboardAuth: createDashboardAuth({
				password: "pw",
				loginRateLimit: false,
			}),
		});
		const login = (body: string) =>
			app.request(
				"/auth/login",
				{
					method: "POST",
					body,
					headers: { "content-type": "application/json" },
				},
				// MAX_BODY_BYTES only governs ingest/admin routes.
				{ MAX_BODY_BYTES: String(10 * 1024 * 1024) } as CollectorEnv,
			);
		expect(
			(await login(JSON.stringify({ password: "x".repeat(16 * 1024) }))).status,
		).toBe(413);
		expect((await login(JSON.stringify({ password: "x" }))).status).toBe(401);
	});
});
