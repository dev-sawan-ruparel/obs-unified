/**
 * Collector-facing subcommands (`keys`, `doctor`), split out of `cli.ts` so
 * they can be exercised directly in tests with an injected `fetch`.
 *
 * Routes mirror `packages/obs-collector/src/plugins/projects-routes.ts`:
 *
 *   GET  /internal/projects                 → { projects: Project[] }
 *   GET  /internal/projects/:id/keys        → { keys: IngestKey[] }
 *   POST /internal/projects/:id/keys        → IngestKeyWithPlaintext (201)
 *                                             body: { name?: string }
 *
 * Authorization is `Authorization: Bearer $OBS_ADMIN_TOKEN` for now. The
 * collector-side bearer contract is being settled separately; this module only
 * promises to send that header on every /internal/* request.
 */

import kleur from "kleur";

export const DEFAULT_COLLECTOR_URL = "http://localhost:8790";
export const DEFAULT_KEY_NAME = "cli";
export const DEFAULT_DOCTOR_ORIGINS = "http://localhost:5173";

export interface CommandIo {
	out(line: string): void;
	err(line: string): void;
}

export interface CommandDeps {
	fetch?: typeof fetch;
	io?: CommandIo;
	env?: NodeJS.ProcessEnv;
}

export interface Project {
	id: string;
	name: string;
	slug: string;
	createdAt: string;
	payloadCaptureEnabled?: boolean;
}

export interface IngestKey {
	id: string;
	projectId: string;
	name: string;
	keyPrefix: string;
	createdAt: string;
	revokedAt: string | null;
}

export interface IngestKeyWithPlaintext extends IngestKey {
	key: string;
	warning?: string;
}

export const KEYS_USAGE = `usage: obs-unified keys <mint|list> [--project <id>] [--name <label>] [--json]

  mint    POST /internal/projects/<id>/keys — mint a new ingest key
  list    GET  /internal/projects/<id>/keys — list a project's ingest keys

Project selection (first match wins):
  --project <id>     explicit project id
  OBS_PROJECT_ID     environment variable
  (discovery)        GET /internal/projects: the project with id "default",
                     or the only project when exactly one exists; otherwise
                     the CLI lists the available ids and asks for --project.

Environment:
  OBS_COLLECTOR_URL  collector base URL (default ${DEFAULT_COLLECTOR_URL})
  OBS_ADMIN_TOKEN    required; sent as "Authorization: Bearer <token>"`;

export const DOCTOR_USAGE =
	"usage: obs-unified doctor [url] [--origin <origin> ...]";

class UsageError extends Error {}

const defaultIo: CommandIo = {
	out: (line) => console.log(line),
	err: (line) => console.error(line),
};

const resolveDeps = (deps: CommandDeps) => ({
	fetch: deps.fetch ?? globalThis.fetch,
	io: deps.io ?? defaultIo,
	env: deps.env ?? process.env,
});

export const normalizeCollectorUrl = (url: string): string =>
	url.trim().replace(/\/+$/, "");

const adminHeaders = (adminToken: string): Record<string, string> => ({
	Authorization: `Bearer ${adminToken}`,
	Accept: "application/json",
});

/** Reads a JSON body without throwing on HTML/empty error pages. */
const readJson = async (r: Response): Promise<unknown> => {
	const text = await r.text().catch(() => "");
	if (!text) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
};

const errorMessageOf = (body: unknown): string | undefined => {
	if (body && typeof body === "object" && "error" in body) {
		const e = (body as { error?: unknown }).error;
		if (typeof e === "string" && e.trim()) return e;
	}
	return undefined;
};

/**
 * Turns a non-2xx collector response into a one-line diagnosis. The 401 vs
 * 404 distinction matters most: 401 means the token was rejected, while 404
 * is either an unknown project (JSON `{ error: "Project not found" }`) or an
 * unknown route (anything else — typically an older collector or a URL that
 * isn't an obs-unified collector at all).
 */
