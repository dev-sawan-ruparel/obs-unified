/**
 * Minimal pprof decoder — server-side copy.
 *
 * Mirrors `packages/dashboard/src/components/flame-graph/parse-pprof.ts`
 * (modulo the browser-only `fetchAndDecodePprof` helper). Used at
 * ingest by `profile-routes.ts` to extract distinct trace_id labels
 * from the blob and populate `profile_trace_index` automatically,
 * closing the header-driven shortcut from Phase 4.
 *
 * Both copies are pure JS and stable. If the format gains a field we
 * care about, update both. Kept duplicated rather than extracted to a
 * shared workspace package because (a) the file is < 500 LOC, (b)
 * extracting would require either crossing the browser↔Worker runtime
 * boundary in `@obs/telemetry-sdk` or adding a 6th workspace package
 * for one decoder.
 *
 * The pprof format is protobuf-encoded and gzipped. We avoid pulling
 * `pprof-format` (which transitively pulls protobufjs) by reading the
 * subset of fields we care about directly:
 *
 *   - Profile.sample
 *   - Profile.location
 *   - Profile.function
 *   - Profile.string_table
 *   - Sample.value (the primary metric — first entry)
 *   - Sample.label (for trace_id filtering)
 *   - Location.line.function_id (for stack resolution)
 *
 * Skips Mapping, drop_frames, time_nanos, period, comments — none of
 * those affect a flame graph render.
 *
 * Wire format reference: https://protobuf.dev/programming-guides/encoding/
 * pprof message definitions: https://github.com/google/pprof/blob/main/proto/profile.proto
 */

// ── Wire types ────────────────────────────────────────────────────────

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

class Reader {
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
			// JS numbers handle up to 2^53; for fields we care about
			// (string-table indices, function ids) this is plenty.
			result += (byte & 0x7f) * 2 ** shift;
			if ((byte & 0x80) === 0) return result;
			shift += 7;
			if (shift > 63) throw new Error("varint: too long");
		}
	}

	readZigzag(): number {
		const v = this.readVarint();
		return (v >>> 1) ^ -(v & 1);
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
		// pprof string_table is UTF-8.
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

	subReader(len: number): Reader {
		const slice = this.readBytes(len);
		return new Reader(slice);
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
		else if (fieldNum === 2 && wire === WIRE_VARINT) label.strIdx = r.readVarint();
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
		else if (fieldNum === 2 && wire === WIRE_VARINT) fn.nameIdx = r.readVarint();
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
		else if (fieldNum === 2 && wire === WIRE_VARINT) vt.unitIdx = r.readVarint();
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
 * Decompress (if needed) + decode a raw pprof byte buffer.
 * Workers expose `DecompressionStream("gzip")` natively. Server-side
 * counterpart of the dashboard's `fetchAndDecodePprof` — the input is
 * already the request body (Cloudflare Workers gives us
 * `c.req.arrayBuffer()`), so there's no fetch step.
 */
export const decodePprofBlob = async (
	body: ArrayBuffer | Uint8Array,
): Promise<PprofProfile> => {
	const buf = body instanceof Uint8Array ? body : new Uint8Array(body);
	let raw: Uint8Array;
	// gzip magic byte sniff — uploaders may pre-decompress, but the
	// canonical wire form is gzipped.
	if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		// Cast: Uint8Array is a valid BodyInit at runtime in Workers and
		// browsers; TS lib types disagree. The resulting Response wraps
		// the underlying ArrayBuffer.
		const stream = new Response(buf as unknown as BodyInit).body!.pipeThrough(
			new DecompressionStream("gzip"),
		);
		raw = new Uint8Array(await new Response(stream).arrayBuffer());
	} else {
		raw = buf;
	}
	return decodePprof(raw);
};

/**
 * Extract distinct trace_id label values from a parsed pprof. Returns
 * an array of valid 16-32 hex-char trace_ids, deduplicated. Used at
 * ingest to populate `profile_trace_index` without trusting the
 * `x-obs-trace-ids` header. Defensive against malformed labels —
 * silently ignores anything that doesn't look like a trace_id.
 */
const TRACE_ID_LABEL_KEYS = ["trace_id", "trace.id"];
const TRACE_ID_RE = /^[0-9a-f]{16,32}$/i;

export const extractTraceIdsFromProfile = (
	profile: PprofProfile,
): string[] => {
	const traceIdKeyIxs = new Set<number>();
	for (let i = 0; i < profile.stringTable.length; i++) {
		if (TRACE_ID_LABEL_KEYS.includes(profile.stringTable[i])) {
			traceIdKeyIxs.add(i);
		}
	}
	if (traceIdKeyIxs.size === 0) return [];

	const traceIds = new Set<string>();
	for (const sample of profile.samples) {
		for (const label of sample.labels) {
			if (!traceIdKeyIxs.has(label.keyIdx)) continue;
			const value = profile.stringTable[label.strIdx]?.toLowerCase();
			if (value && TRACE_ID_RE.test(value)) traceIds.add(value);
		}
	}
	return Array.from(traceIds);
};

/**
 * Re-serialize a parsed pprof keeping only samples whose trace_id label
 * matches `traceIdFilter`. Returns gzipped bytes ready to ship back.
 *
 * Implementation note: location / function / string_table tables are
 * preserved verbatim — unused entries become dead weight in the output
 * but the result is still a valid pprof, and the wire savings come
 * almost entirely from the sample list (which is ~80% of a typical
 * blob). Compacting the auxiliary tables is a Phase 4+ optimization.
 */
export const filterPprofByTraceId = async (
	profile: PprofProfile,
	traceIdFilter: string,
): Promise<Uint8Array> => {
	const want = traceIdFilter.toLowerCase();
	const traceIdKeyIxs = new Set<number>();
	for (let i = 0; i < profile.stringTable.length; i++) {
		if (TRACE_ID_LABEL_KEYS.includes(profile.stringTable[i])) {
			traceIdKeyIxs.add(i);
		}
	}
	const filtered: PprofProfile = {
		...profile,
		samples: profile.samples.filter((s) =>
			s.labels.some(
				(l) =>
					traceIdKeyIxs.has(l.keyIdx) &&
					profile.stringTable[l.strIdx]?.toLowerCase() === want,
			),
		),
	};
	const encoded = encodePprof(filtered);
	// Gzip the result — DecompressionStream's compress sibling is
	// CompressionStream, also Workers-native.
	const stream = new Response(encoded as unknown as BodyInit).body!.pipeThrough(
		new CompressionStream("gzip"),
	);
	return new Uint8Array(await new Response(stream).arrayBuffer());
};

// ── Encoder for the filtered re-serialization path ────────────────────
// Symmetric to the decoder above; only emits the fields we care about.

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

const writeString = (
	out: number[],
	fieldNum: number,
	str: string,
): void => {
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

const encodePprof = (profile: PprofProfile): Uint8Array => {
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

// Stack-tree aggregation lives in the dashboard copy — the collector
// only needs decode + extract + filter for the ingest and pre-filter
// paths. Server-side rendering of flame graphs would re-introduce that
// code; deliberately not built today.
