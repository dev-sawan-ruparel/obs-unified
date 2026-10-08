import { fromBinary, fromJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { ExportLogsServiceResponseSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import { ExportMetricsServiceResponseSchema } from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import { ExportTraceServiceResponseSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import {
	logsResponse,
	metricsResponse,
	otlpRetryableError,
	traceResponse,
} from "./response";

const mockContext = () => {
	type Header = string | Record<string, string>;
	let capturedStatus: number | undefined;
	let capturedHeaders: Record<string, string> | undefined;
	let capturedBody: BodyInit | undefined;
	const ctx = {
		body: (body: BodyInit, status?: number, headers?: Header) => {
			capturedBody = body;
			capturedStatus = status;
			capturedHeaders =
				typeof headers === "string" ? undefined : (headers ?? {});
			return new Response(body, {
				status,
				headers: typeof headers === "string" ? undefined : headers,
			});
		},
	};
	return {
		ctx: ctx as never,
		get status() {
			return capturedStatus;
		},
		get headers() {
			return capturedHeaders;
		},
		get body() {
			return capturedBody;
		},
	};
};

describe("traceResponse", () => {
	it("returns 200 with empty envelope on full success (JSON)", async () => {
		const m = mockContext();
		const res = traceResponse(m.ctx, "json");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/json");
		const text = await res.text();
		const parsed = JSON.parse(text);
		// proto-JSON of empty message is {}
		expect(parsed).toEqual({});
		// Must round-trip via the schema
		expect(() =>
			fromJson(ExportTraceServiceResponseSchema, parsed),
		).not.toThrow();
	});

	it("returns 200 with empty envelope on full success (protobuf)", async () => {
		const m = mockContext();
		const res = traceResponse(m.ctx, "protobuf");
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("application/x-protobuf");
		const bytes = new Uint8Array(await res.arrayBuffer());
		const msg = fromBinary(ExportTraceServiceResponseSchema, bytes);
		expect(msg.partialSuccess).toBeUndefined();
	});

	it("encodes partial_success (JSON) with rejected count", async () => {
		const m = mockContext();
		const res = traceResponse(m.ctx, "json", {
			rejected: 3,
			errorMessage: "too many",
		});
		expect(res.status).toBe(200);
		const json = JSON.parse(await res.text());
		expect(json.partialSuccess.rejectedSpans).toBe("3"); // int64 in proto-JSON = string
		expect(json.partialSuccess.errorMessage).toBe("too many");
		const msg = fromJson(ExportTraceServiceResponseSchema, json);
		expect(msg.partialSuccess?.rejectedSpans).toBe(3n);
	});

	it("encodes partial_success (protobuf) with rejected count", async () => {
		const m = mockContext();
		const res = traceResponse(m.ctx, "protobuf", {
			rejected: 7,
			errorMessage: "cap",
		});
		const bytes = new Uint8Array(await res.arrayBuffer());
		const msg = fromBinary(ExportTraceServiceResponseSchema, bytes);
		expect(msg.partialSuccess?.rejectedSpans).toBe(7n);
		expect(msg.partialSuccess?.errorMessage).toBe("cap");
	});
});

describe("logsResponse", () => {
	it("encodes partial_success with rejectedLogRecords", async () => {
		const m = mockContext();
		const res = logsResponse(m.ctx, "json", {
			rejected: 42,
			errorMessage: "over cap",
		});
		const json = JSON.parse(await res.text());
		expect(json.partialSuccess.rejectedLogRecords).toBe("42");
		const msg = fromJson(ExportLogsServiceResponseSchema, json);
		expect(msg.partialSuccess?.rejectedLogRecords).toBe(42n);
	});

	it("returns empty envelope on full success", async () => {
		const m = mockContext();
		const res = logsResponse(m.ctx, "json");
		expect(JSON.parse(await res.text())).toEqual({});
	});
});

describe("metricsResponse", () => {
	it("encodes partial_success with rejectedDataPoints", async () => {
		const m = mockContext();
		const res = metricsResponse(m.ctx, "json", {
			rejected: 17,
			errorMessage: "series cap",
		});
		const json = JSON.parse(await res.text());
		expect(json.partialSuccess.rejectedDataPoints).toBe("17");
		const msg = fromJson(ExportMetricsServiceResponseSchema, json);
		expect(msg.partialSuccess?.rejectedDataPoints).toBe(17n);
	});

	it("returns empty envelope on full success (protobuf)", async () => {
		const m = mockContext();
		const res = metricsResponse(m.ctx, "protobuf");
		expect(res.headers.get("Content-Type")).toBe("application/x-protobuf");
		const msg = fromBinary(
			ExportMetricsServiceResponseSchema,
			new Uint8Array(await res.arrayBuffer()),
		);
		expect(msg.partialSuccess).toBeUndefined();
	});
});

describe("otlpRetryableError", () => {
	it("returns 503 with Retry-After by default", async () => {
		const m = mockContext();
		const res = otlpRetryableError(m.ctx, 503, "storage down");
		expect(res.status).toBe(503);
		expect(res.headers.get("Retry-After")).toBe("5");
		expect(res.headers.get("Content-Type")).toBe("application/json");
		expect(await res.json()).toEqual({ error: "storage down" });
	});

	it("returns 429 with a custom Retry-After", async () => {
		const m = mockContext();
		const res = otlpRetryableError(m.ctx, 429, "slow down", 30);
		expect(res.status).toBe(429);
		expect(res.headers.get("Retry-After")).toBe("30");
	});
});
