#!/usr/bin/env node
// Type-checks fenced code blocks tagged `check` (```ts check / ```tsx check)
// in the SDK docs against the built SDK declarations.
// Blocks that cannot compile (pseudo-code, partial fragments) must NOT carry
// the `check` tag; add `nocheck <reason>` to the fence so the exclusion is explicit.
// Requires: pnpm --filter @obsunified/types --filter @obsunified/telemetry-sdk --filter @obsunified/analytics-sdk build
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const docsRoot = resolve(here, "..");
const pkgs = resolve(docsRoot, "../../packages");
const FILES = ["sdk-reference.mdx", "sdks.mdx"];
const FENCE = /^```(tsx?)\s+check\b[^\n]*\n([\s\S]*?)^```/gm;

const tmp = mkdtempSync(join(tmpdir(), "docs-snippets-"));
let count = 0;
for (const file of FILES) {
	const src = readFileSync(join(docsRoot, "content/docs", file), "utf8");
	for (const m of src.matchAll(FENCE)) {
		const line = src.slice(0, m.index).split("\n").length;
		const name = `${file.replace(".mdx", "")}-L${line}.${m[1]}`;
		writeFileSync(join(tmp, name), `${m[2]}\nexport {};\n`);
		count++;
	}
}
const require = createRequire(join(docsRoot, "package.json"));
const nodeTypes = dirname(require.resolve("@types/node/package.json"));
const reactTypes = dirname(require.resolve("@types/react/package.json"));
writeFileSync(
	join(tmp, "tsconfig.json"),
	JSON.stringify({
		compilerOptions: {
			target: "ES2022",
			module: "ESNext",
			moduleResolution: "Bundler",
			jsx: "react-jsx",
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			lib: ["ES2022", "DOM"],
			types: ["node"],
			typeRoots: [dirname(nodeTypes)],
			paths: {
				"@obsunified/telemetry-sdk": [`${pkgs}/telemetry-sdk/dist/index.d.ts`],
				"@obsunified/telemetry-sdk/cloudflare": [`${pkgs}/telemetry-sdk/dist/cloudflare.d.ts`],
				"@obsunified/analytics-sdk": [`${pkgs}/analytics-sdk/dist/index.d.ts`],
				"@obsunified/analytics-sdk/react": [`${pkgs}/analytics-sdk/dist/react/index.d.ts`],
				react: [`${reactTypes}/index.d.ts`],
				"react/jsx-runtime": [`${reactTypes}/jsx-runtime.d.ts`],
			},
		},
		include: ["*.ts", "*.tsx"],
	}),
);
mkdirSync(tmp, { recursive: true });
const tsc = require.resolve("typescript/bin/tsc");
const r = spawnSync(process.execPath, [tsc, "-p", join(tmp, "tsconfig.json")], { encoding: "utf8" });
process.stdout.write((r.stdout || "").replaceAll(`${tmp}/`, ""));
process.stderr.write(r.stderr || "");
rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) {
	console.error(`check:snippets failed (${count} snippets). Fix the docs or build the SDK packages first.`);
	process.exit(r.status ?? 1);
}
console.log(`check:snippets ok (${count} snippets)`);
