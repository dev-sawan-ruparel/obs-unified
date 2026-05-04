/**
 * RFC 0004 Phase 1.2 — interaction primitives tests.
 *
 * Covers the contract callers depend on:
 *   - generateInteractionId returns a valid 26-char Crockford base32 string.
 *   - currentInteractionId returns undefined when no context is active.
 *   - withInteractionContext sets/unsets the stack across sync work,
 *     microtask continuations, and exceptions.
 *   - The stack pops correctly even if `fn` throws.
 *   - Mode-B caveat is real — setTimeout escapes the context (the test
 *     documents the limitation rather than working around it).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
	__resetInteractionStackForTests,
	currentInteractionId,
	generateInteractionId,
	popInteraction,
	pushInteraction,
	withInteractionContext,
	withInteractionContextAsync,
} from "./interaction";

afterEach(() => {
	__resetInteractionStackForTests();
});

describe("generateInteractionId", () => {
	it("produces 26-char Crockford-base32 strings", () => {
		const id = generateInteractionId();
		expect(id).toHaveLength(26);
		expect(id).toMatch(/^[0-9A-HJKMNPQRSTVWXYZ]{26}$/);
	});

	it("is sortable by time when minted in order", async () => {
		const a = generateInteractionId();
		// One ms gap is enough; the time prefix changes every ms.
		await new Promise((r) => setTimeout(r, 2));
		const b = generateInteractionId();
		expect(a < b).toBe(true);
	});

	it("is highly unique across many invocations within the same ms", () => {
		const ids = new Set<string>();
		for (let i = 0; i < 1000; i++) ids.add(generateInteractionId());
		expect(ids.size).toBe(1000);
	});
});

describe("currentInteractionId / push / pop", () => {
	it("returns undefined when no context is active", () => {
		expect(currentInteractionId()).toBeUndefined();
	});

	it("returns the top of the stack after push", () => {
		pushInteraction("a");
		expect(currentInteractionId()).toBe("a");
		pushInteraction("b");
		expect(currentInteractionId()).toBe("b");
		popInteraction();
		expect(currentInteractionId()).toBe("a");
		popInteraction();
		expect(currentInteractionId()).toBeUndefined();
	});
});

describe("withInteractionContext (sync)", () => {
	it("sets the id during fn and pops after", () => {
		expect(currentInteractionId()).toBeUndefined();
		withInteractionContext("X", () => {
			expect(currentInteractionId()).toBe("X");
		});
		expect(currentInteractionId()).toBeUndefined();
	});

	it("returns the value fn returned", () => {
		expect(withInteractionContext("X", () => 42)).toBe(42);
	});

	it("pops even when fn throws", () => {
		expect(() => {
			withInteractionContext("X", () => {
				throw new Error("boom");
			});
		}).toThrow("boom");
		expect(currentInteractionId()).toBeUndefined();
	});

	it("nests cleanly", () => {
		withInteractionContext("outer", () => {
			expect(currentInteractionId()).toBe("outer");
			withInteractionContext("inner", () => {
				expect(currentInteractionId()).toBe("inner");
			});
			expect(currentInteractionId()).toBe("outer");
		});
	});
});

describe("withInteractionContextAsync", () => {
	it("keeps the id active across await boundaries within fn", async () => {
		await withInteractionContextAsync("X", async () => {
			expect(currentInteractionId()).toBe("X");
			await Promise.resolve();
			expect(currentInteractionId()).toBe("X");
		});
		expect(currentInteractionId()).toBeUndefined();
	});

	it("pops even when the async fn rejects", async () => {
		await expect(
			withInteractionContextAsync("X", async () => {
				throw new Error("nope");
			}),
		).rejects.toThrow("nope");
		expect(currentInteractionId()).toBeUndefined();
	});
});

describe("Mode-B caveat (documented limitation)", () => {
	// This test exists to *encode the contract*: setTimeout escapes the
	// context. If this ever changes (e.g. TC39 AsyncContext lands), the
	// test fails and we update the docs.
	it("setTimeout fires outside the context — Mode B is required", async () => {
		let observed: string | undefined = "(unset)";
		await new Promise<void>((resolve) => {
			withInteractionContext("X", () => {
				setTimeout(() => {
					observed = currentInteractionId();
					resolve();
				}, 0);
			});
		});
		expect(observed).toBeUndefined();
	});

	it("snapshotting + re-entering via withInteractionContext fixes it", async () => {
		let observed: string | undefined = "(unset)";
		await new Promise<void>((resolve) => {
			withInteractionContext("X", () => {
				const id = currentInteractionId();
				if (!id) throw new Error("expected an id");
				setTimeout(() => {
					withInteractionContext(id, () => {
						observed = currentInteractionId();
					});
					resolve();
				}, 0);
			});
		});
		expect(observed).toBe("X");
	});
});
