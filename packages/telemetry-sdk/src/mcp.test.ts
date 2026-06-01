import { describe, expect, it } from "vitest";
import {
	getActiveAgentContext,
	startAgentRun,
	step,
	withAction,
} from "./agent";
import {
	extractMcpContext,
	injectMcpContext,
	injectMcpNotificationContext,
} from "./mcp";
import { createRequestSpan, runWithSpan } from "./span";

describe("Model Context Protocol (MCP) Trace + Action Graph Context Propagation", () => {
	it("injects trace and action context into JSON-RPC params._meta when active", async () => {
		const requestSpan = createRequestSpan(
			"mcp-client-service",
			"mcp-client-request",
		);

		await runWithSpan(requestSpan, async () => {
			await startAgentRun(
				{
					agentId: "mcp-client-agent",
					agentName: "MCP Orchestrator",
					goal: "Execute MCP tool call",
				},
				async (run) => {
					// Plan step
					await run.step({ name: "call-mcp-tool" }, async () => {
						// biome-ignore lint/suspicious/noExplicitAny: standard JSON-RPC params
						const params: any = { arguments: { foo: "bar" } };

						injectMcpContext(params);

						// Verify injection
						expect(params._meta).toBeDefined();
						expect(params._meta.traceparent).toBeDefined();
						expect(params._meta.traceparent).toContain(requestSpan.traceId);

						const actionCtx = getActiveAgentContext();
						expect(actionCtx).toBeDefined();
						expect(params._meta.obs).toBeDefined();
						expect(params._meta.obs.root_action_id).toBe(
							actionCtx?.rootActionId,
						);
						expect(params._meta.obs.action_id).toBe(actionCtx?.actionId);
						expect(params._meta["obs.action.root_id"]).toBe(
							actionCtx?.rootActionId,
						);
						expect(params._meta["obs.action.id"]).toBe(actionCtx?.actionId);
					});
				},
			);
		});
	});

	it("extracts trace parent and obs action context from MCP JSON-RPC meta", () => {
		const params = {
			_meta: {
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				tracestate: "obs=high",
				obs: {
					root_action_id: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
					action_id: "01J3Y4Z5A6B7C8D9E0F1G2H3K5",
				},
			},
		};

		const context = extractMcpContext(params);
		expect(context).toBeDefined();
		expect(context?.traceContext).toBeDefined();
		expect(context?.traceContext?.traceId).toBe(
			"4bf92f3577b34da6a3ce929d0e0e4736",
		);
		expect(context?.traceContext?.parentSpanId).toBe("00f067aa0ba902b7");
		expect(context?.tracestate).toBe("obs=high");

		expect(context?.actionContext).toBeDefined();
		expect(context?.actionContext?.rootActionId).toBe(
			"01J3Y4Z5A6B7C8D9E0F1G2H3J4",
		);
		expect(context?.actionContext?.actionId).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3K5");
		expect(context?.actionContext?.causedByActionId).toBe(
			"01J3Y4Z5A6B7C8D9E0F1G2H3K5",
		);
	});

	it("extracts flat action keys and baggage from MCP JSON-RPC meta", () => {
		const context = extractMcpContext({
			_meta: {
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				tracestate: "vendor=value",
				baggage: "tenant=acme",
				"obs.action.root_id": "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
				"obs.action.id": "01J3Y4Z5A6B7C8D9E0F1G2H3K5",
			},
		});

		expect(context?.actionContext?.rootActionId).toBe(
			"01J3Y4Z5A6B7C8D9E0F1G2H3J4",
		);
		expect(context?.actionContext?.actionId).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3K5");
		expect(context?.tracestate).toBe("vendor=value");
		expect(context?.baggage).toBe("tenant=acme");
	});

	it("injects the same context shape for MCP notifications", async () => {
		const requestSpan = createRequestSpan("mcp-client-service", "notify");

		await runWithSpan(requestSpan, async () => {
			await startAgentRun(
				{
					agentId: "mcp-client-agent",
					agentName: "MCP Orchestrator",
					goal: "Send MCP notification",
				},
				async (run) => {
					await run.step({ name: "notify-progress" }, async () => {
						// biome-ignore lint/suspicious/noExplicitAny: standard JSON-RPC params
						const params: any = { level: "info" };
						injectMcpNotificationContext(params);
						expect(params._meta.traceparent).toContain(requestSpan.traceId);
						expect(params._meta["obs.action.root_id"]).toBeDefined();
						expect(params._meta["obs.action.id"]).toBeDefined();
					});
				},
			);
		});
	});

	it("correctly restores extracted context and registers causal offspring", async () => {
		const params = {
			_meta: {
				traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
				obs: {
					root_action_id: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
					action_id: "01J3Y4Z5A6B7C8D9E0F1G2H3K5",
				},
			},
		};

		const extracted = extractMcpContext(params);
		expect(extracted).toBeDefined();

		// Simulate MCP host restoring contexts
		const serverSpan = createRequestSpan(
			"mcp-server-service",
			"mcp-tool-execution",
			extracted?.traceContext,
		);
		expect(serverSpan.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");

		await runWithSpan(serverSpan, async () => {
			const actionContext = extracted?.actionContext;
			expect(actionContext).toBeDefined();
			if (actionContext) {
				await withAction(actionContext, async () => {
					const activeAction = getActiveAgentContext();
					expect(activeAction).toBeDefined();
					expect(activeAction?.rootActionId).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3J4");
					expect(activeAction?.actionId).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3K5");

					// Create a child action step
					await step({ name: "mcp-server-internal-step" }, async () => {
						const stepAction = getActiveAgentContext();
						expect(stepAction).toBeDefined();
						expect(stepAction?.rootActionId).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3J4");
						expect(stepAction?.causedByActionId).toBe(
							"01J3Y4Z5A6B7C8D9E0F1G2H3K5",
						);
					});
				});
			}
		});
	});

	it("returns undefined when no context keys are passed in _meta", () => {
		const emptyMeta = { _meta: {} };
		expect(extractMcpContext(emptyMeta)).toBeUndefined();

		const noMeta = { arguments: {} };
		expect(extractMcpContext(noMeta)).toBeUndefined();
	});
});
