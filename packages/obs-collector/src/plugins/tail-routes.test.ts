import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { tailRoutesPlugin } from "./tail-routes";

describe("tailRoutesPlugin", () => {
	it("forwards the authenticated project id instead of trusting query params", async () => {
		let forwardedUrl: string | null = null;
		const app = new Hono<{
			Bindings: CollectorEnv;
			Variables: { projectId: string };
		}>();
		app.use("/internal/*", async (c, next) => {
			c.set("projectId", "authorized-project");
			await next();
		});
		tailRoutesPlugin.register(
			app as unknown as Hono<{ Bindings: CollectorEnv }>,
			new CollectorRuntime(),
		);

		const env = {
			TAIL_HUB: {
				idFromName: (name: string) => name,
				get: () => ({
					fetch: async (url: string) => {
						forwardedUrl = url;
						return new Response("ok", { status: 200 });
					},
				}),
			},
		} as unknown as CollectorEnv;

		const res = await app.request(
			"/internal/telemetry/tail?projectId=attacker-project&kinds=span",
			{ method: "GET" },
			env,
		);

		expect(res.status).toBe(200);
		expect(forwardedUrl).not.toBeNull();
		const url = new URL(forwardedUrl ?? "");
		expect(url.searchParams.get("projectId")).toBe("authorized-project");
		expect(url.searchParams.get("kinds")).toBe("span");
	});
});
