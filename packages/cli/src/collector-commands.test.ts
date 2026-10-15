import kleur from "kleur";
import { beforeEach, describe, expect, it } from "vitest";
import {
	checkDashboardReadApi,
	describeFailure,
	parseChangesArgs,
	parseDoctorArgs,
	parseKeysArgs,
	runChanges,
	runDoctor,
	runKeys,
} from "./collector-commands";

kleur.enabled = false;

const COLLECTOR = "http://collector.test";
const TOKEN = "admin-secret";

interface RecordedCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | undefined;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;

const json = (status: number, body: unknown, headers?: HeadersInit) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...(headers ?? {}) },
	});

const html404 = () =>
	new Response("<html><body>404 Not Found</body></html>", {
		status: 404,
		headers: { "content-type": "text/html" },
	});

/**
 * Minimal fetch double: records every call (method, URL, headers, body) and
 * dispatches on `METHOD /path`. Unrouted calls return an HTML 404 so a wrong
 * route fails loudly instead of being silently accepted.
 */
function fakeFetch(routes: Record<string, Responder>) {
	const calls: RecordedCall[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers: Record<string, string> = {};
		new Headers(init?.headers).forEach((value, key) => {
			headers[key.toLowerCase()] = value;
		});
		const call: RecordedCall = {
			url,
			method: (init?.method ?? "GET").toUpperCase(),
			headers,
			body: typeof init?.body === "string" ? init.body : undefined,
		};
		calls.push(call);
		const { pathname, search } = new URL(url);
		const key = `${call.method} ${pathname}${search}`;
		const responder = routes[key] ?? routes[`${call.method} ${pathname}`];
		return responder ? responder(call) : html404();
	}) as typeof globalThis.fetch;
	return { fetch, calls };
}

function makeIo() {
	const out: string[] = [];
	const err: string[] = [];
	return {
		io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
		out,
		err,
		stdout: () => out.join("\n"),
		stderr: () => err.join("\n"),
	};
}

const PROJECT = {
	id: "default",
	name: "Default",
	slug: "default",
	createdAt: "2026-10-01T00:00:00.000Z",
	payloadCaptureEnabled: false,
};

const MINTED = {
	id: "k1",
	projectId: "default",
	name: "cli",
	keyPrefix: "obs_default_abcd",
	createdAt: "2026-10-12T00:00:00.000Z",
	revokedAt: null,
	key: "obs_default_abcdef0123456789abcdef0123456789abcdef0123",
	warning: "This key will not be shown again. Store it somewhere safe.",
};

