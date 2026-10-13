import { describe, expect, it } from "vitest";
import {
	assertSafeWebhookUrl,
	isPrivateWebhookHost,
	redactWebhookUrl,
	resolveWebhookHost,
	WebhookUrlError,
} from "./webhook-url";

describe("assertSafeWebhookUrl", () => {
	it("accepts public http(s) hooks", () => {
		for (const url of [
			"https://hooks.slack.com/services/T000/B000/XXXX",
			"https://events.pagerduty.com/v2/enqueue",
			"http://alerts.example.com:8080/hook?team=1",
			"https://8.8.8.8/hook",
		]) {
			expect(() => assertSafeWebhookUrl(url)).not.toThrow();
		}
	});

	it("rejects non-http schemes, relative URLs and embedded credentials", () => {
		for (const url of [
			"ftp://example.com/x",
			"file:///etc/passwd",
			"javascript:alert(1)",
			"/relative/hook",
			"https://user:pass@example.com/hook",
		]) {
			expect(() => assertSafeWebhookUrl(url), url).toThrow(WebhookUrlError);
		}
	});

	it("rejects loopback, private, link-local and metadata hosts", () => {
		for (const url of [
			"http://localhost/hook",
			"http://app.localhost/hook",
			"http://127.0.0.1:9000/hook",
			"http://0.0.0.0/hook",
			"http://10.1.2.3/hook",
			"http://172.16.0.1/hook",
			"http://192.168.1.1/hook",
			"http://100.64.0.1/hook",
			"http://169.254.169.254/latest/meta-data/",
			"http://[::1]/hook",
			"http://[fe80::1]/hook",
			"http://[fd00::1]/hook",
			"http://[::ffff:10.0.0.1]/hook",
			"http://collector/hook",
			"http://db.internal/hook",
		]) {
			expect(() => assertSafeWebhookUrl(url), url).toThrow(WebhookUrlError);
		}
	});

	it("allows private hosts only with the explicit opt-in", () => {
		const url = "http://alertmanager.internal:9093/api/v2/alerts";
		expect(() => assertSafeWebhookUrl(url)).toThrow(WebhookUrlError);
		expect(
			assertSafeWebhookUrl(url, { allowPrivateNetworks: true }).hostname,
		).toBe("alertmanager.internal");
		// The opt-in never unlocks credentials or other schemes.
		expect(() =>
			assertSafeWebhookUrl("ftp://10.0.0.1/x", { allowPrivateNetworks: true }),
		).toThrow(WebhookUrlError);
	});

	it("isPrivateWebhookHost treats public names as public", () => {
		expect(isPrivateWebhookHost("hooks.slack.com")).toBe(false);
		expect(isPrivateWebhookHost("hooks.slack.com.")).toBe(false);
		expect(isPrivateWebhookHost("1.1.1.1")).toBe(false);
	});
});

describe("redactWebhookUrl", () => {
	it("keeps only the origin: any path segment or query may be the credential", () => {
		expect(
			redactWebhookUrl("https://hooks.slack.com/services/T000/B000/SECRET"),
		).toBe("https://hooks.slack.com/…");
		// A generic receiver whose only secret is the single path segment.
		expect(redactWebhookUrl("https://hooks.example.com/TOKEN123")).toBe(
			"https://hooks.example.com/…",
		);
		expect(redactWebhookUrl("https://example.com/?token=abc")).toBe(
			"https://example.com/…",
		);
		expect(redactWebhookUrl("https://user:pw@example.com:8443/")).toBe(
			"https://example.com:8443",
		);
		expect(redactWebhookUrl("not a url")).toBe("<invalid url>");
		for (const url of [
			"https://hooks.example.com/TOKEN123",
			"https://example.com/a/b?token=abc#frag",
			"https://user:pw@example.com/",
		]) {
			expect(redactWebhookUrl(url)).not.toMatch(/TOKEN123|token=|pw|abc|frag/);
		}
	});

	it("resolveWebhookHost classifies answers and fails closed when it cannot resolve", async () => {
		const lookup = async (host: string) =>
			host === "evil.example"
				? ["93.184.216.34", "10.0.0.8"]
				: ["93.184.216.34"];
		expect(await resolveWebhookHost("evil.example", lookup)).toBe("private");
		expect(await resolveWebhookHost("hooks.example", lookup)).toBe("public");
		expect(
			await resolveWebhookHost("v6.example", async () => ["fd00::1"]),
		).toBe("private");
		// IP literals were judged already by the literal check.
		expect(await resolveWebhookHost("10.0.0.8", lookup)).toBe("public");
		// No answer is never "safe": the delivery fetch would resolve on its own.
		expect(
			await resolveWebhookHost("down.example", async () => {
				throw new Error("ENOTFOUND");
			}),
		).toBe("unresolvable");
		expect(await resolveWebhookHost("empty.example", async () => [])).toBe(
			"unresolvable",
		);
	});
});
