import { describe, expect, it } from "vitest";
import {
	DEFAULT_INSTRUMENTATION_GAP_THRESHOLDS,
	isInstrumentationGapCandidate,
} from "./constants";

describe("instrumentation gap calibration rule", () => {
	it("flags the calibrated demo missing-instrumentation shape", () => {
		expect(
			isInstrumentationGapCandidate({
				durationMs: 540,
				selfRatio: 500 / 540,
				childSpanCount: 1,
				asyncParent: false,
			}),
		).toBe(true);
	});

	it("suppresses dense, tiny, low-ratio, and async fan-out spans", () => {
		const base = {
			durationMs: 540,
			selfRatio: 500 / 540,
			childSpanCount: 1,
			asyncParent: false,
		};

		expect(
			isInstrumentationGapCandidate({
				...base,
				childSpanCount:
					DEFAULT_INSTRUMENTATION_GAP_THRESHOLDS.maxChildSpanCount + 1,
			}),
		).toBe(false);
		expect(
			isInstrumentationGapCandidate({
				...base,
				durationMs: DEFAULT_INSTRUMENTATION_GAP_THRESHOLDS.minDurationMs,
			}),
		).toBe(false);
		expect(
			isInstrumentationGapCandidate({
				...base,
				selfRatio: DEFAULT_INSTRUMENTATION_GAP_THRESHOLDS.minSelfRatio,
			}),
		).toBe(false);
		expect(isInstrumentationGapCandidate({ ...base, asyncParent: true })).toBe(
			false,
		);
		expect(isInstrumentationGapCandidate({ ...base, spanKind: 3 })).toBe(false);
	});
});
