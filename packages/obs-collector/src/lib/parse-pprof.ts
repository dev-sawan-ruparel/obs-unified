/**
 * Collector-side pprof helpers. The wire-format decoder/encoder lives in
 * `@obs-unified/pprof-decoder` and is shared with the dashboard's flame graph
 * viewer; this file adds the server-specific concerns:
 *
 *   - extractTraceIdsFromProfile — pulls distinct trace_id labels from a
 *     parsed profile so `profile-routes.ts` can populate
 *     `profile_trace_index` without trusting the `x-obs-trace-ids` header.
 *   - filterPprofByTraceId — drops samples that don't carry the requested
 *     trace_id label and re-emits a smaller gzipped pprof. Powers the
 *     Phase 4.5 server-side pre-filter for the trace waterfall's 🔥 link.
 */

import {
	decodePprof,
	decodePprofBlob,
	encodePprof,
	gzipBytes,
	type PprofFunction,
	type PprofLabel,
	type PprofLocation,
	type PprofProfile,
	type PprofSample,
	type PprofValueType,
} from "@obs-unified/pprof-decoder";

// Re-exports keep call sites (profile-routes, tests) importing from one
// place — they don't need to know whether something lives upstream.
export {
	decodePprof,
	decodePprofBlob,
	encodePprof,
	type PprofFunction,
	type PprofLabel,
	type PprofLocation,
	type PprofProfile,
	type PprofSample,
	type PprofValueType,
};

const TRACE_ID_LABEL_KEYS = ["trace_id", "trace.id"];
const TRACE_ID_RE = /^[0-9a-f]{16,32}$/i;

/**
 * Extract distinct trace_id label values from a parsed pprof. Returns
 * an array of valid 16-32 hex-char trace_ids, deduplicated. Defensive
 * against malformed labels — silently ignores anything that doesn't
 * match the hex pattern (a malformed agent shouldn't pollute the index).
 */
export const extractTraceIdsFromProfile = (profile: PprofProfile): string[] => {
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
			const value = profile.stringTable[label.strIdx];
			if (value && TRACE_ID_RE.test(value)) {
				traceIds.add(value.toLowerCase());
			}
		}
	}
	return [...traceIds];
};

/**
 * Filter a pprof down to samples carrying the requested trace_id label
 * and re-emit a gzipped blob. location/function/string tables are
 * preserved verbatim — unused entries become dead weight in the output
 * but the result is still valid pprof, and the wire savings come almost
 * entirely from the sample list (~80% of a typical blob). Compacting
 * the auxiliary tables is a Phase 4+ optimization.
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
	return gzipBytes(encodePprof(filtered));
};
