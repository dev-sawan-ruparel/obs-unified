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
 * subcommand boots the Node + Postgres + RustFS stack from
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
import { runChanges, runDoctor, runKeys } from "./collector-commands";
import {
	type ParsedCreateArgs,
	parseCreateArgs,
	SCAFFOLD_SDK_RANGES,
} from "./scaffold-versions";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.join(here, "..", "templates");

const PLACEHOLDER_INGEST_KEY = "dev-ingest-key";

const [, , subcommand, ...rest] = process.argv;

const usage = () => {
	console.log(`
${kleur.bold("obs-unified")} — observability that fits in one box

Usage: ${kleur.cyan("obs-unified")} <command> [options]

Commands:
  ${kleur.cyan("up")}                    Start the local stack (Postgres + RustFS + collector)
  ${kleur.cyan("down")}                  Stop the local stack
  ${kleur.cyan("create")} <app-name> [--template <react-vite|vanilla-ts|hono-workers>] [--collector-url <url>] [--ingest-key <key>] [--yes]
                        Scaffold a new app pre-wired with the SDKs (non-interactive when --template or --yes is passed)
  ${kleur.cyan("keys mint")} [--project <id>] [--name <label>] [--json]
                        Mint a new ingest key for a project
  ${kleur.cyan("keys list")} [--project <id>] [--json]
                        List a project's ingest keys
  ${kleur.cyan("keys revoke")} <keyId> [--project <id>] [--json]
                        Revoke an ingest key (auth is cached up to 60s)
  ${kleur.cyan("changes record")} [--service <name>] [--version <ver>] [--summary <text>] ...
                        Record a deploy, config change, feature-flag toggle, or rollback
  ${kleur.cyan("changes list")} [--environment <env>] [--service <name>] [--kind <kind>] [--limit <n>]
                        List recent change events from the collector
  ${kleur.cyan("doctor")} [url] [--origin <origin> ...]
                        Diagnose a running collector
  ${kleur.cyan("help")}                  Show this message
  ${kleur.cyan("--version")}             Print the CLI version

Project selection for ${kleur.cyan("keys")}: --project, then OBS_PROJECT_ID, then the
collector's "default" project (or its only project) via GET /internal/projects.

Environment: OBS_COLLECTOR_URL (default http://localhost:8790),
OBS_ADMIN_TOKEN (required for keys; optional for doctor), OBS_INGEST_KEY / OBS_API_KEY
(for changes record), OBS_API_TOKEN (for changes list), OBS_PROJECT_ID,
OBS_DOCTOR_ORIGINS. OBS_API_TOKEN, OBS_ADMIN_TOKEN and OBS_DASHBOARD_TOKEN are
interchangeable bearer tokens for every read/admin command (keys, changes list,
doctor); the first one set wins, in that order.
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
		const parsed = parseCreateArgs(rest);
		if (parsed.error) {
			console.error(kleur.red(parsed.error));
			process.exit(1);
		}
		if (!parsed.appName) {
			console.error(
				kleur.red(
					"usage: obs-unified create <app-name> [--template <react-vite|vanilla-ts|hono-workers>] [--collector-url <url>] [--ingest-key <key>] [--yes]",
				),
			);
			process.exit(1);
		}
		await scaffoldApp(parsed.appName, parsed);
		break;
	}

	case "keys": {
		process.exit(await runKeys(rest));
		break;
	}

	case "changes": {
		process.exit(await runChanges(rest));
		break;
	}

	case "doctor": {
		process.exit(await runDoctor(rest));
		break;
	}

	case "--version":
	case "-v":
	case "version": {
		const pkg = JSON.parse(
			await readFile(path.join(here, "..", "package.json"), "utf8"),
		) as { version: string };
		console.log(pkg.version);
		process.exit(0);
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

async function scaffoldApp(name: string, options: ParsedCreateArgs) {
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

	const defaultCollectorUrl =
		options.collectorUrl ??
		process.env.OBS_COLLECTOR_URL ??
		"http://localhost:8790";

	let selectedTemplate = options.template;
	let selectedCollectorUrl = options.collectorUrl;
	const ingestKey = options.ingestKey?.trim() || undefined;

	if (options.yes || !process.stdin.isTTY || selectedTemplate) {
		selectedTemplate = selectedTemplate ?? "react-vite";
		selectedCollectorUrl = selectedCollectorUrl ?? defaultCollectorUrl;
	} else {
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
				initial: defaultCollectorUrl,
			},
		]);
		selectedTemplate = response.template;
		selectedCollectorUrl = response.collectorUrl;
	}

	if (!selectedTemplate || !selectedCollectorUrl) {
		console.error(kleur.yellow("scaffold cancelled"));
		process.exit(1);
	}

	await mkdir(target, { recursive: true });
	const templateDir = path.join(TEMPLATES, selectedTemplate);
	if (existsSync(templateDir)) {
		await copyTemplate(templateDir, target, {
			__APP_NAME__: name,
			__COLLECTOR_URL__: selectedCollectorUrl,
			__INGEST_KEY__: ingestKey ?? PLACEHOLDER_INGEST_KEY,
		});
		const gitignore = path.join(target, ".gitignore");
		if (!existsSync(gitignore)) {
			await writeFile(
				gitignore,
				"node_modules\ndist\n.env.local\n.dev.vars\n.wrangler\n",
			);
		}
		if (selectedTemplate === "hono-workers" && ingestKey) {
			await writeFile(
				path.join(target, ".dev.vars"),
				`OBS_INGEST_KEY=${ingestKey}\n`,
			);
		}
		const envExample = path.join(target, ".env.example");
		const envLocal = path.join(target, ".env.local");
		if (existsSync(envExample) && !existsSync(envLocal)) {
			const envContent = await readFile(envExample, "utf8");
			await writeFile(envLocal, envContent);
		}
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
			`# ${name}\n\nScaffolded by \`obs-unified create\`. Collector: \`${selectedCollectorUrl}\`.\n`,
		);
	}

	console.log(`${kleur.green("✓")} created ${name}/`);
	printNextSteps(name, selectedTemplate, selectedCollectorUrl, ingestKey);
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

