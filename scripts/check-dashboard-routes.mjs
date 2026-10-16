#!/usr/bin/env node
/**
 * CI / verification guard for RFC-0014 Workstream 1:
 * Enforces that dashboard hash links (`#/...`) are constructed exclusively
 * inside `packages/obs-types/src/routes.ts` and that raw `#/` strings or
 * ad-hoc `client.dashboardLink("/#/...")` calls do not regress in non-test
 * TypeScript/TSX source files.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SCAN_ROOTS = [
	"packages/obs-types/src",
	"packages/dashboard/src",
	"apps/web/src",
	"packages/obs-collector/src",
	"packages/mcp-server/src",
];

// Canonical files allowed to contain `#/` hash prefix literals:
const CANONICAL_ALLOWED_FILES = new Set(["packages/obs-types/src/routes.ts"]);

function isTestFile(relPath) {
	return (
		relPath.includes("/__tests__/") ||
		relPath.endsWith(".test.ts") ||
		relPath.endsWith(".test.tsx") ||
		relPath.endsWith(".spec.ts") ||
		relPath.endsWith(".spec.tsx")
	);
}

function walkTsFiles(dirAbs, out = []) {
	let entries;
	try {
		entries = readdirSync(dirAbs);
	} catch {
		return out;
	}
	for (const name of entries) {
		const full = path.join(dirAbs, name);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			walkTsFiles(full, out);
		} else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
			out.push(full);
		}
	}
	return out;
}

/**
 * Strip single-line and block comments so doc comments mentioning `#/traces/...`
 * do not trigger false positives while string/template literals still match.
 */
function stripComments(source) {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
		.replace(/\/\/.*$/gm, "");
}

const RAW_HASH_ROUTE_RE = /[`'"]\/?#\/[A-Za-z0-9_$-]/g;
const RAW_DASHBOARD_LINK_RE = /client\.dashboardLink\(\s*[`'"]\/?#\//g;

const violations = [];

for (const rootRel of SCAN_ROOTS) {
	const rootAbs = path.join(repoRoot, rootRel);
	const files = walkTsFiles(rootAbs);
	for (const fileAbs of files) {
		const relPath = path.relative(repoRoot, fileAbs).split(path.sep).join("/");
		if (isTestFile(relPath)) continue;
		if (CANONICAL_ALLOWED_FILES.has(relPath)) continue;

		const raw = readFileSync(fileAbs, "utf8");
		const code = stripComments(raw);
		const lines = code.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (RAW_HASH_ROUTE_RE.test(line) || RAW_DASHBOARD_LINK_RE.test(line)) {
				violations.push({
					file: relPath,
					line: i + 1,
					text: raw.split("\n")[i].trim(),
				});
			}
			RAW_HASH_ROUTE_RE.lastIndex = 0;
			RAW_DASHBOARD_LINK_RE.lastIndex = 0;
		}
	}
}

if (violations.length > 0) {
	console.error(
		`[check-dashboard-routes] Found ${violations.length} raw dashboard hash route construction(s) outside packages/obs-types/src/routes.ts:`,
	);
	for (const v of violations) {
		console.error(`  - ${v.file}:${v.line}: ${v.text}`);
	}
	process.exit(1);
}

console.log(
	"[check-dashboard-routes] OK — no raw `#/` route strings found in enforced non-test sources.",
);
