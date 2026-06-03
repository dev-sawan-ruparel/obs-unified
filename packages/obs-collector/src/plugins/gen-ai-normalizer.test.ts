import type { StoredSpan } from "@obs-unified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ACTION_KIND_KEY,
	ACTION_ROOT_ID_KEY,
	ACTOR_TYPE_KEY,
	ActionConfidence,
	ActionKind,
	AGENT_RUN_ID_KEY,
	OPENINFERENCE_SPAN_KIND_KEY,
	OpenInferenceSpanKind,
	TOOL_ARGS_KEY,
	TOOL_CALL_ID_KEY,
	TOOL_NAME_KEY,
	TOOL_SIDE_EFFECT_KEY,
} from "@obs-unified/types/constants";
import { describe, expect, it } from "vitest";
import type {
	CollectorRuntime,
	SpanProcessorPlugin,
} from "../framework/collector";
import type { CollectorRouteContext } from "../framework/env";
import { parseJsonRecord } from "../lib/json";
import { deriveActionId, genAiNormalizerPlugin } from "./gen-ai-normalizer";

describe("deriveActionId deterministic fallback ID hashing", () => {
	it("should generate a stable 26-character Crockford base32 action ID", async () => {
		const actionId1 = await deriveActionId("proj-123", "trace-abc", "span-xyz");
		const actionId2 = await deriveActionId("proj-123", "trace-abc", "span-xyz");

		expect(actionId1).toBe(actionId2);
		expect(actionId1).toHaveLength(26);
		expect(actionId1).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

		const actionId3 = await deriveActionId(
			"proj-123",
			"trace-abc",
			"span-different",
		);
		expect(actionId1).not.toBe(actionId3);
	});
});