function printNextSteps(
	name: string,
	template: string,
	collectorUrl: string,
	ingestKey: string | undefined,
) {
	const steps = [`cd ${name}`, "pnpm install"];
	const notes: string[] = [];
	if (template === "hono-workers") {
		if (ingestKey) {
			notes.push("Ingest key written to .dev.vars (OBS_INGEST_KEY).");
		} else {
			steps.push(
				"cp .dev.vars.example .dev.vars   # then set OBS_INGEST_KEY=<your key>",
			);
		}
		steps.push("pnpm dev");
		notes.push(
			"Production: wrangler secret put OBS_INGEST_KEY",
			`Collector URL: OBS_COLLECTOR_URL=${collectorUrl} (wrangler.toml [vars])`,
		);
	} else {
		steps.push("pnpm dev");
		const vars =
			template === "react-vite"
				? "VITE_OBS_COLLECTOR_URL, VITE_OBS_INGEST_KEY, OBS_COLLECTOR_URL, OBS_INGEST_KEY"
				: "VITE_OBS_COLLECTOR_URL, VITE_OBS_INGEST_KEY";
		if (ingestKey) {
			notes.push(`Ingest key written to .env.local (${vars}).`);
		} else {
			notes.push(
				`No --ingest-key given: .env.local uses the placeholder "${PLACEHOLDER_INGEST_KEY}".`,
				`Set the real key in .env.local before running (${vars}); mint one with: obs-unified keys mint`,
			);
		}
	}
	notes.push("Dashboard: http://localhost:5173");
	console.log(
		`\nNext steps:\n  ${steps.join("\n  ")}\n\n${notes.map((n) => `  ${n}`).join("\n")}`,
	);
}
