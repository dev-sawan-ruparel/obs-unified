/**
 * Cross-runtime crypto helpers using Web Crypto API.
 * Works in Cloudflare Workers, Node 20+, Deno, Bun.
 */

/** SHA-256 hash of a string, returned as lowercase hex. */
export async function sha256Hex(input: string): Promise<string> {
	const encoder = new TextEncoder();
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
	return bytesToHex(new Uint8Array(digest));
}

/** Generate `bytes` cryptographically random bytes and return as lowercase hex. */
export function randomHex(bytes: number): string {
	const buf = new Uint8Array(bytes);
	crypto.getRandomValues(buf);
	return bytesToHex(buf);
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		out += bytes[i].toString(16).padStart(2, "0");
	}
	return out;
}
