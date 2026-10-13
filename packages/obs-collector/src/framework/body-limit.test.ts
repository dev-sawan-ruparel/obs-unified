/**
 * The framework caps request bodies on `/v1/*` and `/internal/*` before any
 * handler buffers them. Both the Content-Length fast path and the streamed
 * (chunked) path must refuse oversized bodies with a JSON 413.
 */

import { describe, expect, it } from "vitest";
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
});
