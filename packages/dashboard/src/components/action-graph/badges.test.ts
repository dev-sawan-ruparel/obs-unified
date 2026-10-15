import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalBadge, AutonomyBadge } from "./badges";

describe("badges", () => {
	it("replaces every underscore in labels", () => {
		expect(
			renderToStaticMarkup(
				createElement(AutonomyBadge, { level: "human_approved_write" }),
			),
		).toContain("human approved write");
		expect(
			renderToStaticMarkup(
				createElement(ApprovalBadge, { state: "blocked_by_policy" }),
			),
		).toContain("blocked by policy");
	});
});
