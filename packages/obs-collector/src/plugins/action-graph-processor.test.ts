import type { StoredSpan } from "@obsunified/types";
import {
	ACTION_CAUSED_BY_ID_KEY,
	ACTION_CONFIDENCE_KEY,
	ACTION_ID_KEY,
	ACTION_ROOT_ID_KEY,
	ActionConfidence,
} from "@obsunified/types/constants";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	CollectorPlugin,
	CollectorRuntime,
	SpanProcessorPlugin,
} from "../framework/collector";
import type { CollectorRouteContext } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import {
	type ActionEnricherPlugin,
	actionGraphProcessorPlugin,
	clearActionEnricherPlugins,
	clearRedactionPlugins,
	type PayloadRedactorPlugin,
	registerActionEnricherPlugin,
	registerRedactionPlugin,
} from "./action-graph-processor";
import { deriveActionId, genAiNormalizerPlugin } from "./gen-ai-normalizer";

const ACTION_ID_1 = "01J3Y4Z5A6B7C8D9E0F1G2H3J4";
const ACTION_ID_2 = "01J3Y4Z5A6B7C8D9E0F1G2H3K5";
const RUN_ROLLUP_ID = "01HZQ5W3K8M4P2X7N9B0CDEFGH";
const LLM_ACTION_ID = "01J4A6B7C8D9E0F1G2H3J4K5M6";
const TOOL_ACTION_ID = "01J4A6B7C8D9E0F1G2H3J4K5M7";

