import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

type InvalidCase = { value: string; reason: string };
type Cases = {
	validIds: string[];
	invalidIds: InvalidCase[];
};

const sharedCasesUrl = new URL(
	"../../../tests/conformance/interaction-id/cases.json",
	import.meta.url,
);
const browserTestUrl = new URL(
	"../../analytics-sdk/src/interaction.conformance.test.ts",
	import.meta.url,
);

describe("interaction_id browser fixture parity", () => {
	test("browser SDK inline fixtures match the shared conformance cases", () => {
		const shared = JSON.parse(readFileSync(sharedCasesUrl, "utf8")) as Cases;
		const browserSource = readFileSync(browserTestUrl, "utf8");

		expect(extractConstArray<string[]>(browserSource, "VALID_IDS")).toEqual(
			shared.validIds,
		);
		expect(
			extractConstArray<InvalidCase[]>(browserSource, "INVALID_IDS"),
		).toEqual(shared.invalidIds);
	});
});

function extractConstArray<T>(source: string, name: string): T {
	const match = source.match(
		new RegExp(`const\\s+${name}\\s*=\\s*(\\[[\\s\\S]*?\\]);`),
	);
	if (!match)
		throw new Error(`Unable to find ${name} in browser conformance test`);
	return Function(`"use strict"; return (${match[1]});`)() as T;
}
