#!/usr/bin/env node
/*
 * messaging:generate — rewrite the DERIVED section of manifest.json from code.
 *
 *   node scripts/generate.mjs           # write manifest.json
 *   node scripts/generate.mjs --check   # fail (exit 1) if the committed derived
 *                                        # section is stale vs code
 *
 * The AUTHORED section (identity chain, governance enums, glossary, capabilities,
 * feature records) is hand-maintained and preserved across runs. Only `derived`
 * is machine-written, so a tool/field/scope change in code must be reflected by
 * re-running generate — CI enforces this with --check.
 *
 * No timestamps are written: the output must be deterministic so --check is a
 * pure content comparison.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { AUTHORED_SEED } from "./authored-seed.mjs";
import { deriveAll, MANIFEST_PATH } from "./lib.mjs";

const HEADER =
	"DO NOT EDIT the `derived` block by hand — run `pnpm --filter @obsunified/messaging generate`. The `authored` block is hand-maintained.";

function build() {
	const authored = existsSync(MANIFEST_PATH)
		? (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")).authored ??
			AUTHORED_SEED)
		: AUTHORED_SEED;
	return {
		$note: HEADER,
		schemaVersion: "obs-unified.messaging-manifest.v1",
		derived: deriveAll(),
		authored,
	};
}

function serialize(obj) {
	// Tab indent to match the repo's Biome JSON formatter so manifest.json passes
	// `biome check` and generate --check stays the sole authority on its format.
	return `${JSON.stringify(obj, null, "\t")}\n`;
}

const check = process.argv.includes("--check");
const next = serialize(build());

if (check) {
	if (!existsSync(MANIFEST_PATH)) {
		console.error(
			"messaging: manifest.json missing; run `pnpm --filter @obsunified/messaging generate`",
		);
		process.exit(1);
	}
	const current = readFileSync(MANIFEST_PATH, "utf8");
	if (current !== next) {
		console.error(
			"messaging: manifest.json is STALE vs code.\n" +
				"A tool/field/scope changed without regenerating. Run:\n" +
				"  pnpm --filter @obsunified/messaging generate\n",
		);
		process.exit(1);
	}
	console.log("messaging: manifest.json is up to date with code.");
} else {
	writeFileSync(MANIFEST_PATH, next);
	console.log(`messaging: wrote ${MANIFEST_PATH}`);
}