export const describeFailure = (input: {
	status: number;
	body: unknown;
	method: string;
	path: string;
	collectorUrl: string;
	projectId?: string;
}): string => {
	const { status, body, method, path, collectorUrl, projectId } = input;
	const message = errorMessageOf(body);
	const projectMissing = message?.toLowerCase().includes("project not found");

	if (status === 401 || status === 403) {
		return `unauthorized (HTTP ${status}): ${collectorUrl} rejected OBS_ADMIN_TOKEN${
			message ? ` — ${message}` : ""
		}`;
	}
	if (projectMissing && projectId !== undefined) {
		return `project "${projectId}" not found on ${collectorUrl} (HTTP ${status}); pass --project <id> or set OBS_PROJECT_ID to one of the ids from GET /internal/projects`;
	}
	if (status === 404) {
		return `route not found (HTTP 404): ${collectorUrl} does not serve ${method} ${path}; check that OBS_COLLECTOR_URL points at an obs-unified collector`;
	}
	return `HTTP ${status} from ${method} ${path}${message ? `: ${message}` : ""}`;
};

const describeNetworkError = (collectorUrl: string, err: unknown) =>
	`could not reach ${collectorUrl}: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`;

// ── keys ──────────────────────────────────────────────────────────────────

export interface KeysArgs {
	action: "mint" | "list";
	project?: string;
	name?: string;
	json: boolean;
}

export function parseKeysArgs(args: string[]): KeysArgs {
	let action: KeysArgs["action"] | undefined;
	let project: string | undefined;
	let name: string | undefined;
	let json = false;

	const takeValue = (flag: string, inline: string | undefined, i: number) => {
		if (inline !== undefined) return { value: inline, consumed: 0 };
		const next = args[i + 1];
		if (next === undefined || next.startsWith("-")) {
			throw new UsageError(`${flag} requires a value`);
		}
		return { value: next, consumed: 1 };
	};

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		const eq = arg.indexOf("=");
		const flag = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
		const inline =
			arg.startsWith("--") && eq > 0 ? arg.slice(eq + 1) : undefined;

		if (flag === "--project" || flag === "-p") {
			const { value, consumed } = takeValue("--project", inline, i);
			if (!value.trim()) throw new UsageError("--project requires a value");
			project = value.trim();
			i += consumed;
		} else if (flag === "--name" || flag === "-n") {
			const { value, consumed } = takeValue("--name", inline, i);
			name = value;
			i += consumed;
		} else if (flag === "--json") {
			json = true;
		} else if (arg.startsWith("-")) {
			throw new UsageError(`unknown keys option: ${arg}`);
		} else if (action === undefined) {
			if (arg !== "mint" && arg !== "list") {
				throw new UsageError(`unknown subcommand: keys ${arg}`);
			}
			action = arg;
		} else {
			throw new UsageError(`unexpected argument: ${arg}`);
		}
	}

	if (!action) throw new UsageError("missing subcommand: keys <mint|list>");
	if (name !== undefined && action !== "mint") {
		throw new UsageError("--name only applies to keys mint");
	}
	return { action, project, name, json };
}

interface ProjectResolution {
	projectId: string;
	source: "--project" | "OBS_PROJECT_ID" | "discovered";
}

/**
 * Picks the project a `keys` command targets. Explicit choices win; otherwise
 * ask the collector what exists rather than assuming an id.
 */
async function resolveProject(input: {
	explicit?: string;
	env: NodeJS.ProcessEnv;
	collectorUrl: string;
	adminToken: string;
	fetch: typeof fetch;
}): Promise<ProjectResolution> {
	if (input.explicit) return { projectId: input.explicit, source: "--project" };
	const fromEnv = input.env.OBS_PROJECT_ID?.trim();
	if (fromEnv) return { projectId: fromEnv, source: "OBS_PROJECT_ID" };

	const path = "/internal/projects";
	let r: Response;
	try {
		r = await input.fetch(`${input.collectorUrl}${path}`, {
			method: "GET",
			headers: adminHeaders(input.adminToken),
		});
	} catch (err) {
		throw new Error(describeNetworkError(input.collectorUrl, err));
	}
	const body = await readJson(r);
	if (!r.ok) {
		throw new Error(
			describeFailure({
				status: r.status,
				body,
				method: "GET",
				path,
				collectorUrl: input.collectorUrl,
			}),
		);
	}
	const projects = (body as { projects?: Project[] } | undefined)?.projects;
	if (!Array.isArray(projects)) {
		throw new Error(
			`unexpected response from GET ${path}: expected { projects: [...] }`,
		);
	}
	const byDefaultId = projects.find((p) => p.id === "default");
	if (byDefaultId) return { projectId: byDefaultId.id, source: "discovered" };
	if (projects.length === 1) {
		return { projectId: projects[0].id, source: "discovered" };
	}
	if (projects.length === 0) {
		throw new Error(
			`no projects exist on ${input.collectorUrl}; create one in the dashboard, then re-run with --project <id>`,
		);
	}
	const listing = projects.map((p) => `  ${p.id}\t${p.slug}\t${p.name}`);
	throw new Error(
		`${projects.length} projects exist on ${input.collectorUrl}; choose one with --project <id> or OBS_PROJECT_ID:\n${listing.join("\n")}`,
	);
}

