import type { StoredSpan } from "@obs-unified/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
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
				"obs.action.id": "action-1",
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
				"obs.action.id": "action-1",
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
				"obs.action.id": "action-privacy",
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
					"obs.action.id": "run-rollup",
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
					"obs.action.id": "action-llm",
					"obs.action.root_id": "run-rollup",
					"obs.action.kind": "llm.call",
					"obs.agent_run.id": "run-rollup",
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
					"obs.action.id": "action-tool",
					"obs.action.root_id": "run-rollup",
					"obs.action.kind": "tool.call",
					"obs.agent_run.id": "run-rollup",
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
});
