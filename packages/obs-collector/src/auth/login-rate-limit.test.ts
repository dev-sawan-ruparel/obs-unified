import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginRateLimiter, loginClientKey } from "./login-rate-limit";

describe("LoginRateLimiter", () => {
	it("blocks after the failure budget and recovers when the window ends", () => {
		let now = 1_000_000;
		const limiter = new LoginRateLimiter({
			maxFailures: 3,
			windowMs: 60_000,
			now: () => now,
		});
		for (let i = 0; i < 3; i += 1) {
			expect(limiter.check("1.2.3.4").allowed).toBe(true);
			limiter.recordFailure("1.2.3.4");
		}
		const blocked = limiter.check("1.2.3.4");
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBe(60);
		// Other clients are unaffected.
		expect(limiter.check("5.6.7.8").allowed).toBe(true);
		now += 60_000;
		expect(limiter.check("1.2.3.4").allowed).toBe(true);
	});

	it("a successful login clears the client's failures", () => {
		const limiter = new LoginRateLimiter({ maxFailures: 2 });
		limiter.recordFailure("k");
		limiter.reset("k");
		limiter.recordFailure("k");
		expect(limiter.check("k").allowed).toBe(true);
	});

	it("evicts the oldest client past the tracking cap", () => {
		const limiter = new LoginRateLimiter({ maxFailures: 1, maxClients: 2 });
		limiter.recordFailure("a");
		limiter.recordFailure("b");
		limiter.recordFailure("c");
		expect(limiter.check("a").allowed).toBe(true);
		expect(limiter.check("c").allowed).toBe(false);
	});

	describe("loginClientKey", () => {
		const headers = (init: Record<string, string>) => new Headers(init);
		const spoofed = headers({
			"cf-connecting-ip": "9.9.9.9",
			"x-forwarded-for": "8.8.8.8, 10.0.0.1",
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it("keys on the connection peer and ignores spoofed headers by default", () => {
			expect(loginClientKey(spoofed, { clientAddress: "203.0.113.7" })).toBe(
				"203.0.113.7",
			);
			expect(
				loginClientKey(spoofed, {
					clientAddress: "203.0.113.7",
					trustProxyHeaders: false,
				}),
			).toBe("203.0.113.7");
		});

		it("prefers the trusted forwarded client over the proxy peer", () => {
			// Behind a trusted proxy the peer is the proxy itself; the
			// forwarded address is the real client.
			expect(
				loginClientKey(spoofed, {
					clientAddress: "10.0.0.1",
					trustProxyHeaders: true,
				}),
			).toBe("9.9.9.9");
			expect(
				loginClientKey(headers({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" }), {
					clientAddress: "10.0.0.1",
					trustProxyHeaders: true,
				}),
			).toBe("8.8.8.8");
			// Whitespace-only / empty header values do not count as forwarded.
			expect(
				loginClientKey(headers({ "x-forwarded-for": "  " }), {
					clientAddress: "10.0.0.1",
					trustProxyHeaders: true,
				}),
			).toBe("10.0.0.1");
		});

		it("falls back to the peer when a trusted proxy sent no headers", () => {
			expect(
				loginClientKey(headers({}), {
					clientAddress: "10.0.0.1",
					trustProxyHeaders: true,
				}),
			).toBe("10.0.0.1");
			expect(
				loginClientKey(headers({}), { trustProxyHeaders: true }),
			).toBeNull();
		});

		it("ignores forwarding headers unless a trusted proxy is declared", () => {
			// Direct client on Node: headers are attacker-chosen and there is no
			// peer address → no key (never a shared bucket).
			expect(loginClientKey(spoofed)).toBeNull();
			expect(loginClientKey(headers({}))).toBeNull();
			expect(loginClientKey(spoofed, { trustProxyHeaders: true })).toBe(
				"9.9.9.9",
			);
			expect(
				loginClientKey(headers({ "x-forwarded-for": "8.8.8.8, 10.0.0.1" }), {
					trustProxyHeaders: true,
				}),
			).toBe("8.8.8.8");
		});

		it("trusts CF-Connecting-IP only on the Cloudflare Workers runtime", () => {
			vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
			expect(loginClientKey(spoofed)).toBe("9.9.9.9");
			expect(
				loginClientKey(headers({ "x-forwarded-for": "8.8.8.8" })),
			).toBeNull();
			// A host-resolved peer still wins over the edge header on Workers
			// unless the embedder opts into trusting proxy headers.
			expect(loginClientKey(spoofed, { clientAddress: "203.0.113.7" })).toBe(
				"203.0.113.7",
			);
		});
	});
});
