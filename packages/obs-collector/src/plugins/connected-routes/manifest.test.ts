import { describe, expect, it } from "vitest";
import {
	hrefForEntity,
	linksFromArtifacts,
	linksFromEvalResults,
	linksFromRetrievalEvents,
	linksFromToolCalls,
	MAX_LINKS_INLINE,
	resolveFaultLocusTarget,
} from "./manifest";

// Tabs served by apps/web/src/app/router.ts (KNOWN_TABS). Generated hrefs
// must start with one of these or the app falls back to Health.
const ROUTER_TABS = new Set([
	"health",
	"investigate",
	"traces",
	"service-map",
	"issues",
	"logs",
	"ai",
	"evidence",
	"usage",
	"replay",
	"alerts",
	"users",
	"agent-runs",
	"actions",
	"tool-calls",
	"profiles",
	"tool-reliability",
	"evaluations",
	"changes",
	"findings",
	"incidents",
	"remediations",
]);
const tabOf = (href: string) =>
	href.replace(/^#\//, "").split(/[/?#]/)[0] ?? "";

describe("connected manifest hrefs target real router tabs", () => {
	it("tool call overflow, retrievals, evals and artifacts avoid unknown tabs", () => {
		const many = Array.from({ length: MAX_LINKS_INLINE + 1 }, (_, i) => ({
			id: `t${i}`,
			actionId: "a1",
			toolName: "search",
		}));
		const hrefs = [
			linksFromToolCalls(many as never, "Tools").links[0]?.href,
			linksFromRetrievalEvents(
				[
					{
						id: "r1",
						actionId: "a1",
						retrieverName: "kb",
						totalResults: 3,
					},
				] as never,
				"R",
			).links[0]?.href,
			linksFromEvalResults(
				[{ id: "e1", actionId: "a1", evaluatorName: "g", passed: 1 }] as never,
				"E",
			).links[0]?.href,
			linksFromArtifacts(
				[
					{
						id: "x1",
						actionId: "a1",
						artifactName: "plan",
						artifactType: "json",
					},
				] as never,
				"A",
			).links[0]?.href,
		];
		expect(hrefs).toEqual([
			"#/tool-calls",
			"#/actions/a1",
			"#/evaluations",
			"#/actions/a1",
		]);
		for (const href of hrefs)
			expect(ROUTER_TABS.has(tabOf(href ?? ""))).toBe(true);
	});

	it("hrefForEntity only emits router tabs for every evidence kind", () => {
		for (const kind of [
			"trace",
			"span",
			"alert",
			"analysis",
			"service",
			"agent_run",
			"action",
			"tool_call",
			"ai_call",
			"profile",
			"change",
			"finding",
			"incident",
			"eval",
			"log",
			"replay",
			"docs",
		]) {
			expect(ROUTER_TABS.has(tabOf(hrefForEntity(kind, "id-1"))), kind).toBe(
				true,
			);
		}
		expect(hrefForEntity("trace", "abc")).toBe("#/traces?trace=abc");
		expect(hrefForEntity("alert", "al 1")).toBe("#/alerts?id=al%201");
		expect(hrefForEntity("ai_call", "c1")).toBe("#/ai/calls/c1");
	});
});

describe("resolveFaultLocusTarget", () => {
	const trace = "a".repeat(32);
	const span = "b".repeat(16);
	it("classifies service nodes, bare services and spans", () => {
		expect(
			resolveFaultLocusTarget("service:prod:default:checkout-api"),
		).toEqual({
			entityKind: "service",
			entityId: "service:prod:default:checkout-api",
			href: "#/service-map?service=checkout-api",
		});
		expect(resolveFaultLocusTarget("checkout-api")).toMatchObject({
			entityKind: "service",
			href: "#/service-map?service=checkout-api",
		});
		expect(resolveFaultLocusTarget(`${trace}:${span}`)).toEqual({
			entityKind: "span",
			entityId: `${trace}:${span}`,
			href: `#/traces?trace=${trace}&span=${span}`,
		});
		expect(resolveFaultLocusTarget(span)).toMatchObject({
			entityKind: "span",
			href: `#/evidence?kind=span&id=${span}`,
		});
	});
});
