import { KNOWN_TABS, parseDashboardRouteHash } from "@obsunified/types";
import { describe, expect, it } from "vitest";
import {
	hrefForEntity,
	linksFromActions,
	linksFromAi,
	linksFromArtifacts,
	linksFromEvalResults,
	linksFromLogs,
	linksFromMetricExemplars,
	linksFromRetrievalEvents,
	linksFromSpans,
	linksFromToolCalls,
	linksFromUsage,
	linkToAction,
	linkToAgentRun,
	linkToSession,
	linkToTrace,
	MAX_LINKS_INLINE,
	resolveFaultLocusTarget,
} from "./manifest";

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
			"#/evaluations/e1",
			"#/actions/a1",
		]);
		for (const href of hrefs) {
			expect(KNOWN_TABS.has(tabOf(href ?? ""))).toBe(true);
			expect(parseDashboardRouteHash(href ?? "").ok).toBe(true);
		}
	});

	it("emits canonical routes from all link builders and round-trips through parseDashboardRouteHash", () => {
		expect(linkToTrace("trace-1").href).toBe("#/traces?trace=trace-1");
		expect(linkToSession("sess/1").href).toBe("#/replay?session=sess%2F1");
		expect(linkToAction("act/1").href).toBe("#/actions/act%2F1");
		expect(linkToAgentRun("run/1").href).toBe("#/agent-runs/run%2F1");

		const inlineSpans = linksFromSpans(
			[
				{
					traceId: "tr-1",
					spanId: "sp-1",
					serviceName: "api",
					spanName: "GET /",
				} as never,
			],
			"Spans",
		);
		expect(inlineSpans.links[0]?.href).toBe("#/traces?trace=tr-1&span=sp-1");
		expect(parseDashboardRouteHash(inlineSpans.links[0]?.href ?? "")).toEqual({
			ok: true,
			route: { tab: "traces", traceId: "tr-1", spanId: "sp-1" },
		});

		const manySpans = linksFromSpans(
			Array.from({ length: MAX_LINKS_INLINE + 1 }, (_, i) => ({
				traceId: "tr-many",
				spanId: `sp-${i}`,
				serviceName: "api",
				spanName: "op",
			})) as never,
			"Spans",
		);
		expect(manySpans.links[0]?.href).toBe("#/traces?q=tr-many");

		const inlineLogs = linksFromLogs(
			[
				{
					logId: "log-1",
					traceId: "tr-1",
					severity: "ERROR",
					message: "boom",
				} as never,
			],
			"Logs",
		);
		expect(inlineLogs.links[0]?.href).toBe("#/logs?id=log-1");

		const inlineUsage = linksFromUsage(
			[
				{
					eventId: "ev-1",
					eventType: "click",
					eventName: "buy",
				} as never,
			],
			"Usage",
		);
		expect(inlineUsage.links[0]?.href).toBe("#/usage?id=ev-1");

		const inlineExemplars = linksFromMetricExemplars(
			[
				{
					traceId: "tr-1",
					spanId: "sp-2",
					serviceName: "api",
					metricName: "latency",
					value: 42,
					tsNs: "100",
				} as never,
			],
			"Exemplars",
		);
		expect(inlineExemplars.links[0]?.href).toBe(
			"#/traces?trace=tr-1&span=sp-2",
		);

		const inlineAi = linksFromAi(
			[
				{
					callId: "call/1",
					provider: "openai",
					modelName: "gpt-4o",
				} as never,
			],
			"AI",
		);
		expect(inlineAi.links[0]?.href).toBe("#/ai/calls/call%2F1");

		const inlineActions = linksFromActions(
			[{ id: "act-1", actionKind: "step", name: "plan" } as never],
			"Actions",
		);
		expect(inlineActions.links[0]?.href).toBe("#/actions/act-1");
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
			const href = hrefForEntity(kind, "id-1");
			expect(KNOWN_TABS.has(tabOf(href)), kind).toBe(true);
			expect(parseDashboardRouteHash(href).ok, kind).toBe(true);
		}
		expect(hrefForEntity("trace", "abc")).toBe("#/traces?trace=abc");
		expect(hrefForEntity("alert", "al 1")).toBe("#/alerts?id=al+1");
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
