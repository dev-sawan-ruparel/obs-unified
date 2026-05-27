/**
 * Minimal pprof decoder + encoder. Shared between the collector (server-
 * side ingest parsing) and the dashboard (browser-side flame graph
 * rendering). Both runtimes expose DecompressionStream/CompressionStream
 * natively, so gzip handling lives here too.
 *
 * Why hand-rolled rather than `pprof-format` / `protobufjs`:
 *   - we only need 5 of pprof's message types (sample, location, function,
 *     value_type, string_table) — protobufjs pulls in a full reflection
 *     runtime that triples the dashboard bundle for no upside
 *   - the wire-format reader is < 100 lines and pure JS, deployable to
 *     Workers without polyfills
 *
 * Wire format reference: https://protobuf.dev/programming-guides/encoding/
 * pprof message definitions: https://github.com/google/pprof/blob/main/proto/profile.proto
 *
 * Fields read: Profile.{sample_type, sample, location, function, string_table};
 * Sample.{location_id, value, label}; Location.line.function_id; Function.{name, filename}.
 *
 * Fields explicitly skipped: Mapping, drop_frames, time_nanos, period,
 * comments — none affect a flame graph render. If pprof gains a field
 * we care about, extend decodePprof here once.
 */

// ── Wire types ────────────────────────────────────────────────────────

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

export class Reader {
	private pos = 0;
	constructor(private readonly buf: Uint8Array) {}

	get eof(): boolean {
		return this.pos >= this.buf.length;
	}

	get position(): number {
		return this.pos;
	}

	readVarint(): number {
		let result = 0;
		let shift = 0;
		while (true) {
			if (this.pos >= this.buf.length) {
				throw new Error("varint: unexpected end of buffer");
			}
			const byte = this.buf[this.pos++];
			// JS numbers are precise up to 2^53. pprof fields we read
			// (string-table indices, function ids, sample values) all fit.
			// We cap shift at 63 to catch malformed 11+ byte varints.
			result += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) return result;
			shift += 7;
			if (shift > 63) throw new Error("varint: too long");
		}
	}

	readBytes(len: number): Uint8Array {
		if (this.pos + len > this.buf.length) {
			throw new Error("readBytes: out of range");
		}
		const slice = this.buf.subarray(this.pos, this.pos + len);
		this.pos += len;
		return slice;
	}

	readString(len: number): string {
		const bytes = this.readBytes(len);
		return new TextDecoder().decode(bytes);
	}

	skipField(wireType: number): void {
		switch (wireType) {
			case WIRE_VARINT:
				this.readVarint();
				return;
			case WIRE_FIXED64:
				this.pos += 8;
				return;
			case WIRE_LENGTH_DELIMITED: {
				const len = this.readVarint();
				this.pos += len;
				return;
			}
			case WIRE_FIXED32:
				this.pos += 4;
				return;
			default:
				throw new Error(`unsupported wire type: ${wireType}`);
		}
	}
}

// ── pprof types we care about ────────────────────────────────────────

export interface PprofLabel {
	keyIdx: number;
	strIdx: number;
	num: number;
}

export interface PprofSample {
	locationIds: number[];
	values: number[];
	labels: PprofLabel[];
}

export interface PprofLocation {
	id: number;
	functionIds: number[];
}

export interface PprofFunction {
	id: number;
	nameIdx: number;
	filenameIdx: number;
}

export interface PprofValueType {
	typeIdx: number;
	unitIdx: number;
}

export interface PprofProfile {
	sampleTypes: PprofValueType[];
	samples: PprofSample[];
	locations: Map<number, PprofLocation>;
	functions: Map<number, PprofFunction>;
	stringTable: string[];
}

// ── Field-level decoders ─────────────────────────────────────────────

const decodePackedVarints = (r: Reader, len: number): number[] => {
	const end = r.position + len;
	const out: number[] = [];
	while (r.position < end) out.push(r.readVarint());
	return out;
};

const decodeLabel = (r: Reader, len: number): PprofLabel => {
	const end = r.position + len;
	const label: PprofLabel = { keyIdx: 0, strIdx: 0, num: 0 };
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_VARINT) label.keyIdx = r.readVarint();
		else if (fieldNum === 2 && wire === WIRE_VARINT)
			label.strIdx = r.readVarint();
		else if (fieldNum === 3 && wire === WIRE_VARINT) label.num = r.readVarint();
		else r.skipField(wire);
	}
	return label;
};