export async function runKeys(
	args: string[],
	deps: CommandDeps = {},
): Promise<number> {
	const { fetch, io, env } = resolveDeps(deps);

	let parsed: KeysArgs;
	try {
		parsed = parseKeysArgs(args);
	} catch (err) {
		if (err instanceof UsageError) {
			io.err(kleur.red(err.message));
			io.err(KEYS_USAGE);
			return 1;
		}
		throw err;
	}

	const collectorUrl = normalizeCollectorUrl(
		env.OBS_COLLECTOR_URL || DEFAULT_COLLECTOR_URL,
	);
	const adminToken = env.OBS_ADMIN_TOKEN?.trim();
	if (!adminToken) {
		io.err(
			kleur.red(
				"OBS_ADMIN_TOKEN env var required (collector dashboard auth token)",
			),
		);
		return 1;
	}

	let project: ProjectResolution;
	try {
		project = await resolveProject({
			explicit: parsed.project,
			env,
			collectorUrl,
			adminToken,
			fetch,
		});
	} catch (err) {
		io.err(kleur.red(err instanceof Error ? err.message : String(err)));
		return 1;
	}

	const path = `/internal/projects/${encodeURIComponent(project.projectId)}/keys`;
	const method = parsed.action === "mint" ? "POST" : "GET";
	const init: RequestInit =
		parsed.action === "mint"
			? {
					method,
					headers: {
						...adminHeaders(adminToken),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ name: parsed.name ?? DEFAULT_KEY_NAME }),
				}
			: { method, headers: adminHeaders(adminToken) };

	let r: Response;
	try {
		r = await fetch(`${collectorUrl}${path}`, init);
	} catch (err) {
		io.err(kleur.red(describeNetworkError(collectorUrl, err)));
		return 1;
	}
	const body = await readJson(r);
	if (!r.ok) {
		io.err(
			kleur.red(
				`${parsed.action} failed: ${describeFailure({
					status: r.status,
					body,
					method,
					path,
					collectorUrl,
					projectId: project.projectId,
				})}`,
			),
		);
		return 1;
	}

	if (parsed.action === "mint") {
		const key = body as Partial<IngestKeyWithPlaintext> | undefined;
		if (!key || typeof key.key !== "string") {
			io.err(
				kleur.red(
					`unexpected response from POST ${path}: expected { key, id, keyPrefix, ... }`,
				),
			);
			return 1;
		}
		if (parsed.json) {
			io.out(JSON.stringify(body, null, 2));
			return 0;
		}
		io.out(
			`${kleur.green("✓")} minted ingest key ${key.id ?? "?"} (${key.name ?? parsed.name ?? DEFAULT_KEY_NAME}) for project ${project.projectId}`,
		);
		io.out(key.key);
		io.out(
			kleur.yellow(
				key.warning ??
					"This key will not be shown again. Store it somewhere safe.",
			),
		);
		return 0;
	}

	const keys = (body as { keys?: IngestKey[] } | undefined)?.keys;
	if (!Array.isArray(keys)) {
		io.err(
			kleur.red(
				`unexpected response from GET ${path}: expected { keys: [...] }`,
			),
		);
		return 1;
	}
	if (parsed.json) {
		io.out(JSON.stringify(body, null, 2));
		return 0;
	}
	if (keys.length === 0) {
		io.out(
			`no ingest keys for project ${project.projectId} on ${collectorUrl} (mint one with: obs-unified keys mint --project ${project.projectId})`,
		);
		return 0;
	}
	io.out(
		`project ${project.projectId} (${project.source}) — ${keys.length} key(s)`,
	);
	io.out(kleur.gray("id\tname\tprefix\tcreated\tstatus"));
	for (const k of keys) {
		const status = k.revokedAt
			? kleur.red(`revoked ${k.revokedAt}`)
			: kleur.green("active");
		io.out(`${k.id}\t${k.name}\t${k.keyPrefix}…\t${k.createdAt}\t${status}`);
	}
	return 0;
}

