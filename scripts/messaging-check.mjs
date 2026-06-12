#!/usr/bin/env node
// Messaging parity check (RFC 0012).
//
// Reads the vendored ./messaging.manifest.json (single source of truth, copied
// verbatim from @obsunified/messaging) and asserts that the docs surfaces have
// not drifted from it. Plain Node ESM, no dependencies — runs on bare `node`.
//
// Exits 1 with `✗` messages on any drift, 0 with a success line when clean.

import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const docsRoot = join(repoRoot, "content", "docs");

const failures = [];
const fail = (msg) => failures.push(msg);

async function readText(path) {
	return readFile(path, "utf8");
}

async function walkMdx(dir) {
	const out = [];
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await walkMdx(full)));
		} else if (entry.isFile() && entry.name.endsWith(".mdx")) {
			out.push(full);
		}
	}
	return out;
}

const manifest = JSON.parse(
	await readText(join(repoRoot, "messaging.manifest.json")),
);
const derived = manifest.derived ?? {};

// ---------------------------------------------------------------------------
// CHECK 1 — MCP tool list (content/docs/mcp-server.mdx ## Tools section)
// ---------------------------------------------------------------------------
async function checkMcpTools() {
	const path = join(docsRoot, "mcp-server.mdx");
	const text = await readText(path);

	// Isolate the `## Tools` section: from its heading to the next `## ` heading.
	const headingRe = /^##\s+Tools\s*$/m;
	const headingMatch = headingRe.exec(text);
	if (!headingMatch) {
		fail("CHECK 1 (MCP tools): could not find a `## Tools` section in mcp-server.mdx");
		return;
	}
	const sectionStart = headingMatch.index + headingMatch[0].length;
	const rest = text.slice(sectionStart);
	const nextHeading = /^##\s+/m.exec(rest);
	const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;

	// Parse `- \`name\`` bullets (the name may be followed by " — description").
	const bulletRe = /^-\s+`([^`]+)`/gm;
	const docTools = new Set();
	for (let m = bulletRe.exec(section); m; m = bulletRe.exec(section)) {
		docTools.add(m[1].trim());
	}

	const expected = new Set(derived.mcpTools ?? []);

	const missing = [...expected].filter((t) => !docTools.has(t));
	const unknown = [...docTools].filter((t) => !expected.has(t));

	if (missing.length === 0 && unknown.length === 0) {
		console.log(`✓ CHECK 1 (MCP tools): ${expected.size} tools match mcp-server.mdx`);
		return;
	}
	if (missing.length) {
		fail(
			`CHECK 1 (MCP tools): missing from mcp-server.mdx ## Tools: ${missing.join(", ")}`,
		);
	}
	if (unknown.length) {
		fail(
			`CHECK 1 (MCP tools): unknown tools in mcp-server.mdx ## Tools (not in manifest): ${unknown.join(", ")}`,
		);
	}
}

// ---------------------------------------------------------------------------
// CHECK 2 — package scope references across all docs
// ---------------------------------------------------------------------------
async function checkPackageScopes() {
	const knownPackages = new Set((derived.packages ?? []).map((p) => p.name));
	const refRe = /@obs-?unified\/[a-z0-9-]+/g;

	const files = await walkMdx(docsRoot);
	const unknown = new Map(); // ref -> Set(files)

	for (const file of files) {
		const text = await readText(file);
		for (let m = refRe.exec(text); m; m = refRe.exec(text)) {
			const ref = m[0];
			if (!knownPackages.has(ref)) {
				if (!unknown.has(ref)) unknown.set(ref, new Set());
				unknown.get(ref).add(file.replace(`${repoRoot}/`, ""));
			}
		}
	}

	if (unknown.size === 0) {
		console.log(
			`✓ CHECK 2 (package scopes): all @obs-unified package refs in ${files.length} docs are known`,
		);
		return;
	}
	for (const [ref, fileSet] of unknown) {
		fail(
			`CHECK 2 (package scopes): unknown package ref \`${ref}\` (in ${[...fileSet].join(", ")})`,
		);
	}
}

