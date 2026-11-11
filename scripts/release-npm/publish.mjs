#!/usr/bin/env node
// Publish the public @obsunified npm packages one at a time, with checks before
// and after each step. Entry points: `pnpm release` or
// `bash scripts/release-npm/publish-sequential.sh`.
//
//   node scripts/release-npm/publish.mjs --dry-run   # every check + pack, no publish
//   node scripts/release-npm/publish.mjs             # publish (interactive terminal)
//   node scripts/release-npm/publish.mjs --yes       # skip the confirmation prompt
//
// What it enforces (any failure exits non-zero):
//   1. Preflight: on `main`, tracked tree clean, no untracked files in package
//      dirs, HEAD equal to origin/main, no unversioned changesets, npm login,
//      an interactive TTY (npm's passkey 2FA needs one).
//   2. Plan: publish order is computed from each package's runtime
//      dependencies plus the SDK ranges the CLI writes into scaffolded apps, so
//      the SDKs always go out before the CLI. Pinned ranges must equal
//      `^<workspace version>`. A local version below the npm latest is refused.
//   3. Build and pack: `pnpm build:packages`, then `pnpm pack` per package. Each
//      tarball must have the expected name/version, no `workspace:` ranges,
//      internal ranges the local versions satisfy, and every main/module/
//      types/bin/exports target present.
//   4. Publish: the verified tarball itself is published, in order. The script
//      stops at the first failure and waits for each version to be visible on
//      the registry before publishing anything that depends on it.
//   5. Tags and verification: `changeset tag`, push only the tags for the
//      versions just published, then install every published version from the
//      registry in a scratch project and run the CLI's `--version`.
//
// Re-running is safe: versions already on the registry are skipped.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const SCOPE = "@obsunified/";
const PACKAGE_GLOBS = ["packages", "sdks/node"];
// Ranges a package writes into generated projects. The pinned packages must be
// on npm before the package that writes them.
const PIN_SOURCES = {
	"@obsunified/cli": {
		ts: ["packages/cli/src/scaffold-versions.ts"],
		templates: "packages/cli/templates",
	},
};
const VISIBILITY_TIMEOUT_MS = 180_000;

const args = new Set(process.argv.slice(2).filter((a) => a !== "--"));
for (const a of args) {
	if (!["--dry-run", "--yes", "-y", "--help", "-h"].includes(a)) {
		fail(`unknown option: ${a}`);
	}
}
if (args.has("--help") || args.has("-h")) {
	const src = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
	console.log(
		src
			.split("\n")
			.slice(1, 30)
			.map((l) => l.replace(/^\/\/ ?/, ""))
			.join("\n"),
	);
	process.exit(0);
}
const DRY_RUN = args.has("--dry-run");
const ASSUME_YES = args.has("--yes") || args.has("-y");

// ------------------------------------------------------------------ helpers
function bold(s) {
	console.log(`\x1b[1m${s}\x1b[0m`);
}
function ok(s) {
	console.log(`  \x1b[32m✓\x1b[0m ${s}`);
}
function warn(s) {
	console.log(`  \x1b[33m!\x1b[0m ${s}`);
}
function fail(s) {
	console.error(`\x1b[31mERROR:\x1b[0m ${s}`);
	process.exit(1);
}

function sh(cmd, argv, opts = {}) {
	const r = spawnSync(cmd, argv, {
		cwd: opts.cwd ?? ROOT,
		encoding: "utf8",
		stdio: opts.inherit ? "inherit" : "pipe",
	});
	if (r.error) throw r.error;
	return {
		code: r.status ?? 1,
		out: (r.stdout ?? "").trim(),
		err: (r.stderr ?? "").trim(),
	};
}
function must(cmd, argv, opts = {}) {
	const r = sh(cmd, argv, opts);
	if (r.code !== 0)
		fail(
			`${cmd} ${argv.join(" ")} failed (exit ${r.code})${r.err ? `\n${r.err}` : ""}`,
		);
	return r.out;
}

