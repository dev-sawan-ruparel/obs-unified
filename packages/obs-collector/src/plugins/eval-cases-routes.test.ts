import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { evalCasesRoutesPlugin } from "./eval-cases-routes";

const env = (db: MemSqlDb): CollectorEnv => ({
	DB: db as unknown as D1Database,
});

const setup = () => {
	const app = new Hono<{ Bindings: CollectorEnv }>();
	evalCasesRoutesPlugin.register(app, new CollectorRuntime());
	return app;
};

const evalCaseRow = {
	id: "case-1",
	project_id: "default",
	source_entity_type: "action",
	source_entity_id: "action-1",
	source_agent_run_id: "run-1",
	source_action_id: "action-1",
	source_ai_call_id: null,
	source_tool_call_id: "tool-1",
	source_trace_id: "trace-1",
	source_span_id: "span-1",
	name: "Wrong invoice update",
	expected_outcome: "Reject unsafe invoice update",
	rubric_json: '{"criteria":["approval"]}',
	redacted_prompt_json: '{"messages":[]}',
	reference_payload_json: '{"answer":"reject"}',
	metadata_json: '{"sourceLinks":{"actionId":"action-1"}}',
	created_at: "2026-05-31T00:00:00.000Z",
	updated_at: "2026-05-31T00:00:00.000Z",
};

const evalRunRow = {
	id: "run-123",
	project_id: "default",
	eval_case_id: "case-1",
	candidate_agent_id: "billing-agent",
	candidate_agent_version: "2026.05.31",
	candidate_prompt_id: "invoice-safety",
	candidate_prompt_version: "v7",
	candidate_model_provider: "openai",
	candidate_model: "gpt-4.1",
	candidate_model_version: "2026-04-14",
	status: "running",
	started_at: "2026-05-31T01:00:00.000Z",
	ended_at: null,
	total_count: 1,
	pass_count: 1,
	fail_count: 0,
	average_score: 0.95,
	metadata_json: '{"branch":"fix/invoice-safety"}',
	created_at: "2026-05-31T01:00:00.000Z",
	case_id: "case-1",
	case_name: "Wrong invoice update",
	case_source_entity_type: "action",
	case_source_entity_id: "action-1",
	case_source_agent_run_id: "run-1",
	case_source_action_id: "action-1",
	case_source_ai_call_id: null,
	case_source_tool_call_id: "tool-1",
	case_source_trace_id: "trace-1",
	case_source_span_id: "span-1",
};