describe("keys mint", () => {
	let env: NodeJS.ProcessEnv;
	beforeEach(() => {
		env = { OBS_COLLECTOR_URL: COLLECTOR, OBS_ADMIN_TOKEN: TOKEN };
	});

	it("POSTs /internal/projects/:id/keys with a JSON name and bearer token", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /internal/projects/default/keys": () => json(201, MINTED),
		});
		const t = makeIo();
		const code = await runKeys(["mint", "--project", "default"], {
			fetch,
			env,
			io: t.io,
		});

		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		const [call] = calls;
		expect(call.method).toBe("POST");
		expect(call.url).toBe(`${COLLECTOR}/internal/projects/default/keys`);
		expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
		expect(call.headers["content-type"]).toBe("application/json");
		expect(call.headers.accept).toBe("application/json");
		expect(JSON.parse(call.body ?? "")).toEqual({ name: "cli" });

		expect(t.out).toContain(MINTED.key);
		expect(t.stdout()).toContain(
			"minted ingest key k1 (cli) for project default",
		);
		expect(t.stdout()).toContain(MINTED.warning);
		expect(t.err).toEqual([]);
	});

	it("never calls the legacy /internal/keys/mint route", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /internal/projects/default/keys": () => json(201, MINTED),
		});
		await runKeys(["mint", "--project", "default"], {
			fetch,
			env,
			io: makeIo().io,
		});
		expect(calls.map((c) => new URL(c.url).pathname)).not.toContain(
			"/internal/keys/mint",
		);
	});

	it("passes --name through and prints raw JSON with --json", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /internal/projects/default/keys": () =>
				json(201, { ...MINTED, name: "browser" }),
		});
		const t = makeIo();
		const code = await runKeys(
			["mint", "--project=default", "--name", "browser", "--json"],
			{ fetch, env, io: t.io },
		);
		expect(code).toBe(0);
		expect(JSON.parse(calls[0].body ?? "")).toEqual({ name: "browser" });
		expect(JSON.parse(t.stdout())).toMatchObject({
			key: MINTED.key,
			name: "browser",
		});
	});

	it("uses OBS_PROJECT_ID when --project is absent, without discovery", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /internal/projects/team-a/keys": () =>
				json(201, { ...MINTED, projectId: "team-a" }),
		});
		const code = await runKeys(["mint"], {
			fetch,
			env: { ...env, OBS_PROJECT_ID: "team-a" },
			io: makeIo().io,
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe(`${COLLECTOR}/internal/projects/team-a/keys`);
	});

	it("--project overrides OBS_PROJECT_ID", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /internal/projects/flag/keys": () => json(201, MINTED),
		});
		const code = await runKeys(["mint", "-p", "flag"], {
			fetch,
			env: { ...env, OBS_PROJECT_ID: "env" },
			io: makeIo().io,
		});
		expect(code).toBe(0);
		expect(calls[0].url).toBe(`${COLLECTOR}/internal/projects/flag/keys`);
	});

	it("discovers the collector's 'default' project via GET /internal/projects", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects": () =>
				json(200, {
					projects: [{ ...PROJECT, id: "other", slug: "other" }, PROJECT],
				}),
			"POST /internal/projects/default/keys": () => json(201, MINTED),
		});
		const code = await runKeys(["mint"], { fetch, env, io: makeIo().io });
		expect(code).toBe(0);
		expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
			"GET /internal/projects",
			"POST /internal/projects/default/keys",
		]);
		expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
	});

	it("falls back to the only project when no 'default' exists", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects": () =>
				json(200, { projects: [{ ...PROJECT, id: "abc123", slug: "solo" }] }),
			"POST /internal/projects/abc123/keys": () => json(201, MINTED),
		});
		const code = await runKeys(["mint"], { fetch, env, io: makeIo().io });
		expect(code).toBe(0);
		expect(calls[1].url).toBe(`${COLLECTOR}/internal/projects/abc123/keys`);
	});

	it("refuses to guess between several non-default projects", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects": () =>
				json(200, {
					projects: [
						{ ...PROJECT, id: "p1", slug: "one", name: "One" },
						{ ...PROJECT, id: "p2", slug: "two", name: "Two" },
					],
				}),
		});
		const t = makeIo();
		const code = await runKeys(["mint"], { fetch, env, io: t.io });
		expect(code).toBe(1);
		expect(calls).toHaveLength(1);
		expect(t.stderr()).toContain("--project");
		expect(t.stderr()).toContain("p1\tone\tOne");
		expect(t.stderr()).toContain("p2\ttwo\tTwo");
	});

	it("reports an empty collector instead of inventing a project", async () => {
		const { fetch } = fakeFetch({
			"GET /internal/projects": () => json(200, { projects: [] }),
		});
		const t = makeIo();
		expect(await runKeys(["mint"], { fetch, env, io: t.io })).toBe(1);
		expect(t.stderr()).toContain("no projects exist");
	});

	it("distinguishes 401 (token rejected) from 404 (project / route)", async () => {
		const unauthorized = fakeFetch({
			"POST /internal/projects/default/keys": () =>
				json(401, { error: "Unauthorized" }),
		});
		const t401 = makeIo();
		expect(
			await runKeys(["mint", "--project", "default"], {
				fetch: unauthorized.fetch,
				env,
				io: t401.io,
			}),
		).toBe(1);
		expect(t401.stderr()).toContain("mint failed: unauthorized (HTTP 401)");
		expect(t401.stderr()).toContain("OBS_ADMIN_TOKEN");
		expect(t401.stderr()).not.toContain("not found");

		// The collector's mint handler surfaces an unknown project as 400
		// `{ error: "Project not found" }` (store throws; route maps to 400).
		const missingProject = fakeFetch({
			"POST /internal/projects/nope/keys": () =>
				json(400, { error: "Project not found" }),
		});
		const t400 = makeIo();
		expect(
			await runKeys(["mint", "--project", "nope"], {
				fetch: missingProject.fetch,
				env,
				io: t400.io,
			}),
		).toBe(1);
		expect(t400.stderr()).toContain('project "nope" not found');
		expect(t400.stderr()).not.toContain("unauthorized");

		const missingRoute = fakeFetch({}); // every call → HTML 404
		const t404 = makeIo();
		expect(
			await runKeys(["mint", "--project", "default"], {
				fetch: missingRoute.fetch,
				env,
				io: t404.io,
			}),
		).toBe(1);
		expect(t404.stderr()).toContain("route not found (HTTP 404)");
		expect(t404.stderr()).toContain("POST /internal/projects/default/keys");
		expect(t404.stderr()).not.toContain("unauthorized");
	});

	it("rejects a 2xx body without a plaintext key", async () => {
		const { fetch } = fakeFetch({
			"POST /internal/projects/default/keys": () => json(201, { id: "k1" }),
		});
		const t = makeIo();
		expect(
			await runKeys(["mint", "--project", "default"], { fetch, env, io: t.io }),
		).toBe(1);
		expect(t.stderr()).toContain("unexpected response");
	});
});

