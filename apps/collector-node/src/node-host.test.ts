import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import {
	type CollectorEnv,
	createDashboardAuth,
	createDefaultCollectorApp,
	createIngestAuth,
} from "@obsunified/collector";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createNodeFetch,
	loginClientAddress,
	type NodeAdapterBindings,
	type NodeRequestEnv,
} from "./node-host";

const PASSWORD = "node-host-test-password-123";

/**
 * Regression for the 2.1.0 GHCR smoke failure: `POST /auth/login` answered
 * 500 because `serve({ fetch: (req) => app.fetch(req, requestEnv) })` dropped
 * the adapter's `{ incoming, outgoing }` argument, so `getConnInfo(c)` threw
 * `Cannot read properties of undefined (reading 'socket')` inside the login
 * limiter. These tests drive the real collector app through a real
 * `@hono/node-server` listener with the same wiring `server.ts` uses.
 */

describe("createNodeFetch", () => {
	it("forwards the collector env plus the adapter bindings, without mutating the shared env", async () => {
		const seen: NodeRequestEnv[] = [];
		const app = {
			fetch: (_request: Request, env: NodeRequestEnv) => {
				seen.push(env);
				return new Response("ok");
			},
		};
		const requestEnv = {
			DB: { tag: "db" },
			INGEST_KEY: "ingest",
			DASHBOARD_PASSWORD: PASSWORD,
		} as unknown as CollectorEnv;
		const bindings = {
			incoming: { socket: { remoteAddress: "10.0.0.7" } },
			outgoing: { tag: "outgoing" },
		} as unknown as NodeAdapterBindings;

		const fetchCallback = createNodeFetch(app, requestEnv);
		const res = await fetchCallback(
			new Request("http://localhost/health"),
			bindings,
		);

		expect(res.status).toBe(200);
		expect(seen).toHaveLength(1);
		expect(seen[0].DB).toBe(requestEnv.DB);
		expect(seen[0].INGEST_KEY).toBe("ingest");
		expect(seen[0].DASHBOARD_PASSWORD).toBe(PASSWORD);
		expect(seen[0].incoming).toBe(bindings.incoming);
		expect(seen[0].outgoing).toBe(bindings.outgoing);
		// The shared env must stay the explicit allowlist: no per-connection
		// sockets may be written back onto it.
		expect(requestEnv).not.toHaveProperty("incoming");
		expect(requestEnv).not.toHaveProperty("outgoing");
		expect(seen[0]).not.toBe(requestEnv);
	});

	it("never trusts a client-supplied `server` key to override the adapter bindings", async () => {
		// Hono's Node getConnInfo prefers `c.env.server` when present; the env
		// is built server-side, so that key must come only from our wiring.
		const seen: NodeRequestEnv[] = [];
		const app = {
			fetch: (_request: Request, env: NodeRequestEnv) => {
				seen.push(env);
				return new Response("ok");
			},
		};
		const fetchCallback = createNodeFetch(app, {} as CollectorEnv);
		await fetchCallback(new Request("http://localhost/"), {
			incoming: {},
			outgoing: {},
		} as unknown as NodeAdapterBindings);
		expect(Object.keys(seen[0]).sort()).toEqual(["incoming", "outgoing"]);
	});
});

