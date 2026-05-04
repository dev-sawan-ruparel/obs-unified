/**
 * RFC 0004 — interaction_id primitives.
 *
 * A click-scoped correlation key minted at the moment a user-originated
 * event handler fires (click / submit / keydown), then propagated to:
 *   - the usage event for the click itself,
 *   - any rrweb events emitted while the context is active,
 *   - the `x-obs-interaction` header on outbound fetch/XHR.
 *
 * Two propagation modes (see RFC 0004 § Browser propagation scope):
 *
 *   Mode A — automatic. The SDK installs a global click/submit/keydown
 *   listener and wraps the handler in `withInteractionContext`. Sync
 *   work and microtask continuations (`await Promise.resolve()`) inherit
 *   the context. setTimeout chains, debounced calls, and state-machine
 *   queues do NOT.
 *
 *   Mode B — manual. The application snapshots the ID at click time
 *   (`currentInteractionId()`) and re-enters it later
 *   (`withInteractionContext(id, fn)`).
 *
 * No silent best-effort. If the context isn't active when an outbound
 * call fires, the request carries no header and the backend records
 * `propagated=false` on the propagation metric. Wrong joins are worse
 * than missing ones.
 */

// ── ULID-shaped ID ──
//
// Crockford base32, 26 chars: 10 chars of millisecond timestamp + 16 chars
// of randomness. Time-prefixed so IDs sort within a session, which makes
// debugging easier ("first click in this minute"). Not bit-perfect ULID
// (we don't enforce monotonicity within a millisecond) but the format and
// guarantees are equivalent for our purposes.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const encodeTime = (millis: number, len: number): string => {
	let str = "";
	let n = millis;
	for (let i = 0; i < len; i++) {
		str = ENCODING[n % 32] + str;
		n = Math.floor(n / 32);
	}
	return str;
};

const encodeRandom = (len: number): string => {
	const bytes = new Uint8Array(len);
	if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
		crypto.getRandomValues(bytes);
	} else {
		// Fallback for non-secure contexts (older environments, jsdom edge cases).
		// IDs only need to be unique within a session; Math.random() is enough
		// in practice and we never use these for security.
		for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
	}
	let str = "";
	for (let i = 0; i < len; i++) str += ENCODING[bytes[i] % 32];
	return str;
};

export const generateInteractionId = (): string =>
	encodeTime(Date.now(), 10) + encodeRandom(16);

// ── Handler stack ──
//
// Module-level stack so reads from anywhere in the page see the same
// context. Sync push/pop at handler entry/exit.

const stack: string[] = [];

export const currentInteractionId = (): string | undefined =>
	stack.length === 0 ? undefined : stack[stack.length - 1];

export const pushInteraction = (id: string): void => {
	stack.push(id);
};

export const popInteraction = (): void => {
	stack.pop();
};

/**
 * Run `fn` with `id` on the interaction stack. Sync code and microtask
 * continuations (`await Promise.resolve(); fn()`) see it via
 * `currentInteractionId()`. setTimeout / queued work does NOT — by the
 * time the deferred work runs, the stack has unwound. That's the
 * documented Mode-B usage: snapshot the id at click time and re-wrap.
 *
 * Throws and rejections still pop the context — the `finally` runs
 * regardless of how the body returns.
 */
export const withInteractionContext = <T>(
	id: string,
	fn: () => T,
): T => {
	pushInteraction(id);
	try {
		return fn();
	} finally {
		popInteraction();
	}
};

/**
 * Async-aware variant. Awaits the body before popping the context, which
 * keeps `currentInteractionId()` correct across `await` boundaries within
 * `fn`. Outside `fn`'s direct await chain, the same Mode-B caveat
 * applies — work scheduled via setTimeout from inside `fn` won't see the
 * id once the timer fires.
 */
export const withInteractionContextAsync = async <T>(
	id: string,
	fn: () => Promise<T>,
): Promise<T> => {
	pushInteraction(id);
	try {
		return await fn();
	} finally {
		popInteraction();
	}
};

// ── Test-only ──

/** Reset the stack. Test-only — never call this in app code. */
export const __resetInteractionStackForTests = (): void => {
	stack.length = 0;
};