describe("keys list", () => {
	const env = { OBS_COLLECTOR_URL: `${COLLECTOR}/`, OBS_ADMIN_TOKEN: TOKEN };
	const KEYS = [
		{
			id: "k1",
			projectId: "default",
			name: "server",
			keyPrefix: "obs_default_1111",
			createdAt: "2026-10-10T00:00:00.000Z",
			revokedAt: null,
		},
		{
			id: "k2",
			projectId: "default",
			name: "old",
			keyPrefix: "obs_default_2222",
			createdAt: "2026-09-01T00:00:00.000Z",
			revokedAt: "2026-10-01T00:00:00.000Z",
		},
	];

	it("GETs /internal/projects/:id/keys with the bearer token and no body", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects/default/keys": () => json(200, { keys: KEYS }),
		});
		const t = makeIo();
		const code = await runKeys(["list", "--project", "default"], {
			fetch,
			env,
			io: t.io,
		});
		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		// trailing slash on OBS_COLLECTOR_URL is normalized away
		expect(calls[0].url).toBe(`${COLLECTOR}/internal/projects/default/keys`);
		expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
		expect(calls[0].body).toBeUndefined();

		const out = t.stdout();
		expect(out).toContain(
			"k1\tserver\tobs_default_1111…\t2026-10-10T00:00:00.000Z\tactive",
		);
		expect(out).toContain(
			"k2\told\tobs_default_2222…\t2026-09-01T00:00:00.000Z\trevoked 2026-10-01T00:00:00.000Z",
		);
		expect(out).toContain("2 key(s)");
	});

	it("never calls the legacy /internal/keys route", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects/default/keys": () => json(200, { keys: [] }),
		});
		await runKeys(["list", "--project", "default"], {
			fetch,
			env,
			io: makeIo().io,
		});
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			"/internal/projects/default/keys",
		]);
	});

	it("URL-encodes the project id", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects/a%20b%2Fc/keys": () => json(200, { keys: [] }),
		});
		expect(
			await runKeys(["list", "--project", "a b/c"], {
				fetch,
				env,
				io: makeIo().io,
			}),
		).toBe(0);
		expect(calls[0].url).toBe(`${COLLECTOR}/internal/projects/a%20b%2Fc/keys`);
	});

	it("prints a hint when the project has no keys", async () => {
		const { fetch } = fakeFetch({
			"GET /internal/projects/default/keys": () => json(200, { keys: [] }),
		});
		const t = makeIo();
		expect(
			await runKeys(["list", "--project", "default"], { fetch, env, io: t.io }),
		).toBe(0);
		expect(t.stdout()).toContain("no ingest keys for project default");
		expect(t.stdout()).toContain("keys mint --project default");
	});

	it("prints the raw payload with --json", async () => {
		const { fetch } = fakeFetch({
			"GET /internal/projects/default/keys": () => json(200, { keys: KEYS }),
		});
		const t = makeIo();
		await runKeys(["list", "--project", "default", "--json"], {
			fetch,
			env,
			io: t.io,
		});
		expect(JSON.parse(t.stdout())).toEqual({ keys: KEYS });
	});

	it("distinguishes 401 from a 404 unknown project and a 404 unknown route", async () => {
		const t401 = makeIo();
		expect(
			await runKeys(["list", "--project", "default"], {
				fetch: fakeFetch({
					"GET /internal/projects/default/keys": () =>
						json(401, { error: "Unauthorized" }),
				}).fetch,
				env,
				io: t401.io,
			}),
		).toBe(1);
		expect(t401.stderr()).toContain("list failed: unauthorized (HTTP 401)");

		const tProject = makeIo();
		expect(
			await runKeys(["list", "--project", "ghost"], {
				fetch: fakeFetch({
					"GET /internal/projects/ghost/keys": () =>
						json(404, { error: "Project not found" }),
				}).fetch,
				env,
				io: tProject.io,
			}),
		).toBe(1);
		expect(tProject.stderr()).toContain('project "ghost" not found');
		expect(tProject.stderr()).toContain("OBS_PROJECT_ID");

		const tRoute = makeIo();
		expect(
			await runKeys(["list", "--project", "default"], {
				fetch: fakeFetch({}).fetch,
				env,
				io: tRoute.io,
			}),
		).toBe(1);
		expect(tRoute.stderr()).toContain("route not found (HTTP 404)");
		expect(tRoute.stderr()).toContain("GET /internal/projects/default/keys");
	});

	it("surfaces a 401 from project discovery before touching the keys route", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/projects": () => json(401, { error: "Unauthorized" }),
		});
		const t = makeIo();
		expect(await runKeys(["list"], { fetch, env, io: t.io })).toBe(1);
		expect(calls).toHaveLength(1);
		expect(t.stderr()).toContain("unauthorized (HTTP 401)");
	});

	it("reports an unreachable collector", async () => {
		const fetch = (async () => {
			throw new TypeError("fetch failed", {
				cause: new Error("connect ECONNREFUSED 127.0.0.1:8790"),
			});
		}) as unknown as typeof globalThis.fetch;
		const t = makeIo();
		expect(
			await runKeys(["list", "--project", "default"], { fetch, env, io: t.io }),
		).toBe(1);
		expect(t.stderr()).toContain(`could not reach ${COLLECTOR}`);
		expect(t.stderr()).toContain("ECONNREFUSED");
	});
});

