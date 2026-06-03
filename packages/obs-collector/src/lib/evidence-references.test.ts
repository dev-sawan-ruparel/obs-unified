import { describe, expect, it } from "vitest";
import { evidenceRouteFor } from "./evidence-references";

describe("evidenceRouteFor", () => {
	it("routes analysis evidence to the canonical investigation page", () => {
		expect(evidenceRouteFor("analysis", "latency.p95")).toBe(
			"#/investigate/latency.p95",
		);
	});
});
