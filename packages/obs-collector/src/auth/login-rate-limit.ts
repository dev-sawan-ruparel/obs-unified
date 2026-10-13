/**
 * Fixed-window failure limiter for `POST /auth/login`. Only failed attempts
 * count; a successful login clears the client's bucket. State is in-memory,
 * so on Cloudflare Workers it is per isolate and on Node per process — it
 * slows a single-origin brute force without any shared storage, and it can
 * never lock an operator out for longer than one window.
 */

export interface LoginRateLimitOptions {
	/** Failed attempts allowed per window before 429. Default 10. */
	maxFailures?: number;
	/** Window length in milliseconds. Default 15 minutes. */
	windowMs?: number;
	/** Upper bound on tracked clients; the oldest bucket is evicted past it. */
	maxClients?: number;
	/** Clock override for tests. */
	now?: () => number;
}

export interface LoginRateLimitVerdict {
	allowed: boolean;
	retryAfterSeconds: number;
}

interface Bucket {
	failures: number;
	windowStartedAt: number;
}

export class LoginRateLimiter {
	private readonly buckets = new Map<string, Bucket>();
	private readonly maxFailures: number;
	private readonly windowMs: number;
	private readonly maxClients: number;
	private readonly now: () => number;

	constructor(options: LoginRateLimitOptions = {}) {
		this.maxFailures = Math.max(1, options.maxFailures ?? 10);
		this.windowMs = Math.max(1_000, options.windowMs ?? 15 * 60_000);
		this.maxClients = Math.max(1, options.maxClients ?? 10_000);
		this.now = options.now ?? Date.now;
	}

	check(key: string): LoginRateLimitVerdict {
		const bucket = this.live(key);
		if (!bucket || bucket.failures < this.maxFailures) {
			return { allowed: true, retryAfterSeconds: 0 };
		}
		const remaining = bucket.windowStartedAt + this.windowMs - this.now();
		return {
			allowed: false,
			retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
		};
	}

	recordFailure(key: string): void {
		const bucket = this.live(key);
		if (bucket) {
			bucket.failures += 1;
			return;
		}
		if (this.buckets.size >= this.maxClients) {
			const oldest = this.buckets.keys().next().value;
			if (oldest !== undefined) this.buckets.delete(oldest);
		}
		this.buckets.set(key, { failures: 1, windowStartedAt: this.now() });
	}

	reset(key: string): void {
		this.buckets.delete(key);
	}

	/** Bucket for `key` if its window is still open; expired buckets are dropped. */
	private live(key: string): Bucket | undefined {
		const bucket = this.buckets.get(key);
		if (!bucket) return undefined;
		if (bucket.windowStartedAt + this.windowMs <= this.now()) {
			this.buckets.delete(key);
			return undefined;
		}
		return bucket;
	}
}

export interface LoginClientKeyOptions {
	/** Transport-level peer address (e.g. the TCP remote address on Node). */
	clientAddress?: string;
	/**
	 * Honour `CF-Connecting-IP` / `X-Forwarded-For` ahead of `clientAddress`.
	 * Only set this when a trusted reverse proxy terminates every connection
	 * and rewrites those headers: behind such a proxy the transport peer is
	 * the proxy itself, so the forwarded address is the real client. Left
	 * off, those headers are ignored entirely and a direct client cannot pick
	 * its own bucket.
	 */
	trustProxyHeaders?: boolean;
}

/** True under workerd, where `CF-Connecting-IP` is set by the Cloudflare edge. */
export const isCloudflareWorkersRuntime = (): boolean =>
	typeof navigator !== "undefined" &&
	typeof navigator.userAgent === "string" &&
	navigator.userAgent.startsWith("Cloudflare-Workers");

/**
 * Client identity for limiting, most specific trustworthy source first:
 *   1. proxy headers, only when the host says a trusted proxy sets them
 *      (`CF-Connecting-IP`, then the first `X-Forwarded-For` hop);
 *   2. the peer address the host resolved from the connection — the default
 *      on Node, and the fallback when a trusted proxy sent no header;
 *   3. `CF-Connecting-IP` when running on Cloudflare Workers (edge-set).
 *
 * With `trustProxyHeaders` unset, forwarding headers never influence the key,
 * so a direct client cannot escape its bucket by forging them.
 *
 * Returns `null` when none of these apply. There is deliberately no shared
 * fallback bucket: one bucket for every client would let an anonymous
 * attacker lock every operator out of the dashboard with a handful of wrong
 * passwords, which is a worse failure than an unthrottled login endpoint
 * guarded by a strong password. Callers skip limiting on `null` and must
 * warn so the embedder supplies `clientAddress` or `trustProxyHeaders`.
 */
export const loginClientKey = (
	headers: { get(name: string): string | null },
	options: LoginClientKeyOptions = {},
): string | null => {
	const cf = headers.get("cf-connecting-ip")?.trim();
	if (options.trustProxyHeaders) {
		if (cf) return cf;
		const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
		if (forwarded) return forwarded;
	}
	const peer = options.clientAddress?.trim();
	if (peer) return peer;
	if (cf && isCloudflareWorkersRuntime()) return cf;
	return null;
};

export const UNKEYED_LOGIN_CLIENT_WARNING =
	"[dashboard-auth] login rate limiting is inactive: no trustworthy client address. " +
	"On Node, pass `loginRateLimit.clientAddress` (e.g. the TCP peer from @hono/node-server's getConnInfo); " +
	"behind a trusted reverse proxy set `loginRateLimit.trustProxyHeaders`. " +
	"Cloudflare Workers key on CF-Connecting-IP automatically.";