describe("keys argument handling", () => {
	it("requires OBS_ADMIN_TOKEN before any request", async () => {
		const { fetch, calls } = fakeFetch({});
		const t = makeIo();
		expect(
			await runKeys(["mint", "--project", "default"], {
				fetch,
				env: { OBS_COLLECTOR_URL: COLLECTOR },
				io: t.io,
			}),
		).toBe(1);
		expect(calls).toHaveLength(0);
		expect(t.stderr()).toContain("OBS_ADMIN_TOKEN");
	});

	it("rejects unknown subcommands and options without a request", async () => {
		for (const args of [
			[],
			["revoke", "k1"],
			["mint", "--bogus"],
			["list", "--name", "x"],
			["mint", "--project"],
			["mint", "extra"],
		]) {
			const { fetch, calls } = fakeFetch({});
			const t = makeIo();
			expect(
				await runKeys(args, {
					fetch,
					env: { OBS_COLLECTOR_URL: COLLECTOR, OBS_ADMIN_TOKEN: TOKEN },
					io: t.io,
				}),
			).toBe(1);
			expect(calls).toHaveLength(0);
			expect(t.stderr()).toContain("usage: obs-unified keys");
		}
	});

	it("parses flags in either form", () => {
		expect(
			parseKeysArgs(["mint", "--project=p", "--name=n", "--json"]),
		).toEqual({
			action: "mint",
			project: "p",
			name: "n",
			json: true,
		});
		expect(parseKeysArgs(["--json", "list", "-p", "p"])).toEqual({
			action: "list",
			project: "p",
			name: undefined,
			json: true,
		});
	});
});

