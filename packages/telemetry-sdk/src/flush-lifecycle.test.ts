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
});
