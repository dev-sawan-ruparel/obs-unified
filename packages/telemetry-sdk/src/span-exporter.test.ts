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
});
