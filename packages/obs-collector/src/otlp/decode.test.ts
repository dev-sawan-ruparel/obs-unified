import { create, toBinary, toJson } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
	OtlpDecodeError,
	decodeLogsRequest,
	decodeMetricsRequest,
	decodeTraceRequest,
	readOtlpBody,
} from "./decode";
import { ExportLogsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/logs/v1/logs_service_pb.js";
import { ExportMetricsServiceRequestSchema } from "./gen/opentelemetry/proto/collector/metrics/v1/metrics_service_pb.js";
import { ExportTraceServiceRequestSchema } from "./gen/opentelemetry/proto/collector/trace/v1/trace_service_pb.js";
import {
	AnyValueSchema,
	KeyValueSchema,
} from "./gen/opentelemetry/proto/common/v1/common_pb.js";
import {
	LogRecordSchema,
	ResourceLogsSchema,
	ScopeLogsSchema,
	SeverityNumber,
} from "./gen/opentelemetry/proto/logs/v1/logs_pb.js";
import {
	AggregationTemporality,
	ExemplarSchema,
	ExponentialHistogramDataPoint_BucketsSchema,
	ExponentialHistogramDataPointSchema,
	ExponentialHistogramSchema,
	GaugeSchema,
	HistogramDataPointSchema,
	HistogramSchema,
	MetricSchema,
	NumberDataPointSchema,
	ResourceMetricsSchema,
	ScopeMetricsSchema,
	SumSchema,
	SummaryDataPoint_ValueAtQuantileSchema,
	SummaryDataPointSchema,
	SummarySchema,
} from "./gen/opentelemetry/proto/metrics/v1/metrics_pb.js";
import { ResourceSchema } from "./gen/opentelemetry/proto/resource/v1/resource_pb.js";
import {
	ResourceSpansSchema,
	ScopeSpansSchema,
	SpanSchema,
} from "./gen/opentelemetry/proto/trace/v1/trace_pb.js";

const TRACE_ID = new Uint8Array([
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
	0x0e, 0x0f, 0x10,
]);
const SPAN_ID = new Uint8Array([
	0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
]);
const TRACE_HEX = "0102030405060708090a0b0c0d0e0f10";
const SPAN_HEX = "aabbccddeeff0011";

const buildMessage = () =>
	create(ExportTraceServiceRequestSchema, {
		resourceSpans: [
			create(ResourceSpansSchema, {
				scopeSpans: [
					create(ScopeSpansSchema, {
						spans: [
							create(SpanSchema, {
								traceId: TRACE_ID,
								spanId: SPAN_ID,
								name: "GET /api/users",
								startTimeUnixNano: 1_700_000_000_000_000_000n,
								endTimeUnixNano: 1_700_000_000_100_000_000n,
							}),
						],
					}),
				],
			}),
		],
	});

const mockContext = (opts: {
	bytes: ArrayBuffer | Uint8Array;
	contentType: string;
	contentEncoding?: string;
}) => {
	const buf =
		opts.bytes instanceof Uint8Array
			? opts.bytes.buffer.slice(
					opts.bytes.byteOffset,
					opts.bytes.byteOffset + opts.bytes.byteLength,
				)
			: opts.bytes;
	return {
		req: {
			arrayBuffer: async () => buf,
			header: (name: string) => {
				const n = name.toLowerCase();
				if (n === "content-type") return opts.contentType;
				if (n === "content-encoding") return opts.contentEncoding;
				return undefined;
			},
		},
	} as unknown as Parameters<typeof readOtlpBody>[0];
};

describe("readOtlpBody", () => {
	it("rejects missing content-type with 415", async () => {
		const c = mockContext({ bytes: new Uint8Array(), contentType: "" });
		await expect(readOtlpBody(c)).rejects.toBeInstanceOf(OtlpDecodeError);
	});

	it("rejects unknown content-encoding with 415", async () => {
		const c = mockContext({
			bytes: new Uint8Array([1, 2, 3]),
			contentType: "application/x-protobuf",
			contentEncoding: "brotli",
		});
		await expect(readOtlpBody(c)).rejects.toMatchObject({ status: 415 });
	});

	it("detects protobuf wire format", async () => {
		const c = mockContext({
			bytes: new Uint8Array(),
			contentType: "application/x-protobuf",
		});
		const { wireFormat } = await readOtlpBody(c);
		expect(wireFormat).toBe("protobuf");
	});

	it("detects json wire format", async () => {
		const c = mockContext({
			bytes: new Uint8Array(),
			contentType: "application/json",
		});
		const { wireFormat } = await readOtlpBody(c);
		expect(wireFormat).toBe("json");
	});

	it("decompresses gzip bodies", async () => {
		const raw = new TextEncoder().encode(JSON.stringify({ resourceSpans: [] }));
		const gz = await new Response(
			new Response(raw).body!.pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer();
		const c = mockContext({
			bytes: gz,
			contentType: "application/json",
			contentEncoding: "gzip",
		});
		const { bytes } = await readOtlpBody(c);
		expect(new TextDecoder().decode(bytes)).toBe('{"resourceSpans":[]}');
	});
});

describe("decodeTraceRequest", () => {
	it("round-trips a span via protobuf", () => {
		const bytes = toBinary(ExportTraceServiceRequestSchema, buildMessage());
		const decoded = decodeTraceRequest({ bytes, wireFormat: "protobuf" });
		const span = decoded.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
		expect(span?.traceId).toBe(TRACE_HEX);
		expect(span?.spanId).toBe(SPAN_HEX);
		expect(span?.name).toBe("GET /api/users");
		expect(span?.startTimeUnixNano).toBe("1700000000000000000");
		expect(span?.endTimeUnixNano).toBe("1700000000100000000");
	});

	it("round-trips a span via JSON", () => {
		const json = toJson(ExportTraceServiceRequestSchema, buildMessage());
		const bytes = new TextEncoder().encode(JSON.stringify(json));
		const decoded = decodeTraceRequest({ bytes, wireFormat: "json" });
		const span = decoded.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
		expect(span?.traceId).toBe(TRACE_HEX);
		expect(span?.spanId).toBe(SPAN_HEX);
		expect(span?.startTimeUnixNano).toBe("1700000000000000000");
	});

	it("throws 400 on malformed protobuf", () => {
		expect(() =>
			decodeTraceRequest({
				bytes: new Uint8Array([0xff, 0xff, 0xff]),
				wireFormat: "protobuf",
			}),
		).toThrowError(OtlpDecodeError);
	});

	it("throws 400 on malformed JSON", () => {
		expect(() =>
			decodeTraceRequest({
				bytes: new TextEncoder().encode("{not json"),
				wireFormat: "json",
			}),
		).toThrowError(OtlpDecodeError);
	});

	it("accepts hex trace/span IDs in JSON (OTLP-spec form, not base64)", () => {
		// Real OTel SDKs emit IDs as lowercase hex strings per the OTLP-JSON
		// spec, not base64 (which is the proto-JSON default for `bytes` fields).
		// The Go reference receiver accepts both — so must we.
		const body = JSON.stringify({
			resourceSpans: [
				{
					scopeSpans: [
						{
							spans: [
								{
									traceId: TRACE_HEX,
									spanId: SPAN_HEX,
									parentSpanId: "1122334455667788",
									name: "hex-id",
									startTimeUnixNano: "1700000000000000000",
									endTimeUnixNano: "1700000000100000000",
								},
							],
						},
					],
				},
			],
		});
		const decoded = decodeTraceRequest({
			bytes: new TextEncoder().encode(body),
			wireFormat: "json",
		});
		const span = decoded.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0];
		expect(span?.traceId).toBe(TRACE_HEX);
		expect(span?.spanId).toBe(SPAN_HEX);
		expect(span?.parentSpanId).toBe("1122334455667788");
	});
});

// ── Logs ────────────────────────────────────────────────────────────────

const LOG_TRACE_ID = new Uint8Array([
	0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd,
	0xee, 0xff, 0x00,
]);
const LOG_SPAN_ID = new Uint8Array([
	0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe,
]);

const buildLogsMessage = () =>
	create(ExportLogsServiceRequestSchema, {
		resourceLogs: [
			create(ResourceLogsSchema, {
				resource: create(ResourceSchema, {
					attributes: [
						create(KeyValueSchema, {
							key: "service.name",
							value: create(AnyValueSchema, {
								value: { case: "stringValue", value: "checkout" },
							}),
						}),
					],
				}),
				scopeLogs: [
					create(ScopeLogsSchema, {
						scope: { name: "users", version: "1.0" },
						logRecords: [
							create(LogRecordSchema, {
								timeUnixNano: 1_700_000_000_000_000_000n,
								observedTimeUnixNano: 1_700_000_000_000_000_000n,
								severityNumber: SeverityNumber.ERROR,
								severityText: "ERROR",
								body: create(AnyValueSchema, {
									value: { case: "stringValue", value: "boom" },
								}),
								traceId: LOG_TRACE_ID,
								spanId: LOG_SPAN_ID,
								attributes: [
									create(KeyValueSchema, {
										key: "request_id",
										value: create(AnyValueSchema, {
											value: { case: "stringValue", value: "abc" },
										}),
									}),
								],
							}),
						],
					}),
				],
			}),
		],
	});

describe("decodeLogsRequest", () => {
	it("round-trips an OTLP log via protobuf", () => {
		const bytes = toBinary(ExportLogsServiceRequestSchema, buildLogsMessage());
		const [log] = decodeLogsRequest({ bytes, wireFormat: "protobuf" });
		expect(log).toBeDefined();
		expect(log?.serviceName).toBe("checkout");
		expect(log?.loggerName).toBe("users");
		expect(log?.severity).toBe("ERROR");
		expect(log?.severityNumber).toBe(17);
		expect(log?.message).toBe("boom");
		expect(log?.traceId).toBe("112233445566778899aabbccddeeff00");
		expect(log?.spanId).toBe("deadbeefcafebabe");
		expect(log?.attributes).toEqual({ request_id: "abc" });
		expect(log?.occurredAt).toBe("2023-11-14T22:13:20.000Z");
	});

	it("round-trips an OTLP log via JSON", () => {
		const json = toJson(ExportLogsServiceRequestSchema, buildLogsMessage());
		const bytes = new TextEncoder().encode(JSON.stringify(json));
		const [log] = decodeLogsRequest({ bytes, wireFormat: "json" });
		expect(log?.serviceName).toBe("checkout");
		expect(log?.severity).toBe("ERROR");
		expect(log?.message).toBe("boom");
		expect(log?.traceId).toBe("112233445566778899aabbccddeeff00");
	});

	it("maps severity number to LogSeverity buckets", () => {
		const mk = (n: number) =>
			create(ExportLogsServiceRequestSchema, {
				resourceLogs: [
					create(ResourceLogsSchema, {
						scopeLogs: [
							create(ScopeLogsSchema, {
								logRecords: [
									create(LogRecordSchema, {
										severityNumber: n as SeverityNumber,
										body: create(AnyValueSchema, {
											value: { case: "stringValue", value: "x" },
										}),
									}),
								],
							}),
						],
					}),
				],
			});

		const sev = (n: number) =>
			decodeLogsRequest({
				bytes: toBinary(ExportLogsServiceRequestSchema, mk(n)),
				wireFormat: "protobuf",
			})[0]?.severity;

		expect(sev(5)).toBe("DEBUG");
		expect(sev(9)).toBe("INFO");
		expect(sev(13)).toBe("WARN");
		expect(sev(17)).toBe("ERROR");
		expect(sev(21)).toBe("FATAL");
	});

	it("falls back to severityText when severityNumber is unset", () => {
		const msg = create(ExportLogsServiceRequestSchema, {
			resourceLogs: [
				create(ResourceLogsSchema, {
					scopeLogs: [
						create(ScopeLogsSchema, {
							logRecords: [
								create(LogRecordSchema, {
									severityText: "warn",
									body: create(AnyValueSchema, {
										value: { case: "stringValue", value: "x" },
									}),
								}),
							],
						}),
					],
				}),
			],
		});
		const [log] = decodeLogsRequest({
			bytes: toBinary(ExportLogsServiceRequestSchema, msg),
			wireFormat: "protobuf",
		});
		expect(log?.severity).toBe("WARN");
	});

	it("returns empty trace/span IDs as null", () => {
		const msg = create(ExportLogsServiceRequestSchema, {
			resourceLogs: [
				create(ResourceLogsSchema, {
					scopeLogs: [
						create(ScopeLogsSchema, {
							logRecords: [
								create(LogRecordSchema, {
									severityNumber: SeverityNumber.INFO,
									body: create(AnyValueSchema, {
										value: { case: "stringValue", value: "x" },
									}),
								}),
							],
						}),
					],
				}),
			],
		});
		const [log] = decodeLogsRequest({
			bytes: toBinary(ExportLogsServiceRequestSchema, msg),
			wireFormat: "protobuf",
		});
		expect(log?.traceId).toBeNull();
		expect(log?.spanId).toBeNull();
	});
});

// ── Metrics ─────────────────────────────────────────────────────────────

const METRIC_TRACE_ID = new Uint8Array(16).fill(1);
const METRIC_SPAN_ID = new Uint8Array(8).fill(2);

const buildMetricsMessage = () =>
	create(ExportMetricsServiceRequestSchema, {
		resourceMetrics: [
			create(ResourceMetricsSchema, {
				resource: create(ResourceSchema, {
					attributes: [
						create(KeyValueSchema, {
							key: "service.name",
							value: create(AnyValueSchema, {
								value: { case: "stringValue", value: "checkout" },
							}),
						}),
					],
				}),
				scopeMetrics: [
					create(ScopeMetricsSchema, {
						scope: { name: "http", version: "1.0" },
						metrics: [
							create(MetricSchema, {
								name: "http.server.active_requests",
								unit: "1",
								description: "currently in-flight",
								data: {
									case: "gauge",
									value: create(GaugeSchema, {
										dataPoints: [
											create(NumberDataPointSchema, {
												timeUnixNano: 1_700_000_000_000_000_000n,
												value: { case: "asDouble", value: 42.5 },
												attributes: [
													create(KeyValueSchema, {
														key: "method",
														value: create(AnyValueSchema, {
															value: { case: "stringValue", value: "GET" },
														}),
													}),
												],
											}),
										],
									}),
								},
							}),
							create(MetricSchema, {
								name: "http.server.requests",
								data: {
									case: "sum",
									value: create(SumSchema, {
										isMonotonic: true,
										aggregationTemporality:
											AggregationTemporality.CUMULATIVE,
										dataPoints: [
											create(NumberDataPointSchema, {
												timeUnixNano: 1_700_000_000_000_000_000n,
												startTimeUnixNano: 1_699_999_000_000_000_000n,
												value: { case: "asInt", value: 128n },
												exemplars: [
													create(ExemplarSchema, {
														timeUnixNano: 1_700_000_000_000_000_000n,
														value: { case: "asDouble", value: 1 },
														traceId: METRIC_TRACE_ID,
														spanId: METRIC_SPAN_ID,
													}),
												],
											}),
										],
									}),
								},
							}),
							create(MetricSchema, {
								name: "http.server.duration",
								unit: "ms",
								data: {
									case: "histogram",
									value: create(HistogramSchema, {
										aggregationTemporality: AggregationTemporality.DELTA,
										dataPoints: [
											create(HistogramDataPointSchema, {
												timeUnixNano: 1_700_000_000_000_000_000n,
												count: 10n,
												sum: 250,
												min: 5,
												max: 90,
												explicitBounds: [10, 50, 100],
												bucketCounts: [3n, 4n, 2n, 1n],
											}),
										],
									}),
								},
							}),
						],
					}),
				],
			}),
		],
	});

describe("decodeMetricsRequest", () => {
	it("decodes gauge, sum, and histogram via protobuf", () => {
		const bytes = toBinary(
			ExportMetricsServiceRequestSchema,
			buildMetricsMessage(),
		);
		const points = decodeMetricsRequest({ bytes, wireFormat: "protobuf" });
		expect(points).toHaveLength(3);

		const gauge = points.find((p) => p.type === "gauge");
		expect(gauge?.name).toBe("http.server.active_requests");
		expect(gauge?.serviceName).toBe("checkout");
		expect(gauge?.scopeName).toBe("http");
		expect(gauge?.value).toBe(42.5);
		expect(gauge?.unit).toBe("1");
		expect(gauge?.tsNs).toBe("1700000000000000000");
		expect(gauge?.attributesJson).toBe('{"method":"GET"}');

		const sum = points.find((p) => p.type === "sum");
		expect(sum?.value).toBe(128);
		expect(sum?.isMonotonic).toBe(true);
		expect(sum?.temporality).toBe(AggregationTemporality.CUMULATIVE);
		expect(sum?.startTsNs).toBe("1699999000000000000");
		const exemplars = sum?.exemplarsJson
			? JSON.parse(sum.exemplarsJson)
			: [];
		expect(exemplars[0].value).toBe(1);
		expect(exemplars[0].traceId).toBe(
			"01010101010101010101010101010101",
		);
		expect(exemplars[0].spanId).toBe("0202020202020202");

		const hist = points.find((p) => p.type === "histogram");
		expect(hist?.count).toBe(10);
		expect(hist?.sum).toBe(250);
		expect(hist?.min).toBe(5);
		expect(hist?.max).toBe(90);
		expect(hist?.boundsJson).toBe("[10,50,100]");
		expect(hist?.bucketCountsJson).toBe("[3,4,2,1]");
		expect(hist?.temporality).toBe(AggregationTemporality.DELTA);
	});

	it("decodes via JSON identically to protobuf", () => {
		const json = toJson(
			ExportMetricsServiceRequestSchema,
			buildMetricsMessage(),
		);
		const bytes = new TextEncoder().encode(JSON.stringify(json));
		const points = decodeMetricsRequest({ bytes, wireFormat: "json" });
		expect(points).toHaveLength(3);
		const gauge = points.find((p) => p.type === "gauge");
		expect(gauge?.value).toBe(42.5);
	});

	it("produces deterministic identity across identical payloads", () => {
		const a = decodeMetricsRequest({
			bytes: toBinary(
				ExportMetricsServiceRequestSchema,
				buildMetricsMessage(),
			),
			wireFormat: "protobuf",
		});
		const b = decodeMetricsRequest({
			bytes: toBinary(
				ExportMetricsServiceRequestSchema,
				buildMetricsMessage(),
			),
			wireFormat: "protobuf",
		});
		expect(a.map((p) => p.identity)).toEqual(b.map((p) => p.identity));
	});

	it("gives different identity for different attributes", () => {
		const mk = (method: string) =>
			create(ExportMetricsServiceRequestSchema, {
				resourceMetrics: [
					create(ResourceMetricsSchema, {
						scopeMetrics: [
							create(ScopeMetricsSchema, {
								metrics: [
									create(MetricSchema, {
										name: "x",
										data: {
											case: "gauge",
											value: create(GaugeSchema, {
												dataPoints: [
													create(NumberDataPointSchema, {
														timeUnixNano: 1n,
														value: { case: "asDouble", value: 1 },
														attributes: [
															create(KeyValueSchema, {
																key: "method",
																value: create(AnyValueSchema, {
																	value: {
																		case: "stringValue",
																		value: method,
																	},
																}),
															}),
														],
													}),
												],
											}),
										},
									}),
								],
							}),
						],
					}),
				],
			});
		const [getP] = decodeMetricsRequest({
			bytes: toBinary(ExportMetricsServiceRequestSchema, mk("GET")),
			wireFormat: "protobuf",
		});
		const [postP] = decodeMetricsRequest({
			bytes: toBinary(ExportMetricsServiceRequestSchema, mk("POST")),
			wireFormat: "protobuf",
		});
		expect(getP?.identity).not.toEqual(postP?.identity);
	});

	it("returns empty array for metric with no data", () => {
		const msg = create(ExportMetricsServiceRequestSchema, {
			resourceMetrics: [
				create(ResourceMetricsSchema, {
					scopeMetrics: [
						create(ScopeMetricsSchema, {
							metrics: [create(MetricSchema, { name: "nope" })],
						}),
					],
				}),
			],
		});
		const points = decodeMetricsRequest({
			bytes: toBinary(ExportMetricsServiceRequestSchema, msg),
			wireFormat: "protobuf",
		});
		expect(points).toEqual([]);
	});

	it("decodes exponential histogram with positive/negative buckets", () => {
		const msg = create(ExportMetricsServiceRequestSchema, {
			resourceMetrics: [
				create(ResourceMetricsSchema, {
					scopeMetrics: [
						create(ScopeMetricsSchema, {
							metrics: [
								create(MetricSchema, {
									name: "latency.exp",
									unit: "ms",
									data: {
										case: "exponentialHistogram",
										value: create(ExponentialHistogramSchema, {
											aggregationTemporality:
												AggregationTemporality.CUMULATIVE,
											dataPoints: [
												create(ExponentialHistogramDataPointSchema, {
													timeUnixNano: 2_000_000_000_000_000_000n,
													count: 100n,
													sum: 5432,
													min: 1,
													max: 999,
													scale: 3,
													zeroCount: 5n,
													zeroThreshold: 0.001,
													positive: create(
														ExponentialHistogramDataPoint_BucketsSchema,
														{
															offset: -5,
															bucketCounts: [10n, 20n, 30n, 40n],
														},
													),
													negative: create(
														ExponentialHistogramDataPoint_BucketsSchema,
														{ offset: 0, bucketCounts: [] },
													),
												}),
											],
										}),
									},
								}),
							],
						}),
					],
				}),
			],
		});
		const [p] = decodeMetricsRequest({
			bytes: toBinary(ExportMetricsServiceRequestSchema, msg),
			wireFormat: "protobuf",
		});
		expect(p?.type).toBe("exp_histogram");
		expect(p?.count).toBe(100);
		expect(p?.sum).toBe(5432);
		expect(p?.min).toBe(1);
		expect(p?.max).toBe(999);
		expect(p?.temporality).toBe(AggregationTemporality.CUMULATIVE);
		const extra = JSON.parse(p?.extraJson ?? "{}");
		expect(extra.scale).toBe(3);
		expect(extra.zeroCount).toBe(5);
		expect(extra.zeroThreshold).toBe(0.001);
		expect(extra.positive.offset).toBe(-5);
		expect(extra.positive.bucketCounts).toEqual([10, 20, 30, 40]);
		expect(extra.negative.offset).toBe(0);
	});

	it("decodes summary with quantileValues", () => {
		const msg = create(ExportMetricsServiceRequestSchema, {
			resourceMetrics: [
				create(ResourceMetricsSchema, {
					scopeMetrics: [
						create(ScopeMetricsSchema, {
							metrics: [
								create(MetricSchema, {
									name: "request.duration.summary",
									data: {
										case: "summary",
										value: create(SummarySchema, {
											dataPoints: [
												create(SummaryDataPointSchema, {
													timeUnixNano: 3_000_000_000_000_000_000n,
													count: 1000n,
													sum: 45678,
													quantileValues: [
														create(
															SummaryDataPoint_ValueAtQuantileSchema,
															{ quantile: 0.5, value: 40 },
														),
														create(
															SummaryDataPoint_ValueAtQuantileSchema,
															{ quantile: 0.95, value: 120 },
														),
														create(
															SummaryDataPoint_ValueAtQuantileSchema,
															{ quantile: 0.99, value: 250 },
														),
													],
												}),
											],
										}),
									},
								}),
							],
						}),
					],
				}),
			],
		});
		const [p] = decodeMetricsRequest({
			bytes: toBinary(ExportMetricsServiceRequestSchema, msg),
			wireFormat: "protobuf",
		});
		expect(p?.type).toBe("summary");
		expect(p?.count).toBe(1000);
		expect(p?.sum).toBe(45678);
		expect(p?.value).toBeNull();
		const extra = JSON.parse(p?.extraJson ?? "{}");
		expect(extra.quantileValues).toEqual([
			{ quantile: 0.5, value: 40 },
			{ quantile: 0.95, value: 120 },
			{ quantile: 0.99, value: 250 },
		]);
	});
});