function parseVersion(v) {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(v);
	if (!m) return null;
	return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null };
}
function cmpVersion(a, b) {
	const x = parseVersion(a),
		y = parseVersion(b);
	for (const k of ["major", "minor", "patch"])
		if (x[k] !== y[k]) return x[k] - y[k];
	if (x.pre === y.pre) return 0;
	if (x.pre === null) return 1;
	if (y.pre === null) return -1;
	return x.pre < y.pre ? -1 : 1;
}
// Supports exact, ^ and ~ ranges, which are the only forms the workspace uses.
// Anything else is reported instead of guessed.
function satisfies(version, range) {
	const v = parseVersion(version);
	const m = /^([\^~]?)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(range);
	if (!v || !m) return null;
	const [, op, base] = m;
	const b = parseVersion(base);
	if (cmpVersion(version, base) < 0) return false;
	if (op === "") return cmpVersion(version, base) === 0;
	if (op === "~") return v.major === b.major && v.minor === b.minor;
	if (b.major > 0) return v.major === b.major;
	if (b.minor > 0) return v.major === 0 && v.minor === b.minor;
	return cmpVersion(version, base) === 0;
}

function npmVersions(name) {
	const r = sh("npm", ["view", name, "versions", "--json"]);
	if (r.code !== 0) {
		if (/E404|404 Not Found/.test(r.err + r.out)) return [];
		fail(`npm view ${name} failed:\n${r.err}`);
	}
	const parsed = JSON.parse(r.out || "[]");
	return Array.isArray(parsed) ? parsed : [parsed];
}
function npmHas(name, version) {
	const r = sh("npm", ["view", `${name}@${version}`, "version"]);
	return r.code === 0 && r.out.split("\n").includes(version);
}
async function waitVisible(name, version) {
	const deadline = Date.now() + VISIBILITY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (npmHas(name, version)) return true;
		await new Promise((res) => setTimeout(res, 5000));
	}
	return false;
}

// ------------------------------------------------------------------ discover
function discoverPackages() {
	const dirs = [];
	for (const g of PACKAGE_GLOBS) {
		const abs = path.join(ROOT, g);
		if (fs.existsSync(path.join(abs, "package.json"))) dirs.push(g);
		else if (fs.existsSync(abs)) {
			for (const d of fs.readdirSync(abs).sort()) {
				if (fs.existsSync(path.join(abs, d, "package.json")))
					dirs.push(path.join(g, d));
			}
		}
	}
	const pkgs = new Map();
	for (const dir of dirs) {
		const manifest = JSON.parse(
			fs.readFileSync(path.join(ROOT, dir, "package.json"), "utf8"),
		);
		if (manifest.private || !manifest.name?.startsWith(SCOPE)) continue;
		if (!parseVersion(manifest.version))
			fail(`${manifest.name}: unsupported version "${manifest.version}"`);
		pkgs.set(manifest.name, {
			name: manifest.name,
			version: manifest.version,
			dir,
			manifest,
		});
	}
	return pkgs;
}

function readPins(name) {
	const src = PIN_SOURCES[name];
	if (!src) return [];
	const pins = [];
	for (const f of src.ts ?? []) {
		const text = fs.readFileSync(path.join(ROOT, f), "utf8");
		for (const m of text.matchAll(/"(@obsunified\/[^"]+)"\s*:\s*"([^"]+)"/g))
			pins.push({ dep: m[1], range: m[2], where: f });
	}
	if (src.templates) {
		const base = path.join(ROOT, src.templates);
		for (const t of fs.readdirSync(base).sort()) {
			const pj = path.join(base, t, "package.json");
			if (!fs.existsSync(pj)) continue;
			const m = JSON.parse(fs.readFileSync(pj, "utf8"));
			for (const [dep, range] of Object.entries({
				...m.dependencies,
				...m.devDependencies,
			})) {
				if (dep.startsWith(SCOPE))
					pins.push({ dep, range, where: path.relative(ROOT, pj) });
			}
		}
	}
	return pins;
}

