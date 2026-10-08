/**
 * Trust-boundary tests for @obsunified/pprof-decoder.
 *
 * The collector decodes pprof bytes straight from untrusted producers
 * (telemetry-sdk emitters and Beyla agents). Bugs in this decoder either
 * crash the receiver or silently produce wrong analytics. The tests
 * focus on (a) the encode→decode round trip we rely on for the trace_id
 * filter and (b) failure modes on malformed input.
 */

import { describe, expect, it } from "vitest";
import {
	decodePprof,
	decodePprofBlob,
	encodePprof,
	gzipBytes,
	type PprofProfile,
	Reader,
} from "./index";

const emptyProfile = (): PprofProfile => ({
	sampleTypes: [],
	samples: [],
	locations: new Map(),
	functions: new Map(),
	stringTable: [""],
});

const tinyProfile = (): PprofProfile => {
	const stringTable = [
		"",
		"cpu",
		"nanoseconds",
		"main.handle",
		"main.go",
		"trace_id",
		"abc123def4567890",
	];
	const functions = new Map();
	functions.set(1, { id: 1, nameIdx: 3, filenameIdx: 4 });
	const locations = new Map();
	locations.set(1, {
		id: 1,
		lines: [{ functionId: 1, line: 42 }],
		functionIds: [1],
	});
	return {
		sampleTypes: [{ typeIdx: 1, unitIdx: 2 }],
		samples: [
			{
				locationIds: [1],
				values: [500],
				labels: [{ keyIdx: 5, strIdx: 6, num: 0 }],
			},
		],
		locations,
		functions,
		stringTable,
	};
};

describe("pprof-decoder round-trip", () => {
	it("decodes a tiny encoded profile preserving structure", () => {
		const encoded = encodePprof(tinyProfile());
		const decoded = decodePprof(encoded);

		expect(decoded.stringTable).toEqual([
			"",
			"cpu",
			"nanoseconds",
			"main.handle",
			"main.go",
			"trace_id",
			"abc123def4567890",
		]);
		expect(decoded.sampleTypes).toEqual([{ typeIdx: 1, unitIdx: 2 }]);
		expect(decoded.samples).toHaveLength(1);
		expect(decoded.samples[0].values).toEqual([500]);
		expect(decoded.samples[0].locationIds).toEqual([1]);
		expect(decoded.samples[0].labels[0]).toEqual({
			keyIdx: 5,
			strIdx: 6,
			num: 0,
		});
		expect(decoded.functions.get(1)).toEqual({
			id: 1,
			nameIdx: 3,
			filenameIdx: 4,
		});
		expect(decoded.locations.get(1)).toEqual({
			id: 1,
			lines: [{ functionId: 1, line: 42 }],
			functionIds: [1],
		});
	});

	it("round-trips an empty profile to a non-throwing decode", () => {
		const decoded = decodePprof(encodePprof(emptyProfile()));
		expect(decoded.samples).toEqual([]);
		expect(decoded.locations.size).toBe(0);
		expect(decoded.functions.size).toBe(0);
	});
});

describe("pprof-decoder blob handling", () => {
	it("decodes a gzipped blob", async () => {
		const raw = encodePprof(tinyProfile());
		const gz = await gzipBytes(raw);
		expect(gz[0]).toBe(0x1f);
		expect(gz[1]).toBe(0x8b);
		const decoded = await decodePprofBlob(gz);
		expect(decoded.samples).toHaveLength(1);
	});

	it("decodes an uncompressed blob (no gzip magic) via passthrough", async () => {
		const raw = encodePprof(tinyProfile());
		const decoded = await decodePprofBlob(raw);
		expect(decoded.samples).toHaveLength(1);
	});

	it("accepts ArrayBuffer input", async () => {
		const raw = encodePprof(tinyProfile());
		const ab = raw.buffer.slice(
			raw.byteOffset,
			raw.byteOffset + raw.byteLength,
		) as ArrayBuffer;
		const decoded = await decodePprofBlob(ab);
		expect(decoded.samples).toHaveLength(1);
	});
});

describe("pprof-decoder error paths", () => {
	it("throws on truncated varint (high bit set, no continuation byte)", () => {
		// 0x80 keeps the continuation bit on but the buffer ends.
		const r = new Reader(new Uint8Array([0x80]));
		expect(() => r.readVarint()).toThrow(/unexpected end/);
	});

	it("throws on over-long varint (>10 bytes / shift > 63)", () => {
		// 11 bytes of 0xff would push shift past 63 before terminating.
		const bytes = new Uint8Array(11);
		for (let i = 0; i < 10; i++) bytes[i] = 0xff;
		bytes[10] = 0x7f;
		const r = new Reader(bytes);
		expect(() => r.readVarint()).toThrow(/too long/);
	});

	it("throws on readBytes out-of-range", () => {
		const r = new Reader(new Uint8Array([0x01, 0x02]));
		expect(() => r.readBytes(10)).toThrow(/out of range/);
	});

	it("throws on unsupported wire type in skipField", () => {
		const r = new Reader(new Uint8Array([0x00]));
		expect(() => r.skipField(7)).toThrow(/unsupported wire type/);
	});

	it("decodePprof throws on a truncated stream", () => {
		const encoded = encodePprof(tinyProfile());
		// Lop off the last 5 bytes — guaranteed to land mid-field.
		const truncated = encoded.slice(0, Math.max(0, encoded.length - 5));
		expect(() => decodePprof(truncated)).toThrow();
	});

	it("decodePprof skips unknown top-level fields without throwing", () => {
		// Construct a buffer that opens with a known field then an unknown
		// (field 99, wire 2 = length-delimited, len 3). The decoder must
		// skipField rather than choke.
		const known = encodePprof(emptyProfile());
		const unknown = new Uint8Array([
			(99 << 3) | 2, // tag: field 99, wire 2
			3, // len
			0x01,
			0x02,
			0x03,
		]);
		const merged = new Uint8Array(known.length + unknown.length);
		merged.set(known, 0);
		merged.set(unknown, known.length);
		expect(() => decodePprof(merged)).not.toThrow();
	});
});
