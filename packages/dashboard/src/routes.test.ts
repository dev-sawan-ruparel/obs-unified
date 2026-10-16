import { describe, expect, it } from "vitest";
import { hashRoutes, parseRouteHash, routeToHash } from "./routes";

describe("hashRoutes", () => {
	it("builds encoded hash routes", () => {
		expect(hashRoutes.change("chg 1")).toBe("#/changes/chg%201");
		expect(hashRoutes.finding("fnd_1")).toBe("#/findings/fnd_1");
		expect(hashRoutes.incident("inc/1")).toBe("#/incidents/inc%2F1");
		expect(hashRoutes.remediation("rem_1")).toBe("#/remediations/rem_1");
	});
});

describe("parseRouteHash / routeToHash", () => {
	it("parses #/evaluations/:id and round-trips it", () => {
		const route = parseRouteHash("#/evaluations/case%2F1");
		expect(route.tab).toBe("evaluations");
		expect(route.evaluationId).toBe("case/1");
		expect(routeToHash(route)).toBe("/evaluations/case%2F1");
	});

	it("accepts the legacy #/evaluations?case= form", () => {
		expect(parseRouteHash("#/evaluations?case=c1").evaluationId).toBe("c1");
		expect(parseRouteHash("#/evaluations?eval_case_id=c2").evaluationId).toBe(
			"c2",
		);
	});

	it("parses and serializes the service-map service filter", () => {
		const route = parseRouteHash("#/service-map?service=checkout%20api");
		expect(route.service).toBe("checkout api");
		expect(routeToHash(route)).toBe("/service-map?service=checkout+api");
		expect(routeToHash({ tab: "service-map" })).toBe("/service-map");
	});

	it("parses and serializes ai call ids", () => {
		const route = parseRouteHash("#/ai/calls/call-1");
		expect(route.aiCallId).toBe("call-1");
		expect(routeToHash(route)).toBe("/ai/calls/call-1");
	});

	it("keeps existing detail routes and defaults to health", () => {
		expect(parseRouteHash("#/remediations/rem_1").remediationId).toBe("rem_1");
		expect(routeToHash({ tab: "actions", actionId: "a 1" })).toBe(
			"/actions/a%201",
		);
		expect(parseRouteHash("").tab).toBe("health");
		expect(parseRouteHash("#/traces?trace=t1").traceId).toBe("t1");
	});
});
