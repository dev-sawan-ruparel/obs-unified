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

export const KEYS_USAGE = `usage: obs-unified keys <mint|list|revoke> [--project <id>] [--name <label>] [--json]
       obs-unified keys revoke <keyId> [--project <id>] [--json]

  mint    POST   /internal/projects/<id>/keys — mint a new ingest key
  list    GET    /internal/projects/<id>/keys — list a project's ingest keys
  revoke  DELETE /internal/projects/<id>/keys/<keyId> — revoke an ingest key
          (the collector caches ingest-key auth for up to 60 seconds, so a
          revoked key can keep working for up to a minute)

Project selection (first match wins):
  --project <id>     explicit project id
  OBS_PROJECT_ID     environment variable
  (discovery)        GET /internal/projects: the project with id "default",
                     or the only project when exactly one exists; otherwise
                     the CLI lists the available ids and asks for --project.

Environment:
  OBS_COLLECTOR_URL  collector base URL (default ${DEFAULT_COLLECTOR_URL})
  OBS_ADMIN_TOKEN    required; sent as "Authorization: Bearer <token>"
                     (OBS_API_TOKEN and OBS_DASHBOARD_TOKEN are also accepted)`;

export const DOCTOR_USAGE =
	"usage: obs-unified doctor [url] [--origin <origin> ...]";

export const DOCTOR_HELP = `${DOCTOR_USAGE}

Smoke-test a running collector: health, browser-ingest CORS, OTLP, and the
dashboard read API.

Environment:
  OBS_COLLECTOR_URL  collector base URL (default ${DEFAULT_COLLECTOR_URL})
  OBS_ADMIN_TOKEN    optional; bearer token for the dashboard read-API probe
                     (OBS_API_TOKEN and OBS_DASHBOARD_TOKEN are also accepted)
  OBS_DOCTOR_ORIGINS comma-separated CORS origins (default ${DEFAULT_DOCTOR_ORIGINS})`;

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

/** A credential plus the flag or env var that supplied it. */
export interface ResolvedCredential {
	value: string;
	/** e.g. "--token", "OBS_ADMIN_TOKEN" */
	source: string;
}

/** Env vars accepted for the collector bearer token, in precedence order. */
export const ADMIN_TOKEN_ENV_VARS = [
	"OBS_API_TOKEN",
	"OBS_ADMIN_TOKEN",
	"OBS_DASHBOARD_TOKEN",
] as const;

/** Env vars accepted for the ingest key, in precedence order. */
export const INGEST_KEY_ENV_VARS = ["OBS_INGEST_KEY", "OBS_API_KEY"] as const;

const resolveCredential = (
	flagName: string,
	flagValue: string | undefined,
	envNames: readonly string[],
	env: NodeJS.ProcessEnv,
): ResolvedCredential | undefined => {
	const fromFlag = flagValue?.trim();
	if (fromFlag) return { value: fromFlag, source: flagName };
	for (const name of envNames) {
		const value = env[name]?.trim();
		if (value) return { value, source: name };
	}
	return undefined;
};

/** Shared by `changes list`, `keys`, and `doctor`. */
export const resolveAdminToken = (
	env: NodeJS.ProcessEnv,
	flagValue?: string,
): ResolvedCredential | undefined =>
	resolveCredential("--token", flagValue, ADMIN_TOKEN_ENV_VARS, env);

/** Used by `changes record`. */
export const resolveIngestKey = (
	env: NodeJS.ProcessEnv,
	flagValue?: string,
): ResolvedCredential | undefined =>
	resolveCredential("--api-key", flagValue, INGEST_KEY_ENV_VARS, env);

