/**
 * RFC 0004 Phase 1.3 — auto-propagation (Mode A).
 *
 * Installs:
 *   1. Capture-phase click / submit / keydown listeners that mint an
 *      interaction_id and push it onto the handler stack from
 *      `interaction.ts`. The id is popped via a microtask cascade so
 *      sync code and shallow `await` chains in user handlers see it
 *      while longer chains (setTimeout, deep promise chains, debouncers)
 *      do NOT — that's the documented Mode A vs Mode B boundary.
 *   2. A global `fetch` wrapper that reads `currentInteractionId()` and
 *      injects the `x-obs-interaction` header when one is active. Does
 *      not overwrite a header the caller already set.
 *   3. An `XMLHttpRequest` wrapper that records the active id at
 *      `open()` time and applies it as a header inside `send()`. XHR is
 *      less common in modern apps but still ships in some libraries
 *      (legacy gtag, older Stripe.js, etc.).
 *
 * The installer is idempotent (calling it twice is a no-op) and returns
 * a cleanup function for tests / hot reload / unmount.
 *
 * Pure helpers (`injectInteractionHeader`, `wrapFetchWithCorrelation`)
 * are exported separately so they can be unit-tested without a DOM.
 */

import {
	currentInteractionId,
	generateInteractionId,
	popInteraction,
	pushInteraction,
} from "./interaction";

export const INTERACTION_HEADER = "x-obs-interaction";

const TRIGGER_EVENTS = ["click", "submit", "keydown"] as const;

// ── Pure helpers ────────────────────────────────────────────────────

/**
 * Returns a new RequestInit with the interaction header set, leaving the
 * original untouched. Does not overwrite the header if the caller already
 * specified one — caller intent wins.
 */
export const injectInteractionHeader = (
	init: RequestInit | undefined,
	id: string,
): RequestInit => {
	const headers = new Headers(init?.headers);
	if (!headers.has(INTERACTION_HEADER)) {
		headers.set(INTERACTION_HEADER, id);
	}
	return { ...init, headers };
};

/**
 * Build a `fetch`-shaped function that reads `getId()` at call time and
 * conditionally adds the header. Pure — doesn't mutate globals.
 *
 * `getId` is a callback (not a captured value) so the wrapper picks up
 * the current id at the moment fetch fires, not at install time.
 */
export const wrapFetchWithCorrelation = (
	originalFetch: typeof fetch,
	getId: () => string | undefined,
): typeof fetch => {
	return ((input: RequestInfo | URL, init?: RequestInit) => {
		const id = getId();
		if (id === undefined) return originalFetch(input, init);
		return originalFetch(input, injectInteractionHeader(init, id));
	}) as typeof fetch;
};

// ── Click listener installer (DOM, but parameterized for tests) ──────

export interface ClickListenerHandle {
	cleanup: () => void;
}

/**
 * Install capture-phase listeners for `click`, `submit`, `keydown` on
 * the given EventTarget (typically `document`). Each trusted event mints
 * a fresh interaction_id, pushes it on the handler stack, and schedules
 * a pop via two queued microtasks.
 *
 * Why two-cascade: a single `queueMicrotask` for the pop runs FIFO with
 * microtasks queued by user handlers, so the pop can win the race when
 * a user does `Promise.resolve().then(...)`. Cascading through one
 * extra microtask pushes the pop past most realistic same-tick await
 * chains. Deep chains still escape — that's Mode B's job.
 *
 * `mint` is a parameter so tests can inject a deterministic id.
 */
export const installClickListeners = (
	target: EventTarget,
	mint: () => string = generateInteractionId,
): ClickListenerHandle => {
	const handler = (e: Event) => {
		// Skip programmatic events — `el.click()` from app code shouldn't
		// mint a new interaction; that's the caller's business.
		if (e.isTrusted === false) return;
		const id = mint();
		pushInteraction(id);
		queueMicrotask(() => queueMicrotask(() => popInteraction(id)));
	};

	for (const evt of TRIGGER_EVENTS) {
		target.addEventListener(evt, handler, { capture: true });
	}

	return {
		cleanup: () => {
			for (const evt of TRIGGER_EVENTS) {
				target.removeEventListener(evt, handler, {
					capture: true,
				} as EventListenerOptions);
			}
		},
	};
};

