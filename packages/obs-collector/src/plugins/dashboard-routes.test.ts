/**
 * Dashboard auth used to guard `/dashboard/login` itself, and the SPA
 * fallback redirected `/dashboard/*` to `/dashboard/` — which it also
 * matched. A browser hitting `/` on a collector without an assets binding
 * bounced forever. These tests follow the redirect chain by hand.
 */

import { describe, expect, it } from "vitest";
import { createDashboardAuth } from "../auth/dashboard-auth";
import {
	createTelemetryCollectorApp,
	isDashboardLoginPath,
} from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { dashboardRoutesPlugin } from "./dashboard-routes";

const HTML = { Accept: "text/html,application/xhtml+xml" };

const makeApp = (auth: Parameters<typeof createDashboardAuth>[0]) =>
	createTelemetryCollectorApp({
		plugins: [dashboardRoutesPlugin],
		dashboardAuth: createDashboardAuth(auth),
	});

const env = (extra: Record<string, unknown> = {}) =>
	({ DB: new MemSqlDb(), ...extra }) as unknown as CollectorEnv;

/** Follow same-origin redirects; returns every path visited plus the final response. */
const follow = async (
	app: ReturnType<typeof makeApp>,
	path: string,
	headers: Record<string, string>,
	maxHops = 6,
) => {
	const visited: string[] = [];
	let current = path;
	for (let hop = 0; hop < maxHops; hop += 1) {
		visited.push(current);
		const res = await app.request(current, { headers }, env());
		const location = res.headers.get("Location");
		if (res.status < 300 || res.status >= 400 || !location) {
			return { visited, res };
		}
		current = location;
	}
	throw new Error(`redirect loop: ${visited.join(" -> ")}`);
};

describe("dashboard routes + auth", () => {
	it("isDashboardLoginPath matches the login page and its sub-routes only", () => {
		expect(isDashboardLoginPath("/dashboard/login")).toBe(true);
		expect(isDashboardLoginPath("/dashboard/login/")).toBe(true);
		expect(isDashboardLoginPath("/dashboard/login/forgot")).toBe(true);
		expect(isDashboardLoginPath("/dashboard/loginx")).toBe(false);
		expect(isDashboardLoginPath("/dashboard/")).toBe(false);
		expect(isDashboardLoginPath("/internal/login")).toBe(false);
	});

	it("an unauthenticated browser at / reaches the login page without looping", async () => {
		const app = makeApp({ password: "pw" });
		const { visited, res } = await follow(app, "/", HTML);
		expect(visited).toEqual(["/", "/dashboard/", "/dashboard/login"]);
		// No assets binding: the login page cannot be served here, but the
		// chain must end instead of bouncing back to /dashboard/.
		expect(res.status).toBe(404);
		expect(res.headers.get("Location")).toBeNull();
		await expect(res.json()).resolves.toMatchObject({
			error: expect.stringContaining("Dashboard assets are not configured"),
		});
	});

	it("still redirects unauthenticated HTML requests for other dashboard pages to login", async () => {
		const app = makeApp({ password: "pw" });
		const res = await app.request(
			"/dashboard/traces",
			{ headers: HTML },
			env(),
		);
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("/dashboard/login");
	});

	it("does not redirect /dashboard/login to itself", async () => {
		const app = makeApp({ password: "pw" });
		const res = await app.request("/dashboard/login", { headers: HTML }, env());
		expect(res.status).toBe(404);
		expect(res.headers.get("Location")).toBeNull();
	});

	it("an authenticated request without assets does not loop on /dashboard/", async () => {
		const app = makeApp({ token: "tok" });
		const headers = { ...HTML, Authorization: "Bearer tok" };
		const { visited, res } = await follow(app, "/", headers);
		expect(visited).toEqual(["/", "/dashboard/"]);
		expect(res.status).toBe(404);
	});

	it("serves the SPA entrypoint from the assets binding for deep links", async () => {
		const app = makeApp({ token: "tok" });
		const fetched: string[] = [];
		const assets = {
			fetch: async (req: Request) => {
				fetched.push(new URL(req.url).pathname);
				return new Response("<html>spa</html>", {
					status: 200,
					headers: { "content-type": "text/html" },
				});
			},
		};
		const res = await app.request(
			"/dashboard/traces/abc",
			{ headers: { ...HTML, Authorization: "Bearer tok" } },
			env({ ASSETS: assets }),
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("<html>spa</html>");
		expect(fetched).toEqual(["/dashboard/"]);
	});
});
