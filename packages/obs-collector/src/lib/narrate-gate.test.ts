import type { AnalysisResult } from "@obs-unified/types";
import { describe, expect, it } from "vitest";
import { computeSignature, evaluateGate, parsePredicate } from "./narrate-gate";

const baseResult = (
	overrides: Partial<AnalysisResult> = {},
): AnalysisResult => ({
	analysisId: "x",
	projectId: "default",
	generatedAt: "2026-04-27T00:00:00Z",
	paramsHash: null,
	status: "ok",
	primaryValue: 1,
	baselineValue: 1,
	deltaPct: 0,
	payload: {},
	narrative: null,
	narrativeSignature: "ok|1.0|1.0|",
	durationMs: 1,
	...overrides,
});

describe("narrate-gate parser", () => {
	it("parses simple atoms", () => {
		const cases = ["status_changed", "signature_changed", "always", "never"];
		for (const c of cases) {
			const r = parsePredicate(c);
			expect(r.kind).toBe("ok");
		}
	});

	it("parses delta_pct comparators with longest-first matching", () => {
		const r = parsePredicate("delta_pct>=10");
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") {
			expect(r.conjunctions[0]?.[0]).toEqual({
				kind: "delta_pct",
				op: ">=",
				value: 10,
			});
		}
	});

	it("parses && and || with DNF semantics", () => {
		const r = parsePredicate(
			"status_changed && delta_pct>20 || signature_changed",
		);
		expect(r.kind).toBe("ok");
		if (r.kind === "ok") {
			expect(r.conjunctions).toHaveLength(2);
			expect(r.conjunctions[0]).toHaveLength(2);
			expect(r.conjunctions[1]).toHaveLength(1);
		}
	});

	it("rejects unknown atoms", () => {
		const r = parsePredicate("foo_bar");
		expect(r.kind).toBe("error");
	});

	it("rejects delta_pct without comparator", () => {
		const r = parsePredicate("delta_pct 10");
		expect(r.kind).toBe("error");
	});
});

describe("evaluateGate intents", () => {
	it("returns 'skip' when spec is undefined", () => {
		// `evaluateGate(undefined, …)` defaults to status_changed; without
		// previous, this always fires. To get skip we pass `never`.
		expect(
			evaluateGate("never", { current: baseResult(), previous: null }),
		).toBe("skip");
	});

	it("returns 'call' on first run when spec is present", () => {
		expect(
			evaluateGate("status_changed", {
				current: baseResult({ status: "warn" }),
				previous: null,
			}),
		).toBe("call");
	});

	it("returns 'reuse' when signature unchanged", () => {
		const sig = "ok|1.0|1.0|";
		const previous = baseResult({
			narrative: "everything's fine",
			narrativeSignature: sig,
		});
		const current = baseResult({ narrativeSignature: sig });
		expect(evaluateGate("status_changed", { current, previous })).toBe("reuse");
	});

	it("status_changed fires when status moves", () => {
		const prev = baseResult({
			status: "ok",
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			status: "critical",
			narrativeSignature: "critical|1.0|1.0|",
		});
		expect(
			evaluateGate("status_changed", { current: cur, previous: prev }),
		).toBe("call");
	});

	it("delta_pct>N fires when |delta| exceeds threshold", () => {
		const prev = baseResult({
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			deltaPct: 30,
			narrativeSignature: "ok|1.3|1.0|",
		});
		expect(evaluateGate("delta_pct>20", { current: cur, previous: prev })).toBe(
			"call",
		);
	});

	it("delta_pct>N treats negative deltas as magnitude", () => {
		const prev = baseResult({
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			deltaPct: -45,
			narrativeSignature: "ok|0.55|1.0|",
		});
		expect(evaluateGate("delta_pct>30", { current: cur, previous: prev })).toBe(
			"call",
		);
	});

	it("OR semantics: either side fires", () => {
		const prev = baseResult({
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			deltaPct: 5, // below threshold
			status: "warn", // status changed
			narrativeSignature: "warn|1.05|1.0|",
		});
		expect(
			evaluateGate("status_changed || delta_pct>20", {
				current: cur,
				previous: prev,
			}),
		).toBe("call");
	});

	it("AND semantics: both must hold", () => {
		const prev = baseResult({
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			deltaPct: 5,
			status: "warn",
			narrativeSignature: "warn|1.05|1.0|",
		});
		expect(
			evaluateGate("status_changed && delta_pct>20", {
				current: cur,
				previous: prev,
			}),
		).toBe("reuse"); // delta below threshold blocks; we have prev narrative
	});

	it("falls back to reuse when gate doesn't fire and previous narrative exists", () => {
		const prev = baseResult({
			narrative: "checkpoint",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({ narrativeSignature: "ok|1.05|1.0|" });
		expect(
			evaluateGate("status_changed", { current: cur, previous: prev }),
		).toBe("reuse");
	});

	it("falls back to skip when gate doesn't fire and there's no previous narrative", () => {
		const prev = baseResult({
			narrative: null,
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({ narrativeSignature: "ok|1.05|1.0|" });
		expect(
			evaluateGate("status_changed", { current: cur, previous: prev }),
		).toBe("skip");
	});

	it("malformed predicate falls back to status_changed", () => {
		const prev = baseResult({
			status: "ok",
			narrative: "old",
			narrativeSignature: "ok|1.0|1.0|",
		});
		const cur = baseResult({
			status: "warn",
			narrativeSignature: "warn|1.0|1.0|",
		});
		expect(
			evaluateGate("totally_made_up_atom", { current: cur, previous: prev }),
		).toBe("call");
	});
});

describe("computeSignature", () => {
	it("rounds primary value coarsely so noise doesn't bust the cache", () => {
		const a = computeSignature({
			status: "ok",
			primaryValue: 1.241,
			baselineValue: 1.0,
			payload: {},
		});
		const b = computeSignature({
			status: "ok",
			primaryValue: 1.243,
			baselineValue: 1.0,
			payload: {},
		});
		expect(a).toBe(b);
	});

	it("changes when status changes", () => {
		const a = computeSignature({
			status: "ok",
			primaryValue: 1,
			baselineValue: 1,
			payload: {},
		});
		const b = computeSignature({
			status: "warn",
			primaryValue: 1,
			baselineValue: 1,
			payload: {},
		});
		expect(a).not.toBe(b);
	});

	it("incorporates payload.signatureKey when set", () => {
		const a = computeSignature({
			status: "ok",
			primaryValue: 1,
			baselineValue: 1,
			payload: { signatureKey: "checkout" },
		});
		const b = computeSignature({
			status: "ok",
			primaryValue: 1,
			baselineValue: 1,
			payload: { signatureKey: "payment" },
		});
		expect(a).not.toBe(b);
	});
});