// ── XHR patching ─────────────────────────────────────────────────────

const XHR_INTERACTION = new WeakMap<XMLHttpRequest, string>();

interface XhrPatchHandle {
	cleanup: () => void;
}

const installXhrPatch = (
	XHRClass: typeof XMLHttpRequest,
	getId: () => string | undefined,
): XhrPatchHandle => {
	const originalOpen = XHRClass.prototype.open;
	const originalSend = XHRClass.prototype.send;

	function patchedOpen(
		this: XMLHttpRequest,
		...args: Parameters<XMLHttpRequest["open"]>
	) {
		const id = getId();
		if (id !== undefined) XHR_INTERACTION.set(this, id);
		return originalOpen.apply(this, args);
	}

	function patchedSend(
		this: XMLHttpRequest,
		...args: Parameters<XMLHttpRequest["send"]>
	) {
		const id = XHR_INTERACTION.get(this);
		if (id !== undefined) {
			try {
				this.setRequestHeader(INTERACTION_HEADER, id);
			} catch {
				// setRequestHeader throws if state isn't OPENED. Either we
				// raced an external open() or the caller used XHR oddly;
				// dropping the header beats throwing through their callsite.
			}
		}
		return originalSend.apply(this, args);
	}

	XHRClass.prototype.open = patchedOpen as XMLHttpRequest["open"];
	XHRClass.prototype.send = patchedSend as XMLHttpRequest["send"];

	return {
		cleanup: () => {
			if (XHRClass.prototype.open === patchedOpen) {
				XHRClass.prototype.open = originalOpen;
			}
			if (XHRClass.prototype.send === patchedSend) {
				XHRClass.prototype.send = originalSend;
			}
		},
	};
};

// ── Top-level installer ──────────────────────────────────────────────

let installRefCount = 0;
let activeCleanup: (() => void) | null = null;

export interface InstallAutoCorrelateOptions {
	/** EventTarget to attach click listeners to. Defaults to `document`. */
	target?: EventTarget;
	/** Override for test injection. Defaults to `generateInteractionId`. */
	mint?: () => string;
}

/**
 * Wire up Mode A auto-propagation: click/submit/keydown listener +
 * global `fetch` patch + `XMLHttpRequest` patch. Idempotent. Returns
 * a cleanup function that restores original `fetch`, restores XHR
 * prototype methods, and removes the listeners.
 *
 * Safe to call in non-browser environments — returns a no-op cleanup
 * if `document` / `XMLHttpRequest` / `globalThis.fetch` are missing.
 */
export const installAutoCorrelate = (
	opts: InstallAutoCorrelateOptions = {},
): (() => void) => {
	if (activeCleanup) {
		installRefCount += 1;
		return () => {
			installRefCount = Math.max(0, installRefCount - 1);
			if (installRefCount === 0) {
				activeCleanup?.();
				activeCleanup = null;
			}
		};
	}
	const target =
		opts.target ?? (typeof document !== "undefined" ? document : undefined);
	if (!target) return () => {};

	installRefCount = 1;

	const clickHandle = installClickListeners(target, opts.mint);

	let fetchCleanup = () => {};
	if (typeof globalThis.fetch === "function") {
		const originalFetch = globalThis.fetch;
		const wrapped = wrapFetchWithCorrelation(
			originalFetch,
			currentInteractionId,
		);
		globalThis.fetch = wrapped;
		fetchCleanup = () => {
			if (globalThis.fetch === wrapped) globalThis.fetch = originalFetch;
		};
	}

	let xhrCleanup = () => {};
	if (typeof XMLHttpRequest !== "undefined") {
		xhrCleanup = installXhrPatch(XMLHttpRequest, currentInteractionId).cleanup;
	}

	activeCleanup = () => {
		clickHandle.cleanup();
		fetchCleanup();
		xhrCleanup();
	};
	return () => {
		installRefCount = Math.max(0, installRefCount - 1);
		if (installRefCount === 0) {
			activeCleanup?.();
			activeCleanup = null;
		}
	};
};

/** Test-only — undo the installation flag without running cleanup. */
export const __resetAutoCorrelateForTests = (): void => {
	activeCleanup?.();
	activeCleanup = null;
	installRefCount = 0;
};
