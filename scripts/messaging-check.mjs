#!/usr/bin/env node
// messaging-check.mjs — RFC 0012 messaging parity check.
//
// Verifies that the presence website stays in sync with the canonical
// messaging manifest vendored at public/messaging.manifest.json.
//
// Plain Node ESM, zero dependencies. Exits 1 (with a clear ✗) on any failure.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const MANIFEST_PATH = "public/messaging.manifest.json";
const SITE_JSON_PATH = "src/content/site.json";
const GENERATED_TS_PATH = "src/content/messaging.generated.ts";
const LLMS_TXT_PATH = "public/llms.txt";

const failures = [];
const fail = (msg) => failures.push(msg);
const ok = (msg) => console.log(`  ✓ ${msg}`);

function read(rel) {
	return readFileSync(join(ROOT, rel), "utf8");
}

// Load + parse the canonical manifest.
let manifestRaw;
let manifest;
try {
	manifestRaw = read(MANIFEST_PATH);
	manifest = JSON.parse(manifestRaw);
} catch (err) {
	console.error(`✗ could not read/parse ${MANIFEST_PATH}: ${err.message}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------
// CHECK 1 — package scope: every @obs-unified / @obsunified token used by the
// website must be a real package name in manifest.derived.packages[].name.
// Catches scope typos like @obs-unified/mcp-server after the npm-scope rename.
// ---------------------------------------------------------------------------
console.log("CHECK 1 — package scope");
{
	const knownPackages = new Set(
		(manifest?.derived?.packages ?? []).map((p) => p.name),
	);
	const tokenRe = /@obs-?unified\/[a-z0-9-]+/g;

	// Collect files to scan: every file under src/** plus public/llms.txt.
	const filesToScan = [];
	const walk = (dir) => {
		for (const entry of readdirSync(join(ROOT, dir))) {
			const rel = join(dir, entry);
			if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
			else filesToScan.push(rel);
		}
	};
	walk("src");
	filesToScan.push(LLMS_TXT_PATH);

	const offenders = new Map(); // token -> Set(files)
	for (const file of filesToScan) {
		let content;
		try {
			content = read(file);
		} catch {
			continue;
		}
		for (const match of content.matchAll(tokenRe)) {
			const token = match[0];
			if (!knownPackages.has(token)) {
				if (!offenders.has(token)) offenders.set(token, new Set());
				offenders.get(token).add(file);
			}
		}
	}

	if (offenders.size === 0) {
		ok(
			`all package scope tokens across src/** and ${LLMS_TXT_PATH} are known (${knownPackages.size} packages)`,
		);
	} else {
		for (const [token, fileSet] of offenders) {
			fail(
				`unknown package token "${token}" (not in manifest.derived.packages) in: ${[...fileSet].join(", ")}`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// CHECK 2 — identity chain: site.json hero.identityChain must equal
// manifest.authored.identityChain exactly.
// ---------------------------------------------------------------------------
console.log("CHECK 2 — identity chain");
{
	const expected = manifest?.authored?.identityChain;
	let actual;
	try {
		actual = JSON.parse(read(SITE_JSON_PATH))?.hero?.identityChain;
	} catch (err) {
		fail(`could not read/parse ${SITE_JSON_PATH}: ${err.message}`);
	}
	if (actual === expected) {
		ok(`hero.identityChain matches manifest.authored.identityChain`);
	} else {
		fail(
			`identityChain mismatch:\n      manifest: ${JSON.stringify(expected)}\n      site.json: ${JSON.stringify(actual)}`,
		);
	}
}

// ---------------------------------------------------------------------------
// CHECK 3 — generated-in-sync: the generated TS module must embed the exact
// same manifest JSON as public/messaging.manifest.json.
// ---------------------------------------------------------------------------
console.log("CHECK 3 — generated module in sync");
{
	let generated;
	try {
		generated = read(GENERATED_TS_PATH);
	} catch (err) {
		fail(`could not read ${GENERATED_TS_PATH}: ${err.message}`);
		generated = "";
	}
	// The manifest file carries a trailing newline; the embedded object in the
	// generated module is immediately followed by ` as const;`. Compare on the
	// manifest body with trailing whitespace stripped.
	const manifestBody = manifestRaw.replace(/\s+$/, "");
	if (generated.includes(manifestBody)) {
		ok(`${GENERATED_TS_PATH} embeds the current manifest JSON verbatim`);
	} else {
		fail(
			`${GENERATED_TS_PATH} is out of sync with ${MANIFEST_PATH} — re-run the messaging sync to regenerate it`,
		);
	}
}

// ---------------------------------------------------------------------------
console.log("");
if (failures.length > 0) {
	for (const f of failures) console.error(`✗ ${f}`);
	console.error(`\n✗ messaging parity check FAILED (${failures.length} issue${failures.length === 1 ? "" : "s"})`);
	process.exit(1);
}
console.log("✓ messaging parity check passed (3/3 checks clean)");
process.exit(0);
