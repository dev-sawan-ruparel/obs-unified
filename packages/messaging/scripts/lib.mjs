/*
 * Shared extraction helpers for the messaging manifest (RFC 0012).
 *
 * Facts are DERIVED FROM CODE wherever code is the authority, so the manifest
 * cannot silently disagree with what actually ships. Extraction is intentionally
 * defensive: if a source moves and an extractor returns nothing, we throw rather
 * than write an empty/partial manifest.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MESSAGING_DIR = resolve(__dirname, "..");
export const REPO_ROOT = resolve(MESSAGING_DIR, "../.."); // obs-unified repo root
export const WORKSPACE_ROOT = resolve(REPO_ROOT, ".."); // dir holding sibling repos
export const MANIFEST_PATH = join(MESSAGING_DIR, "manifest.json");

function read(rel) {
	const p = resolve(REPO_ROOT, rel);
	if (!existsSync(p))
		throw new Error(`messaging: expected source missing: ${rel}`);
	return readFileSync(p, "utf8");
}

function must(arr, label) {
	if (!Array.isArray(arr) || arr.length === 0) {
		throw new Error(
			`messaging: extractor "${label}" produced nothing — source shape changed?`,
		);
	}
	return arr;
}

/** All `z.enum([...])` string arrays found in a source file. */
function enumArrays(src) {
	const out = [];
	const re = /z\s*\.enum\(\s*\[([\s\S]*?)\]\s*\)/g;
	for (const m of src.matchAll(re)) {
		const items = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
		if (items.length) out.push(items);
	}
	return out;
}

/** MCP tool names, in registration order (authority: the server registration calls). */
export function extractMcpTools() {
	const src = read("packages/mcp-server/src/index.ts");
	const names = [...src.matchAll(/registerTool\(\s*["']([a-z0-9_]+)["']/g)].map(
		(m) => m[1],
	);
	return must([...new Set(names)], "mcpTools");
}

/** Connected-rail kinds (authority: the inline enum on the connected_signals tool). */
export function extractConnectedKinds() {
	const src = read("packages/mcp-server/src/index.ts");
	// The connected_signals enum is the one that contains usage + replay + analysis.
	const marker = ["usage", "replay", "analysis", "span"];
	const found = enumArrays(src).find((a) => marker.every((k) => a.includes(k)));
	if (!found)
		throw new Error(
			"messaging: could not locate the connected_signals kind enum",
		);
	return must(found, "connectedKinds");
}

/** Extract a JSON-Schema `required: [...]` block for a named schema const in a source file. */
function requiredFor(src, constName) {
	const idx = src.indexOf(constName);
	if (idx === -1)
		throw new Error(`messaging: schema const ${constName} not found`);
	const after = src.slice(idx);
	const m = after.match(/required:\s*\[([\s\S]*?)\]/);
	if (!m) throw new Error(`messaging: required[] not found for ${constName}`);
	return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}

/** EvidenceReference + EvidenceRetrievalRef field sets and retrieval kinds (authority: @obs-unified/types). */
export function extractEvidenceContract() {
	const src = read("packages/obs-types/src/types/evidence.ts");
	const evidenceReferenceFields = must(
		requiredFor(src, "EvidenceReferenceJsonSchema"),
		"evidenceReferenceFields",
	);
	const evidenceRetrievalRefFields = must(
		requiredFor(src, "EvidenceRetrievalRefJsonSchema"),
		"evidenceRetrievalRefFields",
	);
	// Retrieval kinds: the enum containing logs + trace + replay + profile.
	const kindMarker = ["logs", "trace", "replay", "profile"];
	const retrievalKinds = enumArrays(src).find((a) =>
		kindMarker.every((k) => a.includes(k)),
	);
	if (!retrievalKinds)
		throw new Error("messaging: EvidenceRetrievalKind enum not found");
	return {
		evidenceReferenceFields,
		evidenceRetrievalRefFields,
		evidenceRetrievalKinds: must(retrievalKinds, "evidenceRetrievalKinds"),
	};
}

/** Package identity: name + registry for every workspace + sdk package.json (authority: package.json). */
export function extractPackages() {
	const roots = [resolve(REPO_ROOT, "packages"), resolve(REPO_ROOT, "sdks")];
	const out = [];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root)) {
			const pj = join(root, entry, "package.json");
			if (!existsSync(pj) || !statSync(pj).isFile()) continue;
			let json;
			try {
				json = JSON.parse(readFileSync(pj, "utf8"));
			} catch {
				continue;
			}
			if (!json.name) continue;
			const registry =
				json.publishConfig?.registry ?? "https://registry.npmjs.org/";
			out.push({
				name: json.name,
				registry,
				scope: json.name.startsWith("@") ? json.name.split("/")[0] : null,
				dir: `${root.endsWith("packages") ? "packages" : "sdks"}/${entry}`,
				private: json.private === true,
			});
		}
	}
	return must(out, "packages").sort((a, b) => a.name.localeCompare(b.name));
}

export function deriveAll() {
	const evidence = extractEvidenceContract();
	return {
		mcpTools: extractMcpTools(),
		connectedKinds: extractConnectedKinds(),
		evidenceReferenceFields: evidence.evidenceReferenceFields,
		evidenceRetrievalRefFields: evidence.evidenceRetrievalRefFields,
		evidenceRetrievalKinds: evidence.evidenceRetrievalKinds,
		packages: extractPackages(),
	};
}

export function readManifest() {
	return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}
