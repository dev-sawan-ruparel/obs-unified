// ── Time-binning helpers ──

export function binByInterval(
	timestamps: string[],
	windowMins: number,
	bucketCount = 24,
): number[] {
	if (timestamps.length === 0) return new Array(bucketCount).fill(0);
	const now = Date.now();
	const bucketMs = (windowMins * 60 * 1000) / bucketCount;
	const start = now - windowMins * 60 * 1000;
	const buckets = new Array(bucketCount).fill(0);
	for (const ts of timestamps) {
		const t = new Date(ts).getTime();
		if (Number.isNaN(t)) continue;
		if (t < start || t > now) continue;
		const idx = Math.min(bucketCount - 1, Math.floor((t - start) / bucketMs));
		buckets[idx]++;
	}
	return buckets;
}

// ── Percentile helper ──

/** Linear-interpolated percentile. `p` is 0..1. Returns 0 for empty input. */
export function percentile(values: number[], p: number): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = (sorted.length - 1) * p;
	const lo = Math.floor(idx);
	const hi = Math.ceil(idx);
	if (lo === hi) return sorted[lo] ?? 0;
	const w = idx - lo;
	return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}
