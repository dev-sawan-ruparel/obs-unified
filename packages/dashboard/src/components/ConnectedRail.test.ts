import { describe, expect, it } from "vitest";
import { normalizeConnectedHref } from "./ConnectedRail";

describe("normalizeConnectedHref", () => {
	it("maps legacy trace detail hrefs to the current router query shape", () => {
		expect(normalizeConnectedHref("#/traces/trace-1")).toBe(
			"#/traces?trace=trace-1",
		);
		expect(normalizeConnectedHref("#/traces/trace-1#span=span-2")).toBe(
			"#/traces?trace=trace-1&span=span-2",
		);
	});

	it("maps collapsed trace search hrefs to trace selection", () => {
		expect(normalizeConnectedHref("#/traces?q=trace-heavy")).toBe(
			"#/traces?trace=trace-heavy",
		);
	});

	it("keeps profile detail routes and normalizes trace filters", () => {
		expect(normalizeConnectedHref("#/profiles/prof-1?trace_id=trace-1")).toBe(
			"#/profiles/prof-1?trace_id=trace-1",
		);
		expect(normalizeConnectedHref("#/profiles/prof%2Fencoded?trace=tr-A")).toBe(
			"#/profiles/prof%2Fencoded?trace_id=tr-A",
		);
	});

	it("keeps supported entity routes intact and downgrades unsupported query-only tabs", () => {
		expect(normalizeConnectedHref("#/agent-runs/run-1")).toBe(
			"#/agent-runs/run-1",
		);
		expect(normalizeConnectedHref("#/actions/action-1")).toBe(
			"#/actions/action-1",
		);
		expect(normalizeConnectedHref("#/ai?id=call-1")).toBe("#/ai");
		expect(normalizeConnectedHref("#/logs?id=log-1")).toBe("#/logs");
	});
});
