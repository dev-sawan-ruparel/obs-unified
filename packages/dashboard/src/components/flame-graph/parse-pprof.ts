/**
 * Minimal pprof decoder — extracts only what the flame-graph viewer needs.
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
 * Fetch + ungzip + parse. Browsers expose `DecompressionStream("gzip")`
 * natively (Chromium/Firefox/Safari all support it). Workers do too.
 */
export const fetchAndDecodePprof = async (
	gzippedUrl: string,
	init?: RequestInit,
): Promise<PprofProfile> => {
	const res = await fetch(gzippedUrl, init);
	if (!res.ok) {
		throw new Error(
			`fetchAndDecodePprof: ${res.status} ${res.statusText}`,
		);
	}
	if (!res.body) throw new Error("fetchAndDecodePprof: no response body");
	// Some servers (or proxies) automatically decompress; sniff first.
	const buf = new Uint8Array(await res.arrayBuffer());
	let raw: Uint8Array;
	if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
		// gzip magic — needs decompression.
		const stream = new Response(buf).body!.pipeThrough(
			new DecompressionStream("gzip"),
		);
		raw = new Uint8Array(await new Response(stream).arrayBuffer());
	} else {
		raw = buf;
	}
	return decodePprof(raw);
};

// ── Stack tree aggregation ───────────────────────────────────────────

export interface FlameNode {
	name: string;
	value: number;
	children: Map<string, FlameNode>;
	/** Runtime-only — set by `flatten` for rendering. */
	depth?: number;
}

export interface AggregateOptions {
	/** Optional filter — only samples whose `trace_id` label matches.
	 *  Pass undefined to include all samples. */
	traceIdFilter?: string;
	/** Which sample value index to use. Defaults to 0 (the primary). */
	valueIndex?: number;
}

const TRACE_ID_LABEL_KEYS = ["trace_id", "trace.id"];

/**
 * Aggregate pprof samples into a stack-frame tree. Each node represents
 * a function; node.value is the summed sample weight rooted at that
 * call path. Returns the synthetic root node ("__root__") plus the
 * total weight for percentage calculations.
 */
export const aggregateFlameTree = (
	profile: PprofProfile,
	opts: AggregateOptions = {},
): { root: FlameNode; total: number } => {
	const valueIndex = opts.valueIndex ?? 0;
	const traceIdKeys = new Set<number>();
	if (opts.traceIdFilter !== undefined) {
		for (let i = 0; i < profile.stringTable.length; i++) {
			if (TRACE_ID_LABEL_KEYS.includes(profile.stringTable[i])) {
				traceIdKeys.add(i);
			}
		}
	}

	const root: FlameNode = {
		name: "__root__",
		value: 0,
		children: new Map(),
	};
	let total = 0;

	for (const sample of profile.samples) {
		// Filter by trace_id if requested. pprof samples store labels
		// where label.strIdx points into stringTable; compare by string.
		if (opts.traceIdFilter !== undefined) {
			let matched = false;
			for (const label of sample.labels) {
				if (
					traceIdKeys.has(label.keyIdx) &&
					profile.stringTable[label.strIdx] === opts.traceIdFilter
				) {
					matched = true;
					break;
				}
			}
			if (!matched) continue;
		}

		const value = sample.values[valueIndex] ?? 0;
		if (value <= 0) continue;
		total += value;
		root.value += value;

		// pprof stack frames are leaf-first; flame graph displays
		// root-first, so iterate in reverse.
		let cursor = root;
		for (let i = sample.locationIds.length - 1; i >= 0; i--) {
			const loc = profile.locations.get(sample.locationIds[i]);
			if (!loc) continue;
			// Inlined functions: a Location has multiple Lines, each
			// pointing at a Function. Iterate root-to-leaf for inlines too.
			for (let j = loc.functionIds.length - 1; j >= 0; j--) {
				const fn = profile.functions.get(loc.functionIds[j]);
				if (!fn) continue;
				const name = profile.stringTable[fn.nameIdx] ?? "?";
				let child = cursor.children.get(name);
				if (!child) {
					child = { name, value: 0, children: new Map() };
					cursor.children.set(name, child);
				}
				child.value += value;
				cursor = child;
			}
		}
	}

	return { root, total };
};

/**
 * Flatten the aggregated tree into an ordered list with depth info,
 * suitable for one pass of SVG rendering.
 */
export const flattenFlameTree = (
	root: FlameNode,
): Array<FlameNode & { depth: number; offset: number }> => {
	const out: Array<FlameNode & { depth: number; offset: number }> = [];
	const walk = (node: FlameNode, depth: number, offset: number) => {
		out.push({ ...node, depth, offset });
		// Children sorted by value desc so the visual heat lands on the
		// left of each row.
		const sorted = Array.from(node.children.values()).sort(
			(a, b) => b.value - a.value,
		);
		let cursor = offset;
		for (const child of sorted) {
			walk(child, depth + 1, cursor);
			cursor += child.value;
		}
	};
	walk(root, 0, 0);
	return out;
};