const decodeSample = (r: Reader, len: number): PprofSample => {
	const end = r.position + len;
	const sample: PprofSample = {
		locationIds: [],
		values: [],
		labels: [],
	};
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1) {
			// repeated uint64 location_id — usually packed
			if (wire === WIRE_LENGTH_DELIMITED) {
				const subLen = r.readVarint();
				sample.locationIds.push(...decodePackedVarints(r, subLen));
			} else if (wire === WIRE_VARINT) {
				sample.locationIds.push(r.readVarint());
			} else r.skipField(wire);
		} else if (fieldNum === 2) {
			// repeated int64 value — usually packed
			if (wire === WIRE_LENGTH_DELIMITED) {
				const subLen = r.readVarint();
				sample.values.push(...decodePackedVarints(r, subLen));
			} else if (wire === WIRE_VARINT) {
				sample.values.push(r.readVarint());
			} else r.skipField(wire);
		} else if (fieldNum === 3 && wire === WIRE_LENGTH_DELIMITED) {
			const subLen = r.readVarint();
			sample.labels.push(decodeLabel(r, subLen));
		} else r.skipField(wire);
	}
	return sample;
};

const decodeLine = (r: Reader, len: number): number => {
	const end = r.position + len;
	let functionId = 0;
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_VARINT) functionId = r.readVarint();
		else r.skipField(wire);
	}
	return functionId;
};

const decodeLocation = (r: Reader, len: number): PprofLocation => {
	const end = r.position + len;
	const loc: PprofLocation = { id: 0, functionIds: [] };
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_VARINT) loc.id = r.readVarint();
		else if (fieldNum === 4 && wire === WIRE_LENGTH_DELIMITED) {
			const subLen = r.readVarint();
			loc.functionIds.push(decodeLine(r, subLen));
		} else r.skipField(wire);
	}
	return loc;
};

const decodeFunction = (r: Reader, len: number): PprofFunction => {
	const end = r.position + len;
	const fn: PprofFunction = { id: 0, nameIdx: 0, filenameIdx: 0 };
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_VARINT) fn.id = r.readVarint();
		else if (fieldNum === 2 && wire === WIRE_VARINT)
			fn.nameIdx = r.readVarint();
		else if (fieldNum === 4 && wire === WIRE_VARINT)
			fn.filenameIdx = r.readVarint();
		else r.skipField(wire);
	}
	return fn;
};

const decodeValueType = (r: Reader, len: number): PprofValueType => {
	const end = r.position + len;
	const vt: PprofValueType = { typeIdx: 0, unitIdx: 0 };
	while (r.position < end) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_VARINT) vt.typeIdx = r.readVarint();
		else if (fieldNum === 2 && wire === WIRE_VARINT)
			vt.unitIdx = r.readVarint();
		else r.skipField(wire);
	}
	return vt;
};

// ── Top-level decoder ────────────────────────────────────────────────

export const decodePprof = (raw: Uint8Array): PprofProfile => {
	const r = new Reader(raw);
	const profile: PprofProfile = {
		sampleTypes: [],
		samples: [],
		locations: new Map(),
		functions: new Map(),
		stringTable: [],
	};

	while (!r.eof) {
		const tag = r.readVarint();
		const fieldNum = tag >>> 3;
		const wire = tag & 7;
		if (fieldNum === 1 && wire === WIRE_LENGTH_DELIMITED) {
			const len = r.readVarint();
			profile.sampleTypes.push(decodeValueType(r, len));
		} else if (fieldNum === 2 && wire === WIRE_LENGTH_DELIMITED) {
			const len = r.readVarint();
			profile.samples.push(decodeSample(r, len));
		} else if (fieldNum === 4 && wire === WIRE_LENGTH_DELIMITED) {
			const len = r.readVarint();
			const loc = decodeLocation(r, len);
			profile.locations.set(loc.id, loc);
		} else if (fieldNum === 5 && wire === WIRE_LENGTH_DELIMITED) {
			const len = r.readVarint();
			const fn = decodeFunction(r, len);
			profile.functions.set(fn.id, fn);
		} else if (fieldNum === 6 && wire === WIRE_LENGTH_DELIMITED) {
			const len = r.readVarint();
			profile.stringTable.push(r.readString(len));
		} else {
			r.skipField(wire);
		}
	}

	return profile;
};

/**
 * Decompress (if gzipped) + decode a raw pprof byte buffer. Workers and
 * modern browsers both expose `DecompressionStream("gzip")` natively, so
 * a single implementation serves both runtimes.
 */
export const decodePprofBlob = async (
	body: ArrayBuffer | Uint8Array,
): Promise<PprofProfile> => {
	const buf = body instanceof Uint8Array ? body : new Uint8Array(body);
	let raw: Uint8Array;
	// gzip magic byte sniff. Uploaders may pre-decompress, but the
	// canonical pprof wire form is gzipped.
	if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		// Cast: Uint8Array is a valid BodyInit at runtime in both Workers
		// and browsers; lib.dom types disagree.
		const stream = new Response(buf as unknown as BodyInit).body?.pipeThrough(
			new DecompressionStream("gzip"),
		);
		raw = new Uint8Array(await new Response(stream).arrayBuffer());
	} else {
		raw = buf;
	}
	return decodePprof(raw);
};