describe("evalCasesRoutesPlugin", () => {
	it("saves an eval case from a production action source", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM actions")) {
					return {
						id: "action-1",
						agent_run_id: "run-1",
						tool_call_id: "tool-1",
						trace_id: "trace-1",
						span_id: "span-1",
					};
				}
				if (sql.includes("FROM tool_calls")) {
					return {
						id: "tool-1",
						action_id: "action-1",
						tool_name: "update_invoice",
						args_hash: "args-hash",
						result_hash: "result-hash",
					};
				}
				if (sql.includes("FROM ai_span_payloads")) {
					return {
						input_json: '{"prompt":"redacted"}',
						output_json: '{"result":"blocked"}',
					};
				}
				return null;
			},
			all: () => [],
		});
		const app = setup();

		const res = await app.request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "action",
					sourceEntityId: "action-1",
					name: "Wrong invoice update",
					expectedOutcome: "Reject unsafe invoice update",
					rubric: { criteria: ["approval"] },
				}),
			},
			env(db),
		);

		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			evalCase: {
				sourceActionId: string;
				sourceAgentRunId: string;
				sourceToolCallId: string;
				redactedPrompt: unknown;
				referencePayload: unknown;
			};
		};
		expect(body.evalCase.sourceActionId).toBe("action-1");
		expect(body.evalCase.sourceAgentRunId).toBe("run-1");
		expect(body.evalCase.sourceToolCallId).toBe("tool-1");
		expect(body.evalCase.redactedPrompt).toEqual({ prompt: "redacted" });
		expect(body.evalCase.referencePayload).toEqual({ result: "blocked" });
		expect(db.callsMatching("INSERT INTO eval_cases")).toHaveLength(1);
	});

	it("fetches and lists eval cases", async () => {
		const db = new MemSqlDb({
			first: () => evalCaseRow,
			all: () => [evalCaseRow],
		});
		const app = setup();

		const getRes = await app.request(
			"/internal/eval-cases/case-1",
			{ method: "GET" },
			env(db),
		);
		const listRes = await app.request(
			"/internal/eval-cases?sourceEntityType=action&sourceEntityId=action-1",
			{ method: "GET" },
			env(db),
		);

		expect(getRes.status).toBe(200);
		expect(listRes.status).toBe(200);
		const getBody = (await getRes.json()) as { evalCase: { id: string } };
		const listBody = (await listRes.json()) as {
			evalCases: Array<{ sourceEntityId: string }>;
		};
		expect(getBody.evalCase.id).toBe("case-1");
		expect(listBody.evalCases[0].sourceEntityId).toBe("action-1");
	});

	it("validates source type and reports missing production sources", async () => {
		const app = setup();

		const invalid = await app.request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "span",
					sourceEntityId: "span-1",
					name: "Bad source",
				}),
			},
			env(new MemSqlDb()),
		);
		expect(invalid.status).toBe(400);

		const db = new MemSqlDb({ first: () => null });
		const missing = await setup().request(
			"/internal/eval-cases",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceEntityType: "ai_call",
					sourceEntityId: "missing-call",
					name: "Missing call",
				}),
			},
			env(db),
		);
		expect(missing.status).toBe(404);
	});

	it("creates, fetches, and lists durable eval runs", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM eval_cases")) return evalCaseRow;
				if (sql.includes("FROM eval_runs")) return evalRunRow;
				return null;
			},
			all: (sql) => (sql.includes("FROM eval_runs") ? [evalRunRow] : []),
		});
		const app = setup();

		const createRes = await app.request(
			"/internal/eval-runs",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "run-123",
					evalCaseId: "case-1",
					status: "running",
					candidate: {
						agentId: "billing-agent",
						agentVersion: "2026.05.31",
						promptId: "invoice-safety",
						promptVersion: "v7",
						modelProvider: "openai",
						model: "gpt-4.1",
						modelVersion: "2026-04-14",
					},
					metadata: { branch: "fix/invoice-safety" },
				}),
			},
			env(db),
		);
		const getRes = await app.request(
			"/internal/eval-runs/run-123",
			{ method: "GET" },
			env(db),
		);
		const listRes = await app.request(
			"/internal/eval-runs?evalCaseId=case-1&status=running",
			{ method: "GET" },
			env(db),
		);

		expect(createRes.status).toBe(201);
		expect(getRes.status).toBe(200);
		expect(listRes.status).toBe(200);
		const createBody = (await createRes.json()) as {
			evalRun: {
				id: string;
				evalCaseId: string;
				candidate: { agentVersion: string; promptVersion: string };
				sourceEvalCase: { sourceActionId: string };
				averageScore: number;
			};
		};
		expect(createBody.evalRun.id).toBe("run-123");
		expect(createBody.evalRun.candidate.agentVersion).toBe("2026.05.31");
		expect(createBody.evalRun.candidate.promptVersion).toBe("v7");
		expect(createBody.evalRun.sourceEvalCase.sourceActionId).toBe("action-1");
		expect(createBody.evalRun.averageScore).toBe(0.95);
		const listBody = (await listRes.json()) as {
			evalRuns: Array<{ id: string }>;
		};
		expect(listBody.evalRuns[0].id).toBe("run-123");
		expect(db.callsMatching("INSERT INTO eval_runs")).toHaveLength(1);
	});

	it("rejects invalid eval run input", async () => {
		const res = await setup().request(
			"/internal/eval-runs",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: "",
					status: "done",
					candidate: [],
				}),
			},
			env(new MemSqlDb()),
		);

		expect(res.status).toBe(400);
	});

	it("ingests and lists eval case results", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM eval_cases")) {
					return evalCaseRow;
				}
				return null;
			},
			all: () => [
				{
					id: "result-1",
					project_id: "default",
					eval_case_id: "case-1",
					run_id: "run-123",
					passed: 1,
					score: 0.95,
					actual_outcome: "Correctly updated address",
					details_json: '{"diff":"none"}',
					created_at: "2026-05-31T01:00:00.000Z",
				},
			],
		});
		const app = setup();

		// POST result
		const postRes = await app.request(
			"/internal/eval-cases/case-1/results",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId: "run-123",
					passed: true,
					score: 0.95,
					actualOutcome: "Correctly updated address",
					details: { diff: "none" },
				}),
			},
			env(db),
		);

		expect(postRes.status).toBe(201);
		const postBody = (await postRes.json()) as {
			evalCaseResult: { id: string; runId: string; passed: boolean };
		};
		expect(postBody.evalCaseResult.runId).toBe("run-123");
		expect(postBody.evalCaseResult.passed).toBe(true);

		// GET results
		const getRes = await app.request(
			"/internal/eval-cases/case-1/results",
			{ method: "GET" },
			env(db),
		);

		expect(getRes.status).toBe(200);
		const getBody = (await getRes.json()) as {
			evalCaseResults: Array<{ runId: string; passed: boolean }>;
		};
		expect(getBody.evalCaseResults).toHaveLength(1);
		expect(getBody.evalCaseResults[0].runId).toBe("run-123");
		expect(getBody.evalCaseResults[0].passed).toBe(true);
		expect(db.callsMatching("UPDATE eval_runs")).toHaveLength(0);
	});

	it("attaches eval case results to durable eval runs", async () => {
		const db = new MemSqlDb({
			first: (sql) => {
				if (sql.includes("FROM eval_cases")) return evalCaseRow;
				if (sql.includes("FROM eval_runs")) return evalRunRow;
				return null;
			},
		});
		const app = setup();

		const postRes = await app.request(
			"/internal/eval-cases/case-1/results",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					runId: "run-123",
					passed: true,
					score: 0.95,
					actualOutcome: "Correctly updated address",
					details: { diff: "none" },
				}),
			},
			env(db),
		);

		expect(postRes.status).toBe(201);
		const postBody = (await postRes.json()) as {
			evalCaseResult: { runId: string };
			evalRun: { id: string; passCount: number } | null;
		};
		expect(postBody.evalCaseResult.runId).toBe("run-123");
		expect(postBody.evalRun?.id).toBe("run-123");
		expect(postBody.evalRun?.passCount).toBe(1);
		expect(db.callsMatching("INSERT INTO eval_case_results")).toHaveLength(1);
		expect(db.callsMatching("UPDATE eval_runs")).toHaveLength(1);
	});
});