// ---------------------------------------------------------------------------
// CHECK 3 — EvidenceReference fields (content/docs/evidence-reference.mdx)
// ---------------------------------------------------------------------------
async function checkEvidenceReferenceFields() {
	const path = join(docsRoot, "evidence-reference.mdx");
	const text = await readText(path);
	const fields = derived.evidenceReferenceFields ?? [];

	const missing = fields.filter((field) => {
		const wordRe = new RegExp(`\\b${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
		return !wordRe.test(text);
	});

	if (missing.length === 0) {
		console.log(
			`✓ CHECK 3 (evidence fields): all ${fields.length} EvidenceReference fields present in evidence-reference.mdx`,
		);
		return;
	}
	fail(
		`CHECK 3 (evidence fields): missing from evidence-reference.mdx: ${missing.join(", ")}`,
	);
}

// ---------------------------------------------------------------------------
// CHECK 4 — dev ingest key consistency (mcp-server.mdx config)
// ---------------------------------------------------------------------------
async function checkDevIngestKey() {
	const path = join(docsRoot, "mcp-server.mdx");
	const text = await readText(path);
	if (/OBS_INGEST_KEY"\s*:\s*"dev"/.test(text)) {
		fail(
			`CHECK 4 (dev ingest key): mcp-server.mdx uses ingest key "dev"; manifest devIngestKey is "${manifest.authored.devIngestKey}"`,
		);
	} else {
		console.log(`✓ CHECK 4 (dev ingest key): mcp-server.mdx does not use bare "dev" key`);
	}
}

// ---------------------------------------------------------------------------
// CHECK 5 — doctor CLI command unification
// ---------------------------------------------------------------------------
async function checkDoctorCommand() {
	const files = await walkMdx(docsRoot);
	const violations = [];

	for (const file of files) {
		const text = await readText(file);
		// Check for "obs-unified doctor" without "pnpm dlx @obsunified/cli" prefix
		if (/(?<!pnpm dlx @obs-unified\/cli\s+)obs-unified\s+doctor\b/.test(text)) {
			violations.push(file.replace(`${repoRoot}/`, ""));
		}
	}

	if (violations.length === 0) {
		console.log(`✓ CHECK 5 (doctor command): all doctor CLI references use unified pnpm dlx format`);
		return;
	}
	fail(
		`CHECK 5 (doctor command): files use deprecated "obs-unified doctor" format instead of "pnpm dlx @obsunified/cli doctor": ${violations.join(", ")}`,
	);
}

// ---------------------------------------------------------------------------
// CHECK 6 — shipped features docs page existence
// ---------------------------------------------------------------------------
async function checkShippedFeaturesInDocs() {
	const authored = manifest.authored ?? {};
	for (const f of authored.features ?? []) {
		if (f.status === "shipped" && f.surfacesWhenShipped?.includes("docs.page")) {
			// e.g. /docs/evidence-retrieval -> content/docs/evidence-retrieval.mdx
			const relativePath = f.docsSlug.replace(/^\/docs\//, "") + ".mdx";
			const fullPath = join(docsRoot, relativePath);
			try {
				await readFile(fullPath, "utf8");
				console.log(`✓ CHECK 6 (shipped feature docs): found page for "${f.id}" at ${relativePath}`);
			} catch (err) {
				fail(`CHECK 6 (shipped feature docs): feature "${f.id}" is shipped and requires "docs.page", but no doc exists at ${relativePath}`);
			}
		}
	}
}

await checkMcpTools();
await checkPackageScopes();
await checkEvidenceReferenceFields();
await checkDevIngestKey();
await checkDoctorCommand();
await checkShippedFeaturesInDocs();

if (failures.length > 0) {
	console.error("");
	for (const f of failures) console.error(`✗ ${f}`);
	console.error(`\n✗ messaging parity check failed with ${failures.length} issue(s).`);
	process.exit(1);
}

console.log("\n✓ messaging parity check passed — docs are in sync with messaging.manifest.json");
