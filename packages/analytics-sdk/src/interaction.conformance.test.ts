// Browser SDK conformance against tests/conformance/interaction-id/cases.json.
//
// Fixture data is duplicated inline (rather than `readFileSync`'d) so the
// browser-SDK tsconfig doesn't need to pull in node types. The polyglot
// SDKs and the server-side telemetry SDK load the JSON file directly —
// any drift between the two copies is caught by
// `packages/telemetry-sdk/src/interaction-fixture-parity.test.ts`.

import { describe, expect, test } from "vitest";
import {
	currentInteractionId,
	generateInteractionId,
	popInteraction,
	pushInteraction,
} from "./interaction";

// Mirror of tests/conformance/interaction-id/cases.json. Keep in sync.
const VALID_IDS = [
	"01HZQ5W3K8M4P2X7N9B0CDEFGH",
	"01J3Y4Z5A6B7C8D9E0F1G2H3J4",
	"00000000000000000000000000",
	"ZZZZZZZZZZZZZZZZZZZZZZZZZZ",
];

const INVALID_IDS = [
	{ value: "", reason: "empty" },
	{ value: "01HZQ5W3K8M4P2X7N9B0CDEFG", reason: "too short (25 chars)" },
	{ value: "01HZQ5W3K8M4P2X7N9B0CDEFGHX", reason: "too long (27 chars)" },
	{ value: "01hzq5w3k8m4p2x7n9b0cdefgh", reason: "lowercase rejected" },
	{ value: "I1HZQ5W3K8M4P2X7N9B0CDEFGH", reason: "contains forbidden 'I'" },
	{ value: "L1HZQ5W3K8M4P2X7N9B0CDEFGH", reason: "contains forbidden 'L'" },
	{ value: "O1HZQ5W3K8M4P2X7N9B0CDEFGH", reason: "contains forbidden 'O'" },
	{ value: "U1HZQ5W3K8M4P2X7N9B0CDEFGH", reason: "contains forbidden 'U'" },
	{ value: "01HZQ5W3K8M4P2X7N9B0!DEFGH", reason: "contains punctuation" },
];

const REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe("interaction_id conformance (browser)", () => {
	test("Case 1 — 1,000 minted IDs all match the wire regex", () => {
		for (let i = 0; i < 1000; i++) {
			const id = generateInteractionId();
			expect(REGEX.test(id), `${id} failed regex`).toBe(true);
		}
	});

	test("Case 1b — time-prefix monotonic across consecutive mints", () => {
		const a = generateInteractionId();
		const b = generateInteractionId();
		expect(a.slice(0, 10) <= b.slice(0, 10)).toBe(true);
	});

	test("Case 2/3 — fixture's valid IDs all pass regex", () => {
		for (const id of VALID_IDS) {
			expect(REGEX.test(id), `${id} should be valid`).toBe(true);
		}
	});

	test("Case 4 — fixture's invalid IDs all fail regex", () => {
		for (const { value, reason } of INVALID_IDS) {
			expect(REGEX.test(value), `${value} rejected because: ${reason}`).toBe(
				false,
			);
		}
	});

	test("context stack push/pop balanced", () => {
		expect(currentInteractionId()).toBeUndefined();
		const id = generateInteractionId();
		pushInteraction(id);
		expect(currentInteractionId()).toBe(id);
		popInteraction();
		expect(currentInteractionId()).toBeUndefined();
	});
});