describe("describeFailure", () => {
	it("maps statuses to distinct diagnoses", () => {
		const base = {
			method: "GET",
			path: "/internal/projects/x/keys",
			collectorUrl: COLLECTOR,
			projectId: "x",
		};
		expect(describeFailure({ ...base, status: 401, body: undefined })).toMatch(
			/^unauthorized \(HTTP 401\)/,
		);
		expect(describeFailure({ ...base, status: 403, body: undefined })).toMatch(
			/^unauthorized \(HTTP 403\)/,
		);
		expect(
			describeFailure({
				...base,
				status: 404,
				body: { error: "Project not found" },
			}),
		).toMatch(/^project "x" not found/);
		expect(describeFailure({ ...base, status: 404, body: undefined })).toMatch(
			/^route not found \(HTTP 404\)/,
		);
		expect(
			describeFailure({
				...base,
				status: 500,
				body: { error: "DASHBOARD_PASSWORD is not configured" },
			}),
		).toBe(
			"HTTP 500 from GET /internal/projects/x/keys: DASHBOARD_PASSWORD is not configured",
		);
	});
});

// ── doctor ────────────────────────────────────────────────────────────────

const corsOk = (origin: string) =>
	new Response(null, {
		status: 204,
		headers: {
			"access-control-allow-origin": origin,
			"access-control-allow-headers":
				"content-type, authorization, x-project-id, x-obs-interaction, x-obs-session-id",
		},
	});

const healthyRoutes = (origin: string) => ({
	"GET /health": () => json(200, { ok: true }),
	"OPTIONS /v1/traces": () => corsOk(origin),
	"OPTIONS /v1/usage": () => corsOk(origin),
});