// Runtime edges only: dependencies, peer and optional dependencies, plus pins.
function buildPlan(pkgs, problems) {
	const edges = new Map();
	for (const p of pkgs.values()) {
		const deps = new Set();
		const m = p.manifest;
		for (const [dep, range] of Object.entries({
			...m.dependencies,
			...m.peerDependencies,
			...m.optionalDependencies,
		})) {
			if (!dep.startsWith(SCOPE)) continue;
			const target = pkgs.get(dep);
			if (!target) {
				problems.push(
					`${p.name} depends on ${dep}, which is not a public workspace package`,
				);
				continue;
			}
			deps.add(dep);
			if (!range.startsWith("workspace:")) {
				const s = satisfies(target.version, range);
				if (s === null)
					problems.push(`${p.name}: unsupported range ${dep}@"${range}"`);
				else if (!s)
					problems.push(
						`${p.name}: ${dep}@"${range}" is not satisfied by workspace ${target.version}`,
					);
			}
		}
		for (const pin of readPins(p.name)) {
			const target = pkgs.get(pin.dep);
			if (!target) {
				problems.push(`${pin.where}: pins unknown package ${pin.dep}`);
				continue;
			}
			deps.add(pin.dep);
			if (pin.range !== `^${target.version}`) {
				problems.push(
					`${pin.where}: ${pin.dep} is pinned to "${pin.range}", expected "^${target.version}" (bump the scaffold pins)`,
				);
			}
		}
		edges.set(p.name, deps);
	}
	// Kahn's algorithm with alphabetical tie-breaks for a stable order.
	const indeg = new Map([...pkgs.keys()].map((n) => [n, 0]));
	for (const [n, deps] of edges) indeg.set(n, deps.size);
	const ready = [...indeg]
		.filter(([, d]) => d === 0)
		.map(([n]) => n)
		.sort();
	const order = [];
	while (ready.length) {
		const n = ready.shift();
		order.push(n);
		for (const [m, deps] of edges) {
			if (deps.has(n)) {
				indeg.set(m, indeg.get(m) - 1);
				if (indeg.get(m) === 0) {
					ready.push(m);
					ready.sort();
				}
			}
		}
	}
	if (order.length !== pkgs.size) {
		fail(
			`dependency cycle among: ${[...pkgs.keys()].filter((n) => !order.includes(n)).join(", ")}`,
		);
	}
	return { order, edges };
}

