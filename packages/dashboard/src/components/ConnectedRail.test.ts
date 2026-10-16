import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	CONNECTED_ENTITY_ICONS,
	CONNECTED_ENTITY_LABELS,
	type ConnectedSection,
	formatCausalProofTierBadge,
	formatRelationshipCertaintyBadge,
	getConnectedEntityIcon,
	getConnectedEntityLabel,
	normalizeConnectedHref,
	SectionGroup,
} from "./ConnectedRail";

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
		expect(normalizeConnectedHref("#/changes/chg_01")).toBe("#/changes/chg_01");
		expect(normalizeConnectedHref("#/findings/fnd_01")).toBe(
			"#/findings/fnd_01",
		);
		expect(normalizeConnectedHref("#/incidents/inc_01")).toBe(
			"#/incidents/inc_01",
		);
		expect(normalizeConnectedHref("#/ai?id=call-1")).toBe("#/ai/calls/call-1");
		expect(normalizeConnectedHref("#/ai/calls/call-1")).toBe(
			"#/ai/calls/call-1",
		);
		expect(normalizeConnectedHref("#/evaluations?case=c1")).toBe(
			"#/evaluations/c1",
		);
		expect(normalizeConnectedHref("#/evaluations/c1")).toBe("#/evaluations/c1");
		expect(normalizeConnectedHref("#/logs?id=log-1")).toBe("#/logs");
	});
});

describe("ConnectedRail AutoSRE entity kinds & dual epistemic badges", () => {
	it("defines change, finding, and incident as first-class connected entity kinds", () => {
		expect(CONNECTED_ENTITY_LABELS.change).toBe("Change Event");
		expect(CONNECTED_ENTITY_LABELS.finding).toBe("Finding");
		expect(CONNECTED_ENTITY_LABELS.incident).toBe("Incident");
		expect(getConnectedEntityLabel("change")).toBe("Change Event");
		expect(getConnectedEntityLabel("finding")).toBe("Finding");
		expect(getConnectedEntityLabel("incident")).toBe("Incident");
		expect(CONNECTED_ENTITY_ICONS.change).toBeTruthy();
		expect(CONNECTED_ENTITY_ICONS.finding).toBeTruthy();
		expect(CONNECTED_ENTITY_ICONS.incident).toBeTruthy();
		expect(getConnectedEntityIcon("change")).toBe(
			CONNECTED_ENTITY_ICONS.change,
		);
	});

	it("maps relationshipCertainty and causalProofTier to RFC 0013 badge labels", () => {
		expect(formatRelationshipCertaintyBadge("exact")).toBe("exact link");
		expect(formatRelationshipCertaintyBadge("inferred")).toBe("inferred link");
		expect(formatRelationshipCertaintyBadge("heuristic")).toBe(
			"temporal heuristic",
		);

		expect(formatCausalProofTierBadge("counterfactual_verified")).toBe(
			"counterfactual verified",
		);
		expect(formatCausalProofTierBadge("cohort_rate_isolated")).toBe(
			"cohort isolated",
		);
		expect(formatCausalProofTierBadge("corroborated_candidate")).toBe(
			"corroborated candidate",
		);
		expect(formatCausalProofTierBadge("unverified_locus")).toBe("fault locus");
	});

	it("renders dual epistemic badges on ConnectedLink items and preserves causalConfidence fallback", () => {
		const section: ConnectedSection = {
			label: "Causal Attribution",
			links: [
				{
					label: "deploy v2.4.1 (chg_01)",
					href: "#/changes/chg_01",
					entityKind: "change",
					relationshipCertainty: "exact",
					causalProofTier: "cohort_rate_isolated",
				},
				{
					label: "finding fnd_01",
					href: "#/findings/fnd_01",
					entityKind: "finding",
					relationshipCertainty: "inferred",
					causalProofTier: "counterfactual_verified",
				},
				{
					label: "incident inc_01",
					href: "#/incidents/inc_01",
					entityKind: "incident",
					relationshipCertainty: "heuristic",
					causalProofTier: "unverified_locus",
				},
				{
					label: "legacy action link",
					href: "#/actions/act_01",
					entityKind: "action",
					causalConfidence: "explicit",
				},
			],
		};

		const html = renderToStaticMarkup(createElement(SectionGroup, { section }));
		expect(html).toContain("exact link");
		expect(html).toContain("cohort isolated");
		expect(html).toContain("inferred link");
		expect(html).toContain("counterfactual verified");
		expect(html).toContain("temporal heuristic");
		expect(html).toContain("fault locus");
		expect(html).toContain("explicit");
	});
});
