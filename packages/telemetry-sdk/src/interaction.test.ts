/**
 * RFC 0004 Phase 1.6 — interaction-header parsing + span stamping.
 *
 * Tests the receive side of the click-scoped correlation key. The
 * header itself is opaque ULID-shaped; we accept it only when it
 * matches the same Crockford-base32 26-char pattern @obsunified/analytics-sdk
 * mints. Anything else (empty, wrong shape, control characters) is
 * rejected so a corrupted header doesn't seed wrong joins.
 */

import {
	ACTION_HEADER_NAME,
	ACTION_ID_KEY,
	ACTION_ROOT_HEADER_NAME,
	ACTION_ROOT_ID_KEY,
} from "@obsunified/types/constants";
import { describe, expect, it, vi } from "vitest";
import {
	clearActiveActionContext,
	createRequestSpan,
	getActiveActionContext,
	INTERACTION_ATTRIBUTE_KEY,
	INTERACTION_HEADER_NAME,
	parseActionHeader,
	parseInteractionHeader,
	runWithSpan,
	stampActionFromRequest,
	stampIdentityFromRequest,
	stampInteractionFromRequest,
	withChildSpan,
} from "./span";

const attrValue = (
	span: { attributes?: Array<unknown> },
	key: string,
): unknown => {
	const attributes = span.attributes as
		| Array<{ key: string; value?: Record<string, unknown> }>
		| undefined;
	const value = attributes?.find((attr) => attr.key === key)?.value;
	if (!value) return undefined;
	return (
		value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue
	);
};

const mockSpan = () => ({
	setAttribute: vi.fn(),
});

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

describe("parseActionHeader", () => {
	it("accepts valid explicit action ids", () => {
		expect(parseActionHeader("01HFXY2A3BKM5N7P9QRSTVWXYZ")).toBe(
			"01HFXY2A3BKM5N7P9QRSTVWXYZ",
		);
	});

	it("rejects invalid explicit action ids", () => {
		expect(parseActionHeader("not-an-action")).toBeUndefined();
		expect(parseActionHeader("01hfxy2a3bkm5n7p9qrstvwxyz")).toBeUndefined();
	});
});

describe("stampActionFromRequest", () => {
	const interactionId = "01HFXY2A3BKM5N7P9QRSTVWXYZ";
	const rootActionId = "01HFXY2A3BKM5N7P9QRSTVWXY1";
	const actionId = "01HFXY2A3BKM5N7P9QRSTVWXY2";

	it("stamps explicit action headers on the root span", () => {
		clearActiveActionContext();
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: {
				[INTERACTION_HEADER_NAME]: interactionId,
				[ACTION_ROOT_HEADER_NAME]: rootActionId,
				[ACTION_HEADER_NAME]: actionId,
			},
		});

		const out = stampActionFromRequest(span, request);

		expect(out).toEqual({
			rootActionId,
			actionId,
			causedByActionId: null,
		});
		expect(span.setAttribute).toHaveBeenCalledWith(
			ACTION_ROOT_ID_KEY,
			rootActionId,
		);
		expect(span.setAttribute).toHaveBeenCalledWith(ACTION_ID_KEY, actionId);
		expect(getActiveActionContext()).toMatchObject({
			rootActionId,
			actionId,
			causedByActionId: null,
		});
		clearActiveActionContext();
	});

	it("projects legacy interaction-only requests into action ids", () => {
		clearActiveActionContext();
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: { [INTERACTION_HEADER_NAME]: interactionId },
		});

		const out = stampActionFromRequest(span, request);

		expect(out).toEqual({
			rootActionId: interactionId,
			actionId: interactionId,
			causedByActionId: null,
		});
		expect(span.setAttribute).toHaveBeenCalledWith(
			ACTION_ROOT_ID_KEY,
			interactionId,
		);
		expect(span.setAttribute).toHaveBeenCalledWith(
			ACTION_ID_KEY,
			interactionId,
		);
		clearActiveActionContext();
	});

	it("ignores malformed action headers and preserves valid interaction stamping", () => {
		clearActiveActionContext();
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: {
				[INTERACTION_HEADER_NAME]: interactionId,
				[ACTION_ROOT_HEADER_NAME]: "bad-root",
				[ACTION_HEADER_NAME]: "bad-action",
			},
		});

		const out = stampIdentityFromRequest(span, request);

		expect(out.interactionId).toBe(interactionId);
		expect(out.actionContext).toEqual({
			rootActionId: interactionId,
			actionId: interactionId,
			causedByActionId: null,
		});
		expect(span.setAttribute).toHaveBeenCalledWith(
			INTERACTION_ATTRIBUTE_KEY,
			interactionId,
		);
		expect(span.setAttribute).toHaveBeenCalledWith(
			ACTION_ID_KEY,
			interactionId,
		);
		clearActiveActionContext();
	});

	it("does not let legacy interaction overwrite valid explicit action headers", () => {
		clearActiveActionContext();
		const span = mockSpan();
		const request = new Request("https://example.com", {
			headers: {
				[INTERACTION_HEADER_NAME]: interactionId,
				[ACTION_ROOT_HEADER_NAME]: rootActionId,
				[ACTION_HEADER_NAME]: actionId,
			},
		});

		const out = stampIdentityFromRequest(span, request);

		expect(out.interactionId).toBe(interactionId);
		expect(out.actionContext).toMatchObject({ rootActionId, actionId });
		expect(span.setAttribute).toHaveBeenCalledWith(
			INTERACTION_ATTRIBUTE_KEY,
			interactionId,
		);
		expect(span.setAttribute).toHaveBeenCalledWith(
			ACTION_ROOT_ID_KEY,
			rootActionId,
		);
		expect(span.setAttribute).toHaveBeenCalledWith(ACTION_ID_KEY, actionId);
		clearActiveActionContext();
	});

	it("inherits stamped action context into child spans", async () => {
		clearActiveActionContext();
		const requestSpan = createRequestSpan("svc", "GET /agent");
		runWithSpan(requestSpan, () => {
			stampActionFromRequest(
				requestSpan,
				new Request("https://example.com", {
					headers: {
						[ACTION_ROOT_HEADER_NAME]: rootActionId,
						[ACTION_HEADER_NAME]: actionId,
					},
				}),
			);
		});

		await runWithSpan(requestSpan, async () => {
			await withChildSpan("child", async () => undefined);
		});

		const exportRequest = requestSpan.toOtlpExportRequest();
		const spans =
			exportRequest.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
		const child = spans.find((span) => span.name === "child");
		expect(child).toBeDefined();
		expect(attrValue(child ?? {}, ACTION_ROOT_ID_KEY)).toBe(rootActionId);
		expect(attrValue(child ?? {}, ACTION_ID_KEY)).toBe(actionId);
		clearActiveActionContext();
	});
});
