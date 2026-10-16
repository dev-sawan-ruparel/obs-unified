import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findSpanForCallId } from "./ai/SpansView";
import {
	type EvalCase,
	humanizeLabel,
	resolveEvalCaseId,
} from "./EvaluationsDashboard";
import { focusNeighborhood, ServiceFocusChip } from "./ServiceMapDashboard";

const evalCase = (over: Partial<EvalCase>): EvalCase =>
	({
		id: "c1",
		sourceEntityType: "action",
		sourceEntityId: "src-1",
		...over,
	}) as EvalCase;

describe("EvaluationsDashboard selection", () => {
	it("humanizes every underscore", () => {
		expect(humanizeLabel("human_approved_write")).toBe("human approved write");
		expect(humanizeLabel("agent_run")).toBe("agent run");
	});

	it("resolves a case id directly or through its source entity", () => {
		const cases = [
			evalCase({ id: "c1", sourceActionId: "act-1" }),
			evalCase({ id: "c2", sourceEntityId: "src-2", sourceAiCallId: "call-2" }),
		];
		expect(resolveEvalCaseId("c2", cases)).toBe("c2");
		expect(resolveEvalCaseId("act-1", cases)).toBe("c1");
		expect(resolveEvalCaseId("call-2", cases)).toBe("c2");
		expect(resolveEvalCaseId("missing", cases)).toBeNull();
	});
});

describe("ServiceMapDashboard focus", () => {
	const edges = [
		{ source: "web", target: "api" },
		{ source: "api", target: "db" },
		{ source: "worker", target: "queue" },
	];

	it("keeps only the service, its neighbours and their edges", () => {
		const near = focusNeighborhood(edges, "api");
		expect([...near.services].sort()).toEqual(["api", "db", "web"]);
		expect([...near.edgeIds].sort()).toEqual(["api->db", "web->api"]);
	});

	it("renders the Showing <service> chip with a clear control", () => {
		const html = renderToStaticMarkup(
			createElement(ServiceFocusChip, { service: "api" }),
		);
		expect(html).toContain("Showing api");
		expect(html).toContain("clear");
	});
});

describe("AI call selection", () => {
	it("matches by span id or ai.call_id attribute", () => {
		const spans = [
			{ spanId: "s1", attributes: {} },
			{ spanId: "s2", attributes: { "ai.call_id": "call-9" } },
		] as unknown as Parameters<typeof findSpanForCallId>[0];
		expect(findSpanForCallId(spans, "s1")?.spanId).toBe("s1");
		expect(findSpanForCallId(spans, "call-9")?.spanId).toBe("s2");
		expect(findSpanForCallId(spans, "nope")).toBeUndefined();
	});
});
