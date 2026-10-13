import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OPTIONAL_COLLECTOR_ENV_KEYS } from "./collector-env";

/**
 * server.ts boots on import, so these are source-level contracts: the host
 * must not mutate the global environment with secrets, and the env object
 * handed to the collector must stay an explicit allowlist.
 */
const source = readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "server.ts"),
	"utf8",
);

describe("collector-node server env wiring", () => {
	it("never assigns secrets back onto process.env", () => {
		expect(source).not.toMatch(/process\.env(\.\w+|\[[^\]]+\])\s*=[^=]/);
	});

	it("forwards only the allowlisted auth and optional keys to the collector", () => {
		const block = /const requestEnv: CollectorEnv = \{([\s\S]*?)\};/.exec(
			source,
		);
		expect(block).not.toBeNull();
		const keys = [...(block?.[1] ?? "").matchAll(/^\s*([A-Z_]+):/gm)].map(
			(m) => m[1],
		);
		expect(keys.sort()).toEqual(
			[
				"ALLOWED_ORIGINS",
				"DASHBOARD_PASSWORD",
				"DASHBOARD_TOKEN",
				"DB",
				"INGEST_KEY",
				"PROFILES_BUCKET",
				"REPLAYS_BUCKET",
			].sort(),
		);
		expect(block?.[1]).toContain("...optionalEnv.env");
		// The optional spread is itself a fixed allowlist (no raw process.env).
		expect(block?.[1]).not.toContain("process.env");
		expect(OPTIONAL_COLLECTOR_ENV_KEYS).not.toContain("INGEST_KEY");
	});
});
