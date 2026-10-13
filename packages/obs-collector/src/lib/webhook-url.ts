/**
 * Alert webhook destinations are admin-supplied URLs the collector POSTs to
 * from inside its own network. Two guards live here:
 *
 *  - `assertSafeWebhookUrl` rejects anything that is not plain http(s) to a
 *    public host, so a rule cannot be pointed at loopback, RFC 1918 ranges,
 *    link-local (cloud metadata) or embedded credentials. Self-hosted
 *    installs that legitimately post to an internal receiver can opt in
 *    with `allowPrivateNetworks` (env `ALERT_WEBHOOK_ALLOW_PRIVATE=true`).
 *  - `redactWebhookUrl` renders a URL for logs and span attributes. Slack
 *    and PagerDuty-style hooks carry their secret in the path, so only the
 *    origin and the first path segment survive; query and userinfo never do.
 *
 * Hostnames are checked as written; DNS resolution happens at fetch time
 * and a name that resolves to a private address is not caught here.
 */

export interface WebhookUrlOptions {
	allowPrivateNetworks?: boolean;
}

export class WebhookUrlError extends Error {}

const parseIpv4 = (host: string): number[] | null => {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return null;
	const octets = m.slice(1).map((o) => Number.parseInt(o, 10));
	return octets.every((o) => o <= 255) ? octets : null;
};

const isPrivateIpv4 = (o: number[]): boolean =>
	o[0] === 0 || // "this" network / unspecified
	o[0] === 10 ||
	o[0] === 127 ||
	(o[0] === 100 && o[1] >= 64 && o[1] <= 127) || // CGNAT
	(o[0] === 169 && o[1] === 254) || // link-local incl. cloud metadata
	(o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
	(o[0] === 192 && o[1] === 168) ||
	o[0] >= 224; // multicast, reserved, broadcast

const isPrivateIpv6 = (host: string): boolean => {
	// URL.hostname keeps the brackets for IPv6 literals.
	const literal = host.replace(/^\[|\]$/g, "").toLowerCase();
	if (literal === "::" || literal === "::1") return true;
	// IPv4-mapped (::ffff:a.b.c.d). The WHATWG URL parser serializes the
	// embedded address as two hex groups (::ffff:a00:1), so accept both.
	const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(literal);
	if (dotted) {
		const v4 = parseIpv4(dotted[1]);
		return v4 ? isPrivateIpv4(v4) : true;
	}
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(literal);
	if (hex) {
		const hi = Number.parseInt(hex[1], 16);
		const lo = Number.parseInt(hex[2], 16);
		return isPrivateIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
	}
	const first = Number.parseInt(literal.split(":")[0] || "0", 16);
	if (Number.isNaN(first)) return true;
	if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
	if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	return false;
};

/** True for hosts that name the collector itself or a non-public network. */
export const isPrivateWebhookHost = (hostname: string): boolean => {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (!host) return true;
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	if (host.endsWith(".local") || host.endsWith(".internal")) return true;
	if (host.startsWith("[")) return isPrivateIpv6(host);
	const v4 = parseIpv4(host);
	if (v4) return isPrivateIpv4(v4);
	// Bare hostnames without a dot are almost always intranet names.
	return !host.includes(".");
};

/** Parse and validate a webhook destination; returns the normalized URL. */
export const assertSafeWebhookUrl = (
	raw: string,
	options: WebhookUrlOptions = {},
): URL => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new WebhookUrlError("channel.url must be an absolute http(s) URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new WebhookUrlError("channel.url must be http(s)://");
	}
	if (url.username || url.password) {
		throw new WebhookUrlError(
			"channel.url must not embed credentials; use channel.headers",
		);
	}
	if (!options.allowPrivateNetworks && isPrivateWebhookHost(url.hostname)) {
		throw new WebhookUrlError(
			`channel.url host "${url.hostname}" is not a public address (set ALERT_WEBHOOK_ALLOW_PRIVATE=true to allow internal receivers)`,
		);
	}
	return url;
};

/** Resolve a hostname to its addresses (e.g. `dns.lookup(host, { all: true })`). */
export type HostLookup = (hostname: string) => Promise<string[]>;

export type HostResolution = "public" | "private" | "unresolvable";

/**
 * Second line of defence for hosts that pass the literal check: resolve the
 * name and classify it. Any private / loopback / link-local answer makes it
 * `private`. A lookup that throws or returns nothing is `unresolvable` —
 * callers must treat that as a refusal too (fail closed): the delivery
 * fetch resolves on its own, so "we could not see where this goes" must
 * never become "send it anyway". The fetch's own resolution can still
 * differ from this one (rebinding); that window is not closed here.
 */
export const resolveWebhookHost = async (
	hostname: string,
	lookup: HostLookup,
): Promise<HostResolution> => {
	// Literals were already judged by isPrivateWebhookHost.
	if (parseIpv4(hostname) || hostname.startsWith("[")) return "public";
	let addresses: string[];
	try {
		addresses = await lookup(hostname);
	} catch {
		return "unresolvable";
	}
	if (addresses.length === 0) return "unresolvable";
	const isPrivate = addresses.some((address) => {
		const v4 = parseIpv4(address);
		if (v4) return isPrivateIpv4(v4);
		return isPrivateIpv6(`[${address}]`);
	});
	return isPrivate ? "private" : "public";
};

/**
 * Origin only. Any path segment or query parameter of a webhook URL may be
 * the credential (Slack nests it, generic receivers often use a single
 * token segment), so nothing past the host is ever rendered; `/…` marks
 * that a path existed. Userinfo is dropped with the rest.
 */
export const redactWebhookUrl = (raw: string): string => {
	try {
		const url = new URL(raw);
		const hasPath = url.pathname !== "/" || url.search !== "";
		return `${url.protocol}//${url.host}${hasPath ? "/…" : ""}`;
	} catch {
		return "<invalid url>";
	}
};
