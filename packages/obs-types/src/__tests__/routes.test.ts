import { describe, expect, it } from "vitest";
import {
	DASHBOARD_TABS,
	type DashboardRoute,
	dashboardRouteToHash,
	dashboardRouteToHref,
	hashRoutes,
	hrefForEntity,
	KNOWN_TABS,
	parseDashboardRouteHash,
	parseRouteHash,
	resolveDashboardRoute,
	routeForEntity,
	routeToHash,
} from "../routes";

function acceptRoute(route: DashboardRoute): DashboardRoute {
	return route;
}

describe("DashboardRoute compile-time negative type checks", () => {
	it("rejects unknown tabs, cross-variant fields (fresh literals & typed variables), and incomplete dependent selections", () => {
		// Valid routes compile cleanly
		expect(acceptRoute({ tab: "evaluations", evaluationId: "ec_1" }).tab).toBe(
			"evaluations",
		);
		expect(acceptRoute({ tab: "service-map", service: "checkout" }).tab).toBe(
			"service-map",
		);
		expect(
			acceptRoute({ tab: "traces", traceId: "t1", spanId: "s1" }).tab,
		).toBe("traces");
		expect(
			acceptRoute({
				tab: "evidence",
				evidenceKind: "incident",
				evidenceId: "inc_1",
			}).tab,
		).toBe("evidence");

		// @ts-expect-error unknown tab is rejected
		acceptRoute({ tab: "evals" });

		// @ts-expect-error cross-variant field on fresh object literal is rejected
		acceptRoute({ tab: "service-map", remediationId: "rem_1" });

		// Cross-variant field passed through a typed variable is ALSO rejected
		const crossVariantViaVariable: {
			tab: "service-map";
			remediationId: string;
		} = {
			tab: "service-map",
			remediationId: "rem_1",
		};
		// @ts-expect-error cross-variant field via variable is rejected by DisallowOtherRouteFields
		acceptRoute(crossVariantViaVariable);

		// @ts-expect-error spanId without traceId on traces is rejected
		acceptRoute({ tab: "traces", spanId: "s1" });

		const spanWithoutTraceViaVar: { tab: "traces"; spanId: string } = {
			tab: "traces",
			spanId: "s1",
		};
		// @ts-expect-error spanId without traceId via variable is rejected
		acceptRoute(spanWithoutTraceViaVar);

		// @ts-expect-error evidenceKind without evidenceId is rejected
		acceptRoute({ tab: "evidence", evidenceKind: "incident" });

		// @ts-expect-error evidenceId without evidenceKind is rejected
		acceptRoute({ tab: "evidence", evidenceId: "inc_1" });
	});
});

