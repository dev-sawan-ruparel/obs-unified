import { describe, expect, it } from "vitest";
import { resolveExemplarLink } from "./resolver";

describe("resolveExemplarLink", () => {
	it("resolves toolCallId with highest precedence", () => {
		expect(
			resolveExemplarLink({
				toolCallId: "tc-123",
				actionId: "act-456",
				agentRunId: "run-789",
				evalId: "ev-012",
				traceId: "tr-345",
			}),
		).toBe("#/tool-calls/tc-123");
	});

	it("resolves actionId if toolCallId is missing", () => {
		expect(
			resolveExemplarLink({
				actionId: "act-456",
				agentRunId: "run-789",
				evalId: "ev-012",
				traceId: "tr-345",
			}),
		).toBe("#/actions/act-456");
	});

	it("resolves agentRunId if toolCallId and actionId are missing", () => {
		expect(
			resolveExemplarLink({
				agentRunId: "run-789",
				evalId: "ev-012",
				traceId: "tr-345",
			}),
		).toBe("#/agent-runs/run-789");
	});

	it("resolves evalId if toolCallId, actionId, and agentRunId are missing", () => {
		expect(
			resolveExemplarLink({
				evalId: "ev-012",
				traceId: "tr-345",
			}),
		).toBe("#/evals/ev-012");
	});

	it("resolves traceId if all other IDs are missing", () => {
		expect(
			resolveExemplarLink({
				traceId: "tr-345",
			}),
		).toBe("#/traces?trace=tr-345");
	});

	it("returns empty string if no IDs are present", () => {
		expect(resolveExemplarLink({})).toBe("");
	});

	it("encodes route values", () => {
		expect(resolveExemplarLink({ toolCallId: "tool/call 1" })).toBe(
			"#/tool-calls/tool%2Fcall%201",
		);
		expect(resolveExemplarLink({ traceId: "trace/1" })).toBe(
			"#/traces?trace=trace%2F1",
		);
	});
});