const registerSpanProcessors = (...plugins: CollectorPlugin[]) => {
	const processors: SpanProcessorPlugin[] = [];
	const runtime = {
		addSpanProcessor(p: SpanProcessorPlugin) {
			processors.push(p);
		},
	};
	for (const plugin of plugins) {
		plugin.register(
			{} as Parameters<typeof plugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
	}
	return async (spans: StoredSpan[], context: CollectorRouteContext) => {
		let next = spans;
		for (const processor of processors) {
			next = await processor.process(next, context);
		}
		return next;
	};
};

describe("actionGraphProcessorPlugin — Extensibility & Enrichment", () => {
	let db: MemSqlDb;
	let context: CollectorRouteContext;

	beforeEach(() => {
		db = new MemSqlDb();
		context = {
			env: {
				DB: db,
				OBS_PAYLOAD_CAPTURE_DEFAULT: "true",
			},
			now: new Date(),
			logger: console,
		} as unknown as CollectorRouteContext;
		clearActionEnricherPlugins();
		clearRedactionPlugins();
	});

	afterEach(() => {
		clearActionEnricherPlugins();
		clearRedactionPlugins();
	});

	it("triggers action enricher hooks and successfully mutates records prior to database insertion", async () => {
		const enricherCalls: string[] = [];

		const mockEnricher: ActionEnricherPlugin = {
			name: "test-enricher",
			enrichActionRecord(record, _span, _attrs) {
				enricherCalls.push("enrichActionRecord");
				record.name = "enriched-action-name";
			},
			enrichAgentRunRecord(record, _span, _attrs) {
				enricherCalls.push("enrichAgentRunRecord");
				record.goal = "enriched-goal";
			},
			enrichToolCallRecord(record, _span, _attrs) {
				enricherCalls.push("enrichToolCallRecord");
				record.toolName = "enriched-tool";
			},
			enrichRetrievalRecord(record, _span, _attrs) {
				enricherCalls.push("enrichRetrievalRecord");
				record.retrieverName = "enriched-retriever";
			},
			enrichEvalRecord(record, _span, _attrs) {
				enricherCalls.push("enrichEvalRecord");
				record.evaluatorName = "enriched-evaluator";
			},
			enrichArtifactRecord(record, _span, _attrs) {
				enricherCalls.push("enrichArtifactRecord");
				record.artifactName = "enriched-artifact";
			},
		};

		registerActionEnricherPlugin(mockEnricher);

		// A span with all possible agent-action details to trigger all enrichers
		const span: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-1",
			parentSpanId: null,
			traceId: "trace-1",
			traceState: null,
			serviceName: "test-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "original-name",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:05.000Z",
			durationMs: 5000,
			attributesJson: JSON.stringify({
				"obs.action.id": ACTION_ID_1,
				"obs.action.kind": "agent.run",
				"obs.agent_run.agent_id": "agent-1",
				"obs.agent_run.goal": "original-goal",
				// Trigger tool call
				"obs.tool_call.tool_name": "original-tool",
				"obs.tool_call.args": "{}",
				// Trigger retrieval
				"obs.retrieval.retriever_name": "original-retriever",
				"obs.retrieval.query": "original-query",
				// Trigger eval
				"obs.eval.evaluator_name": "original-evaluator",
				"obs.eval.passed": 1,
				// Trigger artifact
				"obs.artifact.name": "original-artifact",
				"obs.artifact.content": "original-content",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:05.000Z",
			expiresAt: "2026-05-23T00:00:05.000Z",
			sessionId: null,
			interactionId: null,
		};

		// Get the processor from the plugin registration
		const processors: SpanProcessorPlugin[] = [];
		const app = {};
		const runtime = {
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		};

		actionGraphProcessorPlugin.register(
			app as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");
		expect(processFn).toBeDefined();

		// Run processing
		await processFn([span], context);

		// Assert that all six enricher hooks were called
		expect(enricherCalls).toContain("enrichActionRecord");
		expect(enricherCalls).toContain("enrichAgentRunRecord");
		expect(enricherCalls).toContain("enrichToolCallRecord");
		expect(enricherCalls).toContain("enrichRetrievalRecord");
		expect(enricherCalls).toContain("enrichEvalRecord");
		expect(enricherCalls).toContain("enrichArtifactRecord");

		// Assert that the database writes contain the mutated fields!
		const actionInserts = db.callsMatching("INSERT INTO actions");
		expect(actionInserts).toHaveLength(1);
		// index 7 of bind values is name (8th column)
		// SQLite Actions columns: id, project_id, root_action_id, caused_by_action_id, actor_type, actor_id, action_kind, name
		expect(actionInserts[0].binds).toContain("enriched-action-name");

		const runInserts = db.callsMatching("INSERT INTO agent_runs");
		expect(runInserts).toHaveLength(1);
		expect(runInserts[0].binds).toContain("enriched-goal");

		const toolInserts = db.callsMatching("INSERT INTO tool_calls");
		expect(toolInserts).toHaveLength(1);
		expect(toolInserts[0].binds).toContain("enriched-tool");

		const retrievalInserts = db.callsMatching("INSERT INTO retrieval_events");
		expect(retrievalInserts).toHaveLength(1);
		expect(retrievalInserts[0].binds).toContain("enriched-retriever");

		const evalInserts = db.callsMatching("INSERT INTO eval_results");
		expect(evalInserts).toHaveLength(1);
		expect(evalInserts[0].binds).toContain("enriched-evaluator");

		const artifactInserts = db.callsMatching("INSERT INTO artifacts");
		expect(artifactInserts).toHaveLength(1);
		expect(artifactInserts[0].binds).toContain("enriched-artifact");
	});

	it("plugs in custom payload redactor plugins and sanitizes fields before DB write", async () => {
		const mockRedactor: PayloadRedactorPlugin = {
			name: "test-redactor",
			redact(_value, ctx) {
				if (ctx.kind === "tool_call" && ctx.fieldName === "args") {
					return { redactedSecret: "yes-redacted" };
				}
				if (ctx.kind === "retrieval" && ctx.fieldName === "query") {
					return "redacted-query-string";
				}
				return undefined;
			},
		};

		registerRedactionPlugin(mockRedactor);

		const span: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-1",
			parentSpanId: null,
			traceId: "trace-1",
			traceState: null,
			serviceName: "test-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "my-tool-span",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:05.000Z",
			durationMs: 5000,
			attributesJson: JSON.stringify({
				"obs.action.id": ACTION_ID_1,
				"obs.action.kind": "tool.call",
				"obs.tool_call.tool_name": "some-tool",
				"obs.tool_call.args": JSON.stringify({
					secretKey: "supersecretPassword123",
				}),
				"obs.retrieval.retriever_name": "some-retriever",
				"obs.retrieval.query": "find secret documents",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:05.000Z",
			expiresAt: "2026-05-23T00:00:05.000Z",
			sessionId: null,
			interactionId: null,
		};

		const processors: SpanProcessorPlugin[] = [];
		const app = {};
		const runtime = {
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		};

		actionGraphProcessorPlugin.register(
			app as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			runtime as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");
		await processFn([span], context);

		const toolInserts = db.callsMatching("INSERT INTO tool_calls");
		expect(toolInserts).toHaveLength(1);
		// The redacted args column should carry our redacted structure
		const argsBindVal = toolInserts[0].binds.find(
			(b) => typeof b === "string" && b.includes("redactedSecret"),
		);
		expect(argsBindVal).toBe(
			JSON.stringify({ redactedSecret: "yes-redacted" }),
		);

		const retrievalInserts = db.callsMatching("INSERT INTO retrieval_events");
		expect(retrievalInserts).toHaveLength(1);
		// The redacted query (which actually isn't stored in a redacted query column because standard retrieval stores documentsJson redacted)
		// Wait, let's see how retrieval_events is defined. It has documentsJson, totalResults, queryHash.
		// Wait, in `action-graph-processor.ts`:
		// redactedDocs = runRedaction(rawDocs, ...)
		// redactedQuery = runRedaction(rawQuery, ...)
		// queryHash is sha256Hex of rawQuery.
	});

	it("stores hashes and metadata only when project payload capture is disabled", async () => {
		context = {
			...context,
			env: {
				DB: db,
			},
		} as unknown as CollectorRouteContext;

		const span: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-privacy",
			parentSpanId: null,
			traceId: "trace-privacy",
			traceState: null,
			serviceName: "test-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "update-invoice",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			attributesJson: JSON.stringify({
				"obs.action.id": ACTION_ID_2,
				"obs.action.kind": "tool.call",
				"obs.tool_call.tool_name": "update_invoice",
				"obs.tool_call.args": JSON.stringify({
					invoiceId: "inv-123",
					email: "customer@example.com",
				}),
				"obs.tool_call.result": JSON.stringify({ ok: true }),
				"ai.payload.input": "raw prompt must not persist",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: null,
			interactionId: null,
		};

		const processors: SpanProcessorPlugin[] = [];
		actionGraphProcessorPlugin.register(
			{} as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			{
				addSpanProcessor(p: SpanProcessorPlugin) {
					processors.push(p);
				},
			} as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");
		await processFn([span], context);

		const actionInsert = db.callsMatching("INSERT INTO actions")[0];
		expect(actionInsert.binds).not.toContain("raw prompt must not persist");
		expect(
			actionInsert.binds.some((bind) => String(bind).includes("email")),
		).toBe(false);

		const toolInsert = db.callsMatching("INSERT INTO tool_calls")[0];
		expect(toolInsert.binds).toContain(null);
		expect(
			toolInsert.binds.some((bind) =>
				String(bind).includes("customer@example.com"),
			),
		).toBe(false);
	});

	it("persists agent run cost and latency rollups from child LLM and tool actions", async () => {
		const baseSpan = {
			projectId: "proj-123",
			parentSpanId: null,
			traceId: "trace-rollup",
			traceState: null,
			serviceName: "test-service",
			scopeName: null,
			scopeVersion: null,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:05.000Z",
			expiresAt: "2026-05-23T00:00:05.000Z",
			sessionId: null,
			interactionId: null,
		} satisfies Partial<StoredSpan>;

		const spans: StoredSpan[] = [
			{
				...baseSpan,
				spanId: "span-run",
				spanName: "agent-run",
				startTime: "2026-05-22T00:00:00.000Z",
				endTime: "2026-05-22T00:00:01.000Z",
				durationMs: 1000,
				attributesJson: JSON.stringify({
					"obs.action.id": RUN_ROLLUP_ID,
					"obs.action.kind": "agent.run",
					"obs.agent_run.agent_id": "agent-rollup",
				}),
			},
			{
				...baseSpan,
				spanId: "span-llm",
				spanName: "classify",
				startTime: "2026-05-22T00:00:01.000Z",
				endTime: "2026-05-22T00:00:03.000Z",
				durationMs: 2000,
				attributesJson: JSON.stringify({
					"obs.action.id": LLM_ACTION_ID,
					"obs.action.root_id": RUN_ROLLUP_ID,
					"obs.action.kind": "llm.call",
					"obs.agent_run.id": RUN_ROLLUP_ID,
					"llm.cost.total_usd": 0.015,
				}),
			},
			{
				...baseSpan,
				spanId: "span-tool",
				spanName: "mutate",
				startTime: "2026-05-22T00:00:03.000Z",
				endTime: "2026-05-22T00:00:05.500Z",
				durationMs: 2500,
				attributesJson: JSON.stringify({
					"obs.action.id": TOOL_ACTION_ID,
					"obs.action.root_id": RUN_ROLLUP_ID,
					"obs.action.kind": "tool.call",
					"obs.agent_run.id": RUN_ROLLUP_ID,
					"obs.tool_call.tool_name": "db.update_invoice",
					"gen_ai.usage.cost_usd": 0.02,
				}),
			},
		] as StoredSpan[];

		const processors: SpanProcessorPlugin[] = [];
		actionGraphProcessorPlugin.register(
			{} as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			{
				addSpanProcessor(p: SpanProcessorPlugin) {
					processors.push(p);
				},
			} as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");
		await processFn(spans, context);

		const runInsert = db.callsMatching("INSERT INTO agent_runs")[0];
		expect(runInsert.binds[10]).toBe(0.035);
		expect(runInsert.binds[11]).toBe(5500);

		const actionInserts = db.callsMatching("INSERT INTO actions");
		expect(actionInserts.map((insert) => insert.binds[23])).toEqual([
			null,
			0.015,
			0.02,
		]);
	});

	it("rejects malformed explicit action IDs and persists deterministic fallback context", async () => {
		let enricherAttrs: Record<string, unknown> | null = null;
		registerActionEnricherPlugin({
			name: "trust-boundary-test",
			enrichActionRecord(_record, _span, attrs) {
				enricherAttrs = attrs;
			},
		});

		const span: StoredSpan = {
			projectId: "proj-123",
			spanId: "span-malformed",
			parentSpanId: null,
			traceId: "trace-malformed",
			traceState: null,
			serviceName: "test-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "malformed-tool",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			attributesJson: JSON.stringify({
				[ACTION_ID_KEY]: "not-an-action-id",
				[ACTION_ROOT_ID_KEY]: "also-not-an-action-id",
				[ACTION_CAUSED_BY_ID_KEY]: "bad-parent-id",
				"obs.agent_run.id": "bad-run-id",
				"obs.action.kind": "tool.call",
				"obs.tool_call.tool_name": "unsafe_tool",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: null,
			interactionId: null,
		};

		const processors: SpanProcessorPlugin[] = [];
		actionGraphProcessorPlugin.register(
			{} as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			{
				addSpanProcessor(p: SpanProcessorPlugin) {
					processors.push(p);
				},
			} as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");

		const [transformed] = await processFn([span], context);
		const expectedActionId = await deriveActionId(
			span.projectId,
			span.traceId,
			span.spanId,
		);
		const expectedRootId = await deriveActionId(
			span.projectId,
			span.traceId,
			span.traceId.substring(0, 16),
		);

		const actionInsert = db.callsMatching("INSERT INTO actions")[0];
		expect(actionInsert.binds[0]).toBe(expectedActionId);
		expect(actionInsert.binds[2]).toBe(expectedRootId);
		expect(actionInsert.binds[3]).toBeNull();
		expect(actionInsert.binds[17]).toBeNull();

		const attrsJson = String(actionInsert.binds[24]);
		expect(attrsJson).not.toContain("not-an-action-id");
		expect(attrsJson).not.toContain("also-not-an-action-id");
		expect(attrsJson).not.toContain("bad-parent-id");
		expect(attrsJson).not.toContain("bad-run-id");
		expect(JSON.parse(attrsJson)).toMatchObject({
			[ACTION_ID_KEY]: expectedActionId,
			[ACTION_ROOT_ID_KEY]: expectedRootId,
			[ACTION_CAUSED_BY_ID_KEY]: null,
			[ACTION_CONFIDENCE_KEY]: ActionConfidence.Fallback,
		});

		const transformedAttrs = JSON.parse(transformed?.attributesJson ?? "{}");
		expect(transformedAttrs[ACTION_ID_KEY]).toBe(expectedActionId);
		expect(transformedAttrs[ACTION_CONFIDENCE_KEY]).toBe(
			ActionConfidence.Fallback,
		);
		expect(transformedAttrs["obs.agent_run.id"]).toBeUndefined();
		expect(enricherAttrs).toMatchObject({
			[ACTION_ID_KEY]: expectedActionId,
			[ACTION_ROOT_ID_KEY]: expectedRootId,
			[ACTION_CAUSED_BY_ID_KEY]: null,
			[ACTION_CONFIDENCE_KEY]: ActionConfidence.Fallback,
		});
		expect(JSON.stringify(enricherAttrs)).not.toContain("not-an-action-id");
		expect(JSON.stringify(enricherAttrs)).not.toContain(
			"also-not-an-action-id",
		);
		expect(JSON.stringify(enricherAttrs)).not.toContain("bad-parent-id");
		expect(JSON.stringify(enricherAttrs)).not.toContain("bad-run-id");
	});

	it("derives queue continuation parent links when explicit async IDs are absent", async () => {
		const span: StoredSpan = {
			projectId: "proj-123",
			spanId: "queue-child-span",
			parentSpanId: "queue-parent-span",
			traceId: "trace-queue",
			traceState: null,
			serviceName: "worker-service",
			scopeName: null,
			scopeVersion: null,
			spanName: "continue queued job",
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			attributesJson: JSON.stringify({
				"openinference.span.kind": "CHAIN",
			}),
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: null,
			interactionId: null,
		};

		const processors: SpanProcessorPlugin[] = [];
		actionGraphProcessorPlugin.register(
			{} as Parameters<typeof actionGraphProcessorPlugin.register>[0],
			{
				addSpanProcessor(p: SpanProcessorPlugin) {
					processors.push(p);
				},
			} as unknown as CollectorRuntime,
		);
		const processFn = processors[0]?.process;
		if (!processFn) throw new Error("span processor was not registered");

		await processFn([span], context);
		const expectedActionId = await deriveActionId(
			span.projectId,
			span.traceId,
			span.spanId,
		);
		const expectedParentActionId = await deriveActionId(
			span.projectId,
			span.traceId,
			span.parentSpanId ?? "",
		);

		const actionInsert = db.callsMatching("INSERT INTO actions")[0];
		expect(actionInsert.binds[0]).toBe(expectedActionId);
		expect(actionInsert.binds[3]).toBe(expectedParentActionId);
		const attrs = JSON.parse(String(actionInsert.binds[24]));
		expect(attrs[ACTION_CONFIDENCE_KEY]).toBe(ActionConfidence.Fallback);
		expect(attrs[ACTION_CAUSED_BY_ID_KEY]).toBe(expectedParentActionId);
	});

	it("preserves action identity confidence across the normalizer-to-processor pipeline", async () => {
		const baseSpan = {
			projectId: "proj-123",
			parentSpanId: null,
			traceId: "trace-pipeline",
			traceState: null,
			serviceName: "pipeline-service",
			scopeName: null,
			scopeVersion: null,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: null,
			interactionId: null,
		} satisfies Partial<StoredSpan>;

		const explicitId = "01J3Y4Z5A6B7C8D9E0F1G2H3J4";
		const spans: StoredSpan[] = [
			{
				...baseSpan,
				spanId: "span-fallback",
				spanName: "fallback llm",
				attributesJson: JSON.stringify({
					"gen_ai.operation.name": "chat",
				}),
			},
			{
				...baseSpan,
				spanId: "span-explicit",
				spanName: "explicit llm",
				attributesJson: JSON.stringify({
					"gen_ai.operation.name": "chat",
					[ACTION_ID_KEY]: explicitId,
				}),
			},
			{
				...baseSpan,
				spanId: "span-malformed-pipeline",
				spanName: "malformed llm",
				attributesJson: JSON.stringify({
					"gen_ai.operation.name": "chat",
					[ACTION_ID_KEY]: "not-an-action-id",
				}),
			},
			{
				...baseSpan,
				spanId: "span-mcp",
				spanName: "write_file",
				attributesJson: JSON.stringify({
					"mcp.method.name": "tools/call",
					"mcp.tool.name": "write_file",
				}),
			},
			{
				...baseSpan,
				spanId: "span-queue-child",
				parentSpanId: "span-queue-parent",
				spanName: "queued continuation",
				attributesJson: JSON.stringify({
					"openinference.span.kind": "CHAIN",
				}),
			},
		] as StoredSpan[];

		const runPipeline = registerSpanProcessors(
			genAiNormalizerPlugin,
			actionGraphProcessorPlugin,
		);
		await runPipeline(spans, context);

		const actionBySpan = new Map(
			db
				.callsMatching("INSERT INTO actions")
				.map((insert) => [String(insert.binds[13]), insert]),
		);
		const attrsFor = (spanId: string) =>
			JSON.parse(String(actionBySpan.get(spanId)?.binds[24] ?? "{}"));

		expect(attrsFor("span-fallback")[ACTION_CONFIDENCE_KEY]).toBe(
			ActionConfidence.Fallback,
		);
		expect(attrsFor("span-explicit")).toMatchObject({
			[ACTION_ID_KEY]: explicitId,
			[ACTION_CONFIDENCE_KEY]: ActionConfidence.Explicit,
		});
		expect(attrsFor("span-malformed-pipeline")).toMatchObject({
			[ACTION_ID_KEY]: await deriveActionId(
				"proj-123",
				"trace-pipeline",
				"span-malformed-pipeline",
			),
			[ACTION_CONFIDENCE_KEY]: ActionConfidence.Fallback,
		});
		expect(attrsFor("span-mcp")[ACTION_CONFIDENCE_KEY]).toBe(
			ActionConfidence.Fallback,
		);
		expect(db.callsMatching("INSERT INTO tool_calls")).toHaveLength(1);
		expect(actionBySpan.get("span-queue-child")?.binds[3]).toBe(
			await deriveActionId("proj-123", "trace-pipeline", "span-queue-parent"),
		);
	});

	it("persists explicit MCP audit and mutation evidence without accepting raw MCP metadata", async () => {
		const baseSpan = {
			projectId: "proj-123",
			parentSpanId: null,
			traceId: "trace-evidence",
			traceState: null,
			serviceName: "tool-service",
			scopeName: null,
			scopeVersion: null,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: null,
			interactionId: null,
		} satisfies Partial<StoredSpan>;

		const runPipeline = registerSpanProcessors(actionGraphProcessorPlugin);
		await runPipeline(
			[
				{
					...baseSpan,
					spanId: "span-evidence",
					spanName: "write_file",
					attributesJson: JSON.stringify({
						"openinference.span.kind": "tool.call",
						"obs.tool_call.tool_name": "write_file",
						"obs.mcp.audit": {
							schemaVersion: 1,
							presentFields: ["progressToken", "_meta"],
							allowedFields: { progressToken: true, _meta: false },
							redactedFields: ["_meta"],
							hashedFields: { progressToken: "sha256:123" },
							droppedFields: ["_meta.secret"],
							hasRawMeta: true,
						},
						"obs.tool_call.mutation.before": { status: "draft" },
						"obs.tool_call.mutation.after": { status: "published" },
						"obs.tool_call.mutation.diff": [{ op: "replace", path: "/status" }],
						"obs.tool_call.mutation.artifact_id": "artifact-123",
					}),
				},
				{
					...baseSpan,
					spanId: "span-raw-meta",
					spanName: "raw_meta_tool",
					attributesJson: JSON.stringify({
						"openinference.span.kind": "tool.call",
						"obs.tool_call.tool_name": "raw_meta_tool",
						"mcp._meta": { secret: "do-not-store" },
					}),
				},
				{
					...baseSpan,
					spanId: "span-resource",
					spanName: "read_resource",
					attributesJson: JSON.stringify({
						"openinference.span.kind": "retrieval",
						"mcp.method.name": "resources/read",
						"obs.mcp.audit": {
							schemaVersion: 1,
							presentFields: ["cursor", "_meta"],
							allowedFields: { cursor: true, _meta: false },
							redactedFields: ["_meta"],
							hasRawMeta: true,
						},
					}),
				},
			] as StoredSpan[],
			context,
		);

		const toolInserts = db.callsMatching("INSERT INTO tool_calls");
		expect(toolInserts).toHaveLength(2);
		const evidenceInsert = toolInserts.find((call) =>
			call.binds.includes("span-evidence"),
		);
		const rawMetaInsert = toolInserts.find((call) =>
			call.binds.includes("span-raw-meta"),
		);
		expect(evidenceInsert?.binds[11]).toContain("presentFields");
		expect(evidenceInsert?.binds[12]).toContain("draft");
		expect(evidenceInsert?.binds[13]).toContain("published");
		expect(evidenceInsert?.binds[14]).toContain("replace");
		expect(evidenceInsert?.binds[15]).toBe("artifact-123");
		expect(rawMetaInsert?.binds[11]).toBeNull();
		expect(String(rawMetaInsert?.binds.join(" "))).not.toContain(
			"do-not-store",
		);

		const actionBySpan = new Map(
			db
				.callsMatching("INSERT INTO actions")
				.map((insert) => [String(insert.binds[13]), insert]),
		);
		const resourceAttrs = JSON.parse(
			String(actionBySpan.get("span-resource")?.binds[24] ?? "{}"),
		);
		expect(resourceAttrs["obs.mcp.audit_envelope"]).toMatchObject({
			presentFields: ["cursor", "_meta"],
			hasRawMeta: true,
		});
		expect(resourceAttrs["obs.mcp.audit"]).toBeUndefined();
	});

	it("persists Scenario B heavy-spender proof chain from seeded span attributes", async () => {
		const scenario = {
			traceId: "0b000000000000000000000000000001",
			runSpanId: "0b00000000000001",
			llmSpanId: "0b00000000000002",
			toolSpanId: "0b00000000000003",
			evalSpanId: "0b00000000000004",
			runActionId: "01K00000000000000000000001",
			llmActionId: "01K00000000000000000000002",
			toolActionId: "01K00000000000000000000003",
			evalActionId: "01K00000000000000000000004",
		};
		const baseSpan = {
			projectId: "default",
			traceId: scenario.traceId,
			traceState: null,
			serviceName: "obs-demo",
			scopeName: "seed-ai",
			scopeVersion: null,
			spanKind: 1,
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:01.000Z",
			durationMs: 1000,
			droppedAttributesCount: 0,
			resourceAttributesJson: "{}",
			eventsJson: "[]",
			droppedEventsCount: 0,
			linksJson: "[]",
			droppedLinksCount: 0,
			receivedAt: "2026-05-22T00:00:01.000Z",
			expiresAt: "2026-05-23T00:00:01.000Z",
			sessionId: "sess-heavy",
			interactionId: "ix-ai",
		} satisfies Partial<StoredSpan>;

		const runPipeline = registerSpanProcessors(actionGraphProcessorPlugin);
		await runPipeline(
			[
				{
					...baseSpan,
					spanId: scenario.runSpanId,
					parentSpanId: null,
					spanName: "agent.run.recommendation-cost-spike",
					attributesJson: JSON.stringify({
						"obs.action.id": scenario.runActionId,
						"obs.action.kind": "agent.run",
						"obs.action.name": "Seed recommendation agent run",
						"obs.actor.type": "agent",
						"obs.actor.id": "seed-recommendation-agent",
						"obs.agent.id": "seed-recommendation-agent",
						"obs.agent.name": "Seed Recommendation Agent",
						"obs.agent.version": "scenario-b-v1",
						"obs.agent.goal":
							"Generate recommendations for a heavy-spender session",
						"obs.agent.autonomy_level": "suggested_action",
					}),
				},
				{
					...baseSpan,
					spanId: scenario.llmSpanId,
					parentSpanId: scenario.runSpanId,
					spanName: "anthropic.chat",
					attributesJson: JSON.stringify({
						"openinference.span.kind": "LLM",
						"llm.provider": "anthropic",
						"llm.model_name": "claude-3-5-haiku",
						"obs.action.id": scenario.llmActionId,
						"obs.action.root_id": scenario.runActionId,
						"obs.action.caused_by_id": scenario.runActionId,
						"obs.action.kind": "llm.call",
						"obs.agent.run_id": scenario.runActionId,
						"obs.action.prompt_version": "seed-scenario-b-v1",
						"obs.action.total_cost_usd": 0.25,
					}),
				},
				{
					...baseSpan,
					spanId: scenario.toolSpanId,
					parentSpanId: scenario.llmSpanId,
					spanName: "catalog.lookup_recommendations",
					attributesJson: JSON.stringify({
						"obs.action.id": scenario.toolActionId,
						"obs.action.root_id": scenario.runActionId,
						"obs.action.caused_by_id": scenario.llmActionId,
						"obs.action.kind": "tool.call",
						"obs.agent.run_id": scenario.runActionId,
						"obs.tool.name": "catalog.lookup_recommendations",
						"obs.tool.args": JSON.stringify({ category: "premium", limit: 50 }),
						"obs.tool.result": JSON.stringify({ returned: 50, cache: "miss" }),
					}),
				},
				{
					...baseSpan,
					spanId: scenario.evalSpanId,
					parentSpanId: scenario.llmSpanId,
					spanName: "eval.recommendation_budget_guard",
					statusCode: 2,
					statusMessage: "budget_guard_failed",
					attributesJson: JSON.stringify({
						"obs.action.id": scenario.evalActionId,
						"obs.action.root_id": scenario.runActionId,
						"obs.action.caused_by_id": scenario.llmActionId,
						"obs.action.kind": "eval",
						"obs.agent.run_id": scenario.runActionId,
						"obs.eval.evaluator_name": "recommendation_budget_guard",
						"obs.eval.evaluator_version": "seed-v1",
						"obs.eval.score": 0.35,
						"obs.eval.passed": false,
						"obs.eval.reasoning":
							"Heavy-spender recommendation call exceeded the seed budget threshold.",
					}),
				},
			] as StoredSpan[],
			context,
		);

		const actionInserts = db.callsMatching("INSERT INTO actions");
		expect(actionInserts.map((call) => call.binds[0])).toEqual([
			scenario.runActionId,
			scenario.llmActionId,
			scenario.toolActionId,
			scenario.evalActionId,
		]);
		expect(actionInserts.map((call) => call.binds[2])).toEqual([
			scenario.runActionId,
			scenario.runActionId,
			scenario.runActionId,
			scenario.runActionId,
		]);
		expect(actionInserts.map((call) => call.binds[3])).toEqual([
			null,
			scenario.runActionId,
			scenario.llmActionId,
			scenario.llmActionId,
		]);

		expect(db.callsMatching("INSERT INTO agent_runs")[0].binds).toContain(
			"seed-recommendation-agent",
		);
		expect(db.callsMatching("INSERT INTO tool_calls")[0].binds).toContain(
			"catalog.lookup_recommendations",
		);
		const evalInsert = db.callsMatching("INSERT INTO eval_results")[0];
		expect(evalInsert.binds).toContain("recommendation_budget_guard");
		expect(evalInsert.binds).toContain(0);
	});
});
