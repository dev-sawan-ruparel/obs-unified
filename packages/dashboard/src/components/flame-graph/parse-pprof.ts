/**
 * Browser-side pprof helpers for the flame graph viewer. The wire-format
 * decoder lives in `@obs-unified/pprof-decoder` (shared with the collector); this
 * file adds the browser-only concerns:
 *
 *   - fetchAndDecodePprof — fetch a (gzipped) URL and decode.
 *   - aggregateFlameTree / flattenFlameTree — turn parsed samples into a
 *     stack-frame tree the renderer can paint.
 */

import { decodePprofBlob, type PprofProfile } from "@obs-unified/pprof-decoder";

// Re-export the parsed-pprof types so this file remains the canonical
// import for flame-graph consumers in the dashboard.
export {
	decodePprof,
	decodePprofBlob,
	type PprofFunction,
	type PprofLabel,
	type PprofLocation,
	type PprofProfile,
	type PprofSample,
	type PprofValueType,
} from "@obs-unified/pprof-decoder";

/**
 * Fetch + ungzip + parse. Browsers expose `DecompressionStream("gzip")`
 * natively across Chromium / Firefox / Safari — the same primitive the
 * collector uses on the Worker side.
 */
export const fetchAndDecodePprof = async (
	gzippedUrl: string,
	init?: RequestInit,
): Promise<PprofProfile> => {
	const res = await fetch(gzippedUrl, init);
	if (!res.ok) {
		throw new Error(`fetchAndDecodePprof: ${res.status} ${res.statusText}`);
	}
	const buf = await res.arrayBuffer();
	return decodePprofBlob(buf);
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

		// pprof stack frames are leaf-first; flame graph displays root-first,
		// so iterate in reverse.
		let cursor = root;
		for (let i = sample.locationIds.length - 1; i >= 0; i--) {
			const loc = profile.locations.get(sample.locationIds[i]);
			if (!loc) continue;
			// Inlined functions: a Location has multiple Lines, each pointing
			// at a Function. Iterate root-to-leaf for inlines too.
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