// ── doctor ────────────────────────────────────────────────────────────────

export interface DoctorArgs {
	url: string;
	origins: string[];
}

export function parseDoctorArgs(
	args: string[],
	env: NodeJS.ProcessEnv = process.env,
): DoctorArgs {
	let url = env.OBS_COLLECTOR_URL || DEFAULT_COLLECTOR_URL;
	// The default only covers the dashboard origin the all-in-one image allows;
	// demo flows pass their own (examples.md sends Astronomy Shop users here
	// with --origin http://localhost:8080).
	const defaultOrigins = (env.OBS_DOCTOR_ORIGINS ?? DEFAULT_DOCTOR_ORIGINS)
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
	// Origins given via --origin replace the defaults rather than extend them:
	// doctor must check exactly what the caller asked about, or leftover
	// defaults fail the run against collectors that only allow the caller's
	// origin.
	const flagOrigins = new Set<string>();

	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--origin") {
			const origin = args[i + 1];
			if (!origin) throw new UsageError(DOCTOR_USAGE);
			flagOrigins.add(origin);
			i += 1;
			continue;
		}
		if (arg.startsWith("--origin=")) {
			flagOrigins.add(arg.slice("--origin=".length));
			continue;
		}
		if (arg.startsWith("-")) {
			throw new UsageError(`unknown doctor option: ${arg}`);
		}
		url = arg;
	}

	return {
		url: normalizeCollectorUrl(url),
		origins: flagOrigins.size ? [...flagOrigins] : [...new Set(defaultOrigins)],
	};
}

const INGEST_REQUEST_HEADERS = [
	"content-type",
	"authorization",
	"x-project-id",
	"x-obs-interaction",
	"x-obs-session-id",
];

async function checkCorsPreflight(
	fetch: typeof globalThis.fetch,
	url: string,
	origin: string,
	path: string,
) {
	const r = await fetch(`${url}${path}`, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Method": "POST",
			"Access-Control-Request-Headers": INGEST_REQUEST_HEADERS.join(","),
		},
	});
	if (!r.ok) throw new Error(`HTTP ${r.status}`);

	const allowOrigin = r.headers.get("access-control-allow-origin");
	if (allowOrigin !== origin) {
		throw new Error(
			`expected Access-Control-Allow-Origin ${origin}, got ${allowOrigin ?? "none"}`,
		);
	}

	const allowedHeaders = new Set(
		(r.headers.get("access-control-allow-headers") ?? "")
			.split(",")
			.map((header) => header.trim().toLowerCase())
			.filter(Boolean),
	);
	const missing = INGEST_REQUEST_HEADERS.filter(
		(header) => !allowedHeaders.has(header),
	);
	if (missing.length > 0) {
		throw new Error(`missing allowed header(s): ${missing.join(", ")}`);
	}

	return "ok";
}

/**
 * Probes the dashboard read API through `GET /internal/projects` — the one
 * /internal route every host serves that needs no project header. Without a
 * token a 401 is the only healthy answer: a 200 means the internal API is
 * exposed without authentication and the check fails. With OBS_ADMIN_TOKEN
 * set the request is authenticated and must succeed.
 */
