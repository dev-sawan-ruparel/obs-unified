import { describe, expect, it } from "vitest";
import {
	buildLineageAttributesFromSources,
	normalizeEnvironment,
	resolveLineageFromSources,
} from "./lineage";

describe("normalizeEnvironment", () => {
	it("maps aliases, lowercases and trims", () => {
		expect(normalizeEnvironment("production")).toBe("prod");
		expect(normalizeEnvironment(" Production ")).toBe("prod");
		expect(normalizeEnvironment("DEVELOPMENT")).toBe("dev");
		expect(normalizeEnvironment("test")).toBe("test");
		expect(normalizeEnvironment("Staging")).toBe("staging");
	});
	it("falls back to default", () => {
		expect(normalizeEnvironment(undefined)).toBe("default");
		expect(normalizeEnvironment("   ")).toBe("default");
	});
});

describe("lineage resolution", () => {
	it("normalizes env-derived and explicit environments", () => {
		expect(
			resolveLineageFromSources(undefined, { NODE_ENV: "production" }),
		).toEqual({ environment: "prod" });
		expect(
			resolveLineageFromSources({ environment: "Development" }, {}).environment,
		).toBe("dev");
	});
	it("prefers flat fields over nested lineage over configured over env", () => {
		const r = resolveLineageFromSources(
			{ commitSha: "a", lineage: { commitSha: "b", configDigest: "d" } },
			{ OBS_COMMIT_SHA: "c", OBS_CONFIG_DIGEST: "e" },
			{ configDigest: "f" },
		);
		expect(r).toEqual({ commitSha: "a", configDigest: "d" });
	});
	it("builds wire attributes", () => {
		expect(
			buildLineageAttributesFromSources(undefined, {
				OBS_ENVIRONMENT: "production",
				GITHUB_SHA: "abc",
			}),
		).toEqual({
			"deployment.environment.name": "prod",
			"obs.environment": "prod",
			"vcs.commit.id": "abc",
			"obs.commit.sha": "abc",
		});
	});
});
