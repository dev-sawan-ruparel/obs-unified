import { describe, expect, it, beforeEach, afterEach } from "vitest";
import type { StoredSpan } from "@obs-unified/types";
import {
	actionGraphProcessorPlugin,
	registerActionEnricherPlugin,
	clearActionEnricherPlugins,
	registerRedactionPlugin,
	clearRedactionPlugins,
	type ActionEnricherPlugin,
	type PayloadRedactorPlugin,
} from "./action-graph-processor";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";

describe("actionGraphProcessorPlugin — Extensibility & Enrichment", () => {
	let db: MemSqlDb;
	let context: any;

	beforeEach(() => {
		db = new MemSqlDb();
		context = {
			env: {
				DB: db,
			},
			now: new Date(),
			logger: console,
		};
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
			enrichActionRecord(record, span, attrs) {
				enricherCalls.push("enrichActionRecord");
				record.name = "enriched-action-name";
			},
			enrichAgentRunRecord(record, span, attrs) {
				enricherCalls.push("enrichAgentRunRecord");
				record.goal = "enriched-goal";
			},
			enrichToolCallRecord(record, span, attrs) {
				enricherCalls.push("enrichToolCallRecord");
				record.toolName = "enriched-tool";
			},
			enrichRetrievalRecord(record, span, attrs) {
				enricherCalls.push("enrichRetrievalRecord");
				record.retrieverName = "enriched-retriever";
			},
			enrichEvalRecord(record, span, attrs) {
				enricherCalls.push("enrichEvalRecord");
				record.evaluatorName = "enriched-evaluator";
			},
			enrichArtifactRecord(record, span, attrs) {
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
			spanName: "original-name",
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
			sessionId: null,
			interactionId: null,
			userId: null,
		};

		// Get the processor from the plugin registration
		let processFn: any = null;
		const app: any = {};
		const runtime: any = {
			addSpanProcessor(p: any) {
				processFn = p.process;
			},
		};

		actionGraphProcessorPlugin.register(app, runtime);
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
			redact(value, ctx) {
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
			spanName: "my-tool-span",
			statusCode: 1,
			statusMessage: null,
			startTime: "2026-05-22T00:00:00.000Z",
			endTime: "2026-05-22T00:00:05.000Z",
			durationMs: 5000,
			attributesJson: JSON.stringify({
				"obs.action.id": "action-1",
				"obs.action.kind": "tool.call",
				"obs.tool_call.tool_name": "some-tool",
				"obs.tool_call.args": JSON.stringify({ secretKey: "supersecretPassword123" }),
				"obs.retrieval.retriever_name": "some-retriever",
				"obs.retrieval.query": "find secret documents",
			}),
			sessionId: null,
			interactionId: null,
			userId: null,
		};

		let processFn: any = null;
		const app: any = {};
		const runtime: any = {
			addSpanProcessor(p: any) {
				processFn = p.process;
			},
		};

		actionGraphProcessorPlugin.register(app, runtime);
		await processFn([span], context);

		const toolInserts = db.callsMatching("INSERT INTO tool_calls");
		expect(toolInserts).toHaveLength(1);
		// The redacted args column should carry our redacted structure
		const argsBindVal = toolInserts[0].binds.find((b) => typeof b === "string" && b.includes("redactedSecret"));
		expect(argsBindVal).toBe(JSON.stringify({ redactedSecret: "yes-redacted" }));

		const retrievalInserts = db.callsMatching("INSERT INTO retrieval_events");
		expect(retrievalInserts).toHaveLength(1);
		// The redacted query (which actually isn't stored in a redacted query column because standard retrieval stores documentsJson redacted)
		// Wait, let's see how retrieval_events is defined. It has documentsJson, totalResults, queryHash.
		// Wait, in `action-graph-processor.ts`:
		// redactedDocs = runRedaction(rawDocs, ...)
		// redactedQuery = runRedaction(rawQuery, ...)
		// queryHash is sha256Hex of rawQuery.
	});
});