export async function checkDashboardReadApi(input: {
	fetch: typeof globalThis.fetch;
	url: string;
	adminToken?: string;
}): Promise<string> {
	const path = "/internal/projects";
	const headers: Record<string, string> = { Accept: "application/json" };
	if (input.adminToken) {
		headers.Authorization = `Bearer ${input.adminToken}`;
	}
	const r = await input.fetch(`${input.url}${path}`, {
		method: "GET",
		headers,
	});
	const body = await readJson(r);

	if (r.status === 404) {
		throw new Error(
			`HTTP 404 — GET ${path} not served; is ${input.url} an obs-unified collector?`,
		);
	}
	if (r.status === 401 || r.status === 403) {
		if (input.adminToken) {
			throw new Error(
				`HTTP ${r.status} — OBS_ADMIN_TOKEN rejected${
					errorMessageOf(body) ? ` (${errorMessageOf(body)})` : ""
				}`,
			);
		}
		return "auth required (expected; set OBS_ADMIN_TOKEN to verify a token)";
	}
	if (!r.ok) {
		const message = errorMessageOf(body);
		throw new Error(`HTTP ${r.status}${message ? ` — ${message}` : ""}`);
	}
	const projects = (body as { projects?: Project[] } | undefined)?.projects;
	const count = Array.isArray(projects)
		? `${projects.length} project(s)`
		: "ok";
	if (!input.adminToken) {
		throw new Error(
			`HTTP ${r.status} without credentials — ${input.url} exposes the internal API unauthenticated (${count}); set DASHBOARD_TOKEN on the collector`,
		);
	}
	return `ok (OBS_ADMIN_TOKEN accepted, ${count})`;
}

export async function runDoctor(
	args: string[],
	deps: CommandDeps = {},
): Promise<number> {
	const { fetch, io, env } = resolveDeps(deps);

	let parsed: DoctorArgs;
	try {
		parsed = parseDoctorArgs(args, env);
	} catch (err) {
		if (err instanceof UsageError) {
			io.err(kleur.red(err.message));
			if (err.message !== DOCTOR_USAGE) io.err(DOCTOR_USAGE);
			return 1;
		}
		throw err;
	}
	const { url, origins } = parsed;
	const adminToken = env.OBS_ADMIN_TOKEN?.trim() || undefined;

	io.out(`Checking ${url}…`);
	io.out(`CORS origins: ${origins.join(", ")}\n`);
	const checks: Array<[string, () => Promise<string>]> = [
		[
			"health endpoint",
			async () => {
				const r = await fetch(`${url}/health`);
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return "ok";
			},
		],
		[
			"OTLP traces endpoint",
			async () => {
				const r = await fetch(`${url}/v1/traces`, {
					method: "OPTIONS",
					headers: {
						Origin: origins[0],
						"Access-Control-Request-Method": "POST",
						"Access-Control-Request-Headers": INGEST_REQUEST_HEADERS.join(","),
					},
				});
				if (r.status >= 500) throw new Error(`HTTP ${r.status}`);
				return "reachable";
			},
		],
		[
			"browser ingest CORS",
			async () => {
				for (const origin of origins) {
					const result = await checkCorsPreflight(
						fetch,
						url,
						origin,
						"/v1/usage",
					);
					if (result !== "ok") return result;
				}
				return "interaction/session headers allowed";
			},
		],
		[
			"dashboard read API (GET /internal/projects)",
			() => checkDashboardReadApi({ fetch, url, adminToken }),
		],
	];
	let failed = 0;
	for (const [name, check] of checks) {
		try {
			const result = await check();
			io.out(`  ${kleur.green("✓")} ${name} — ${result}`);
		} catch (err) {
			failed += 1;
			io.out(
				`  ${kleur.red("✗")} ${name} — ${err instanceof Error ? err.message : err}`,
			);
		}
	}
	io.out("");
	if (failed > 0) {
		io.out(kleur.red(`${failed} check(s) failed`));
		// If every check failed, the collector is almost certainly unreachable
		// (not running, wrong URL) rather than misconfigured — point the way out.
		if (failed === checks.length) {
			io.out(
				kleur.yellow(
					`\nCouldn't reach a collector at ${url}.\n` +
						`  • Is it running? Start one locally with: ${kleur.cyan("pnpm dev:collector")}\n` +
						`  • Or build and run the all-in-one image from a clone: ${kleur.cyan("pnpm local:image && pnpm local:run")}\n` +
						`  • Then re-run this check against ${url}.`,
				),
			);
		}
		return 1;
	}
	io.out(kleur.green("all clear"));
	return 0;
}
