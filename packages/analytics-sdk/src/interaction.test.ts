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
	wrapInteraction,
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

describe("wrapInteraction (Phase 1.4)", () => {
	it("falls through when no interaction is active", () => {
		const handler = (a: number) => a * 2;
		const wrapped = wrapInteraction(handler);
		expect(wrapped(3)).toBe(6);
		expect(currentInteractionId()).toBeUndefined();
	});

	it("captures the id at invocation time and pops after sync return", () => {
		pushInteraction("X");
		const handler = () => currentInteractionId();
		const wrapped = wrapInteraction(handler);
		const result = wrapped();
		expect(result).toBe("X");
		// After sync return, our wrap has popped its copy. The original
		// "X" is still on the stack from the explicit push above.
		expect(currentInteractionId()).toBe("X");
		popInteraction();
		expect(currentInteractionId()).toBeUndefined();
	});

	it("keeps the id active across awaits in async handlers", async () => {
		pushInteraction("X");
		// Simulate Mode A's microtask pop that would normally fire while
		// the handler is still awaiting — the wrapper's own push must
		// outlive that.
		queueMicrotask(() => popInteraction());

		const observed: (string | undefined)[] = [];
		const handler = async () => {
			observed.push(currentInteractionId());
			await new Promise((r) => setTimeout(r, 10));
			observed.push(currentInteractionId());
			await Promise.resolve();
			observed.push(currentInteractionId());
		};
		const wrapped = wrapInteraction(handler);
		await wrapped();

		expect(observed).toEqual(["X", "X", "X"]);
		expect(currentInteractionId()).toBeUndefined();
	});

	it("pops on rejection from an async handler", async () => {
		pushInteraction("X");
		const wrapped = wrapInteraction(async () => {
			await Promise.resolve();
			throw new Error("nope");
		});

		await expect(wrapped()).rejects.toThrow("nope");
		// One layer popped (the wrap's copy). The original push from this
		// test remains; clean up.
		expect(currentInteractionId()).toBe("X");
		popInteraction();
	});

	it("pops on throw from a sync handler", () => {
		pushInteraction("X");
		const wrapped = wrapInteraction(() => {
			throw new Error("sync boom");
		});

		expect(() => wrapped()).toThrow("sync boom");
		expect(currentInteractionId()).toBe("X"); // wrap's copy popped, outer remains
		popInteraction();
	});

	it("preserves arguments and return value", () => {
		pushInteraction("X");
		const wrapped = wrapInteraction((a: number, b: string) => `${a}:${b}`);
		expect(wrapped(7, "foo")).toBe("7:foo");
		popInteraction();
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
