import { describe, expect, it } from "vitest";
import {
	EvalCaseSourceNotFoundError,
	EvalCasesStore,
} from "./eval-cases-store";
import { MemSqlDb } from "./test-utils/mem-sql-db";

const actionRow = {
	id: "action-1",
	agent_run_id: "run-1",
	tool_call_id: "tool-1",
	trace_id: "trace-1",
	span_id: "span-1",
};

const toolRow = {
	id: "tool-1",
	action_id: "action-1",
	tool_name: "search_docs",
	args_hash: "args-hash",
	result_hash: "result-hash",
};

describe("EvalCasesStore", () => {
	it("creates eval cases with hydrated source links, payloads, and metadata", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM actions")) return actionRow;
				if (sql.includes("FROM tool_calls")) return toolRow;
				if (sql.includes("FROM ai_span_payloads")) {
					return {
						input_json: '{"messages":[{"role":"user","content":"redacted"}]}',
						output_json: '{"answer":"updated invoice"}',
					};
				}
				return null;
			},
			all: (sql) => {
				if (sql.includes("FROM retrieval_events")) {
					return [
						{
							documents_json:
								'[{"docId":"doc-1","sourceId":"kb","score":0.91}]',
						},
					];
				}
				return [];
			},
		});

		const store = new EvalCasesStore(db);
		const evalCase = await store.createCase("default", {
			sourceEntityType: "action",
			sourceEntityId: "action-1",
			name: "Wrong invoice update",
			expectedOutcome: "Do not update the invoice without approval",
			rubric: { criteria: ["requires approval"] },
			metadata: { capturedBy: "test" },
		});

		expect(evalCase.sourceActionId).toBe("action-1");
		expect(evalCase.sourceAgentRunId).toBe("run-1");
		expect(evalCase.sourceToolCallId).toBe("tool-1");
		expect(evalCase.sourceTraceId).toBe("trace-1");
		expect(evalCase.sourceSpanId).toBe("span-1");
		expect(evalCase.redactedPrompt).toEqual({
			messages: [{ role: "user", content: "redacted" }],
		});
		expect(evalCase.referencePayload).toEqual({
			answer: "updated invoice",
		});
		expect(evalCase.metadata.toolHashes).toEqual([
			{
				toolCallId: "tool-1",
				toolName: "search_docs",
				argsHash: "args-hash",
				resultHash: "result-hash",
			},
		]);
		expect(evalCase.metadata.documentRefs).toEqual([
			{ docId: "doc-1", sourceId: "kb", score: 0.91 },
		]);
		expect(evalCase.evidenceReferences).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					entityKind: "action",
					entityId: "action-1",
					route: "#/actions/action-1",
					source: "eval_case.source_links",
				}),
				expect.objectContaining({
					entityKind: "span",
					entityId: "trace-1:span-1",
					route: "#/traces/trace-1#span=span-1",
				}),
			]),
		);

		const insert = db.callsMatching("INSERT INTO eval_cases")[0];
		expect(insert.binds).toContain("default");
		expect(insert.binds).toContain("action");
		expect(insert.binds).toContain("action-1");
		expect(insert.binds).toContain("run-1");
		expect(insert.binds).toContain("tool-1");
		expect(insert.binds).toContain("trace-1");
	});

	it("maps stored rows on get and list with source filters", async () => {
		const row = {
			id: "case-1",
			project_id: "default",
			source_entity_type: "tool_call",
			source_entity_id: "tool-1",
			source_agent_run_id: "run-1",
			source_action_id: "action-1",
			source_ai_call_id: null,
			source_tool_call_id: "tool-1",
			source_trace_id: "trace-1",
			source_span_id: "span-1",
			name: "Tool call regression",
			expected_outcome: "Tool should be read only",
			rubric_json: '{"score":1}',
			redacted_prompt_json: '{"input":"redacted"}',
			reference_payload_json: '{"output":"ok"}',
			metadata_json: '{"toolHashes":[{"toolCallId":"tool-1"}]}',
			created_at: "2026-05-31T00:00:00.000Z",
			updated_at: "2026-05-31T00:00:00.000Z",
		};
		const db = new MemSqlDb({
			first: () => row,
			all: () => [row],
		});
		const store = new EvalCasesStore(db);

		const found = await store.getCase("default", "case-1");
		const listed = await store.listCases({
			projectId: "default",
			sourceEntityType: "tool_call",
			sourceEntityId: "tool-1",
			limit: 10,
		});

		expect(found?.id).toBe("case-1");
		expect(found?.rubric).toEqual({ score: 1 });
		expect(found?.evidenceReferences?.[0]).toEqual(
			expect.objectContaining({
				evidenceId: "eval_case:case-1:action:action-1",
				entityKind: "action",
				entityId: "action-1",
			}),
		);
		expect(listed).toHaveLength(1);
		expect(listed[0].sourceToolCallId).toBe("tool-1");
		const listCall = db.callsMatching(
			"FROM eval_cases WHERE project_id = ?",
		)[1];
		expect(listCall.binds).toEqual(["default", "tool_call", "tool-1", 10]);
	});

	it("rejects dangling production source links", async () => {
		const store = new EvalCasesStore(new MemSqlDb({ first: () => null }));

		await expect(
			store.createCase("default", {
				sourceEntityType: "ai_call",
				sourceEntityId: "missing-call",
				name: "Missing source",
			}),
		).rejects.toBeInstanceOf(EvalCaseSourceNotFoundError);
	});
});
