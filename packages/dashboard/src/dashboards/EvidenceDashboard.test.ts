import type { EvidenceBundle } from "@obsunified/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ObsDashboardProvider } from "../provider";
import {
	connectedKindForAnchor,
	EvidenceBundleDetails,
} from "./EvidenceDashboard";

const baseBundle: EvidenceBundle = {
	schemaVersion: "obs-unified.evidence-bundle.v1",
	intent: "triage_incident",
	anchor: { entityKind: "incident", entityId: "inc_42" },
	summary: "Incident inc_42",
	derivedSummaries: [],
	findings: [],
	compactions: [],
	evidenceReferences: [],
	retrievalRefs: [],
	suggestedNextPivots: [],
} as unknown as EvidenceBundle;

const richBundle: EvidenceBundle = {
	...baseBundle,
	evidenceReferences: [
		{
			evidenceId: "ev_1",
			entityKind: "change",
			entityId: "chg_deploy_241",
			route: "#/changes/chg_deploy_241",
			source: "change-correlation",
			confidence: 0.82,
			relationshipCertainty: "exact",
			causalProofTier: "cohort_rate_isolated",
			reason: "Errors began after deploy v2.4.1",
			citations: [],
			suggestedNextPivots: [],
		},
	],
	suggestedNextPivots: [
		{
			label: "Open the deploy",
			entityKind: "change",
			entityId: "chg_deploy_241",
			route: "#/changes/chg_deploy_241",
			reason: "Candidate cause",
		},
	],
	autosre: {
		faultLocus: {
			nodeId: "service:prod:default:checkout-api",
			spanId: "span_9",
			relationshipCertainty: "exact",
			isBlackoutSuspected: true,
		},
		candidateChanges: [
			{
				changeId: "chg_deploy_241",
				kind: "deploy",
				version: "v2.4.1",
				previousVersion: "v2.4.0",
				occurredAt: "2026-10-15T03:00:00.000Z",
				cohortVerdict: "isolated_to_new_version",
				causalProofTier: "cohort_rate_isolated",
				rateNew: 0.25,
				rateOld: 0.01,
				sampleNew: 60,
				sampleOld: 60,
				overlappingCodePaths: [],
			},
		],
		contentionCandidates: [
			{
				aggressorTraceId: "trace_noisy",
				aggressorSpanId: "span_noisy",
				aggressorServiceName: "batch-job",
				sharedTargetNodeId: "database:prod:postgres:orders",
				relationshipCertainty: "inferred",
				totalResourceTimeMs: 1800,
			},
		],
		priorFindings: [
			{
				findingId: "fnd_prior",
				title: "Null deref in checkout",
				causalProofTier: "counterfactual_verified",
				causalVerificationStatus: "counterfactual_verified",
				recoveryStatus: "recovered",
				contributingChangeId: "chg_old",
				occurredAt: "2026-10-01T00:00:00.000Z",
			},
		],
	},
};

const render = (bundle: EvidenceBundle) =>
	renderToStaticMarkup(
		createElement(
			ObsDashboardProvider,
			null,
			createElement(EvidenceBundleDetails, { bundle }),
		),
	);

describe("EvidenceBundleDetails", () => {
	it("renders evidence references, next pivots and every autosre section", () => {
		const html = render(richBundle);
		expect(html).toContain('data-evidence-reference="ev_1"');
		expect(html).toContain("Errors began after deploy v2.4.1");
		expect(html).toContain("Open the deploy");
		expect(html).toContain('data-pivot-route="#/changes/chg_deploy_241"');
		expect(html).toContain("data-fault-locus");
		expect(html).toContain("service:prod:default:checkout-api");
		expect(html).toContain("blackout suspected");
		expect(html).toContain("data-candidate-changes");
		expect(html).toContain("isolated_to_new_version");
		expect(html).toContain("data-contention-candidates");
		expect(html).toContain("batch-job");
		expect(html).toContain("data-prior-findings");
		expect(html).toContain("Null deref in checkout");
		// The connected rail for the incident anchor is mounted.
		expect(html).toContain("Loading neighbors...");
	});

	it("renders nothing for absent sections", () => {
		const html = render(baseBundle);
		expect(html).not.toContain("data-fault-locus");
		expect(html).not.toContain("data-candidate-changes");
		expect(html).not.toContain("data-prior-findings");
		expect(html).not.toContain("data-evidence-reference");
		expect(html).not.toContain("data-next-pivots");
	});

	it("maps evidence anchors to connected-rail entity kinds", () => {
		expect(connectedKindForAnchor("incident")).toBe("incident");
		expect(connectedKindForAnchor("finding")).toBe("finding");
		expect(connectedKindForAnchor("change")).toBe("change");
		expect(connectedKindForAnchor("trace")).toBeNull();
	});
});