// ------------------------------------------------------------------ tarballs
function collectTargets(manifest) {
	const out = new Set();
	const add = (v) => {
		if (typeof v === "string" && !v.includes("*"))
			out.add(v.replace(/^\.\//, ""));
	};
	for (const k of ["main", "module", "types", "typings"]) add(manifest[k]);
	if (typeof manifest.bin === "string") add(manifest.bin);
	else for (const v of Object.values(manifest.bin ?? {})) add(v);
	const walk = (node) => {
		if (typeof node === "string") add(node);
		else if (node && typeof node === "object")
			for (const v of Object.values(node)) walk(v);
	};
	walk(manifest.exports);
	return [...out];
}

function packAndVerify(pkg, pkgs, outDir) {
	const before = new Set(fs.readdirSync(outDir));
	must("pnpm", ["pack", "--pack-destination", outDir], {
		cwd: path.join(ROOT, pkg.dir),
	});
	const created = fs
		.readdirSync(outDir)
		.filter((f) => !before.has(f) && f.endsWith(".tgz"));
	if (created.length !== 1)
		fail(
			`${pkg.name}: expected one tarball from pnpm pack, found ${created.length}`,
		);
	const tgz = path.join(outDir, created[0]);
	const entries = must("tar", ["-tzf", tgz])
		.split("\n")
		.map((e) => e.replace(/^package\//, ""));
	const packed = JSON.parse(
		must("tar", ["-xzOf", tgz, "package/package.json"]),
	);
	const issues = [];
	if (packed.name !== pkg.name || packed.version !== pkg.version) {
		issues.push(
			`tarball is ${packed.name}@${packed.version}, expected ${pkg.name}@${pkg.version}`,
		);
	}
	for (const field of [
		"dependencies",
		"peerDependencies",
		"optionalDependencies",
	]) {
		for (const [dep, range] of Object.entries(packed[field] ?? {})) {
			if (String(range).startsWith("workspace:"))
				issues.push(`${field}.${dep} still has "${range}"`);
			const target = pkgs.get(dep);
			if (target && satisfies(target.version, range) === false) {
				issues.push(
					`${field}.${dep}@"${range}" does not match workspace ${target.version}`,
				);
			}
		}
	}
	const fileSet = new Set(entries);
	for (const t of collectTargets(packed)) {
		if (!fileSet.has(t))
			issues.push(`missing ${t} (referenced by package.json)`);
	}
	// Real env files, npm credentials, and nested tarballs; templates may ship .env.example.
	const suspicious = entries.filter((e) =>
		/(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]+)?|\.npmrc|[^/]*\.tgz)$/.test(
			e,
		),
	);
	if (suspicious.length)
		issues.push(`unexpected files: ${suspicious.join(", ")}`);
	const kb = Math.round(fs.statSync(tgz).size / 1024);
	return { tgz, issues, files: entries.length, kb };
}

// ------------------------------------------------------------------ main
async function main() {
	process.chdir(ROOT);
	const problems = [];
	const check = (cond, msg) => {
		if (!cond) problems.push(msg);
		return cond;
	};

	bold("1. Preflight");
	const branch = must("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
	check(branch === "main", `on branch "${branch}"; publish from main`);
	check(
		must("git", ["status", "--porcelain", "--untracked-files=no"]) === "",
		"tracked files have uncommitted changes",
	);
	const pkgs = discoverPackages();
	const dirs = [...pkgs.values()].map((p) => p.dir);
	const untracked = must("git", [
		"ls-files",
		"--others",
		"--exclude-standard",
		"--",
		...dirs,
	]);
	check(
		untracked === "",
		`untracked files inside package dirs would be packed:\n    ${untracked.split("\n").join("\n    ")}`,
	);
	must("git", ["fetch", "-q", "origin", "main"]);
	const head = must("git", ["rev-parse", "HEAD"]);
	const remote = must("git", ["rev-parse", "origin/main"]);
	check(
		head === remote,
		`HEAD ${head.slice(0, 7)} is not origin/main ${remote.slice(0, 7)}; run git pull --ff-only`,
	);
	const pending = fs
		.readdirSync(path.join(ROOT, ".changeset"))
		.filter((f) => f.endsWith(".md") && f !== "README.md");
	check(
		pending.length === 0,
		`unversioned changesets: ${pending.join(", ")} (run pnpm version-packages in a PR first)`,
	);
	const registry = must("npm", ["config", "get", "registry"]).replace(
		/\/$/,
		"",
	);
	check(
		registry === "https://registry.npmjs.org",
		`npm registry is ${registry}, expected https://registry.npmjs.org`,
	);
	let npmUser = "";
	if (DRY_RUN) {
		warn("dry run: npm login and TTY are not required");
	} else {
		check(
			process.stdin.isTTY === true,
			"stdin is not a TTY; npm's passkey prompts need an interactive terminal",
		);
		const who = sh("npm", ["whoami"]);
		npmUser = who.code === 0 ? who.out : "";
		check(npmUser !== "", "not logged in to npm; run: npm login");
	}
	if (problems.length === 0)
		ok(
			`main @ ${head.slice(0, 7)}, clean, synced${npmUser ? `, npm user ${npmUser}` : ""}`,
		);

	bold("2. Plan");
	const { order, edges } = buildPlan(pkgs, problems);
	const plan = [];
	for (const name of order) {
		const p = pkgs.get(name);
		const versions = npmVersions(name);
		const latest = versions.length
			? versions.reduce((a, b) => (cmpVersion(a, b) >= 0 ? a : b))
			: null;
		const published = versions.includes(p.version);
		if (!published && latest && cmpVersion(p.version, latest) < 0) {
			problems.push(`${name}: local ${p.version} is below npm ${latest}`);
		}
		plan.push({ ...p, latest, published });
		const after = [...edges.get(name)]
			.map((d) => d.slice(SCOPE.length))
			.join(", ");
		console.log(
			`  ${published ? "skip   " : "publish"} ${name.padEnd(30)} ${String(latest ?? "-").padStart(7)} -> ${p.version.padEnd(7)}${after ? `  after ${after}` : ""}`,
		);
	}
	const todo = plan.filter((p) => !p.published);

	if (problems.length) {
		bold("Blocked");
		for (const p of problems) console.log(`  \x1b[31m✗\x1b[0m ${p}`);
		process.exit(1);
	}
	if (todo.length === 0) {
		ok("every package version is already on npm; nothing to publish");
		return;
	}

	bold("3. Build and pack");
	must("pnpm", ["build:packages"], { inherit: true });
	const dirty = must("git", ["status", "--porcelain", "--untracked-files=no"]);
	if (dirty)
		fail(
			`the build changed tracked files; commit or fix them first:\n${dirty}`,
		);
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "obs-npm-release-"));
	let packIssues = 0;
	for (const p of todo) {
		const r = packAndVerify(p, pkgs, outDir);
		p.tgz = r.tgz;
		if (r.issues.length) {
			packIssues += r.issues.length;
			console.log(`  \x1b[31m✗\x1b[0m ${p.name}@${p.version}`);
			for (const i of r.issues) console.log(`      ${i}`);
		} else ok(`${p.name}@${p.version}  ${r.files} files, ${r.kb} KB`);
	}
	if (packIssues)
		fail(`${packIssues} tarball problem(s); nothing was published`);

	if (DRY_RUN) {
		bold(
			`Dry run passed: ${todo.length} package(s) would be published. Tarballs: ${outDir}`,
		);
		return;
	}
	if (!ASSUME_YES) {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		const ans = await rl.question(
			`Publish ${todo.length} package(s) to npm as ${npmUser}? [y/N] `,
		);
		rl.close();
		if (!/^y(es)?$/i.test(ans.trim())) fail("aborted; nothing was published");
	}

	bold("4. Publish");
	const done = [];
	for (const p of todo) {
		// Re-check right before publishing: a previous partial run or someone else may have published it.
		if (npmHas(p.name, p.version)) {
			warn(`${p.name}@${p.version} appeared on npm; skipping`);
			done.push(p);
			continue;
		}
		console.log(
			`  == ${p.name}@${p.version} (approve the browser prompt if asked)`,
		);
		const r = sh("npm", ["publish", p.tgz, "--access", "public"], {
			inherit: true,
		});
		if (r.code !== 0) {
			fail(
				`publish failed for ${p.name}@${p.version}. Published so far: ${done.map((d) => `${d.name}@${d.version}`).join(", ") || "none"}. Fix the cause and re-run; published versions are skipped.`,
			);
		}
		if (!(await waitVisible(p.name, p.version))) {
			fail(
				`${p.name}@${p.version} is not visible on the registry after ${VISIBILITY_TIMEOUT_MS / 1000}s; stopping before its dependents. Re-run once it appears.`,
			);
		}
		ok(`${p.name}@${p.version} is on npm`);
		done.push(p);
	}

	bold("5. Tags");
	must("pnpm", ["exec", "changeset", "tag"], { inherit: true });
	const tags = done.map((p) => `${p.name}@${p.version}`);
	for (const t of tags) {
		if (sh("git", ["rev-parse", "-q", "--verify", `refs/tags/${t}`]).code !== 0)
			fail(`expected tag ${t} after changeset tag`);
	}
	must("git", ["push", "origin", ...tags.map((t) => `refs/tags/${t}`)], {
		inherit: true,
	});
	ok(`pushed ${tags.length} tag(s)`);

	bold("6. Verify from the registry");
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "obs-npm-verify-"));
	fs.writeFileSync(
		path.join(scratch, "package.json"),
		JSON.stringify({ name: "obs-npm-verify", private: true, version: "0.0.0" }),
	);
	const install = sh(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--prefer-online",
			...tags,
		],
		{ cwd: scratch, inherit: true },
	);
	if (install.code !== 0)
		fail(`clean install of the published versions failed in ${scratch}`);
	for (const p of done) {
		const installed = JSON.parse(
			fs.readFileSync(
				path.join(scratch, "node_modules", p.name, "package.json"),
				"utf8",
			),
		).version;
		if (installed !== p.version)
			fail(`${p.name}: installed ${installed}, expected ${p.version}`);
	}
	const cli = done.find((p) => p.name === "@obsunified/cli");
	if (cli) {
		const v = must(
			path.join(scratch, "node_modules", ".bin", "obs-unified"),
			["--version"],
			{ cwd: scratch },
		);
		if (!v.includes(cli.version))
			fail(`obs-unified --version printed "${v}", expected ${cli.version}`);
		ok(`obs-unified --version -> ${v}`);
	}
	ok(`clean install resolved ${done.length} published version(s)`);
	fs.rmSync(scratch, { recursive: true, force: true });
	fs.rmSync(outDir, { recursive: true, force: true });
	bold(`Done: published ${tags.join(", ")}`);
}

main().catch((e) => fail(e?.stack ?? String(e)));