describe("doctor", () => {
	const ORIGIN = "http://app.test";

	it("probes GET /internal/projects unauthenticated and treats 401 as healthy", async () => {
		const { fetch, calls } = fakeFetch({
			...healthyRoutes(ORIGIN),
			"GET /internal/projects": () => json(401, { error: "Unauthorized" }),
		});
		const t = makeIo();
		const code = await runDoctor([COLLECTOR, "--origin", ORIGIN], {
			fetch,
			env: {},
			io: t.io,
		});
		expect(code).toBe(0);

		const probe = calls.find(
			(c) => new URL(c.url).pathname === "/internal/projects",
		);
		expect(probe).toBeDefined();
		expect(probe?.method).toBe("GET");
		expect(probe?.headers.authorization).toBeUndefined();
		expect(calls.map((c) => new URL(c.url).pathname)).not.toContain(
			"/internal/spans",
		);

		expect(t.stdout()).toContain(
			"✓ dashboard read API (GET /internal/projects) — auth required (expected",
		);
		expect(t.stdout()).toContain("all clear");
	});

	it("sends OBS_ADMIN_TOKEN when set and reports an accepted token", async () => {
		const { fetch, calls } = fakeFetch({
			...healthyRoutes(ORIGIN),
			"GET /internal/projects": () => json(200, { projects: [PROJECT] }),
		});
		const t = makeIo();
		const code = await runDoctor([COLLECTOR, "--origin", ORIGIN], {
			fetch,
			env: { OBS_ADMIN_TOKEN: TOKEN },
			io: t.io,
		});
		expect(code).toBe(0);
		const probe = calls.find(
			(c) => new URL(c.url).pathname === "/internal/projects",
		);
		expect(probe?.headers.authorization).toBe(`Bearer ${TOKEN}`);
		expect(t.stdout()).toContain("OBS_ADMIN_TOKEN accepted, 1 project(s)");
	});

	it("fails the dashboard check when a supplied token is rejected (401)", async () => {
		const { fetch } = fakeFetch({
			...healthyRoutes(ORIGIN),
			"GET /internal/projects": () => json(401, { error: "Unauthorized" }),
		});
		const t = makeIo();
		const code = await runDoctor([COLLECTOR, "--origin", ORIGIN], {
			fetch,
			env: { OBS_ADMIN_TOKEN: TOKEN },
			io: t.io,
		});
		expect(code).toBe(1);
		expect(t.stdout()).toContain(
			"✗ dashboard read API (GET /internal/projects) — HTTP 401 — OBS_ADMIN_TOKEN rejected",
		);
		expect(t.stdout()).toContain("1 check(s) failed");
		expect(t.stdout()).not.toContain("Couldn't reach a collector");
	});

	it("fails the dashboard check on 404 and names the missing route", async () => {
		const { fetch } = fakeFetch(healthyRoutes(ORIGIN)); // no /internal/projects
		const t = makeIo();
		const code = await runDoctor([COLLECTOR, "--origin", ORIGIN], {
			fetch,
			env: {},
			io: t.io,
		});
		expect(code).toBe(1);
		expect(t.stdout()).toContain(
			"HTTP 404 — GET /internal/projects not served",
		);
	});

	it("checkDashboardReadApi surfaces non-auth server errors", async () => {
		const { fetch } = fakeFetch({
			"GET /internal/projects": () =>
				json(500, { error: "DASHBOARD_PASSWORD is not configured" }),
		});
		await expect(
			checkDashboardReadApi({ fetch, url: COLLECTOR }),
		).rejects.toThrow("HTTP 500 — DASHBOARD_PASSWORD is not configured");
	});

	it("fails when GET /internal/projects answers 200 without credentials", async () => {
		const { fetch, calls } = fakeFetch({
			...healthyRoutes(ORIGIN),
			"GET /internal/projects": () => json(200, { projects: [PROJECT] }),
		});
		const t = makeIo();
		const code = await runDoctor([COLLECTOR, "--origin", ORIGIN], {
			fetch,
			env: {},
			io: t.io,
		});
		expect(code).toBe(1);
		const probe = calls.find(
			(c) => new URL(c.url).pathname === "/internal/projects",
		);
		expect(probe?.headers.authorization).toBeUndefined();
		expect(t.stdout()).toContain(
			"✗ dashboard read API (GET /internal/projects) — HTTP 200 without credentials",
		);
		expect(t.stdout()).toContain("exposes the internal API unauthenticated");
		expect(t.stdout()).toContain("1 check(s) failed");
		expect(t.stdout()).not.toContain("all clear");

		await expect(
			checkDashboardReadApi({ fetch, url: COLLECTOR }),
		).rejects.toThrow("exposes the internal API unauthenticated");
	});

	it("points at a missing collector when every check fails", async () => {
		const fetch = (async () => {
			throw new TypeError("fetch failed");
		}) as unknown as typeof globalThis.fetch;
		const t = makeIo();
		expect(await runDoctor([], { fetch, env: {}, io: t.io })).toBe(1);
		expect(t.stdout()).toContain("4 check(s) failed");
		expect(t.stdout()).toContain(
			"Couldn't reach a collector at http://localhost:8790",
		);
	});

	it("parses url and --origin, replacing default origins", () => {
		expect(parseDoctorArgs([], {})).toEqual({
			url: "http://localhost:8790",
			origins: ["http://localhost:5173"],
		});
		expect(
			parseDoctorArgs(
				["http://c.test/", "--origin", "http://a", "--origin=http://b"],
				{
					OBS_DOCTOR_ORIGINS: "http://x,http://y",
				},
			),
		).toEqual({ url: "http://c.test", origins: ["http://a", "http://b"] });
		expect(
			parseDoctorArgs([], { OBS_DOCTOR_ORIGINS: "http://x, http://y" }),
		).toEqual({
			url: "http://localhost:8790",
			origins: ["http://x", "http://y"],
		});
	});

	it("rejects unknown options without making requests", async () => {
		const { fetch, calls } = fakeFetch({});
		const t = makeIo();
		expect(await runDoctor(["--nope"], { fetch, env: {}, io: t.io })).toBe(1);
		expect(calls).toHaveLength(0);
		expect(t.stderr()).toContain("unknown doctor option: --nope");
		expect(t.stderr()).toContain("usage: obs-unified doctor");
	});
});

