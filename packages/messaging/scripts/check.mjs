#!/usr/bin/env node
/*
 * messaging:check — fail (exit 1) when a lead-repo surface disagrees with the
 * manifest. Run after `generate`. Satellite repos ship their own check against a
 * vendored copy of this manifest; this script governs the obs-unified repo.
 *
 * Checks:
 *   1. MCP tool-list parity — packages/mcp-server/README.md "## Tools" == derived tools.
 *   2. Package-scope integrity — every @obs[-]unified/<pkg> referenced in README /
 *      mcp-server README is a real package (catches scope/name typos like the
 *      @obs-unified/mcp-server → @obsunified/mcp-server rename).
 *   3. Feature gap — every feature.addsMcpTools ⊆ derived tools.
 *   4. Feature orphan — every shipped evidence tool is owned by a feature record.
 *   5. Dev ingest key — no bare "dev" ingest key (must be the manifest devIngestKey).
 *   6. Identity chain — README shows the chain components in order.
 *   7. Governance enums — docs/agent-action-graph.md documents every enum value.
 *   8. Feature status gate — a not-yet-shipped feature is not advertised as shipped.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT, readManifest } from "./lib.mjs";

const m = readManifest();
const tools = new Set(m.derived.mcpTools);
const pkgNames = new Set(m.derived.packages.map((p) => p.name));
const failures = [];
const fail = (msg) => failures.push(msg);
const read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");

// 1. MCP tool-list parity (mcp-server README)
{
	const src = read("packages/mcp-server/README.md");
	const block = src.split(/^## Tools$/m)[1]?.split(/^## /m)[0] ?? "";
	const listed = new Set(
		[...block.matchAll(/^- `([a-z0-9_]+)`/gm)].map((x) => x[1]),
	);
	for (const t of tools)
		if (!listed.has(t))
			fail(`mcp-server/README.md Tools list is MISSING \`${t}\``);
	for (const t of listed)
		if (!tools.has(t))
			fail(
				`mcp-server/README.md Tools list has UNKNOWN tool \`${t}\` (not in code)`,
			);
}

// 2. Package-scope integrity (root README + mcp-server README)
for (const rel of ["README.md", "packages/mcp-server/README.md"]) {
	const src = read(rel);
	const refs = [...src.matchAll(/@obs-?unified\/[a-z0-9-]+/g)].map((x) => x[0]);
	for (const ref of new Set(refs)) {
		if (!pkgNames.has(ref))
			fail(
				`${rel} references unknown package \`${ref}\` (scope/name typo? not in any package.json)`,
			);
	}
}

// 3 + 4. Feature gap / orphan
const featureTools = new Set();
for (const f of m.authored.features ?? []) {
	for (const t of f.addsMcpTools ?? []) {
		featureTools.add(t);
		if (!tools.has(t))
			fail(
				`feature "${f.id}" declares MCP tool \`${t}\` that does not exist in code (gap)`,
			);
	}
}
for (const t of tools) {
	if (/evidence/.test(t) && !featureTools.has(t)) {
		fail(
			`evidence tool \`${t}\` exists in code but no feature record declares it (orphan)`,
		);
	}
}

// 5. Dev ingest key consistency (M2)
{
	const src = read("packages/mcp-server/README.md");
	if (/OBS_INGEST_KEY"\s*:\s*"dev"/.test(src)) {
		fail(
			`mcp-server/README.md uses ingest key "dev"; manifest devIngestKey is "${m.authored.devIngestKey}"`,
		);
	}
}

// 6. Identity chain (P2) — README must show the chain components in order.
{
	const chain = m.authored.identityChain.split("→").map((s) => s.trim());
	const src = read("README.md");
	let last = -1;
	for (const part of chain) {
		const at = src.indexOf(part, last + 1);
		if (at === -1)
			fail(`README.md is missing identity-chain component \`${part}\``);
		else last = at;
	}
}

// 7. Governance enums (P2) — agent-action-graph doc must document each value.
{
	const src = read("docs/agent-action-graph.md");
	for (const [name, values] of Object.entries(m.authored.governance)) {
		if (!Array.isArray(values)) continue;
		for (const v of values)
			if (!src.includes(v))
				fail(`docs/agent-action-graph.md is missing ${name} value \`${v}\``);
	}
}

// 8. Feature status gate (P3) — status gating checks both ways.
{
	const src = read("README.md");
	const whatYouGet =
		src.split(/^## What you get$/m)[1]?.split(/^## /m)[0] ?? src;
	for (const f of m.authored.features ?? []) {
		if (f.status === "shipped") {
			// Enforce: shipped features must be advertised in README "What you get"
			if (
				f.surfacesWhenShipped?.includes("readme.what-you-get") &&
				f.addsSignalType &&
				!whatYouGet.includes(f.addsSignalType)
			) {
				fail(
					`feature "${f.id}" is status="shipped" and requires "readme.what-you-get", but its signal "${f.addsSignalType}" is not advertised in README "What you get"`,
				);
			}
			// Enforce: shipped features must have their tools in mcp-server README
			if (
				f.surfacesWhenShipped?.includes("mcp.tool-list") &&
				f.addsMcpTools
			) {
				const mcpReadme = read("packages/mcp-server/README.md");
				for (const tool of f.addsMcpTools) {
					if (!mcpReadme.includes(`\`${tool}\``)) {
						fail(
							`feature "${f.id}" is status="shipped" and requires "mcp.tool-list", but its tool \`${tool}\` is not listed in mcp-server/README.md`,
						);
					}
				}
			}
		} else {
			// Enforce: non-shipped features must NOT be advertised in README "What you get"
			if (
				f.addsSignalType &&
				whatYouGet.includes(f.addsSignalType)
			) {
				fail(
					`feature "${f.id}" is status="${f.status}" but its signal "${f.addsSignalType}" is advertised in README "What you get"`,
				);
			}
		}
	}
}

// 9. RFC Status Log Integration Check (M2) — rfc-status.md single source of truth.
{
	const src = read("docs/rfc-status.md");
	for (const f of m.authored.features ?? []) {
		if (f.rfc) {
			// Extract RFC number (e.g. "0011-evidence..." -> "0011")
			const matchNum = f.rfc.match(/^(\d+)/);
			if (matchNum) {
				const rfcNum = matchNum[1];
				const heading = `## RFC ${rfcNum}`;
				const parts = src.split(new RegExp(`^${heading}\\b`, "m"));
				if (parts.length < 2) {
					fail(`rfc-status.md is missing section for \`${heading}\``);
				} else {
					const section = parts[1].split(/^## /m)[0] || "";
					if (f.status === "shipped") {
						if (section.includes("- [~]") || section.includes("- [ ]")) {
							fail(
								`feature "${f.id}" is status="shipped", but rfc-status.md section for \`${heading}\` has incomplete tasks ([~] or [ ])`,
							);
						}
					}
				}
			}
		}
	}
}

// 10. Governance Enum Source Check — manifest enums must match obs-types constants.
{
	const src = read("packages/obs-types/src/constants.ts");
	const extractEnumValues = (objectName) => {
		const blockMatch = src.match(
			new RegExp(`export\\s+const\\s+${objectName}\\s*=\\s*\\{([^}]+)\\}`),
		);
		if (!blockMatch) return [];
		return [...blockMatch[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
	};

	const autonomyLevelValues = extractEnumValues("AgentAutonomyLevel");
	const approvalStateValues = extractEnumValues("ToolApprovalState");

	const expectedAutonomy = m.authored.governance.autonomyLevel;
	const expectedApproval = m.authored.governance.approvalState;

	for (const v of autonomyLevelValues) {
		if (!expectedAutonomy.includes(v)) {
			fail(
				`manifest.json is missing autonomyLevel value \`${v}\` (defined in obs-types constants.ts)`,
			);
		}
	}
	for (const v of expectedAutonomy) {
		if (!autonomyLevelValues.includes(v)) {
			fail(
				`manifest.json autonomyLevel has extra value \`${v}\` (not defined in obs-types constants.ts)`,
			);
		}
	}

	for (const v of approvalStateValues) {
		if (!expectedApproval.includes(v)) {
			fail(
				`manifest.json is missing approvalState value \`${v}\` (defined in obs-types constants.ts)`,
			);
		}
	}
	for (const v of expectedApproval) {
		if (!approvalStateValues.includes(v)) {
			fail(
				`manifest.json approvalState has extra value \`${v}\` (not defined in obs-types constants.ts)`,
			);
		}
	}
}

if (failures.length) {
	console.error(`messaging:check FAILED (${failures.length}):`);
	for (const f of failures) console.error(`  ✗ ${f}`);
	process.exit(1);
}
console.log("messaging:check passed — lead-repo surfaces match the manifest.");
