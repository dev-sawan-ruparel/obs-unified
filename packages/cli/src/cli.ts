#!/usr/bin/env node
/**
 * obs-unified — command-line entry point.
 *
 * Subcommands:
 *   up        Bring up a local stack via docker compose.
 *   down      Tear down the local stack.
 *   create    Scaffold a new React + Hono app pre-wired with the SDKs.
 *   keys      Mint or list ingest keys for a project on a running collector.
 *   doctor    Diagnose a running collector — health, CORS, dashboard read API.
 *
 * `keys` and `doctor` live in `collector-commands.ts` so their HTTP contract
 * can be tested directly against a fake fetch.
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
import { runDoctor, runKeys } from "./collector-commands";
import { SCAFFOLD_SDK_RANGES } from "./scaffold-versions";

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
  ${kleur.cyan("keys mint")} [--project <id>] [--name <label>] [--json]
                        Mint a new ingest key for a project
  ${kleur.cyan("keys list")} [--project <id>] [--json]
                        List a project's ingest keys
  ${kleur.cyan("doctor")} [url] [--origin <origin> ...]
                        Diagnose a running collector
  ${kleur.cyan("help")}                  Show this message

Project selection for ${kleur.cyan("keys")}: --project, then OBS_PROJECT_ID, then the
collector's "default" project (or its only project) via GET /internal/projects.

Environment: OBS_COLLECTOR_URL (default http://localhost:8790),
OBS_ADMIN_TOKEN (required for keys; optional for doctor), OBS_PROJECT_ID,
OBS_DOCTOR_ORIGINS.
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
		process.exit(await runKeys(rest));
		break;
	}

	case "doctor": {
		process.exit(await runDoctor(rest));
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
						...SCAFFOLD_SDK_RANGES,
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