// ── changes ───────────────────────────────────────────────────────────────

describe("changes record", () => {
	const INGEST_KEY = "obs_default_ingest_key_123";

	it("POSTs /v1/changes with ingest key, default kind 'deploy', and parsed touchedPaths", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /v1/changes": () =>
				json(201, {
					id: "chg_241",
					kind: "deploy",
					serviceName: "checkout",
					version: "2.4.1",
				}),
		});
		const t = makeIo();
		const code = await runChanges(
			[
				"record",
				"--environment",
				"prod",
				"--service",
				"checkout",
				"--namespace",
				"payments",
				"--version",
				"2.4.1",
				"--previous-version",
				"2.4.0",
				"--commit-sha",
				"abc1234",
				"--previous-commit-sha",
				"def5678",
				"--summary",
				"Deploy checkout 2.4.1",
				"--repo-url",
				"https://github.com/acme/checkout",
				"--pr-url",
				"https://github.com/acme/checkout/pull/42",
				"--actor",
				"ci-bot",
				"--touched-paths",
				"src/checkout.ts, src/payment.ts ",
			],
			{
				fetch,
				env: { OBS_COLLECTOR_URL: COLLECTOR, OBS_INGEST_KEY: INGEST_KEY },
				io: t.io,
			},
		);

		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("POST");
		expect(calls[0].url).toBe(`${COLLECTOR}/v1/changes`);
		expect(calls[0].headers.authorization).toBe(`Bearer ${INGEST_KEY}`);
		expect(calls[0].headers["x-api-key"]).toBe(INGEST_KEY);
		expect(JSON.parse(calls[0].body ?? "")).toEqual({
			environment: "prod",
			kind: "deploy",
			serviceName: "checkout",
			namespace: "payments",
			version: "2.4.1",
			previousVersion: "2.4.0",
			commitSha: "abc1234",
			previousCommitSha: "def5678",
			summary: "Deploy checkout 2.4.1",
			repositoryUrl: "https://github.com/acme/checkout",
			pullRequestUrl: "https://github.com/acme/checkout/pull/42",
			actorId: "ci-bot",
			touchedPaths: ["src/checkout.ts", "src/payment.ts"],
		});
		expect(t.stdout()).toContain("recorded change chg_241");
	});

	it("accepts --api-key and --url flags and OBS_API_KEY fallback", async () => {
		const { fetch, calls } = fakeFetch({
			"POST /v1/changes": () => json(201, { id: "chg_flag" }),
		});
		const t = makeIo();
		const code = await runChanges(
			[
				"record",
				"--url",
				"http://custom.collector:8790/",
				"--api-key",
				"flag-ingest-key",
				"--kind",
				"feature_flag",
				"--service",
				"web",
				"--json",
			],
			{ fetch, env: {}, io: t.io },
		);
		expect(code).toBe(0);
		expect(calls[0].url).toBe("http://custom.collector:8790/v1/changes");
		expect(calls[0].headers["x-api-key"]).toBe("flag-ingest-key");
		expect(JSON.parse(calls[0].body ?? "")).toMatchObject({
			kind: "feature_flag",
			serviceName: "web",
			summary: "feature_flag web",
		});
		expect(JSON.parse(t.stdout())).toEqual({ id: "chg_flag" });
	});

	it("requires an ingest key before sending a request", async () => {
		const { fetch, calls } = fakeFetch({});
		const t = makeIo();
		const code = await runChanges(["record", "--service", "checkout"], {
			fetch,
			env: { OBS_COLLECTOR_URL: COLLECTOR },
			io: t.io,
		});
		expect(code).toBe(1);
		expect(calls).toHaveLength(0);
		expect(t.stderr()).toContain("ingest key required");
	});
});

