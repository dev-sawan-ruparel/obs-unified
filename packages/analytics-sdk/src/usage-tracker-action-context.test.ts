import { afterEach, describe, expect, it, vi } from "vitest";
import {
	__resetInteractionStackForTests,
	withInteractionContext,
} from "./interaction";
import { UsageTracker } from "./usage-tracker";

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
const originalDescriptors = {
	window: Object.getOwnPropertyDescriptor(globalThis, "window"),
	document: Object.getOwnPropertyDescriptor(globalThis, "document"),
	navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
	sessionStorage: Object.getOwnPropertyDescriptor(globalThis, "sessionStorage"),
	localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
};

const defineGlobal = (
	name: keyof typeof originalDescriptors,
	value: unknown,
) => {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
};

const restoreGlobal = (name: keyof typeof originalDescriptors) => {
	const descriptor = originalDescriptors[name];
	if (descriptor === undefined) {
		Reflect.deleteProperty(globalThis, name);
		return;
	}
	Object.defineProperty(globalThis, name, descriptor);
};

const installBrowserGlobals = () => {
	defineGlobal("window", {
		location: {
			href: "https://app.example.test/invoices",
			pathname: "/invoices",
		},
	});
	defineGlobal("document", {
		referrer: "",
		title: "Invoices",
	});
	defineGlobal("navigator", { userAgent: "vitest" });
	defineGlobal("sessionStorage", new MemoryStorage() as unknown as Storage);
	defineGlobal("localStorage", new MemoryStorage() as unknown as Storage);
};

afterEach(() => {
	__resetInteractionStackForTests();
	globalThis.fetch = originalFetch;
	restoreGlobal("window");
	restoreGlobal("document");
	restoreGlobal("navigator");
	restoreGlobal("sessionStorage");
	restoreGlobal("localStorage");
});

describe("UsageTracker action context", () => {
	it("stamps user-originated usage events with interaction and action IDs", () => {
		const fetchSpy = vi.fn<typeof fetch>(async () => new Response("ok"));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		installBrowserGlobals();

		const tracker = new UsageTracker({
			endpoint: "https://collector.example.test/v1/usage",
		});

		withInteractionContext("click-1", () => {
			tracker.trackInteraction("invoice.save");
		});

		const usageCall = fetchSpy.mock.calls.find(
			([url, init]) =>
				url === "https://collector.example.test/v1/usage" &&
				(init as RequestInit | undefined)?.method === "POST",
		);
		expect(usageCall).toBeDefined();
		const body = JSON.parse((usageCall?.[1] as RequestInit).body as string) as {
			events: Array<{
				interactionId?: string;
				rootActionId?: string;
				actionId?: string;
			}>;
		};
		expect(body.events[0]).toMatchObject({
			interactionId: "click-1",
			rootActionId: "click-1",
			actionId: "click-1",
		});
	});

	it("stamps usage events with explicit divergent action IDs", () => {
		const fetchSpy = vi.fn<typeof fetch>(async () => new Response("ok"));
		globalThis.fetch = fetchSpy as unknown as typeof fetch;
		installBrowserGlobals();

		const tracker = new UsageTracker({
			endpoint: "https://collector.example.test/v1/usage",
		});

		withInteractionContext(
			"click-1",
			() => {
				tracker.trackInteraction("agent.step");
			},
			{ rootActionId: "run-1", actionId: "step-1" },
		);

		const usageCall = fetchSpy.mock.calls.find(
			([url, init]) =>
				url === "https://collector.example.test/v1/usage" &&
				(init as RequestInit | undefined)?.method === "POST",
		);
		expect(usageCall).toBeDefined();
		const body = JSON.parse((usageCall?.[1] as RequestInit).body as string) as {
			events: Array<{
				interactionId?: string;
				rootActionId?: string;
				actionId?: string;
			}>;
		};
		expect(body.events[0]).toMatchObject({
			interactionId: "click-1",
			rootActionId: "run-1",
			actionId: "step-1",
		});
	});
});
