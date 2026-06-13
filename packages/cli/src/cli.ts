#!/usr/bin/env node
/**
 * obs-unified — command-line entry point.
 *
 * Subcommands:
 *   up        Bring up a local stack via docker compose.
 *   down      Tear down the local stack.
 *   create    Scaffold a new React + Hono app pre-wired with the SDKs.
 *   keys      Mint or revoke ingest keys against a running collector.
 *   doctor    Diagnose a running collector — check storage, auth, CORS.
 *
 * The CLI is host-agnostic — it does not assume Cloudflare. The `up`
 * subcommand boots the Node + Postgres + MinIO stack from
 * `apps/collector-node/docker-compose.yml`.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import kleur from "kleur";
import prompts from "prompts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(here, "..", "templates");

const [, , subcommand, ...rest] = process.argv;

const usage = () => {
	console.log(`
${kleur.bold("obs-unified")} — observability that fits in one box

Usage: ${kleur.cyan("obs-unified")} <command> [options]

Commands:
  ${kleur.cyan("up")}                    Start the local stack (Postgres + MinIO + collector)
  ${kleur.cyan("down")}                  Stop the local stack
  ${kleur.cyan("create")} <app-name>     Scaffold a new React + Hono app pre-wired with the SDKs
  ${kleur.cyan("keys mint")}             Mint a new ingest key
  ${kleur.cyan("keys list")}             List existing ingest keys
  ${kleur.cyan("doctor")} [url]          Diagnose a running collector
  ${kleur.cyan("help")}                  Show this message
`);
};

const run = (cmd: string, args: string[], cwd?: string): Promise<number> =>
	new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { cwd, stdio: "inherit" });
		p.on("error", reject);
		p.on("close", (code) => resolve(code ?? 1));
	});

switch (subcommand) {
	case "up": {
		const composeFile = findComposeFile(rest);
		if (!composeFile) {
			console.error(
				kleur.red("could not locate a collector docker compose file."),
			);
			console.error(
				"Run from the obs-unified repo root, or pass --compose-file <path>.",
			);
			process.exit(1);
		}
		const code = await run("docker", [
			"compose",
			"-f",
			composeFile,
			"up",
			"-d",
		]);
		if (code === 0) {
			console.log(
				`${kleur.green("✓")} collector stack up at http://localhost:8790`,
			);
			console.log(
				"  In this repo, run `pnpm dev:web` for the dashboard at http://localhost:5173.",
			);
		}
		process.exit(code);
		break;
	}

	case "down": {
		const composeFile = findComposeFile(rest);
		if (!composeFile) {
			console.error(
				kleur.red(
					"could not locate a collector docker compose file. Run from the repo root, or pass --compose-file <path>.",
				),
			);
			process.exit(1);
		}
		process.exit(await run("docker", ["compose", "-f", composeFile, "down"]));
		break;
	}

	case "create": {
		const appName = rest[0];
		if (!appName) {
			console.error(kleur.red("usage: obs-unified create <app-name>"));
			process.exit(1);
		}
		await scaffoldApp(appName);
		break;
	}

	case "keys": {
		await keysSubcommand(rest);
		break;
	}

	case "doctor": {
		await runDoctor(rest);
		break;
	}

	case undefined:
	case "help":
	case "--help":
	case "-h":
		usage();
		process.exit(0);
		break;

	default:
		console.error(kleur.red(`unknown command: ${subcommand}`));
		usage();
		process.exit(1);
}

function findComposeFile(args: string[] = []): string | null {
	const explicit = parseComposeFileArg(args);
	if (explicit) return explicit;

	const candidates = [
		"apps/collector-node/docker-compose.yml",
		"docker-compose.yml",
		"compose.yml",
	];
	for (const c of candidates) {
		if (existsSync(c)) return c;
	}
	return null;
}

function parseComposeFileArg(args: string[]): string | null {
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (arg === "--compose-file" || arg === "-f") {
			const file = args[i + 1];
			if (!file) {
				console.error(
					kleur.red(`usage: obs-unified ${subcommand} --compose-file <path>`),
				);
				process.exit(1);
			}
			return file;
		}
		if (arg.startsWith("--compose-file=")) {
			return arg.slice("--compose-file=".length);
		}
		if (arg.startsWith("-")) {
			console.error(kleur.red(`unknown ${subcommand} option: ${arg}`));
			process.exit(1);
		}
	}
	return null;
}

async function scaffoldApp(name: string) {
	const target = path.resolve(name);
	const cwd = process.cwd();
	const relativeTarget = path.relative(cwd, target);
	if (
		!name.trim() ||
		path.isAbsolute(name) ||
		relativeTarget.startsWith("..") ||
		path.basename(name) !== name
	) {
		console.error(kleur.red("app name must be a single directory name"));
		process.exit(1);
	}
	if (existsSync(target)) {
		console.error(kleur.red(`directory ${name} already exists`));
		process.exit(1);
	}

	const response = await prompts([
		{
			type: "select",
			name: "template",
			message: "Template",
			choices: [
				{ title: "React + Vite + Hono on Node.js", value: "react-vite" },
				{ title: "Vanilla TypeScript frontend", value: "vanilla-ts" },
				{ title: "Hono on Cloudflare Workers API", value: "hono-workers" },
			],
		},
		{
			type: "text",
			name: "collectorUrl",
			message: "Default collector URL",
			initial: "http://localhost:8790",
		},
	]);
	if (!response.template || !response.collectorUrl) {
		console.error(kleur.yellow("scaffold cancelled"));
		process.exit(1);
	}

	await mkdir(target, { recursive: true });
	const templateDir = path.join(TEMPLATES, response.template);
	if (existsSync(templateDir)) {
		await copyTemplate(templateDir, target, {
			__APP_NAME__: name,
			__COLLECTOR_URL__: response.collectorUrl,
		});
	} else {
		// Minimal inline template if the directory hasn't been populated
		// yet — keeps the CLI usable while real templates ship.
		await writeFile(
			path.join(target, "package.json"),
			JSON.stringify(
				{
					name,
					private: true,
					type: "module",
					scripts: { dev: "vite", build: "vite build" },
					dependencies: {
						"@obsunified/analytics-sdk": "^1.0.0",
						"@obsunified/telemetry-sdk": "^1.0.0",
						react: "^19.0.0",
						"react-dom": "^19.0.0",
					},
				},
				null,
				2,
			),
		);
		await writeFile(
			path.join(target, "README.md"),
			`# ${name}\n\nScaffolded by \`obs-unified create\`. Collector: \`${response.collectorUrl}\`.\n`,
		);
	}

	console.log(`${kleur.green("✓")} created ${name}/`);
	console.log(`\nNext steps:\n  cd ${name}\n  pnpm install\n  pnpm dev`);
}

async function copyTemplate(
	src: string,
	dst: string,
	replacements: Record<string, string>,
) {
	const { readdir, stat } = await import("node:fs/promises");
	const entries = await readdir(src, { withFileTypes: true });
	await mkdir(dst, { recursive: true });
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name);
		const dstPath = path.join(dst, entry.name);
		if (entry.isDirectory()) {
			await copyTemplate(srcPath, dstPath, replacements);
		} else {
			const content = await readFile(srcPath, "utf8");
			let out = content;
			for (const [k, v] of Object.entries(replacements)) {
				out = out.split(k).join(v);
			}
			await writeFile(dstPath, out);
		}
	}
	void stat;
}

async function keysSubcommand(args: string[]) {
	const [action] = args;
	const collectorUrl = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
	const adminToken = process.env.OBS_ADMIN_TOKEN;
	if (!adminToken) {
		console.error(
			kleur.red(
				"OBS_ADMIN_TOKEN env var required (collector dashboard auth token)",
			),
		);
		process.exit(1);
	}
	switch (action) {
		case "mint": {
			const r = await fetch(`${collectorUrl}/internal/keys/mint`, {
				method: "POST",
				headers: { Authorization: `Bearer ${adminToken}` },
			});
			if (!r.ok) {
				console.error(kleur.red(`mint failed: ${r.status}`));
				process.exit(1);
			}
			const body = (await r.json()) as { key: string };
			console.log(`${kleur.green("✓")} minted:`);
			console.log(body.key);
			break;
		}
		case "list": {
			const r = await fetch(`${collectorUrl}/internal/keys`, {
				headers: { Authorization: `Bearer ${adminToken}` },
			});
			if (!r.ok) {
				console.error(kleur.red(`list failed: ${r.status}`));
				process.exit(1);
			}
			const body = (await r.json()) as {
				keys: Array<{
					id: string;
					created_at: string;
					last_used: string | null;
				}>;
			};
			for (const k of body.keys) {
				console.log(
					`${k.id}\t${k.created_at}\t${k.last_used ?? kleur.gray("never used")}`,
				);
			}
			break;
		}
		default:
			console.error(kleur.red(`unknown subcommand: keys ${action ?? ""}`));
			process.exit(1);
	}
}

async function runDoctor(args: string[]) {
	const { url, origins } = parseDoctorArgs(args);
	console.log(`Checking ${url}…`);
	console.log(`CORS origins: ${origins.join(", ")}\n`);
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
						"Access-Control-Request-Headers":
							"content-type,authorization,x-project-id,x-obs-interaction,x-obs-session-id",
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
					const result = await checkCorsPreflight(url, origin, "/v1/usage");
					if (result !== "ok") return result;
				}
				return "interaction/session headers allowed";
			},
		],
		[
			"dashboard read API",
			async () => {
				const r = await fetch(`${url}/internal/spans?limit=1`);
				if (r.status === 401) return "auth required (expected)";
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return "ok";
			},
		],
	];
	let failed = 0;
	for (const [name, check] of checks) {
		try {
			const result = await check();
			console.log(`  ${kleur.green("✓")} ${name} — ${result}`);
		} catch (err) {
			failed += 1;
			console.log(
				`  ${kleur.red("✗")} ${name} — ${err instanceof Error ? err.message : err}`,
			);
		}
	}
	console.log();
	if (failed > 0) {
		console.log(kleur.red(`${failed} check(s) failed`));
		// If every check failed, the collector is almost certainly unreachable
		// (not running, wrong URL) rather than misconfigured — point the way out.
		if (failed === checks.length) {
			console.log(
				kleur.yellow(
					`\nCouldn't reach a collector at ${url}.\n` +
						`  • Is it running? Start one locally with: ${kleur.cyan("pnpm dev:collector")}\n` +
						`  • Or boot the all-in-one image: ${kleur.cyan("docker run --rm -p 5173:5173 -p 8790:8790 ghcr.io/obs-unified/local:latest")}\n` +
						`  • Then re-run this check against ${url}.`,
				),
			);
		}
		process.exit(1);
	}
	console.log(kleur.green("all clear"));
}

function parseDoctorArgs(args: string[]) {
	let url = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
	// The default only covers the dashboard origin the all-in-one image allows;
	// demo flows pass their own (examples.md sends Astronomy Shop users here
	// with --origin http://localhost:8080).
	const defaultOrigins = (
		process.env.OBS_DOCTOR_ORIGINS ?? "http://localhost:5173"
	)
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
			if (!origin) {
				console.error(
					kleur.red("usage: obs-unified doctor [url] [--origin <origin> ...]"),
				);
				process.exit(1);
			}
			flagOrigins.add(origin);
			i += 1;
			continue;
		}
		if (arg.startsWith("--origin=")) {
			flagOrigins.add(arg.slice("--origin=".length));
			continue;
		}
		if (arg.startsWith("-")) {
			console.error(kleur.red(`unknown doctor option: ${arg}`));
			process.exit(1);
		}
		url = arg;
	}

	return {
		url,
		origins: flagOrigins.size ? [...flagOrigins] : [...new Set(defaultOrigins)],
	};
}

async function checkCorsPreflight(url: string, origin: string, path: string) {
	const requestedHeaders = [
		"content-type",
		"authorization",
		"x-project-id",
		"x-obs-interaction",
		"x-obs-session-id",
	];
	const r = await fetch(`${url}${path}`, {
		method: "OPTIONS",
		headers: {
			Origin: origin,
			"Access-Control-Request-Method": "POST",
			"Access-Control-Request-Headers": requestedHeaders.join(","),
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
	const missing = requestedHeaders.filter(
		(header) => !allowedHeaders.has(header),
	);
	if (missing.length > 0) {
		throw new Error(`missing allowed header(s): ${missing.join(", ")}`);
	}

	return "ok";
}
