import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRequestSpan,
	flushSpans,
	initSpanExporter,
	shutdownSpanExporter,
} from "./span";

describe("span exporter", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(null, { status: 200 })),
		);
	});

	afterEach(async () => {
		await shutdownSpanExporter();
		vi.unstubAllGlobals();
	});

	it("queues ended request spans and flushes them to OTLP traces", async () => {
		initSpanExporter({
			collectorUrl: "https://collector.example",
			authToken: "key-123",
			extraHeaders: { "X-Test": "1" },
			flushIntervalMs: 0,
		});
		const span = createRequestSpan("svc", "GET /items");
		span.setAttribute("http.request.method", "GET");
		span.end();

		expect(fetch).not.toHaveBeenCalled();
		await flushSpans();

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe("https://collector.example/v1/traces");
		expect(init).toMatchObject({
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer key-123",
				"X-Test": "1",
			},
		});
		const body = JSON.parse(String(init?.body));
		expect(body.resourceSpans).toHaveLength(1);
		expect(body.resourceSpans[0].scopeSpans[0].spans[0]).toMatchObject({
			name: "GET /items",
			kind: 2,
		});
	});

	it("sends an ended span only once", async () => {
		initSpanExporter({
			collectorUrl: "https://collector.example",
			flushIntervalMs: 0,
		});
		const span = createRequestSpan("svc", "GET /once");
		span.end();
		span.end();

		await flushSpans();

		const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
		expect(body.resourceSpans).toHaveLength(1);
	});

	it("requeues the batch on a transient non-2xx and resends it on the next flush", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		initSpanExporter({
			collectorUrl: "https://collector.example",
			flushIntervalMs: 0,
		});
		createRequestSpan("svc", "GET /retry").end();

		await flushSpans();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(errors).toHaveBeenCalledWith(
			expect.stringContaining("HTTP 503; 1 item(s) requeued"),
		);

		await flushSpans();
		expect(fetch).toHaveBeenCalledTimes(2);
		const body = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));
		expect(body.resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
			"GET /retry",
		);

		// Accepted on the retry: nothing left to send.
		await flushSpans();
		expect(fetch).toHaveBeenCalledTimes(2);
		errors.mockRestore();
	});

	it("drops the batch loudly on a permanent client error instead of retrying", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		initSpanExporter({
			collectorUrl: "https://collector.example",
			authToken: "rotated",
			flushIntervalMs: 0,
		});
		createRequestSpan("svc", "GET /rejected").end();

		await flushSpans();
		await flushSpans();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(errors).toHaveBeenCalledWith(
			expect.stringContaining("HTTP 401; dropping 1 item(s)"),
		);
		errors.mockRestore();
	});
});
