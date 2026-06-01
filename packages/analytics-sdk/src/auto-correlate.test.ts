/**
 * RFC 0004 Phase 1.3 — auto-correlate tests.
 *
 * Tests are DOM-free: we synthesize EventTargets, Headers (via the WHATWG
 * `Headers` global available in modern Node/Bun/Vitest), and a fake fetch
 * function. The DOM-touching `installAutoCorrelate` orchestrator is
 * smoke-tested for idempotency + cleanup contract; the meat of the
 * behavior lives in pure helpers (`injectInteractionHeader`,
 * `wrapFetchWithCorrelation`, `installClickListeners`) which we test
 * exhaustively.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetAutoCorrelateForTests,
	ACTION_HEADER,
	INTERACTION_HEADER,
	injectInteractionHeader,
	injectInteractionHeaders,
	installAutoCorrelate,
	installClickListeners,
	ROOT_ACTION_HEADER,
	wrapFetchWithActionCorrelation,
	wrapFetchWithCorrelation,
} from "./auto-correlate";
import {
	__resetInteractionStackForTests,
	currentInteractionId,
	withInteractionContext,
} from "./interaction";

afterEach(() => {
	__resetInteractionStackForTests();
	__resetAutoCorrelateForTests();
});

// ── injectInteractionHeader ──────────────────────────────────────────

describe("injectInteractionHeader", () => {
	it("sets the header when init is undefined", () => {
		const out = injectInteractionHeader(undefined, "X");
		expect(new Headers(out.headers).get(INTERACTION_HEADER)).toBe("X");
	});

	it("sets the header when init has unrelated headers", () => {
		const out = injectInteractionHeader(
			{ headers: { "content-type": "application/json" } },
			"X",
		);
		const h = new Headers(out.headers);
		expect(h.get(INTERACTION_HEADER)).toBe("X");
		expect(h.get("content-type")).toBe("application/json");
	});

	it("does NOT overwrite if the caller already set it (caller intent wins)", () => {
		const out = injectInteractionHeader(
			{ headers: { [INTERACTION_HEADER]: "caller-set" } },
			"sdk-set",
		);
		expect(new Headers(out.headers).get(INTERACTION_HEADER)).toBe("caller-set");
	});

	it("preserves other init fields (method, body)", () => {
		const out = injectInteractionHeader(
			{ method: "POST", body: '{"k":1}' },
			"X",
		);
		expect(out.method).toBe("POST");
		expect(out.body).toBe('{"k":1}');
	});
});

describe("injectInteractionHeaders", () => {
	it("sets interaction and action headers when init is undefined", () => {
		const out = injectInteractionHeaders(undefined, {
			interactionId: "click-1",
			rootActionId: "click-1",
			actionId: "click-1",
		});
		const h = new Headers(out.headers);
		expect(h.get(INTERACTION_HEADER)).toBe("click-1");
		expect(h.get(ROOT_ACTION_HEADER)).toBe("click-1");
		expect(h.get(ACTION_HEADER)).toBe("click-1");
	});

	it("does NOT overwrite caller-specified action headers", () => {
		const out = injectInteractionHeaders(
			{
				headers: {
					[INTERACTION_HEADER]: "caller-interaction",
					[ROOT_ACTION_HEADER]: "caller-root",
					[ACTION_HEADER]: "caller-action",
				},
			},
			{
				interactionId: "sdk-interaction",
				rootActionId: "sdk-root",
				actionId: "sdk-action",
			},
		);
		const h = new Headers(out.headers);
		expect(h.get(INTERACTION_HEADER)).toBe("caller-interaction");
		expect(h.get(ROOT_ACTION_HEADER)).toBe("caller-root");
		expect(h.get(ACTION_HEADER)).toBe("caller-action");
	});
});

// ── wrapFetchWithCorrelation ─────────────────────────────────────────

describe("wrapFetchWithCorrelation", () => {
	it("calls original fetch unchanged when no id is active", async () => {
		const original = vi.fn<typeof fetch>(async () => new Response("ok"));
		const wrapped = wrapFetchWithCorrelation(
			original as unknown as typeof fetch,
			() => undefined,
		);
		await wrapped("https://example.com", { method: "GET" });
		expect(original).toHaveBeenCalledWith("https://example.com", {
			method: "GET",
		});
	});

	it("injects the header when an id is active", async () => {
		const original = vi.fn<typeof fetch>(async () => new Response("ok"));
		const id: string | undefined = "I1";
		const wrapped = wrapFetchWithCorrelation(
			original as unknown as typeof fetch,
			() => id,
		);
		await wrapped("https://example.com", { method: "POST" });

		const init = original.mock.calls[0][1] as RequestInit;
		expect(new Headers(init.headers).get(INTERACTION_HEADER)).toBe("I1");
		expect(new Headers(init.headers).get(ROOT_ACTION_HEADER)).toBe("I1");
		expect(new Headers(init.headers).get(ACTION_HEADER)).toBe("I1");
	});

	it("reads id at call time, not install time", async () => {
		const original = vi.fn<typeof fetch>(async () => new Response("ok"));
		let id: string | undefined;
		const wrapped = wrapFetchWithCorrelation(
			original as unknown as typeof fetch,
			() => id,
		);

		// First call: no id active → no header.
		await wrapped("https://a.example", undefined);
		const initA = original.mock.calls[0][1] as RequestInit | undefined;
		expect(
			initA ? new Headers(initA.headers).get(INTERACTION_HEADER) : null,
		).toBeNull();

		// Second call: id is set → header present.
		id = "I2";
		await wrapped("https://b.example", undefined);
		const initB = original.mock.calls[1][1] as RequestInit;
		expect(new Headers(initB.headers).get(INTERACTION_HEADER)).toBe("I2");
		expect(new Headers(initB.headers).get(ROOT_ACTION_HEADER)).toBe("I2");
		expect(new Headers(initB.headers).get(ACTION_HEADER)).toBe("I2");
	});

	it("injects divergent action context when available", async () => {
		const original = vi.fn<typeof fetch>(async () => new Response("ok"));
		const wrapped = wrapFetchWithActionCorrelation(
			original as unknown as typeof fetch,
			() => ({
				interactionId: "click-1",
				rootActionId: "run-1",
				actionId: "step-1",
			}),
		);

		await wrapped("https://example.com", { method: "POST" });

		const init = original.mock.calls[0][1] as RequestInit;
		const h = new Headers(init.headers);
		expect(h.get(INTERACTION_HEADER)).toBe("click-1");
		expect(h.get(ROOT_ACTION_HEADER)).toBe("run-1");
		expect(h.get(ACTION_HEADER)).toBe("step-1");
	});
});

// ── installClickListeners ────────────────────────────────────────────

describe("installClickListeners", () => {
	it("pushes a fresh id on each trusted click", async () => {
		const target = new EventTarget();
		let nextId = 1;
		installClickListeners(target, () => `id-${nextId++}`);

		// Synthesize a trusted click. Note: in a real browser, isTrusted is
		// set by the engine. Tests dispatch synthetic events whose isTrusted
		// is false by default, so we patch.
		const e1 = new Event("click");
		Object.defineProperty(e1, "isTrusted", { value: true });
		target.dispatchEvent(e1);

		// Stack contains id-1 right after dispatch (sync handlers see it).
		// Since our test target dispatches sync, the listener has run.
		// The pop is queued via two microtasks — flush them.
		expect(currentInteractionId()).toBe("id-1");
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(currentInteractionId()).toBeUndefined();

		// Second click mints a different id.
		const e2 = new Event("click");
		Object.defineProperty(e2, "isTrusted", { value: true });
		target.dispatchEvent(e2);
		expect(currentInteractionId()).toBe("id-2");
	});

	it("ignores untrusted (programmatic) events", () => {
		const target = new EventTarget();
		installClickListeners(target, () => "should-not-mint");

		const e = new Event("click"); // isTrusted defaults to false in jsdom/node
		// Don't override isTrusted — leave it false (the default for synthetic events)
		target.dispatchEvent(e);

		expect(currentInteractionId()).toBeUndefined();
	});

	it("attaches to click, submit, and keydown", () => {
		const target = new EventTarget();
		const ids: string[] = [];
		let counter = 0;
		installClickListeners(target, () => {
			const id = `id-${++counter}`;
			ids.push(id);
			return id;
		});

		for (const type of ["click", "submit", "keydown"]) {
			const e = new Event(type);
			Object.defineProperty(e, "isTrusted", { value: true });
			target.dispatchEvent(e);
		}

		expect(ids).toEqual(["id-1", "id-2", "id-3"]);
	});

	it("cleanup removes the listeners", () => {
		const target = new EventTarget();
		const handle = installClickListeners(target, () => "X");

		handle.cleanup();

		const e = new Event("click");
		Object.defineProperty(e, "isTrusted", { value: true });
		target.dispatchEvent(e);

		expect(currentInteractionId()).toBeUndefined();
	});

	it("interoperates with explicit Mode-B contexts (stack semantics)", () => {
		const target = new EventTarget();
		installClickListeners(target, () => "click-id");

		// User code wraps something in Mode B before any click happens.
		withInteractionContext("manual", () => {
			expect(currentInteractionId()).toBe("manual");
			// A click during a manual context pushes another id on top.
			const e = new Event("click");
			Object.defineProperty(e, "isTrusted", { value: true });
			target.dispatchEvent(e);
			expect(currentInteractionId()).toBe("click-id");
		});
		// After the manual context returns and the click microtask drains
		// (implicitly via the test continuing to next assertion synchronously,
		// before microtasks run), we still expect the click-id to be on top
		// momentarily. We don't await microtasks here — just verify the
		// manual context's id is gone.
	});
});

// ── installAutoCorrelate (smoke) ─────────────────────────────────────

describe("installAutoCorrelate", () => {
	it("returns a cleanup function and is idempotent on second call", () => {
		const target = new EventTarget();
		const cleanup1 = installAutoCorrelate({ target });
		const cleanup2 = installAutoCorrelate({ target });

		expect(typeof cleanup1).toBe("function");
		expect(typeof cleanup2).toBe("function");
		// Second cleanup is a no-op (idempotent install means
		// the second call doesn't track new state).
		cleanup2();
		cleanup1();
	});

	it("is a no-op cleanup when no DOM is available", () => {
		// No `target` provided AND no global `document` mock — should
		// gracefully return a no-op cleanup. (vitest in node has no
		// `document`.)
		expect(typeof document).toBe("undefined");
		const cleanup = installAutoCorrelate();
		expect(typeof cleanup).toBe("function");
		cleanup(); // shouldn't throw
	});

	it("integrates: trusted click on target makes fetch carry the header", async () => {
		const originalFetch = globalThis.fetch;
		const fetchSpy = vi.fn<typeof fetch>(async () => new Response("ok"));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;

		const target = new EventTarget();
		const cleanup = installAutoCorrelate({
			target,
			mint: () => "INTEGRATION-ID",
		});

		try {
			const e = new Event("click");
			Object.defineProperty(e, "isTrusted", { value: true });
			target.dispatchEvent(e);

			await globalThis.fetch("https://example.com/api", { method: "POST" });

			const init = fetchSpy.mock.calls[0][1] as RequestInit;
			expect(new Headers(init.headers).get(INTERACTION_HEADER)).toBe(
				"INTEGRATION-ID",
			);
			expect(new Headers(init.headers).get(ROOT_ACTION_HEADER)).toBe(
				"INTEGRATION-ID",
			);
			expect(new Headers(init.headers).get(ACTION_HEADER)).toBe(
				"INTEGRATION-ID",
			);
		} finally {
			cleanup();
			globalThis.fetch = originalFetch;
		}
	});

	it("integrates: trusted click on target makes XHR carry all correlation headers", () => {
		const originalXhr = globalThis.XMLHttpRequest;
		const seenHeaders: Record<string, string> = {};

		class FakeXhr {
			open() {}
			send() {}
			setRequestHeader(name: string, value: string) {
				seenHeaders[name] = value;
			}
		}

		globalThis.XMLHttpRequest =
			FakeXhr as unknown as typeof globalThis.XMLHttpRequest;

		const target = new EventTarget();
		const cleanup = installAutoCorrelate({
			target,
			mint: () => "XHR-INTEGRATION-ID",
		});

		try {
			const e = new Event("click");
			Object.defineProperty(e, "isTrusted", { value: true });
			target.dispatchEvent(e);

			const xhr = new XMLHttpRequest();
			xhr.open("POST", "https://example.com/api");
			xhr.send();

			expect(seenHeaders[INTERACTION_HEADER]).toBe("XHR-INTEGRATION-ID");
			expect(seenHeaders[ROOT_ACTION_HEADER]).toBe("XHR-INTEGRATION-ID");
			expect(seenHeaders[ACTION_HEADER]).toBe("XHR-INTEGRATION-ID");
		} finally {
			cleanup();
			if (originalXhr === undefined) {
				Reflect.deleteProperty(globalThis, "XMLHttpRequest");
			} else {
				globalThis.XMLHttpRequest = originalXhr;
			}
		}
	});
});
