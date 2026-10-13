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

		it("prefers the connection peer the host resolved", () => {
			expect(loginClientKey(spoofed, { clientAddress: "203.0.113.7" })).toBe(
				"203.0.113.7",
			);
		});

		it("ignores forwarding headers unless a trusted proxy is declared", () => {
			// Direct client on Node: headers are attacker-chosen → one shared bucket.
			expect(loginClientKey(spoofed)).toBe("shared");
			expect(loginClientKey(headers({}))).toBe("shared");
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
			expect(loginClientKey(headers({ "x-forwarded-for": "8.8.8.8" }))).toBe(
				"shared",
			);
		});
	});
});
