// Node SDK server-side conformance against
// tests/conformance/interaction-id/cases.json.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
import {
	INTERACTION_ATTRIBUTE,
	INTERACTION_HEADER,
	isValidInteractionId,
	stampInteractionFromRequest,
} from "./interaction.js";

const fixturePath = fileURLToPath(
	new URL(
		"../../../tests/conformance/interaction-id/cases.json",
		import.meta.url,
	),
);
const cases = JSON.parse(readFileSync(fixturePath, "utf8")) as {
	validIds: string[];
	invalidIds: Array<{ value: string; reason: string }>;
};

interface MockSpan {
	attrs: Map<string, unknown>;
	isRecording(): boolean;
	setAttribute(k: string, v: unknown): void;
}

const mkSpan = (recording = true): MockSpan => ({
	attrs: new Map(),
	isRecording: () => recording,
	setAttribute(k, v) {
		this.attrs.set(k, v);
	},
});

describe("interaction_id server conformance", () => {
	test("Case 1 — isValidInteractionId accepts all valid fixture IDs", () => {
		for (const id of cases.validIds) {
			expect(isValidInteractionId(id), id).toBe(true);
		}
	});

	test("Case 4 — isValidInteractionId rejects all invalid fixture IDs", () => {
		for (const { value, reason } of cases.invalidIds) {
			expect(isValidInteractionId(value), reason).toBe(false);
		}
	});

	test("Case 2 — header round-trip stamps the active span", () => {
		const span = mkSpan();
		const id = cases.validIds[0];
		stampInteractionFromRequest(span as never, {
			headers: { [INTERACTION_HEADER]: id },
		});
		expect(span.attrs.get(INTERACTION_ATTRIBUTE)).toBe(id);
	});

	test("Case 3 — absent header is a no-op", () => {
		const span = mkSpan();
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
		stampInteractionFromRequest(span as never, { headers: {} });
		expect(span.attrs.has(INTERACTION_ATTRIBUTE)).toBe(false);
		expect(consoleWarn).not.toHaveBeenCalled();
		consoleWarn.mockRestore();
	});

	test("Case 4 — malformed values silently drop", () => {
		for (const { value } of cases.invalidIds) {
			const span = mkSpan();
			stampInteractionFromRequest(span as never, {
				headers: { [INTERACTION_HEADER]: value },
			});
			expect(span.attrs.has(INTERACTION_ATTRIBUTE)).toBe(false);
		}
	});

	test("non-recording span is a no-op", () => {
		const span = mkSpan(false);
		stampInteractionFromRequest(span as never, {
			headers: { [INTERACTION_HEADER]: cases.validIds[0] },
		});
		expect(span.attrs.has(INTERACTION_ATTRIBUTE)).toBe(false);
	});

	test("Fetch API Request shape", () => {
		const span = mkSpan();
		const headers = new Headers({ [INTERACTION_HEADER]: cases.validIds[0] });
		const request = { headers };
		stampInteractionFromRequest(span as never, request);
		expect(span.attrs.get(INTERACTION_ATTRIBUTE)).toBe(cases.validIds[0]);
	});
});
