import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installFlushLifecycle } from "./flush-lifecycle";

/**
 * Minimal exporter buffer with the same contract as ai/logger/span: a hard
 * cap that evicts the oldest item, a revision bumped only by `enqueue`, and
 * a flush that requeues the whole batch on failure without touching it.
 */
const fakeExporter = (capacity: number) => {
	let items: string[] = [];
	let revision = 0;
	let outcome: "ok" | "fail" | "hang" = "fail";
	let release: (() => void) | null = null;
	const attempts: string[][] = [];
	const flush = vi.fn(async () => {
		const batch = items.splice(0, items.length);
		attempts.push([...batch]);
		if (outcome === "hang") {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
		if (outcome !== "ok") {
			// Requeue: same items, revision untouched.
			items.unshift(...batch);
			if (items.length > capacity) items = items.slice(items.length - capacity);
		}
	});
	return {
		flush,
		attempts,
		enqueue(item: string) {
			if (items.length >= capacity)
				items.splice(0, items.length - capacity + 1);
			items.push(item);
			revision += 1;
		},
		pending: () => ({ count: items.length, revision }),
		setOutcome(next: typeof outcome) {
			outcome = next;
		},
		releaseInFlight() {
			release?.();
			release = null;
		},
		items: () => [...items],
	};
};

const drain = async () => {
	process.emit("beforeExit", 0);
	await vi.advanceTimersByTimeAsync(0);
};

describe("final beforeExit drain gate (enqueue revision)", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flushes a replacement enqueued into a full buffer even though the length is unchanged", async () => {
		const exporter = fakeExporter(2);
		const lifecycle = installFlushLifecycle({
			name: "test",
			flush: exporter.flush,
			intervalMs: 0,
			pending: exporter.pending,
		});
		try {
			exporter.enqueue("a");
			exporter.enqueue("b");
			await drain(); // fails, requeued → ["a","b"]
			await drain(); // nothing new: skipped
			expect(exporter.flush).toHaveBeenCalledTimes(1);

			// At the cap, a new item evicts "a": length stays 2.
			exporter.enqueue("c");
			expect(exporter.items()).toEqual(["b", "c"]);
			expect(exporter.pending().count).toBe(2);

			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(2);
			expect(exporter.attempts[1]).toEqual(["b", "c"]);
			await drain(); // requeued again, nothing new: no loop
			expect(exporter.flush).toHaveBeenCalledTimes(2);
		} finally {
			lifecycle.stop();
		}
	});

	it("flushes work that arrived while the final flush was in flight", async () => {
		const exporter = fakeExporter(10);
		const lifecycle = installFlushLifecycle({
			name: "test",
			flush: exporter.flush,
			intervalMs: 0,
			pending: exporter.pending,
		});
		try {
			exporter.setOutcome("hang");
			exporter.enqueue("a");
			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(1);

			// New telemetry during the in-flight attempt; a drain now must not
			// start a second concurrent flush.
			exporter.enqueue("b");
			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(1);

			// The in-flight attempt fails and requeues "a": the buffer is now
			// ["a","b"]. Sampling after settle would wrongly call "b" attempted.
			exporter.setOutcome("fail");
			exporter.releaseInFlight();
			await vi.advanceTimersByTimeAsync(0);
			expect(exporter.items()).toEqual(["a", "b"]);

			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(2);
			expect(exporter.attempts[1]).toEqual(["a", "b"]);
			await drain(); // requeued, nothing new: no loop
			expect(exporter.flush).toHaveBeenCalledTimes(2);
		} finally {
			lifecycle.stop();
		}
	});

	it("does not re-attempt after an in-flight failure when nothing new arrived", async () => {
		const exporter = fakeExporter(10);
		const lifecycle = installFlushLifecycle({
			name: "test",
			flush: exporter.flush,
			intervalMs: 0,
			pending: exporter.pending,
		});
		try {
			exporter.setOutcome("hang");
			exporter.enqueue("a");
			await drain();
			exporter.setOutcome("fail");
			exporter.releaseInFlight();
			await vi.advanceTimersByTimeAsync(0);
			await drain();
			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(1);

			// And a delivered buffer never triggers another request.
			exporter.setOutcome("ok");
			exporter.enqueue("b");
			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(2);
			await drain();
			expect(exporter.flush).toHaveBeenCalledTimes(2);
		} finally {
			lifecycle.stop();
		}
	});
});