describe("parseDashboardRouteHash & dashboardRouteToHash / dashboardRouteToHref", () => {
	it("covers all 30 canonical tabs in DASHBOARD_TABS and KNOWN_TABS", () => {
		expect(DASHBOARD_TABS).toHaveLength(30);
		expect(KNOWN_TABS.size).toBe(30);
		for (const tab of DASHBOARD_TABS) {
			expect(KNOWN_TABS.has(tab)).toBe(true);
			const parsed = parseDashboardRouteHash(`#/${tab}`);
			expect(parsed).toEqual({ ok: true, route: { tab } });
			expect(
				dashboardRouteToHash(parsed.ok ? parsed.route : { tab: "health" }),
			).toBe(`/${tab}`);
			expect(
				dashboardRouteToHref(parsed.ok ? parsed.route : { tab: "health" }),
			).toBe(`#/${tab}`);
		}
	});

	it("resolves empty hashes to health", () => {
		for (const empty of ["", "#", "#/", "/", "   "]) {
			expect(parseDashboardRouteHash(empty)).toEqual({
				ok: true,
				route: { tab: "health" },
			});
			expect(resolveDashboardRoute(empty)).toEqual({ tab: "health" });
		}
	});

	it("returns unknown_tab with health fallback for unrecognized tabs", () => {
		const res = parseDashboardRouteHash("#/not-a-tab/123");
		expect(res).toEqual({
			ok: false,
			reason: "unknown_tab",
			rawHash: "#/not-a-tab/123",
			rawTab: "not-a-tab",
			fallbackRoute: { tab: "health" },
		});
		expect(resolveDashboardRoute("#/not-a-tab/123")).toEqual({
			tab: "health",
		});
	});

	it("never throws on malformed percent-encoding and returns malformed_encoding", () => {
		for (const bad of [
			"#/traces/%E0%A4%A",
			"#/logs?q=%ZZ",
			"#/%E0%A4%A",
			"#/traces/t1#span=%ZZ",
			"#/ai/calls/%E0%A4%A",
		]) {
			const res = parseDashboardRouteHash(bad);
			expect(res.ok).toBe(false);
			if (!res.ok) {
				expect(res.reason).toBe("malformed_encoding");
				expect(res.fallbackRoute).toEqual({ tab: "health" });
			}
			expect(resolveDashboardRoute(bad)).toEqual({ tab: "health" });
			expect(parseRouteHash(bad)).toEqual({ tab: "health" });
		}
	});

	it("rejects invalid dependent selections at runtime with invalid_selection", () => {
		const spanOnly = parseDashboardRouteHash("#/traces?span=s1");
		expect(spanOnly).toEqual({
			ok: false,
			reason: "invalid_selection",
			rawHash: "#/traces?span=s1",
			rawTab: "traces",
			fallbackRoute: { tab: "health" },
		});

		const kindOnly = parseDashboardRouteHash("#/evidence?kind=incident");
		expect(kindOnly).toEqual({
			ok: false,
			reason: "invalid_selection",
			rawHash: "#/evidence?kind=incident",
			rawTab: "evidence",
			fallbackRoute: { tab: "health" },
		});

		const idOnly = parseDashboardRouteHash("#/evidence?id=inc_1");
		expect(idOnly).toEqual({
			ok: false,
			reason: "invalid_selection",
			rawHash: "#/evidence?id=inc_1",
			rawTab: "evidence",
			fallbackRoute: { tab: "health" },
		});
	});

	it("round-trips every selection variant including escaped /, #, spaces, and Unicode", () => {
		const trickyIds = [
			"simple-id_1",
			"id/with/slashes",
			"id#with#hashes",
			"id with spaces & symbols?",
			"unicode-🔥-東京-λ",
		];

		for (const id of trickyIds) {
			const routes: DashboardRoute[] = [
				{ tab: "investigate", investigationId: id },
				{
					tab: "traces",
					traceId: id,
					spanId: `span/${id}`,
					service: `svc/${id}`,
					query: `q ${id}`,
				},
				{ tab: "service-map", service: id },
				{ tab: "issues", issueId: id, service: `svc/${id}` },
				{
					tab: "logs",
					logId: id,
					query: `q ${id}`,
					severity: "ERROR",
					service: `svc/${id}`,
					traceId: `tr/${id}`,
				},
				{ tab: "ai", aiCallId: id },
				{ tab: "evidence", evidenceKind: "incident", evidenceId: id },
				{ tab: "usage", usageId: id },
				{ tab: "replay", sessionId: id },
				{ tab: "timeline", sessionId: id },
				{ tab: "alerts", alertId: id },
				{ tab: "users", userId: id },
				{ tab: "agent-runs", agentRunId: id },
				{ tab: "actions", actionId: id },
				{ tab: "tool-calls", toolCallId: id },
				{ tab: "profiles", profileId: id, traceId: `tr/${id}` },
				{ tab: "autonomous-review", remediationId: id },
				{ tab: "evaluations", evaluationId: id },
				{ tab: "changes", changeId: id },
				{ tab: "findings", findingId: id },
				{ tab: "incidents", incidentId: id },
				{ tab: "remediations", remediationId: id },
			];

			for (const route of routes) {
				const href = dashboardRouteToHref(route);
				expect(href.startsWith("#/")).toBe(true);
				expect(href.startsWith("##")).toBe(false);
				const parsed = parseDashboardRouteHash(href);
				expect(parsed).toEqual({ ok: true, route });
			}
		}
	});

	it("normalizes legacy aliases and inline #span= fragments", () => {
		// Legacy inline #/traces/<traceId>#span=<spanId>
		const legacySpan = parseDashboardRouteHash(
			"#/traces/trace%2F1#span=span%232",
		);
		expect(legacySpan).toEqual({
			ok: true,
			route: { tab: "traces", traceId: "trace/1", spanId: "span#2" },
			legacyAlias: true,
		});
		if (legacySpan.ok) {
			expect(dashboardRouteToHref(legacySpan.route)).toBe(
				"#/traces?trace=trace%2F1&span=span%232",
			);
		}

		// Canonical query form #/traces?trace=<traceId>&span=<spanId>
		const canonicalSpan = parseDashboardRouteHash(
			"#/traces?trace=trace-1&span=span-2",
		);
		expect(canonicalSpan).toEqual({
			ok: true,
			route: { tab: "traces", traceId: "trace-1", spanId: "span-2" },
		});

		// Legacy #/evaluations?case=<id> and ?eval_case_id=<id>
		const evalCase = parseDashboardRouteHash("#/evaluations?case=ec_1");
		expect(evalCase).toEqual({
			ok: true,
			route: { tab: "evaluations", evaluationId: "ec_1" },
			legacyAlias: true,
		});
		if (evalCase.ok) {
			expect(dashboardRouteToHref(evalCase.route)).toBe("#/evaluations/ec_1");
		}

		const evalCaseId = parseDashboardRouteHash(
			"#/evaluations?eval_case_id=ec_2",
		);
		expect(evalCaseId).toEqual({
			ok: true,
			route: { tab: "evaluations", evaluationId: "ec_2" },
			legacyAlias: true,
		});

		// Legacy #/evals/<id> tab alias
		const evalsTab = parseDashboardRouteHash("#/evals/ec_3");
		expect(evalsTab).toEqual({
			ok: true,
			route: { tab: "evaluations", evaluationId: "ec_3" },
			legacyAlias: true,
		});

		// Legacy #/ai?id=<id>
		const aiLegacy = parseDashboardRouteHash("#/ai?id=call_1");
		expect(aiLegacy).toEqual({
			ok: true,
			route: { tab: "ai", aiCallId: "call_1" },
			legacyAlias: true,
		});
		if (aiLegacy.ok) {
			expect(dashboardRouteToHref(aiLegacy.route)).toBe("#/ai/calls/call_1");
		}

		// Dedicated selections for alerts, logs, usage, profiles
		expect(parseDashboardRouteHash("#/alerts?id=al_1")).toEqual({
			ok: true,
			route: { tab: "alerts", alertId: "al_1" },
		});
		expect(parseDashboardRouteHash("#/logs?id=log_1")).toEqual({
			ok: true,
			route: { tab: "logs", logId: "log_1" },
		});
		expect(parseDashboardRouteHash("#/usage?id=ev_1")).toEqual({
			ok: true,
			route: { tab: "usage", usageId: "ev_1" },
		});
		expect(parseDashboardRouteHash("#/profiles/prof_1?trace_id=tr_1")).toEqual({
			ok: true,
			route: { tab: "profiles", profileId: "prof_1", traceId: "tr_1" },
		});
	});
});

