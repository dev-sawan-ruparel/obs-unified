import { describe, expect, it } from "vitest";
import { hashRoutes } from "./routes";

describe("hashRoutes", () => {
	it("builds encoded hash routes", () => {
		expect(hashRoutes.change("chg 1")).toBe("#/changes/chg%201");
		expect(hashRoutes.finding("fnd_1")).toBe("#/findings/fnd_1");
		expect(hashRoutes.incident("inc/1")).toBe("#/incidents/inc%2F1");
		expect(hashRoutes.remediation("rem_1")).toBe("#/remediations/rem_1");
	});
});
