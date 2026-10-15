import type { ChangeEvent } from "@obsunified/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChangeMarkersBar, formatChangeVersionLabel } from "./ChangeMarkersBar";

const sampleChanges: ChangeEvent[] = [
	{
		id: "chg_01",
		projectId: "default",
		environment: "prod",
		targetNodeId: "service:prod:default:checkout",
		kind: "deploy",
		source: "explicit_api",
		relationshipCertainty: "exact",
		summary: "Rollout checkout v2.4.1 with new retry pool",
		serviceName: "checkout",
		version: "v2.4.1",
		previousVersion: "v2.4.0",
		commitSha: "a1b2c3d4e5f6",
		previousCommitSha: "9f8e7d6c5b4a",
		configDigest: null,
		repositoryUrl: "https://github.com/acme/checkout",
		pullRequestUrl: "https://github.com/acme/checkout/pull/42",
		actorId: "ci-bot",
		causedByActionId: null,
		agentRunId: null,
		touchedPaths: ["src/checkout/pool.ts"],
		attributes: {},
		occurredAt: "2026-10-15T03:55:00.000Z",
		receivedAt: "2026-10-15T03:55:01.000Z",
		expiresAt: null,
	},
	{
		id: "chg_02",
		projectId: "default",
		environment: "staging",
		targetNodeId: "flag:staging:new_cart_flow",
		kind: "feature_flag",
		source: "inferred_telemetry",
		relationshipCertainty: "inferred",
		summary: "Enable new_cart_flow flag in staging",
		serviceName: "frontend",
		version: null,
		previousVersion: null,
		commitSha: null,
		previousCommitSha: null,
		configDigest: "cfg_123",
		repositoryUrl: null,
		pullRequestUrl: null,
		actorId: null,
		causedByActionId: null,
		agentRunId: null,
		touchedPaths: [],
		attributes: {},
		occurredAt: "2026-10-15T03:50:00.000Z",
		receivedAt: "2026-10-15T03:50:01.000Z",
		expiresAt: null,
	},
];

describe("ChangeMarkersBar", () => {
	it("formats version transitions and commit sha fallbacks", () => {
		expect(
			formatChangeVersionLabel({
				previousVersion: "v2.4.0",
				version: "v2.4.1",
				previousCommitSha: null,
				commitSha: null,
			}),
		).toBe("v2.4.0 → v2.4.1");

		expect(
			formatChangeVersionLabel({
				previousVersion: null,
				version: "v2.4.1",
				previousCommitSha: null,
				commitSha: null,
			}),
		).toBe("v2.4.1");

		expect(
			formatChangeVersionLabel({
				previousVersion: null,
				version: null,
				previousCommitSha: "9f8e7d6c5b4a",
				commitSha: "a1b2c3d4e5f6",
			}),
		).toBe("9f8e7d6 → a1b2c3d");
	});

	it("renders recent change markers with version transition, summary, environment badge, and #/changes/:id link", () => {
		const html = renderToStaticMarkup(
			createElement(ChangeMarkersBar, { changes: sampleChanges }),
		);

		expect(html).toContain("Recent Changes (2)");
		expect(html).toContain("deploy");
		expect(html).toContain("prod");
		expect(html).toContain("v2.4.0 → v2.4.1");
		expect(html).toContain("Rollout checkout v2.4.1 with new retry pool");
		expect(html).toContain('href="#/changes/chg_01"');
		expect(html).toContain("exact link");

		expect(html).toContain("feature_flag");
		expect(html).toContain("staging");
		expect(html).toContain("Enable new_cart_flow flag in staging");
		expect(html).toContain('href="#/changes/chg_02"');
		expect(html).toContain("inferred link");
	});

	it("renders nothing when changes list is empty", () => {
		const html = renderToStaticMarkup(
			createElement(ChangeMarkersBar, { changes: [] }),
		);
		expect(html).toBe("");
	});
});