/** Credentials passed as flags land in shell history; say so once. */
const warnIfFlagCredential = (
	io: CommandIo,
	cred: ResolvedCredential | undefined,
	envHint: string,
): void => {
	if (cred?.source.startsWith("--")) {
		io.err(
			kleur.yellow(
				`warning: ${cred.source} may be saved in your shell history; prefer ${envHint}`,
			),
		);
	}
};

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
	/** Flag or env var that supplied the rejected token. */
	tokenSource?: string;
}): string => {
	const { status, body, method, path, collectorUrl, projectId } = input;
	const tokenSource = input.tokenSource ?? "OBS_ADMIN_TOKEN";
	const message = errorMessageOf(body);
	const projectMissing = message?.toLowerCase().includes("project not found");

	if (status === 401 || status === 403) {
		return `unauthorized (HTTP ${status}): ${collectorUrl} rejected ${tokenSource}${
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
	action: "mint" | "list" | "revoke";
	keyId?: string;
	project?: string;
	name?: string;
	json: boolean;
}

export function parseKeysArgs(args: string[]): KeysArgs {
	let action: KeysArgs["action"] | undefined;
	let keyId: string | undefined;
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
			if (arg !== "mint" && arg !== "list" && arg !== "revoke") {
				throw new UsageError(`unknown subcommand: keys ${arg}`);
			}
			action = arg;
		} else if (action === "revoke" && keyId === undefined) {
			keyId = arg;
		} else {
			throw new UsageError(`unexpected argument: ${arg}`);
		}
	}

	if (!action) {
		throw new UsageError("missing subcommand: keys <mint|list|revoke>");
	}
	if (name !== undefined && action !== "mint") {
		throw new UsageError("--name only applies to keys mint");
	}
	if (action === "revoke" && !keyId) {
		throw new UsageError("keys revoke requires a <keyId> (see: keys list)");
	}
	return { action, keyId, project, name, json };
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
	tokenSource?: string;
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
				tokenSource: input.tokenSource,
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

	if (args.includes("--help") || args.includes("-h")) {
		io.out(KEYS_USAGE);
		return 0;
	}

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
	const credential = resolveAdminToken(env);
	if (!credential) {
		io.err(
			kleur.red(
				"OBS_ADMIN_TOKEN env var required (collector dashboard auth token; OBS_API_TOKEN and OBS_DASHBOARD_TOKEN are also accepted)",
			),
		);
		return 1;
	}
	const adminToken = credential.value;

	let project: ProjectResolution;
	try {
		project = await resolveProject({
			explicit: parsed.project,
			env,
			collectorUrl,
			adminToken,
			tokenSource: credential.source,
			fetch,
		});
	} catch (err) {
		io.err(kleur.red(err instanceof Error ? err.message : String(err)));
		return 1;
	}

	const keysPath = `/internal/projects/${encodeURIComponent(project.projectId)}/keys`;
	const path =
		parsed.action === "revoke"
			? `${keysPath}/${encodeURIComponent(parsed.keyId ?? "")}`
			: keysPath;
	const method =
		parsed.action === "mint"
			? "POST"
			: parsed.action === "revoke"
				? "DELETE"
				: "GET";
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
					tokenSource: credential.source,
				})}`,
			),
		);
		return 1;
	}

	if (parsed.action === "revoke") {
		if (parsed.json) {
			io.out(JSON.stringify(body ?? { ok: true }, null, 2));
			return 0;
		}
		io.out(
			`${kleur.green("✓")} revoked ingest key ${parsed.keyId} for project ${project.projectId}`,
		);
		io.out(
			kleur.yellow(
				"The collector caches ingest-key auth for up to 60 seconds; the key may keep working until then.",
			),
		);
		return 0;
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
	tokenSource?: string;
}): Promise<string> {
	const tokenSource = input.tokenSource ?? "OBS_ADMIN_TOKEN";
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
				`HTTP ${r.status} — ${tokenSource} rejected${
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
	return `ok (${tokenSource} accepted, ${count})`;
}

export async function runDoctor(
	args: string[],
	deps: CommandDeps = {},
): Promise<number> {
	const { fetch, io, env } = resolveDeps(deps);

	if (args.includes("--help") || args.includes("-h")) {
		io.out(DOCTOR_HELP);
		return 0;
	}

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
	const credential = resolveAdminToken(env);
	const adminToken = credential?.value;

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
			() =>
				checkDashboardReadApi({
					fetch,
					url,
					adminToken,
					tokenSource: credential?.source,
				}),
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

// ── changes ───────────────────────────────────────────────────────────────

export const CHANGES_USAGE = `usage:
  obs-unified changes record [--url <url>] [--api-key <key>] [--environment <env>] [--kind <kind>] [--service <name>] [--namespace <ns>] [--version <ver>] [--previous-version <ver>] [--commit-sha <sha>] [--previous-commit-sha <sha>] [--summary <text>] [--repo-url <url>] [--pr-url <url>] [--actor <id>] [--touched-paths <p1,p2,...>] [--json]
  obs-unified changes list [--url <url>] [--token <token>] [--environment <env>] [--service <name>] [--kind <kind>] [--limit <n>] [--json]

  record  POST /v1/changes       — record a deploy, config change, feature-flag toggle, or rollback
  list    GET  /internal/changes — list recent change events from the collector

Environment:
  OBS_COLLECTOR_URL              collector base URL (default ${DEFAULT_COLLECTOR_URL})
  OBS_INGEST_KEY / OBS_API_KEY   ingest key for 'changes record'
  OBS_API_TOKEN / OBS_ADMIN_TOKEN bearer token for 'changes list'`;

export interface ChangesRecordArgs {
	action: "record";
	url?: string;
	apiKey?: string;
	environment?: string;
	kind: string;
	service?: string;
	namespace?: string;
	targetNodeId?: string;
	version?: string;
	previousVersion?: string;
	commitSha?: string;
	previousCommitSha?: string;
	configDigest?: string;
	summary?: string;
	repoUrl?: string;
	prUrl?: string;
	actor?: string;
	touchedPaths?: string[];
	json: boolean;
}

export interface ChangesListArgs {
	action: "list";
	url?: string;
	token?: string;
	environment?: string;
	service?: string;
	targetNodeId?: string;
	kind?: string;
	since?: string;
	limit?: number;
	json: boolean;
}

export type ChangesArgs = ChangesRecordArgs | ChangesListArgs;

export function parseChangesArgs(args: string[]): ChangesArgs {
	let action: "record" | "list" | undefined;
	let url: string | undefined;
	let apiKey: string | undefined;
	let token: string | undefined;
	let environment: string | undefined;
	let kind: string | undefined;
	let service: string | undefined;
	let namespace: string | undefined;
	let targetNodeId: string | undefined;
	let version: string | undefined;
	let previousVersion: string | undefined;
	let commitSha: string | undefined;
	let previousCommitSha: string | undefined;
	let configDigest: string | undefined;
	let summary: string | undefined;
	let repoUrl: string | undefined;
	let prUrl: string | undefined;
	let actor: string | undefined;
	let touchedPaths: string[] | undefined;
	let since: string | undefined;
	let limit: number | undefined;
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

		if (flag === "--url") {
			const { value, consumed } = takeValue("--url", inline, i);
			if (!value.trim()) throw new UsageError("--url requires a value");
			url = value.trim();
			i += consumed;
		} else if (flag === "--api-key") {
			const { value, consumed } = takeValue("--api-key", inline, i);
			if (!value.trim()) throw new UsageError("--api-key requires a value");
			apiKey = value.trim();
			i += consumed;
		} else if (flag === "--token") {
			const { value, consumed } = takeValue("--token", inline, i);
			if (!value.trim()) throw new UsageError("--token requires a value");
			token = value.trim();
			i += consumed;
		} else if (flag === "--environment" || flag === "--env") {
			const { value, consumed } = takeValue("--environment", inline, i);
			if (!value.trim()) throw new UsageError("--environment requires a value");
			environment = value.trim();
			i += consumed;
		} else if (flag === "--kind") {
			const { value, consumed } = takeValue("--kind", inline, i);
			if (!value.trim()) throw new UsageError("--kind requires a value");
			kind = value.trim();
			i += consumed;
		} else if (flag === "--service" || flag === "--service-name") {
			const { value, consumed } = takeValue("--service", inline, i);
			if (!value.trim()) throw new UsageError("--service requires a value");
			service = value.trim();
			i += consumed;
		} else if (flag === "--namespace") {
			const { value, consumed } = takeValue("--namespace", inline, i);
			if (!value.trim()) throw new UsageError("--namespace requires a value");
			namespace = value.trim();
			i += consumed;
		} else if (flag === "--target-node-id") {
			const { value, consumed } = takeValue("--target-node-id", inline, i);
			if (!value.trim())
				throw new UsageError("--target-node-id requires a value");
			targetNodeId = value.trim();
			i += consumed;
		} else if (flag === "--version") {
			const { value, consumed } = takeValue("--version", inline, i);
			if (!value.trim()) throw new UsageError("--version requires a value");
			version = value.trim();
			i += consumed;
		} else if (flag === "--previous-version") {
			const { value, consumed } = takeValue("--previous-version", inline, i);
			if (!value.trim())
				throw new UsageError("--previous-version requires a value");
			previousVersion = value.trim();
			i += consumed;
		} else if (flag === "--commit-sha") {
			const { value, consumed } = takeValue("--commit-sha", inline, i);
			if (!value.trim()) throw new UsageError("--commit-sha requires a value");
			commitSha = value.trim();
			i += consumed;
		} else if (flag === "--previous-commit-sha") {
			const { value, consumed } = takeValue("--previous-commit-sha", inline, i);
			if (!value.trim())
				throw new UsageError("--previous-commit-sha requires a value");
			previousCommitSha = value.trim();
			i += consumed;
		} else if (flag === "--config-digest") {
			const { value, consumed } = takeValue("--config-digest", inline, i);
			if (!value.trim())
				throw new UsageError("--config-digest requires a value");
			configDigest = value.trim();
			i += consumed;
		} else if (flag === "--summary") {
			const { value, consumed } = takeValue("--summary", inline, i);
			if (!value.trim()) throw new UsageError("--summary requires a value");
			summary = value.trim();
			i += consumed;
		} else if (flag === "--repo-url") {
			const { value, consumed } = takeValue("--repo-url", inline, i);
			if (!value.trim()) throw new UsageError("--repo-url requires a value");
			repoUrl = value.trim();
			i += consumed;
		} else if (flag === "--pr-url") {
			const { value, consumed } = takeValue("--pr-url", inline, i);
			if (!value.trim()) throw new UsageError("--pr-url requires a value");
			prUrl = value.trim();
			i += consumed;
		} else if (flag === "--actor") {
			const { value, consumed } = takeValue("--actor", inline, i);
			if (!value.trim()) throw new UsageError("--actor requires a value");
			actor = value.trim();
			i += consumed;
		} else if (flag === "--touched-paths") {
			const { value, consumed } = takeValue("--touched-paths", inline, i);
			touchedPaths = value
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
			i += consumed;
		} else if (flag === "--since") {
			const { value, consumed } = takeValue("--since", inline, i);
			if (!value.trim()) throw new UsageError("--since requires a value");
			since = value.trim();
			i += consumed;
		} else if (flag === "--limit") {
			const { value, consumed } = takeValue("--limit", inline, i);
			const n = Number.parseInt(value, 10);
			if (!Number.isFinite(n) || n <= 0) {
				throw new UsageError("--limit must be a positive integer");
			}
			limit = n;
			i += consumed;
		} else if (flag === "--json") {
			json = true;
		} else if (arg.startsWith("-")) {
			throw new UsageError(`unknown changes option: ${arg}`);
		} else if (action === undefined) {
			if (arg !== "record" && arg !== "list") {
				throw new UsageError(`unknown subcommand: changes ${arg}`);
			}
			action = arg;
		} else {
			throw new UsageError(`unexpected argument: ${arg}`);
		}
	}

	if (!action)
		throw new UsageError("missing subcommand: changes <record|list>");

	if (action === "record") {
		return {
			action: "record",
			url,
			apiKey,
			environment,
			kind: kind ?? "deploy",
			service,
			namespace,
			targetNodeId,
			version,
			previousVersion,
			commitSha,
			previousCommitSha,
			configDigest,
			summary,
			repoUrl,
			prUrl,
			actor,
			touchedPaths,
			json,
		};
	}

	return {
		action: "list",
		url,
		token,
		environment,
		service,
		targetNodeId,
		kind,
		since,
		limit,
		json,
	};
}

export async function runChanges(
	args: string[],
	deps: CommandDeps = {},
): Promise<number> {
	const { fetch, io, env } = resolveDeps(deps);

	let parsed: ChangesArgs;
	try {
		parsed = parseChangesArgs(args);
	} catch (err) {
		if (err instanceof UsageError) {
			io.err(kleur.red(err.message));
			io.err(CHANGES_USAGE);
			return 1;
		}
		throw err;
	}

	const collectorUrl = normalizeCollectorUrl(
		parsed.url || env.OBS_COLLECTOR_URL || DEFAULT_COLLECTOR_URL,
	);

	if (parsed.action === "record") {
		const ingest = resolveIngestKey(env, parsed.apiKey);
		const apiKey = ingest?.value;
		if (!ingest || !apiKey) {
			io.err(
				kleur.red(
					"ingest key required for changes record (pass --api-key or set OBS_INGEST_KEY / OBS_API_KEY)",
				),
			);
			return 1;
		}
		warnIfFlagCredential(io, ingest, "OBS_INGEST_KEY");

		const summary =
			parsed.summary ??
			`${parsed.kind}${parsed.service ? ` ${parsed.service}` : ""}${parsed.version ? ` ${parsed.version}` : ""}`.trim();

		const payload: Record<string, unknown> = {
			kind: parsed.kind,
			summary,
		};
		if (parsed.environment !== undefined)
			payload.environment = parsed.environment;
		if (parsed.service !== undefined) payload.serviceName = parsed.service;
		if (parsed.namespace !== undefined) payload.namespace = parsed.namespace;
		if (parsed.targetNodeId !== undefined)
			payload.targetNodeId = parsed.targetNodeId;
		if (parsed.version !== undefined) payload.version = parsed.version;
		if (parsed.previousVersion !== undefined)
			payload.previousVersion = parsed.previousVersion;
		if (parsed.commitSha !== undefined) payload.commitSha = parsed.commitSha;
		if (parsed.previousCommitSha !== undefined)
			payload.previousCommitSha = parsed.previousCommitSha;
		if (parsed.configDigest !== undefined)
			payload.configDigest = parsed.configDigest;
		if (parsed.repoUrl !== undefined) payload.repositoryUrl = parsed.repoUrl;
		if (parsed.prUrl !== undefined) payload.pullRequestUrl = parsed.prUrl;
		if (parsed.actor !== undefined) payload.actorId = parsed.actor;
		if (parsed.touchedPaths !== undefined)
			payload.touchedPaths = parsed.touchedPaths;

		const path = "/v1/changes";
		let r: Response;
		try {
			r = await fetch(`${collectorUrl}${path}`, {
				method: "POST",
				headers: {
					// The ingest middleware accepts Bearer or X-API-Key; send it once.
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(payload),
			});
		} catch (err) {
			io.err(kleur.red(describeNetworkError(collectorUrl, err)));
			return 1;
		}

		const body = await readJson(r);
		if (!r.ok) {
			io.err(
				kleur.red(
					`changes record failed: ${describeFailure({
						status: r.status,
						body,
						method: "POST",
						path,
						collectorUrl,
						tokenSource: ingest.source,
					})}`,
				),
			);
			return 1;
		}

		if (parsed.json) {
			io.out(JSON.stringify(body, null, 2));
			return 0;
		}

		const rec =
			body && typeof body === "object" && "change" in body
				? (body as { change?: Record<string, unknown> }).change
				: (body as Record<string, unknown> | undefined);
		const changeId = typeof rec?.id === "string" ? rec.id : "ok";
		io.out(
			`${kleur.green("✓")} recorded change ${changeId} (${parsed.kind}${parsed.service ? ` ${parsed.service}` : ""}) — ${summary}`,
		);
		return 0;
	}

	const credential = resolveAdminToken(env, parsed.token);
	if (!credential) {
		io.err(
			kleur.red(
				"bearer token required for changes list (pass --token or set OBS_API_TOKEN / OBS_ADMIN_TOKEN)",
			),
		);
		return 1;
	}
	const token = credential.value;
	warnIfFlagCredential(io, credential, "OBS_API_TOKEN");

	const search = new URLSearchParams();
	if (parsed.environment) search.set("environment", parsed.environment);
	if (parsed.service) search.set("serviceName", parsed.service);
	if (parsed.targetNodeId) search.set("targetNodeId", parsed.targetNodeId);
	if (parsed.kind) search.set("kind", parsed.kind);
	if (parsed.since) search.set("since", parsed.since);
	if (parsed.limit !== undefined) search.set("limit", String(parsed.limit));

	const query = search.toString();
	const path = query ? `/internal/changes?${query}` : "/internal/changes";

	let r: Response;
	try {
		r = await fetch(`${collectorUrl}${path}`, {
			method: "GET",
			headers: adminHeaders(token),
		});
	} catch (err) {
		io.err(kleur.red(describeNetworkError(collectorUrl, err)));
		return 1;
	}

	const body = await readJson(r);
	if (!r.ok) {
		io.err(
			kleur.red(
				`changes list failed: ${describeFailure({
					status: r.status,
					body,
					method: "GET",
					path: "/internal/changes",
					collectorUrl,
					tokenSource: credential.source,
				})}`,
			),
		);
		return 1;
	}

	if (parsed.json) {
		io.out(JSON.stringify(body, null, 2));
		return 0;
	}

	const changes = Array.isArray(body)
		? body
		: (body as { changes?: Array<Record<string, unknown>> } | undefined)
				?.changes;
	if (!Array.isArray(changes)) {
		io.err(
			kleur.red(
				"unexpected response from GET /internal/changes: expected { changes: [...] }",
			),
		);
		return 1;
	}

	if (changes.length === 0) {
		io.out(`no changes found on ${collectorUrl}`);
		return 0;
	}

	io.out(
		kleur.gray("id\tkind\tenvironment\tservice\tversion\toccurredAt\tsummary"),
	);
	for (const c of changes) {
		io.out(
			`${c.id ?? "?"}\t${c.kind ?? "-"}\t${c.environment ?? "default"}\t${c.serviceName ?? c.targetNodeId ?? "-"}\t${c.version ?? "-"}\t${c.occurredAt ?? "-"}\t${c.summary ?? ""}`,
		);
	}
	return 0;
}
