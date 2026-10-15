import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearRecordedFeatureFlags,
	getRecordedFeatureFlags,
	recordFeatureFlag,
	resolveLineageConfig,
	setConfiguredLineage,
	UsageTracker,
} from "./index";

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
		location: {
			href: "https://app.example.test/checkout",
			pathname: "/checkout",
			search: "",
		},
		innerWidth: 1280,
		innerHeight: 800,
	});
	define("document", { referrer: "", title: "Checkout" });
	define("navigator", { userAgent: "vitest" });
	define("sessionStorage", new MemoryStorage() as unknown as Storage);
	define("localStorage", new MemoryStorage() as unknown as Storage);
};

afterEach(() => {
	clearRecordedFeatureFlags();
	setConfiguredLineage(undefined);
	globalThis.fetch = originalFetch;
	for (const n of names) {
		const d = originals[n];
		if (d) Object.defineProperty(globalThis, n, d);
		else Reflect.deleteProperty(globalThis, n);
	}
});

describe("RFC 0013 Goal 1.3 — analytics-sdk runtime lineage & feature flags", () => {
	it("resolves ObservabilityLineageConfig from explicit config and env fallback", () => {
		expect(
			resolveLineageConfig(
				{
					environment: "prod",
					serviceVersion: "2.4.1",
					commitSha: "8f3a1b2",
					configDigest: "cfg_99a1",
				},
				{},
			),
		).toEqual({
			environment: "prod",
			serviceVersion: "2.4.1",
			commitSha: "8f3a1b2",
			configDigest: "cfg_99a1",
		});
	});

	it("attaches lineage metadata and recorded feature flags to usage events", () => {
		const fetchSpy = vi.fn<typeof fetch>(async () => new Response("ok"));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		installBrowserGlobals();

		const tracker = new UsageTracker({
			endpoint: "https://collector.example.test/v1/usage",
			environment: "staging",
			serviceVersion: "2.4.1",
			commitSha: "8f3a1b2",
			configDigest: "cfg_99a1",
		});

		recordFeatureFlag("checkout_redesign", "variant-b", {
			providerName: "launchdarkly",
			contextId: "usr_123",
		});
		expect(getRecordedFeatureFlags()).toEqual({
			checkout_redesign: "variant-b",
		});

		tracker.trackInteraction("pay_button.click", { buttonId: "pay-now" });

		const usageCall = fetchSpy.mock.calls.find(
			([url, init]) =>
				url === "https://collector.example.test/v1/usage" &&
				(init as RequestInit | undefined)?.method === "POST",
		);
		expect(usageCall).toBeDefined();
		const body = JSON.parse((usageCall?.[1] as RequestInit).body as string) as {
			events: Array<{
				properties?: Record<string, unknown>;
				context?: Record<string, unknown>;
			}>;
		};

		const event = body.events[0];
		expect(event.properties).toMatchObject({ buttonId: "pay-now" });
		// Lineage wire keys live in context only, not duplicated in properties.
		for (const key of [
			"deployment.environment.name",
			"obs.environment",
			"service.version",
			"obs.service.version",
			"vcs.commit.id",
			"obs.commit.sha",
			"obs.config.digest",
		]) {
			expect(event.properties).not.toHaveProperty(key);
			expect(event.context).toHaveProperty(key);
		}
		for (const key of [
			"environment",
			"serviceVersion",
			"commitSha",
			"configDigest",
		]) {
			expect(event.context).not.toHaveProperty(key);
		}
		expect(event.properties).toMatchObject({
			"obs.feature_flags.checkout_redesign": "variant-b",
			"feature_flag.key": "checkout_redesign",
		});
		expect(event.context).toMatchObject({
			"deployment.environment.name": "staging",
			"obs.environment": "staging",
			"service.version": "2.4.1",
			"obs.service.version": "2.4.1",
			"vcs.commit.id": "8f3a1b2",
			"obs.commit.sha": "8f3a1b2",
			"obs.config.digest": "cfg_99a1",
			"obs.feature_flags.checkout_redesign": "variant-b",
			"feature_flag.key": "checkout_redesign",
			"feature_flag.variant": "variant-b",
			featureFlags: {
				checkout_redesign: "variant-b",
			},
		});
	});
});