describe("telemetry SDK flush lifecycle", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 204 })),
		);
	});

	afterEach(async () => {
		const ai = await import("./ai");
		const logger = await import("./logger");
		await ai.shutdownAI();
		await logger.shutdownLogger();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("flushes sub-threshold AI calls on the configured interval", async () => {
		const { initAI, trackAICall } = await import("./ai");

		initAI({
			collectorUrl: "https://collector.example",
			serviceName: "svc",
			flushIntervalMs: 1_000,
		});
		trackAICall({
			provider: "openai",
			modelName: "gpt-test",
			callType: "chat",
		});

		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"https://collector.example/v1/ai",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("flushes sub-threshold logs on the configured interval", async () => {
		const { createLogger, initLogger } = await import("./logger");

		initLogger({
			collectorUrl: "https://collector.example",
			serviceName: "svc",
			flushIntervalMs: 1_000,
		});
		createLogger("test").info("hello");

		expect(fetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1_000);

		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			"https://collector.example/v1/logs",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("does not loop on beforeExit when the collector is down, but flushes work produced after a drain", async () => {
		vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { createLogger, initLogger } = await import("./logger");
		initLogger({
			collectorUrl: "https://collector.example",
			serviceName: "svc",
			flushIntervalMs: 0,
		});
		const log = createLogger("test");
		log.info("last words");

		const drain = async () => {
			process.emit("beforeExit", 0);
			await vi.advanceTimersByTimeAsync(0);
		};
		// Requeued batch, nothing new: one attempt, then the loop may exit.
		await drain();
		await drain();
		await drain();
		expect(fetch).toHaveBeenCalledTimes(1);

		// A later drain after new work must still try (a one-shot flag would
		// silently drop these), and again only once while nothing changes.
		log.info("written after the first drain");
		await drain();
		await drain();
		expect(fetch).toHaveBeenCalledTimes(2);

		// Once the collector is back, the next drain delivers everything and
		// an empty buffer never triggers another request.
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		log.info("collector back");
		await drain();
		expect(fetch).toHaveBeenCalledTimes(3);
		const body = String(vi.mocked(fetch).mock.calls[2][1]?.body);
		expect(body).toContain("last words");
		expect(body).toContain("written after the first drain");
		expect(body).toContain("collector back");
		await drain();
		expect(fetch).toHaveBeenCalledTimes(3);
		errors.mockRestore();
	});

	it("attempts the final beforeExit flush once even when the collector is down", async () => {
		vi.mocked(fetch).mockRejectedValue(new Error("ECONNREFUSED"));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { createLogger, initLogger } = await import("./logger");
		initLogger({
			collectorUrl: "https://collector.example",
			serviceName: "svc",
			flushIntervalMs: 0,
		});
		createLogger("test").info("last words");

		// Node emits beforeExit each time the loop drains; a requeued batch
		// used to trigger another flush every time, keeping the process alive.
		for (let drain = 0; drain < 3; drain += 1) {
			process.emit("beforeExit", 0);
			await vi.advanceTimersByTimeAsync(0);
		}
		expect(fetch).toHaveBeenCalledTimes(1);
		errors.mockRestore();
	});

	it("requeues logs on a 503 so the next interval resends them", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		const { createLogger, initLogger } = await import("./logger");
		initLogger({
			collectorUrl: "https://collector.example",
			serviceName: "svc",
			flushIntervalMs: 1_000,
		});
		createLogger("test").warn("keep me");

		await vi.advanceTimersByTimeAsync(1_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(fetch).toHaveBeenCalledTimes(2);
		const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
		expect(JSON.stringify(body)).toContain("keep me");
		errors.mockRestore();
	});
});