describe("genAiNormalizerPlugin - OTel GenAI normalization", () => {
	const context = {
		env: {},
		now: new Date(),
		logger: console,
	} as unknown as CollectorRouteContext;

	const registerNormalizer = () => {
		const processors: SpanProcessorPlugin[] = [];
		const app = {};
		const runtime = {
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		};

		genAiNormalizerPlugin.register(
			app as Parameters<typeof genAiNormalizerPlugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
		return processors[0].process;
	};

	it("should normalize raw gen_ai.* spans and derive canonical Action Graph attributes", async () => {
		const processFn = registerNormalizer();

		const rawSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-456",
			parentSpanId: "span-parent",
			traceId: "trace-789",
			traceState: null,
			serviceName: "my-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "chat",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"gen_ai.operation.name": "chat",
				"gen_ai.system": "openai",
				"gen_ai.request.model": "gpt-4o",
				"gen_ai.usage.input_tokens": 120,
				"gen_ai.usage.output_tokens": 80,
				"gen_ai.prompt": "Hello normalizer",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const [processed] = await processFn([rawSpan], context);
		const attrs = parseJsonRecord(processed.attributesJson);

		// OpenInference conversions
		expect(attrs[OPENINFERENCE_SPAN_KIND_KEY]).toBe(OpenInferenceSpanKind.LLM);
		expect(attrs["llm.model_name"]).toBe("gpt-4o");
		expect(attrs["llm.provider"]).toBe("openai");
		expect(attrs["llm.token_count.prompt"]).toBe(120);
		expect(attrs["llm.token_count.completion"]).toBe(80);
		expect(attrs["llm.token_count.total"]).toBe(200);

		// Action Graph Schema attributes
		expect(attrs[ACTION_ID_KEY]).toBeDefined();
		expect(attrs[ACTION_ID_KEY]).toHaveLength(26);
		expect(attrs[ACTION_CONFIDENCE_KEY]).toBe(ActionConfidence.Fallback);

		// Derived root and causal parent relationships
		const derivedRoot = await deriveActionId(
			"proj-123",
			"trace-789",
			"trace-789".substring(0, 16),
		);
		const derivedCausedBy = await deriveActionId(
			"proj-123",
			"trace-789",
			"span-parent",
		);

		expect(attrs[ACTION_ROOT_ID_KEY]).toBe(derivedRoot);
		expect(attrs[ACTION_CAUSED_BY_ID_KEY]).toBe(derivedCausedBy);
		expect(attrs[ACTOR_TYPE_KEY]).toBe("agent");
		expect(attrs[AGENT_RUN_ID_KEY]).toBe(derivedRoot);
		expect(attrs[ACTION_KIND_KEY]).toBe(ActionKind.LlmCall);
	});

	it("should preserve explicitly passed Action Graph attributes", async () => {
		const processFn = registerNormalizer();

		const explicitSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-456",
			parentSpanId: null,
			traceId: "trace-789",
			traceState: null,
			serviceName: "my-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "chat",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"gen_ai.operation.name": "chat",
				[ACTION_ID_KEY]: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
				[ACTION_ROOT_ID_KEY]: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
				[ACTION_CAUSED_BY_ID_KEY]: "01HZQ5W3K8M4P2X7N9B0CDEFGH",
				[ACTOR_TYPE_KEY]: "system",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const [processed] = await processFn([explicitSpan], context);
		const attrs = parseJsonRecord(processed.attributesJson);

		expect(attrs[ACTION_ID_KEY]).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3J4");
		expect(attrs[ACTION_ROOT_ID_KEY]).toBe("01J3Y4Z5A6B7C8D9E0F1G2H3J4");
		expect(attrs[ACTION_CAUSED_BY_ID_KEY]).toBe("01HZQ5W3K8M4P2X7N9B0CDEFGH");
		expect(attrs[ACTOR_TYPE_KEY]).toBe("system");
		expect(attrs[ACTION_CONFIDENCE_KEY]).toBe(ActionConfidence.Explicit);
	});

	it("derives fallback action ids when explicit Action Graph attributes are malformed", async () => {
		const processFn = registerNormalizer();

		const invalidSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-456",
			parentSpanId: "span-parent",
			traceId: "trace-789",
			traceState: null,
			serviceName: "my-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "chat",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"gen_ai.operation.name": "chat",
				[ACTION_ID_KEY]: "not-an-action-id",
				[ACTION_ROOT_ID_KEY]: "also-invalid",
				[ACTION_CAUSED_BY_ID_KEY]: "bad-parent",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const [processed] = await processFn([invalidSpan], context);
		const attrs = parseJsonRecord(processed.attributesJson);

		expect(attrs[ACTION_ID_KEY]).toBe(
			await deriveActionId("proj-123", "trace-789", "span-456"),
		);
		expect(attrs[ACTION_ROOT_ID_KEY]).toBe(
			await deriveActionId(
				"proj-123",
				"trace-789",
				"trace-789".substring(0, 16),
			),
		);
		expect(attrs[ACTION_CAUSED_BY_ID_KEY]).toBe(
			await deriveActionId("proj-123", "trace-789", "span-parent"),
		);
		expect(attrs[ACTION_CONFIDENCE_KEY]).toBe(ActionConfidence.Fallback);
	});
});

describe("genAiNormalizerPlugin - OTel MCP normalization", () => {
	const context = {
		env: {},
		now: new Date(),
		logger: console,
	} as unknown as CollectorRouteContext;

	const registerNormalizer = () => {
		const processors: SpanProcessorPlugin[] = [];
		const app = {};
		const runtime = {
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		};

		genAiNormalizerPlugin.register(
			app as Parameters<typeof genAiNormalizerPlugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
		return processors[0].process;
	};

	it("should normalize mcp tools/call spans to TOOL kind and Action kind tool.call", async () => {
		const processFn = registerNormalizer();

		const mcpSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-456",
			parentSpanId: null,
			traceId: "trace-789",
			traceState: null,
			serviceName: "mcp-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "update_invoice_status",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"mcp.method.name": "tools/call",
				"mcp.tool.name": "update_invoice_status",
				"mcp.tool.arguments": { invoice_id: "INV-2026", status: "paid" },
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const [processed] = await processFn([mcpSpan], context);
		const attrs = parseJsonRecord(processed.attributesJson);

		expect(attrs[OPENINFERENCE_SPAN_KIND_KEY]).toBe(OpenInferenceSpanKind.TOOL);
		expect(attrs[ACTION_KIND_KEY]).toBe(ActionKind.ToolCall);
		expect(attrs[TOOL_CALL_ID_KEY]).toBe(attrs[ACTION_ID_KEY]);
		expect(attrs[TOOL_NAME_KEY]).toBe("update_invoice_status");
		expect(attrs["obs.tool_call.tool_name"]).toBe("update_invoice_status");
		expect(attrs[TOOL_ARGS_KEY]).toBe(
			JSON.stringify({ invoice_id: "INV-2026", status: "paid" }),
		);
		expect(attrs["obs.tool_call.args"]).toBe(
			JSON.stringify({ invoice_id: "INV-2026", status: "paid" }),
		);
		expect(attrs[TOOL_SIDE_EFFECT_KEY]).toBe(1);
	});

	it("infers MCP side effects only from leading mutation verbs", async () => {
		const processFn = registerNormalizer();

		const baseSpan = {
			projectId: "proj-123",
			parentSpanId: null,
			traceId: "trace-789",
			traceState: null,
			serviceName: "mcp-service",
			scopeName: null,
			scopeVersion: null,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		} satisfies Partial<StoredSpan>;

		const spans: StoredSpan[] = [
			{
				...baseSpan,
				spanId: "span-write",
				spanName: "write_file",
				attributesJson: JSON.stringify({
					"mcp.method.name": "tools/call",
					"mcp.tool.name": "write_file",
				}),
			},
			{
				...baseSpan,
				spanId: "span-list",
				spanName: "list_updates",
				attributesJson: JSON.stringify({
					"mcp.method.name": "tools/call",
					"mcp.tool.name": "list_updates",
				}),
			},
			{
				...baseSpan,
				spanId: "span-status",
				spanName: "get_write_status",
				attributesJson: JSON.stringify({
					"mcp.method.name": "tools/call",
					"mcp.tool.name": "get_write_status",
				}),
			},
			{
				...baseSpan,
				spanId: "span-explicit",
				spanName: "read_with_explicit_side_effect",
				attributesJson: JSON.stringify({
					"mcp.method.name": "tools/call",
					"mcp.tool.name": "read_status",
					"mcp.tool.side_effect": 1,
				}),
			},
		] as StoredSpan[];

		const processed = await processFn(spans, context);
		const attrs = processed.map((span) => parseJsonRecord(span.attributesJson));

		expect(attrs[0][TOOL_SIDE_EFFECT_KEY]).toBe(1);
		expect(attrs[1][TOOL_SIDE_EFFECT_KEY]).toBe(0);
		expect(attrs[2][TOOL_SIDE_EFFECT_KEY]).toBe(0);
		expect(attrs[3][TOOL_SIDE_EFFECT_KEY]).toBe(1);
	});

	it("should normalize mcp resources/read and prompts/get spans to RETRIEVER and PROMPT kinds", async () => {
		const processFn = registerNormalizer();

		const resourceSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-456",
			parentSpanId: null,
			traceId: "trace-789",
			traceState: null,
			serviceName: "mcp-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "read_logs",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"mcp.method.name": "resources/read",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const promptSpan: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-789",
			parentSpanId: null,
			traceId: "trace-789",
			traceState: null,
			serviceName: "mcp-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "summarize_doc",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				"mcp.method.name": "prompts/get",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		};

		const [processedRes, processedPrompt] = await processFn(
			[resourceSpan, promptSpan],
			context,
		);

		const attrsRes = parseJsonRecord(processedRes.attributesJson);
		expect(attrsRes[OPENINFERENCE_SPAN_KIND_KEY]).toBe(
			OpenInferenceSpanKind.RETRIEVER,
		);
		expect(attrsRes[ACTION_KIND_KEY]).toBe(ActionKind.Retrieval);

		const attrsPrompt = parseJsonRecord(processedPrompt.attributesJson);
		expect(attrsPrompt[OPENINFERENCE_SPAN_KIND_KEY]).toBe(
			OpenInferenceSpanKind.PROMPT,
		);
		expect(attrsPrompt[ACTION_KIND_KEY]).toBe(ActionKind.AgentStep);
	});
});

describe("genAiNormalizerPlugin - OpenInference span kinds and Phase 0 fixtures", () => {
	const context = {
		env: {},
		now: new Date(),
		logger: console,
	} as unknown as CollectorRouteContext;

	const registerNormalizer = () => {
		const processors: SpanProcessorPlugin[] = [];
		const app = {};
		const runtime = {
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		};

		genAiNormalizerPlugin.register(
			app as Parameters<typeof genAiNormalizerPlugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
		return processors[0].process;
	};

	it("should map EMBEDDING, RERANKER, GUARDRAIL, EVALUATOR, AGENT, CHAIN to canonical action kinds", async () => {
		const processFn = registerNormalizer();

		const testSpans = [
			"EMBEDDING",
			"RERANKER",
			"GUARDRAIL",
			"EVALUATOR",
			"AGENT",
			"CHAIN",
		].map((oiKind, idx) => ({
			projectId: "proj-123",
			spanId: `span-oi-${idx}`,
			parentSpanId: null,
			traceId: "trace-oi",
			traceState: null,
			serviceName: "oi-service",
			scopeName: null,
			scopeVersion: null,
			spanName: `test-${oiKind.toLowerCase()}`,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-31T22:00:00.000Z",
			endTime: "2026-05-31T22:00:02.000Z",
			durationMs: 2000,
			attributesJson: JSON.stringify({
				[OPENINFERENCE_SPAN_KIND_KEY]: oiKind,
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-31T22:00:02.000Z",
			expiresAt: "2026-06-01T22:00:02.000Z",
			sessionId: null,
			interactionId: null,
		}));

		const processed = await processFn(testSpans, context);
		const kinds = processed.map(
			(p) => parseJsonRecord(p.attributesJson)[ACTION_KIND_KEY],
		);

		expect(kinds[0]).toBe(ActionKind.AgentStep); // EMBEDDING
		expect(kinds[1]).toBe(ActionKind.AgentStep); // RERANKER
		expect(kinds[2]).toBe(ActionKind.AgentStep); // GUARDRAIL
		expect(kinds[3]).toBe(ActionKind.Eval); // EVALUATOR
		expect(kinds[4]).toBe(ActionKind.AgentStep); // AGENT
		expect(kinds[5]).toBe(ActionKind.AgentStep); // CHAIN
	});

	it("verifies and loads Phase 0 action fixtures as conformance baseline", async () => {
		const fs = await import("node:fs");
		const path = await import("node:path");

		let fixturesDir = path.resolve(process.cwd(), "tests/fixtures/actions");
		if (!fs.existsSync(fixturesDir)) {
			fixturesDir = path.resolve(process.cwd(), "../../tests/fixtures/actions");
		}
		const files = [
			"browser-only-flow.json",
			"click-triggered-agent-run.json",
			"cron-triggered-agent-run.json",
			"wrong-invoice-update.json",
		];

		for (const file of files) {
			const filePath = path.join(fixturesDir, file);
			expect(fs.existsSync(filePath)).toBe(true);

			const raw = fs.readFileSync(filePath, "utf8");
			const json = JSON.parse(raw);

			// Assert minimum required Action Graph envelope keys
			expect(json.actions).toBeDefined();
			expect(Array.isArray(json.actions)).toBe(true);
			expect(json.agent_runs).toBeDefined();
			expect(json.tool_calls).toBeDefined();

			if (json.actions.length > 0) {
				const firstAction = json.actions[0];
				expect(firstAction.id).toBeDefined();
				expect(firstAction.project_id).toBeDefined();
				expect(firstAction.root_action_id).toBeDefined();
			}

			const fixtureSpans: StoredSpan[] = json.actions.map(
				(action: Record<string, unknown>) => {
					const attrs =
						typeof action.attrs_json === "string"
							? parseJsonRecord(action.attrs_json)
							: {};
					const actionKind = String(action.action_kind ?? "agent.step");
					const openInferenceKind = actionKind.includes("tool")
						? OpenInferenceSpanKind.TOOL
						: actionKind.includes("llm")
							? OpenInferenceSpanKind.LLM
							: actionKind.includes("retriev")
								? OpenInferenceSpanKind.RETRIEVER
								: actionKind.includes("eval") ||
										actionKind.includes("guardrail")
									? OpenInferenceSpanKind.EVALUATOR
									: OpenInferenceSpanKind.CHAIN;
					return {
						projectId: String(action.project_id),
						spanId: String(action.span_id),
						parentSpanId:
							typeof action.caused_by_action_id === "string"
								? String(action.caused_by_action_id).slice(0, 16)
								: null,
						traceId: String(action.trace_id),
						traceState: null,
						serviceName: "fixture",
						scopeName: null,
						scopeVersion: null,
						spanName: String(action.name ?? action.id),
						spanKind: 1,
						statusCode: action.status === "error" ? 2 : 1,
						statusMessage: null,
						startTime: String(action.started_at),
						endTime:
							typeof action.ended_at === "string"
								? String(action.ended_at)
								: String(action.started_at),
						durationMs: Number(action.duration_ms ?? 0),
						attributesJson: JSON.stringify({
							...attrs,
							[OPENINFERENCE_SPAN_KIND_KEY]: openInferenceKind,
							[ACTION_ID_KEY]: action.id,
							[ACTION_ROOT_ID_KEY]: action.root_action_id,
							[ACTION_CAUSED_BY_ID_KEY]: action.caused_by_action_id,
							[ACTION_KIND_KEY]: action.action_kind,
							[AGENT_RUN_ID_KEY]: action.agent_run_id,
						}),
						droppedAttributesCount: 0,
						resourceAttributesJson: "{}",
						eventsJson: "[]",
						droppedEventsCount: 0,
						linksJson: "[]",
						droppedLinksCount: 0,
						receivedAt: String(action.ended_at ?? action.started_at),
						expiresAt: "2026-06-01T00:00:00.000Z",
						sessionId:
							typeof action.session_id === "string"
								? String(action.session_id)
								: null,
						interactionId:
							typeof action.interaction_id === "string"
								? String(action.interaction_id)
								: null,
					};
				},
			);

			const processed = await registerNormalizer()(fixtureSpans, context);
			for (let i = 0; i < processed.length; i++) {
				const attrs = parseJsonRecord(processed[i].attributesJson);
				const action = json.actions[i];
				expect(attrs[ACTION_ID_KEY]).toBe(action.id);
				expect(attrs[ACTION_ROOT_ID_KEY]).toBe(action.root_action_id);
				expect(attrs[ACTION_KIND_KEY]).toBe(action.action_kind);
				expect(attrs[ACTION_CONFIDENCE_KEY]).toBe(ActionConfidence.Explicit);
				if (action.agent_run_id) {
					expect(attrs[AGENT_RUN_ID_KEY]).toBe(action.agent_run_id);
				}
			}
		}
	});
});
