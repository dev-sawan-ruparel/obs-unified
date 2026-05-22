/**
 * Gate-predicate evaluator for the RFC 0002 Stage 3 narrate layer.
 *
 * The gate is the single most important cost+noise control in the RFC.
 * Naive: every panel narrates every run → 600 sentences/hour at 10
 * panels. Real: only narrate when the system has actually changed.
 *
 * Mini-language (kept small on purpose):
 *
 *   status_changed
 *   delta_pct<op><number>          op ∈ {>, >=, <, <=, ==, !=}
 *   signature_changed
 *   always                         (skip the gate, still LLM call)
 *   never                          (don't narrate)
 *   <atom> && <atom> [&& ...]
 *   <atom> || <atom> [|| ...]
 *
 * `&&` binds tighter than `||` (standard precedence). No parens to
 * keep the parser tiny — if you need parens, split into two analyses.
 *
 * `evaluate()` returns one of three intents the runner needs:
 *   - "call"   : run the LLM
 *   - "reuse"  : keep previous narrative if any, no LLM call
 *   - "skip"   : narrative is null this run
 *
 * Why three states (not just true/false): when the gate doesn't fire
 * we still want to *show* the previous narrative ("(unchanged for 8 min)")
 * rather than blanking the panel. That's the "reuse" branch.
 */

import type { AnalysisResult } from "@obs-unified/types";

export type NarrativeIntent = "call" | "reuse" | "skip";

interface GateInputs {
	current: AnalysisResult;
	previous: AnalysisResult | null;
}

const COMPARATORS = ["<=", ">=", "==", "!=", "<", ">"] as const;
type Comparator = (typeof COMPARATORS)[number];

interface DeltaPctAtom {
	kind: "delta_pct";
	op: Comparator;
	value: number;
}

interface FlagAtom {
	kind: "status_changed" | "signature_changed" | "always" | "never";
}

type Atom = DeltaPctAtom | FlagAtom;

interface ParseError {
	kind: "error";
	message: string;
}

type ParseResult = { kind: "ok"; conjunctions: Atom[][] } | ParseError;

const stripWhitespace = (s: string) => s.replace(/\s+/g, "");

const parseAtom = (raw: string): Atom | ParseError => {
	const t = stripWhitespace(raw);
	if (!t) return { kind: "error", message: "empty atom" };
	if (t === "status_changed") return { kind: "status_changed" };
	if (t === "signature_changed") return { kind: "signature_changed" };
	if (t === "always") return { kind: "always" };
	if (t === "never") return { kind: "never" };

	if (t.startsWith("delta_pct")) {
		const rest = t.slice("delta_pct".length);
		// Probe operators longest-first so `>=` doesn't match as `>`.
		for (const op of COMPARATORS) {
			if (rest.startsWith(op)) {
				const numStr = rest.slice(op.length);
				const value = Number(numStr);
				if (!Number.isFinite(value)) {
					return {
						kind: "error",
						message: `delta_pct: not a number after ${op}: "${numStr}"`,
					};
				}
				return { kind: "delta_pct", op, value };
			}
		}
		return {
			kind: "error",
			message: `delta_pct: missing comparator (>, >=, <, <=, ==, !=)`,
		};
	}

	return { kind: "error", message: `unknown atom: "${t}"` };
};

/**
 * Parse `a && b || c && d` → `[[a, b], [c, d]]` (DNF, OR over ANDs).
 * Returned errors point at the offending atom, not character position —
 * good enough given how short these predicates are.
 */
export function parsePredicate(predicate: string): ParseResult {
	const orGroups = predicate.split("||");
	const conjunctions: Atom[][] = [];
	for (const group of orGroups) {
		const atoms: Atom[] = [];
		const parts = group.split("&&");
		for (const part of parts) {
			const atom = parseAtom(part);
			if ("kind" in atom && atom.kind === "error") return atom;
			atoms.push(atom as Atom);
		}
		conjunctions.push(atoms);
	}
	return { kind: "ok", conjunctions };
}

const compare = (op: Comparator, a: number, b: number): boolean => {
	switch (op) {
		case ">":
			return a > b;
		case ">=":
			return a >= b;
		case "<":
			return a < b;
		case "<=":
			return a <= b;
		case "==":
			return a === b;
		case "!=":
			return a !== b;
	}
};

