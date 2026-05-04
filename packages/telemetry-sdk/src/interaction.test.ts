/**
 * RFC 0004 Phase 1.6 — interaction-header parsing + span stamping.
 *
 * Tests the receive side of the click-scoped correlation key. The
 * header itself is opaque ULID-shaped; we accept it only when it
 * matches the same Crockford-base32 26-char pattern @obs/analytics-sdk
 * mints. Anything else (empty, wrong shape, control characters) is
 * rejected so a corrupted header doesn't seed wrong joins.
 */

import { describe, expect, it, vi } from "vitest";
import {
	INTERACTION_ATTRIBUTE_KEY,
	INTERACTION_HEADER_NAME,
	parseInteractionHeader,
	stampInteractionFromRequest,
} from "./span";

describe("parseInteractionHeader", () => {
	it("returns undefined for missing/empty values", () => {
		expect(parseInteractionHeader(undefined)).toBeUndefined();
		expect(parseInteractionHeader(null)).toBeUndefined();
		expect(parseInteractionHeader("")).toBeUndefined();
		expect(parseInteractionHeader("   ")).toBeUndefined();
	});

	it("accepts a valid 26-char Crockford-base32 ULID", () => {
		const id = "01HFXY2A3BKM5N7P9QRSTVWXYZ";
		expect(parseInteractionHeader(id)).toBe(id);
	});

	it("trims surrounding whitespace before validating", () => {
		const id = "01HFXY2A3BKM5N7P9QRSTVWXYZ";
		expect(parseInteractionHeader(`  ${id}\n`)).toBe(id);
	});

	it("rejects strings of wrong length", () => {
		expect(parseInteractionHeader("01HFXY")).toBeUndefined(); // too short
		expect(
			parseInteractionHeader("01HFXY2A3BKM5N7P9QRSTVWXYZEXTRA"),
		).toBeUndefined(); // too long
	});

	it("rejects strings with invalid characters", () => {
		// Crockford excludes I, L, O, U; we also exclude lowercase + dashes.
		expect(
			parseInteractionHeader("I1HFXY2A3BKM5N7P9QRSTVWXYZ"), // I at start
		).toBeUndefined();
		expect(
			parseInteractionHeader("01HFXY2A3BKM5N7P9QRSTVWXYL"), // L at end
		).toBeUndefined();
		expect(
			parseInteractionHeader("01HFXY-A3BKM5N7P9QRSTVWXYZ"), // dash mid-string
		).toBeUndefined();
	});

	it("rejects lowercase (we mint uppercase)", () => {
		expect(
			parseInteractionHeader("01hfxy2a3bkm5n7p9qrstvwxyz"),
		).toBeUndefined();
	});
});

describe("stampInteractionFromRequest", () => {
	const id = "01HFXY2A3BKM5N7P9QRSTVWXYZ";

	const mockSpan = () => ({
		setAttribute: vi.fn(),
	});

	it("stamps the attribute when the header is valid", () => {
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: { [INTERACTION_HEADER_NAME]: id },
		});

		const out = stampInteractionFromRequest(span, request);
		expect(out).toBe(id);
		expect(span.setAttribute).toHaveBeenCalledWith(
			INTERACTION_ATTRIBUTE_KEY,
			id,
		);
	});

	it("is a no-op when the header is missing", () => {
		const span = mockSpan();
		const request = new Request("https://example.com");

		const out = stampInteractionFromRequest(span, request);
		expect(out).toBeUndefined();
		expect(span.setAttribute).not.toHaveBeenCalled();
	});

	it("is a no-op when the header is malformed (no wrong-id stamp)", () => {
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: { [INTERACTION_HEADER_NAME]: "garbage" },
		});

		const out = stampInteractionFromRequest(span, request);
		expect(out).toBeUndefined();
		expect(span.setAttribute).not.toHaveBeenCalled();
	});

	it("works with a Hono-shaped headers object (object with .get())", () => {
		const span = mockSpan();
		const request = {
			headers: {
				get: (name: string) =>
					name.toLowerCase() === INTERACTION_HEADER_NAME ? id : null,
			},
		};

		const out = stampInteractionFromRequest(span, request);
		expect(out).toBe(id);
		expect(span.setAttribute).toHaveBeenCalledWith(
			INTERACTION_ATTRIBUTE_KEY,
			id,
		);
	});
});