describe("routeForEntity & hrefForEntity", () => {
	it("maps known entities to canonical routes and unknown kinds to evidence explorer", () => {
		expect(hrefForEntity("trace", "t1")).toBe("#/traces?trace=t1");
		expect(hrefForEntity("span", "t1:s1")).toBe("#/traces?trace=t1&span=s1");
		expect(hrefForEntity("span", "s1", { traceId: "t1" })).toBe(
			"#/traces?trace=t1&span=s1",
		);
		expect(hrefForEntity("span", "orphan-span")).toBe(
			"#/evidence?kind=span&id=orphan-span",
		);
		expect(hrefForEntity("alert", "al 1")).toBe("#/alerts?id=al+1");
		expect(hrefForEntity("log", "log_1")).toBe("#/logs?id=log_1");
		expect(hrefForEntity("usage", "ev_1")).toBe("#/usage?id=ev_1");
		expect(hrefForEntity("profile", "p1", { traceId: "t1" })).toBe(
			"#/profiles/p1?trace_id=t1",
		);
		expect(hrefForEntity("ai_call", "call/1")).toBe("#/ai/calls/call%2F1");
		expect(hrefForEntity("eval", "ec_1")).toBe("#/evaluations/ec_1");
		expect(hrefForEntity("remediation", "rem_1")).toBe("#/remediations/rem_1");
		expect(hrefForEntity("custom_kind", "id/1")).toBe(
			"#/evidence?kind=custom_kind&id=id%2F1",
		);
		expect(routeForEntity("custom_kind", "id/1")).toEqual({
			tab: "evidence",
			evidenceKind: "custom_kind",
			evidenceId: "id/1",
		});
	});
});

describe("legacy Route, parseRouteHash, routeToHash, and hashRoutes compatibility", () => {
	it("preserves legacy hashRoutes helpers and parseRouteHash/routeToHash signatures", () => {
		expect(hashRoutes.change("chg 1")).toBe("#/changes/chg%201");
		expect(hashRoutes.finding("fnd_1")).toBe("#/findings/fnd_1");
		expect(hashRoutes.incident("inc/1")).toBe("#/incidents/inc%2F1");
		expect(hashRoutes.remediation("rem_1")).toBe("#/remediations/rem_1");

		const parsed = parseRouteHash("#/evaluations/case%2F1");
		expect(parsed.tab).toBe("evaluations");
		expect(parsed.evaluationId).toBe("case/1");
		expect(routeToHash(parsed)).toBe("/evaluations/case%2F1");
	});
});
