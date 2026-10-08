import type {
	LogSeverity,
	JsonValue as ObsJsonValue,
	OtlpAnyValue,
	OtlpKeyValue,
} from "@obsunified/types";
import type {
	AnyValue,
	KeyValue,
} from "../gen/opentelemetry/proto/common/v1/common_pb.js";

export const extractServiceName = (
	attrs: KeyValue[] | undefined,
): string | null => {
	if (!attrs) return null;
	const match = attrs.find((a) => a.key === "service.name");
	if (!match?.value) return null;
	return match.value.value.case === "stringValue"
		? match.value.value.value
		: null;
};

export const severityFromNumber = (n: number, text: string): LogSeverity => {
	if (n >= 21) return "FATAL";
	if (n >= 17) return "ERROR";
	if (n >= 13) return "WARN";
	if (n >= 9) return "INFO";
	if (n >= 5) return "DEBUG";
	if (n >= 1) return "DEBUG"; // TRACE collapsed to DEBUG
	// severityNumber unset — fall back to text, then INFO default.
	const upper = text.toUpperCase();
	if (
		upper === "FATAL" ||
		upper === "ERROR" ||
		upper === "WARN" ||
		upper === "INFO" ||
		upper === "DEBUG"
	)
		return upper;
	return "INFO";
};

export const anyValueToString = (v: AnyValue | undefined): string => {
	if (!v) return "";
	switch (v.value.case) {
		case "stringValue":
			return v.value.value;
		case "boolValue":
			return String(v.value.value);
		case "intValue":
			return v.value.value.toString();
		case "doubleValue":
			return String(v.value.value);
		case "bytesValue":
			return bytesToBase64(v.value.value);
		case "arrayValue":
		case "kvlistValue":
			return JSON.stringify(adaptAnyValue(v));
		default:
			return "";
	}
};

export const keyValuesToRecord = (
	kvs: KeyValue[],
): Record<string, ObsJsonValue> => {
	const out: Record<string, ObsJsonValue> = {};
	for (const kv of kvs) {
		out[kv.key] = anyValueToJson(kv.value);
	}
	return out;
};

const anyValueToJson = (v: AnyValue | undefined): ObsJsonValue => {
	if (!v) return null;
	switch (v.value.case) {
		case "stringValue":
			return v.value.value;
		case "boolValue":
			return v.value.value;
		case "intValue":
			// OTel int is int64. Downgrade safely; lossy above 2^53 but rare for attrs.
			return Number(v.value.value);
		case "doubleValue":
			return v.value.value;
		case "bytesValue":
			return bytesToBase64(v.value.value);
		case "arrayValue":
			return v.value.value.values.map((x) => anyValueToJson(x));
		case "kvlistValue":
			return keyValuesToRecord(v.value.value.values);
		default:
			return null;
	}
};

export const adaptKeyValue = (kv: KeyValue): OtlpKeyValue => ({
	key: kv.key,
	value: kv.value ? adaptAnyValue(kv.value) : undefined,
});

export const adaptAnyValue = (v: AnyValue): OtlpAnyValue => {
	switch (v.value.case) {
		case "stringValue":
			return { stringValue: v.value.value };
		case "boolValue":
			return { boolValue: v.value.value };
		case "intValue":
			return { intValue: v.value.value.toString() };
		case "doubleValue":
			return { doubleValue: v.value.value };
		case "arrayValue":
			return {
				arrayValue: {
					values: v.value.value.values.map((x) => adaptAnyValue(x)),
				},
			};
		case "kvlistValue":
			return {
				kvlistValue: {
					values: v.value.value.values.map(adaptKeyValue),
				},
			};
		case "bytesValue":
			// Surface bytes as base64 string — matches proto-JSON mapping spec.
			return { stringValue: bytesToBase64(v.value.value) };
		default:
			return {};
	}
};

const HEX_CHARS = "0123456789abcdef";
export const bytesToHex = (bytes: Uint8Array): string => {
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const b = bytes[i] ?? 0;
		out += HEX_CHARS[b >> 4];
		out += HEX_CHARS[b & 0xf];
	}
	return out;
};

export const bigintToString = (n: bigint): string => n.toString();

export const bytesToBase64 = (bytes: Uint8Array): string => {
	let binary = "";
	for (let i = 0; i < bytes.length; i++)
		binary += String.fromCharCode(bytes[i] ?? 0);
	return btoa(binary);
};
