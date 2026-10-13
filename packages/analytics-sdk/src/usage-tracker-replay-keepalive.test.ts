/**
 * Browsers cap `keepalive` request bodies at 64 KiB; `fetch` throws for
 * anything larger and the replay chunk silently vanished. Large chunks must
 * go out as ordinary requests.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fitsKeepalive,
	KEEPALIVE_MAX_BODY_BYTES,
	UsageTracker,
} from "./usage-tracker";

class MemoryStorage {
	private readonly values = new Map<string, string>();
	get length(): number {
		return this.values.size;
	}
	clear(): void {
		this.values.clear();
	}
	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}
	key(index: number): string | null {
		return Array.from(this.values.keys())[index] ?? null;
	}
	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
	removeItem(key: string): void {
		this.values.delete(key);
	}
}

const originalFetch = globalThis.fetch;
const names = [
	"window",
	"document",
	"navigator",
	"sessionStorage",
	"localStorage",
] as const;
const originals = Object.fromEntries(
	names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis, n)]),
) as Record<(typeof names)[number], PropertyDescriptor | undefined>;

const installBrowserGlobals = () => {
	const define = (name: string, value: unknown) =>
		Object.defineProperty(globalThis, name, {
			configurable: true,
			writable: true,
			value,
		});
	define("window", {
		location: { href: "https://app.example.test/", pathname: "/" },
	});
	define("document", { referrer: "", title: "Home" });
	define("navigator", { userAgent: "vitest" });
	define("sessionStorage", new MemoryStorage() as unknown as Storage);
	define("localStorage", new MemoryStorage() as unknown as Storage);
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const n of names) {
		const d = originals[n];
		if (d) Object.defineProperty(globalThis, n, d);
		else Reflect.deleteProperty(globalThis, n);
	}
});

const flushWithEvents = (events: Record<string, unknown>[]) => {
	const fetchSpy = vi.fn<typeof fetch>(async () => new Response("ok"));
	globalThis.fetch = fetchSpy as unknown as typeof fetch;
	installBrowserGlobals();
	const tracker = new UsageTracker({
		endpoint: "https://collector.example.test/v1/usage",
	});
	(
		tracker as unknown as { replayEvents: Record<string, unknown>[] }
	).replayEvents = events;
	tracker.flushReplays();
	const call = fetchSpy.mock.calls.find(([url]) =>
		String(url).endsWith("/v1/replays"),
	);
	expect(call).toBeDefined();
	return call?.[1] as RequestInit;
};

describe("replay flush keepalive", () => {
	it("fitsKeepalive measures bytes against the 64 KiB cap", () => {
		expect(fitsKeepalive("x".repeat(KEEPALIVE_MAX_BODY_BYTES))).toBe(true);
		expect(fitsKeepalive("x".repeat(KEEPALIVE_MAX_BODY_BYTES + 1))).toBe(false);
		// multi-byte characters count by encoded size, not string length
		expect(fitsKeepalive("é".repeat(KEEPALIVE_MAX_BODY_BYTES / 2 + 1))).toBe(
			false,
		);
	});

	it("uses keepalive for small chunks and plain fetch for large snapshots", () => {
		const small = flushWithEvents([{ type: 3, data: { x: 1 } }]);
		expect(small.keepalive).toBe(true);

		const snapshot = flushWithEvents([
			{ type: 2, data: { html: "<div>".repeat(20_000) } },
		]);
		expect((snapshot.body as string).length).toBeGreaterThan(64 * 1024);
		expect(snapshot.keepalive).toBe(false);
	});
});