describe("changes list", () => {
	const API_TOKEN = "read-bearer-token";

	it("GETs /internal/changes with bearer token and query filters", async () => {
		const { fetch, calls } = fakeFetch({
			"GET /internal/changes": () =>
				json(200, {
					changes: [
						{
							id: "chg_241",
							kind: "deploy",
							environment: "prod",
							serviceName: "checkout",
							version: "2.4.1",
							occurredAt: "2026-10-15T01:00:00.000Z",
							summary: "Deploy 2.4.1",
						},
					],
				}),
		});
		const t = makeIo();
		const code = await runChanges(
			[
				"list",
				"--environment",
				"prod",
				"--service",
				"checkout",
				"--kind",
				"deploy",
				"--limit",
				"10",
			],
			{
				fetch,
				env: { OBS_COLLECTOR_URL: COLLECTOR, OBS_API_TOKEN: API_TOKEN },
				io: t.io,
			},
		);

		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		const calledUrl = new URL(calls[0].url);
		expect(calledUrl.pathname).toBe("/internal/changes");
		expect(calledUrl.searchParams.get("environment")).toBe("prod");
		expect(calledUrl.searchParams.get("serviceName")).toBe("checkout");
		expect(calledUrl.searchParams.get("kind")).toBe("deploy");
		expect(calledUrl.searchParams.get("limit")).toBe("10");
		expect(calls[0].headers.authorization).toBe(`Bearer ${API_TOKEN}`);
		expect(t.stdout()).toContain(
			"chg_241\tdeploy\tprod\tcheckout\t2.4.1\t2026-10-15T01:00:00.000Z\tDeploy 2.4.1",
		);
	});

	it("requires a bearer token for changes list", async () => {
		const { fetch, calls } = fakeFetch({});
		const t = makeIo();
		const code = await runChanges(["list"], {
			fetch,
			env: { OBS_COLLECTOR_URL: COLLECTOR },
			io: t.io,
		});
		expect(code).toBe(1);
		expect(calls).toHaveLength(0);
		expect(t.stderr()).toContain("bearer token required");
	});

	it("parses changes arguments accurately", () => {
		expect(
			parseChangesArgs([
				"record",
				"--service=api",
				"--touched-paths=a.ts,b.ts",
			]),
		).toMatchObject({
			action: "record",
			kind: "deploy",
			service: "api",
			touchedPaths: ["a.ts", "b.ts"],
		});
		expect(
			parseChangesArgs(["list", "--token", "tok", "--limit", "5", "--json"]),
		).toMatchObject({
			action: "list",
			token: "tok",
			limit: 5,
			json: true,
		});
	});
});