describe("login through @hono/node-server", () => {
	const closers: Array<() => Promise<void>> = [];
	afterEach(async () => {
		await Promise.all(closers.splice(0).map((close) => close()));
	});

	/**
	 * Boots the production app shape (`createDefaultCollectorApp` + dashboard
	 * auth with the TCP-peer limiter) on an ephemeral loopback port, exactly
	 * as `server.ts` does, but with a database double that fails loudly: the
	 * login path must not need storage.
	 */
	async function startHost(options: { trustProxyHeaders?: boolean } = {}) {
		const warn = vi.fn();
		const peers: Array<string | undefined> = [];
		const dashboardAuth = createDashboardAuth({
			password: PASSWORD,
			loginRateLimit: {
				maxFailures: 2,
				clientAddress: (c: Context<{ Bindings: CollectorEnv }>) => {
					const address = loginClientAddress(c);
					peers.push(address);
					return address;
				},
				// Mirrors `trustProxyHeaders: env.TRUST_PROXY` in server.ts.
				trustProxyHeaders: options.trustProxyHeaders ?? false,
				warn,
			},
		});
		const app = createDefaultCollectorApp({
			auth: { middleware: createIngestAuth({ allowUnauthenticated: false }) },
			dashboardAuth,
			sqlDb: () => {
				throw new Error("login must not touch the database");
			},
		});
		const requestEnv = {
			DB: {} as D1Database,
			INGEST_KEY: "ingest-key",
			DASHBOARD_PASSWORD: PASSWORD,
		} satisfies CollectorEnv;

		const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
			const s = serve(
				{
					fetch: createNodeFetch(app, requestEnv),
					hostname: "127.0.0.1",
					port: 0,
				},
				() => resolve(s),
			);
		});
		const { port } = server.address() as AddressInfo;
		const baseUrl = `http://127.0.0.1:${port}`;
		closers.push(
			() =>
				new Promise<void>((resolve) => {
					server.close(() => resolve());
					(
						server as { closeAllConnections?: () => void }
					).closeAllConnections?.();
				}),
		);

		const login = (password: string, headers: Record<string, string> = {}) =>
			fetch(`${baseUrl}/auth/login`, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify({ password }),
			});

		return { baseUrl, login, warn, peers };
	}

	it("POST /auth/login succeeds and the limiter keys on the real TCP peer", async () => {
		const host = await startHost();

		const res = await host.login(PASSWORD);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ success: true });
		expect(res.headers.get("set-cookie")).toMatch(/^obs_session=/);

		// getConnInfo resolved the loopback peer through the forwarded bindings.
		expect(host.peers).toEqual(["127.0.0.1"]);
		// A keyed client means the limiter is active: no "inactive" warning.
		expect(host.warn).not.toHaveBeenCalled();
	});

	it("rejects a bad password with 401 (not 500) and still resolves the peer", async () => {
		const host = await startHost();
		const res = await host.login("wrong-password");
		expect(res.status).toBe(401);
		await expect(res.json()).resolves.toEqual({ error: "Invalid password" });
		expect(host.peers).toEqual(["127.0.0.1"]);
	});

	it("ignores client-supplied proxy headers by default: the TCP peer owns the bucket", async () => {
		const host = await startHost();

		expect((await host.login("wrong-1")).status).toBe(401);
		expect((await host.login("wrong-2")).status).toBe(401);

		// A direct client cannot escape its bucket by forging a forwarded
		// address — the TCP peer (127.0.0.1) is what the limiter keyed on.
		const forged = await host.login(PASSWORD, {
			"x-forwarded-for": "203.0.113.9",
			"cf-connecting-ip": "198.51.100.4",
		});
		expect(forged.status).toBe(429);
		expect(forged.headers.get("retry-after")).toMatch(/^\d+$/);
		expect(new Set(host.peers)).toEqual(new Set(["127.0.0.1"]));
	});

	it("with TRUST_PROXY=true keys on the forwarded client, not the proxy peer", async () => {
		const host = await startHost({ trustProxyHeaders: true });
		const asClient = (ip: string) => ({ "x-forwarded-for": `${ip}, 10.0.0.1` });

		// Two failures from forwarded client A exhaust A's budget...
		expect((await host.login("wrong-1", asClient("203.0.113.9"))).status).toBe(
			401,
		);
		expect((await host.login("wrong-2", asClient("203.0.113.9"))).status).toBe(
			401,
		);
		expect((await host.login(PASSWORD, asClient("203.0.113.9"))).status).toBe(
			429,
		);
		// ...while forwarded client B, arriving over the same TCP peer, is
		// still welcome: the proxy's address is no longer the bucket key.
		const other = await host.login(PASSWORD, asClient("203.0.113.10"));
		expect(other.status).toBe(200);
		expect(other.headers.get("set-cookie")).toMatch(/^obs_session=/);
		// CF-Connecting-IP outranks X-Forwarded-For when a proxy sets both.
		const viaCf = await host.login(PASSWORD, {
			...asClient("203.0.113.9"),
			"cf-connecting-ip": "198.51.100.4",
		});
		expect(viaCf.status).toBe(200);
		// The host still resolved the real peer on every request.
		expect(new Set(host.peers)).toEqual(new Set(["127.0.0.1"]));
		expect(host.warn).not.toHaveBeenCalled();
	});

	it("with TRUST_PROXY=true falls back to the TCP peer when no forwarded header arrives", async () => {
		const host = await startHost({ trustProxyHeaders: true });

		expect((await host.login("wrong-1")).status).toBe(401);
		expect((await host.login("wrong-2")).status).toBe(401);
		// No header → bucket is the peer (127.0.0.1), which is now exhausted.
		expect((await host.login(PASSWORD)).status).toBe(429);
		// A forwarded client is a separate bucket from the bare peer.
		expect(
			(await host.login(PASSWORD, { "x-forwarded-for": "203.0.113.11" }))
				.status,
		).toBe(200);
		expect(host.warn).not.toHaveBeenCalled();
	});
});
