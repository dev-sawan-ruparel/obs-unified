import type { JsonValue } from "@bufbuild/protobuf";
import type { Context } from "hono";

export type OtlpWireFormat = "json" | "protobuf";

export interface ReadBodyResult {
	bytes: Uint8Array;
	wireFormat: OtlpWireFormat;
}

export class OtlpDecodeError extends Error {
	constructor(
		message: string,
		public readonly status: 400 | 415,
	) {
		super(message);
	}
}

/**
 * Reads and decompresses an OTLP request body, returning the raw bytes plus
 * the inferred wire format. Throws `OtlpDecodeError` for unsupported content-
 * types or malformed gzip.
 */
export const readOtlpBody = async (c: Context): Promise<ReadBodyResult> => {
	const contentType = (c.req.header("content-type") ?? "").toLowerCase();
	const wireFormat = detectWireFormat(contentType);

	let body = await c.req.arrayBuffer();
	const encoding = (c.req.header("content-encoding") ?? "").toLowerCase();
	if (encoding === "gzip") {
		body = await gunzip(body);
	} else if (encoding && encoding !== "identity") {
		throw new OtlpDecodeError(`Unsupported content-encoding: ${encoding}`, 415);
	}

	return { bytes: new Uint8Array(body), wireFormat };
};

const detectWireFormat = (contentType: string): OtlpWireFormat => {
	if (contentType.includes("application/x-protobuf")) return "protobuf";
	if (contentType.includes("application/json")) return "json";
	throw new OtlpDecodeError(
		`Unsupported content-type: ${contentType || "(missing)"}`,
		415,
	);
};

const gunzip = async (input: ArrayBuffer): Promise<ArrayBuffer> => {
	const stream = new Response(input).body?.pipeThrough(
		new DecompressionStream("gzip"),
	);
	if (!stream) throw new OtlpDecodeError("Empty gzip body", 400);
	return new Response(stream).arrayBuffer();
};

export const decodeJsonBody = (bytes: Uint8Array): JsonValue => {
	const text = new TextDecoder().decode(bytes);
	if (!text.length) return {};
	const parsed = JSON.parse(text) as JsonValue;
	rewriteHexIdsToBase64(parsed);
	return parsed;
};

/**
 * The OTLP JSON encoding spec requires `trace_id` (16 bytes) and `span_id`
 * (8 bytes) to be lowercase hex strings — but proto-JSON's default encoding
 * for `bytes` fields is base64, which is what protobuf-es's `fromJson`
 * expects. The Go reference receiver accepts both; we do too, by walking
 * the parsed JSON and converting any hex-shaped ID field to base64 before
 * handing it to the schema decoder.
 *
 * Mutates the input in-place. Recognized field names cover every place a
 * trace/span ID appears in OTLP: span, link, log record, exemplar.
 */
const rewriteHexIdsToBase64 = (node: JsonValue): void => {
	if (Array.isArray(node)) {
		for (const item of node) rewriteHexIdsToBase64(item);
		return;
	}
	if (!node || typeof node !== "object") return;
	const obj = node as Record<string, JsonValue>;
	for (const key of Object.keys(obj)) {
		const value = obj[key];
		if (typeof value === "string") {
			if ((key === "traceId" || key === "trace_id") && isHex(value, 32)) {
				obj[key] = hexToBase64(value);
			} else if (
				(key === "spanId" ||
					key === "span_id" ||
					key === "parentSpanId" ||
					key === "parent_span_id") &&
				isHex(value, 16)
			) {
				obj[key] = hexToBase64(value);
			} else if (isTimestampKey(key) && !isUint64String(value)) {
				delete obj[key];
			}
		} else if (isTimestampKey(key) && typeof value !== "number") {
			delete obj[key];
		} else {
			rewriteHexIdsToBase64(value);
		}
	}
};

const isHex = (s: string, length: number): boolean =>
	s.length === length && /^[0-9a-f]+$/i.test(s);

const isTimestampKey = (key: string): boolean =>
	key === "timeUnixNano" ||
	key === "observedTimeUnixNano" ||
	key === "startTimeUnixNano" ||
	key === "endTimeUnixNano";

const isUint64String = (s: string): boolean => /^\d+$/.test(s);

const hexToBase64 = (hex: string): string => {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++)
		binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
};
