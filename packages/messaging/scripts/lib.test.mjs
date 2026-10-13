import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTHORED_SEED } from "./authored-seed.mjs";
import { readManifest, scopeIntegrityFailures } from "./lib.mjs";

const derived = {
	packages: [{ name: "@obsunified/cli", scope: "@obsunified" }],
};

test("scope integrity reads authored.scopes, not a root scopes key", () => {
	const stale = {
		derived,
		authored: { scopes: { sdks: { scope: "@obs-unified" } } },
	};
	const failures = scopeIntegrityFailures(stale);
	assert.equal(failures.length, 1);
	assert.match(failures[0], /authored\.scopes\.sdks\.scope "@obs-unified"/);

	const current = {
		derived,
		authored: { scopes: { sdks: { scope: "@obsunified" } } },
	};
	assert.deepEqual(scopeIntegrityFailures(current), []);
});

test("a legacy root-level scopes block is still checked", () => {
	const legacy = { derived, scopes: { mcp: { scope: "@obs-unified" } } };
	assert.equal(scopeIntegrityFailures(legacy).length, 1);
});

test("the committed manifest and the generator seed use the derived scope", () => {
	const manifest = readManifest();
	assert.deepEqual(scopeIntegrityFailures(manifest), []);
	assert.deepEqual(
		scopeIntegrityFailures({
			derived: manifest.derived,
			authored: AUTHORED_SEED,
		}),
		[],
	);
	for (const text of Object.values(AUTHORED_SEED.glossary)) {
		assert.doesNotMatch(
			text,
			/^Repo \+ GitHub-Packages scope/,
			"seed glossary still describes the retired scope as current",
		);
	}
});
