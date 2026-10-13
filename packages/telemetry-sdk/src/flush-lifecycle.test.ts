import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