// ── Encoder (used by the server-side trace_id filter that re-emits a
// smaller blob; safe to expose from the shared package).
// Symmetric to the decoder above; only emits the fields we read.

const writeVarint = (out: number[], value: number): void => {
	while (value >= 0x80) {
		out.push((value & 0x7f) | 0x80);
		value = Math.floor(value / 128);
	}
	out.push(value & 0x7f);
};

const writeTag = (out: number[], fieldNum: number, wireType: number): void =>
	writeVarint(out, (fieldNum << 3) | wireType);

const writeLengthDelimited = (
	out: number[],
	fieldNum: number,
	bytes: number[] | Uint8Array,
): void => {
	writeTag(out, fieldNum, WIRE_LENGTH_DELIMITED);
	writeVarint(out, bytes.length);
	for (let i = 0; i < bytes.length; i++) out.push(bytes[i]);
};

const writeString = (out: number[], fieldNum: number, str: string): void => {
	const bytes = new TextEncoder().encode(str);
	writeLengthDelimited(out, fieldNum, bytes);
};

const writePackedVarints = (
	out: number[],
	fieldNum: number,
	values: number[],
): void => {
	if (values.length === 0) return;
	const inner: number[] = [];
	for (const v of values) writeVarint(inner, v);
	writeLengthDelimited(out, fieldNum, inner);
};

const encodeLabel = (label: PprofLabel): number[] => {
	const out: number[] = [];
	if (label.keyIdx) {
		writeTag(out, 1, WIRE_VARINT);
		writeVarint(out, label.keyIdx);
	}
	if (label.strIdx) {
		writeTag(out, 2, WIRE_VARINT);
		writeVarint(out, label.strIdx);
	}
	if (label.num) {
		writeTag(out, 3, WIRE_VARINT);
		writeVarint(out, label.num);
	}
	return out;
};

const encodeSample = (sample: PprofSample): number[] => {
	const out: number[] = [];
	writePackedVarints(out, 1, sample.locationIds);
	writePackedVarints(out, 2, sample.values);
	for (const label of sample.labels) {
		writeLengthDelimited(out, 3, encodeLabel(label));
	}
	return out;
};

const encodeValueType = (vt: PprofValueType): number[] => {
	const out: number[] = [];
	if (vt.typeIdx) {
		writeTag(out, 1, WIRE_VARINT);
		writeVarint(out, vt.typeIdx);
	}
	if (vt.unitIdx) {
		writeTag(out, 2, WIRE_VARINT);
		writeVarint(out, vt.unitIdx);
	}
	return out;
};

const encodeLocation = (loc: PprofLocation): number[] => {
	const out: number[] = [];
	if (loc.id) {
		writeTag(out, 1, WIRE_VARINT);
		writeVarint(out, loc.id);
	}
	for (const fid of loc.functionIds) {
		const lineBytes: number[] = [];
		if (fid) {
			writeTag(lineBytes, 1, WIRE_VARINT);
			writeVarint(lineBytes, fid);
		}
		writeLengthDelimited(out, 4, lineBytes);
	}
	return out;
};

const encodeFunction = (fn: PprofFunction): number[] => {
	const out: number[] = [];
	if (fn.id) {
		writeTag(out, 1, WIRE_VARINT);
		writeVarint(out, fn.id);
	}
	if (fn.nameIdx) {
		writeTag(out, 2, WIRE_VARINT);
		writeVarint(out, fn.nameIdx);
	}
	if (fn.filenameIdx) {
		writeTag(out, 4, WIRE_VARINT);
		writeVarint(out, fn.filenameIdx);
	}
	return out;
};

export const encodePprof = (profile: PprofProfile): Uint8Array => {
	const out: number[] = [];
	for (const vt of profile.sampleTypes) {
		writeLengthDelimited(out, 1, encodeValueType(vt));
	}
	for (const sample of profile.samples) {
		writeLengthDelimited(out, 2, encodeSample(sample));
	}
	for (const loc of profile.locations.values()) {
		writeLengthDelimited(out, 4, encodeLocation(loc));
	}
	for (const fn of profile.functions.values()) {
		writeLengthDelimited(out, 5, encodeFunction(fn));
	}
	for (const str of profile.stringTable) {
		writeString(out, 6, str);
	}
	return new Uint8Array(out);
};

/** Convenience: gzip a Uint8Array using CompressionStream. */
export const gzipBytes = async (bytes: Uint8Array): Promise<Uint8Array> => {
	const stream = new Response(bytes as unknown as BodyInit).body?.pipeThrough(
		new CompressionStream("gzip"),
	);
	return new Uint8Array(await new Response(stream).arrayBuffer());
};