const evalAtom = (atom: Atom, { current, previous }: GateInputs): boolean => {
	switch (atom.kind) {
		case "always":
			return true;
		case "never":
			return false;
		case "status_changed":
			if (previous === null) return true;
			return current.status !== previous.status;
		case "signature_changed":
			if (previous === null) return true;
			return current.narrativeSignature !== previous.narrativeSignature;
		case "delta_pct": {
			const dp = current.deltaPct;
			if (dp === null || !Number.isFinite(dp)) return false;
			return compare(atom.op, Math.abs(dp), atom.value);
		}
	}
};

/**
 * Decide what to do with the narrative this run.
 *
 *   - spec missing or `never`            → skip
 *   - first ever run AND spec present    → call (no previous to compare)
 *   - signature unchanged                → reuse previous narrative
 *                                          (the LLM would say the same
 *                                          thing — don't pay for it)
 *   - gate predicate evaluates true      → call
 *   - otherwise                          → reuse if previous narrative
 *                                          exists, else skip
 *
 * `signature_changed` short-circuits to skip when signatures match,
 * even if other clauses would fire — this keeps the cache invariant
 * "same signature ⇒ same narrative" airtight.
 */
export function evaluateGate(
	predicate: string | undefined,
	inputs: GateInputs,
): NarrativeIntent {
	const expr = (predicate ?? "status_changed").trim();
	if (expr === "" || expr === "never") return "skip";

	const { current, previous } = inputs;

	// Cache: same signature as last result ⇒ reuse the previous narrative
	// without LLM call. Even with `always` we don't pay twice for the same
	// state of the world.
	if (
		previous &&
		previous.narrative &&
		current.narrativeSignature !== null &&
		current.narrativeSignature === previous.narrativeSignature
	) {
		return "reuse";
	}

	// First-run-with-spec — no previous to compare to, so narrate.
	if (previous === null) return "call";

	const parsed = parsePredicate(expr);
	if (parsed.kind === "error") {
		// Don't blow up the runner over a malformed predicate; fall back to
		// "status_changed" which is the conservative default.
		console.log(`[narrate-gate] bad predicate "${expr}": ${parsed.message}`);
		const fallback = parsePredicate("status_changed");
		if (fallback.kind === "error") return "skip"; // unreachable
		return evaluateConjunctions(fallback.conjunctions, inputs)
			? "call"
			: previous.narrative
				? "reuse"
				: "skip";
	}

	const fired = evaluateConjunctions(parsed.conjunctions, inputs);
	if (fired) return "call";
	return previous.narrative ? "reuse" : "skip";
}

function evaluateConjunctions(
	conjunctions: Atom[][],
	inputs: GateInputs,
): boolean {
	// DNF: OR over ANDs.
	for (const group of conjunctions) {
		if (group.every((atom) => evalAtom(atom, inputs))) return true;
	}
	return false;
}

/**
 * Compute a narrative_signature from a result. The signature is what we
 * compare to decide "did the world actually change in a way the narrative
 * would describe?" — so it includes status, the rounded primary value,
 * and any caller-supplied identifiers from the payload (top services,
 * top errors, etc).
 *
 * Rounded coarsely so that 1.241% vs 1.243% don't both pay for an LLM call.
 */
export function computeSignature(input: {
	status: string;
	primaryValue: number | null;
	baselineValue: number | null;
	payload: Record<string, unknown>;
}): string {
	const round = (v: number | null): string => {
		if (v === null || !Number.isFinite(v)) return "n";
		// 3 sig figs for small numbers, 1% buckets for percentages we present
		// as such. Keep it simple — over-rounding hurts cache hit rate, under
		// hurts cost.
		if (Math.abs(v) >= 100) return Math.round(v).toString();
		if (Math.abs(v) >= 1) return v.toFixed(1);
		return v.toFixed(2);
	};
	const sigPayload =
		typeof input.payload?.signatureKey === "string"
			? (input.payload.signatureKey as string)
			: "";
	return `${input.status}|${round(input.primaryValue)}|${round(input.baselineValue)}|${sigPayload}`;
}
