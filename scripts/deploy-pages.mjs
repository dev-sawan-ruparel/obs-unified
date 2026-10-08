#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cloudflare = JSON.parse(
	readFileSync(resolve(root, "config/cloudflare.json"), "utf8"),
);
const project = JSON.parse(
	readFileSync(resolve(root, "config/project.json"), "utf8"),
);
const targetName = process.argv[2];
const preview = process.argv.includes("--preview");
const target = cloudflare.pages[targetName];
if (!target) {
	console.error(
		"Usage: node scripts/deploy-pages.mjs <website|docs> [--preview]",
	);
	process.exit(1);
}

const app = resolve(root, target.directory);
const packageName = JSON.parse(
	readFileSync(resolve(app, "package.json"), "utf8"),
).name;
const env = {
	...process.env,
	CLOUDFLARE_ACCOUNT_ID:
		process.env.CLOUDFLARE_ACCOUNT_ID || cloudflare.accountId,
	GITHUB_REPO_LINK: process.env.GITHUB_REPO_LINK || project.GITHUB_REPO_LINK,
};

function run(args, cwd = root) {
	const result = spawnSync("pnpm", args, { cwd, env, stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["--filter", packageName, "types:check"]);
run(["--filter", packageName, "build"]);
run(
	[
		"dlx",
		"wrangler@4",
		"pages",
		"deploy",
		target.output,
		`--project-name=${target.project}`,
		`--branch=${preview ? "preview" : "main"}`,
		"--commit-dirty=true",
	],
	app,
);
