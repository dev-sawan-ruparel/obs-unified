import { isInstrumentationGapCandidate } from "@obs-unified/types";
import type { SpanDetail } from "./types";

/**
 * RFC 0005 — derived self-time + async-parent flag.
 *
 * `selfMs` = wall - sum(children's wall). Clamped to 0 for "async parents"
 * where children's durations exceed the parent's window (fan-out work that
 * doesn't sum into the parent's wall-clock). The async flag drives a striped
 * visualization that warns the viewer "self-time isn't meaningful for this row."
 */
export type SpanTreeNode = SpanDetail & {
	depth: number;
	selfMs: number;
	selfRatio: number;
	asyncParent: boolean;
	childCount: number;
};

export function buildSpanTree(spans: SpanDetail[]): SpanTreeNode[] {
	const children = new Map<string | null, SpanDetail[]>();
	for (const s of spans) {
		const parentKey = s.parentSpanId ?? null;
		if (!children.has(parentKey)) children.set(parentKey, []);
		children.get(parentKey)?.push(s);
	}

	const result: SpanTreeNode[] = [];
	const walk = (parentId: string | null, depth: number) => {
		const kids = children.get(parentId) ?? [];
		kids.sort((a, b) => a.startTime.localeCompare(b.startTime));
		for (const s of kids) {
			const myKids = children.get(s.spanId) ?? [];
			const childWall = myKids.reduce((acc, c) => acc + c.durationMs, 0);
			const rawSelf = s.durationMs - childWall;
			const asyncParent = rawSelf < 0;
			const selfMs = Math.max(0, rawSelf);
			const selfRatio =
				s.durationMs > 0 ? Math.min(1, selfMs / s.durationMs) : 0;
			result.push({
				...s,
				depth,
				selfMs,
				selfRatio,
				asyncParent,
				childCount: myKids.length,
			});
			walk(s.spanId, depth + 1);
		}
	};
	walk(null, 0);

	if (result.length < spans.length) {
		const seen = new Set(result.map((s) => s.spanId));
		for (const s of spans) {
			if (!seen.has(s.spanId)) {
				result.push({
					...s,
					depth: 0,
					selfMs: s.durationMs,
					selfRatio: 1,
					asyncParent: false,
					childCount: 0,
				});
			}
		}
	}

	return result;
}

export const isLikelyUninstrumented = (s: SpanTreeNode): boolean =>
	isInstrumentationGapCandidate({
		durationMs: s.durationMs,
		selfRatio: s.selfRatio,
		childSpanCount: s.childCount,
		asyncParent: s.asyncParent,
		spanKind: s.spanKind,
	});
