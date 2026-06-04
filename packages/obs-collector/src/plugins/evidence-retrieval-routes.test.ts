import {
	encodePprof,
	gzipBytes,
	type PprofProfile,
} from "@obs-unified/pprof-decoder";
import type { EvidenceBundle } from "@obs-unified/types";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { CollectorRuntime } from "../framework/collector";
import type { CollectorEnv } from "../framework/env";
import { MemSqlDb } from "../lib/test-utils/mem-sql-db";
import { evidenceRetrievalRoutesPlugin } from "./evidence-retrieval-routes";

const encodeRef = (payload: Record<string, unknown>): string => {
	const json = JSON.stringify(payload);
	const bytes = new TextEncoder().encode(json);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `eref_${globalThis
		.btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")}`;
};

const spanRows = [
	{
		project_id: "default",
		trace_id: "trace-1",
		span_id: "root",
		parent_span_id: null,
		service_name: "checkout-api",
		scope_name: null,
		scope_version: null,
		span_name: "POST /checkout",
		span_kind: 2,
		status_code: 1,
		status_message: null,
		start_time: "2026-06-03T10:00:00.000Z",
		end_time: "2026-06-03T10:00:01.000Z",
		duration_ms: 1000,
		attributes_json: "{}",
		resource_attributes_json: "{}",
		events_json: "[]",
		links_json: "[]",
		received_at: "2026-06-03T10:00:01.000Z",
		expires_at: "2026-06-10T10:00:01.000Z",
	},
	{
		project_id: "default",
		trace_id: "trace-1",
		span_id: "payment",
		parent_span_id: "root",
		service_name: "checkout-api",
		scope_name: null,
		scope_version: null,
		span_name: "payment.authorize",
		span_kind: 3,
		status_code: 2,
		status_message: "Stripe timeout",
		start_time: "2026-06-03T10:00:00.100Z",
		end_time: "2026-06-03T10:00:00.900Z",
		duration_ms: 800,
		attributes_json: "{}",
		resource_attributes_json: "{}",
		events_json: "[]",
		links_json: "[]",
		received_at: "2026-06-03T10:00:01.000Z",
		expires_at: "2026-06-10T10:00:01.000Z",
	},
];

const logRows = [
	{
		project_id: "default",
		log_id: "log-1",
		trace_id: "trace-1",
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: "GET /api/products/123 404",
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-03T10:00:00.200Z",
		received_at: "2026-06-03T10:00:00.200Z",
		expires_at: "2026-06-10T10:00:00.200Z",
	},
	{
		project_id: "default",
		log_id: "log-2",
		trace_id: "trace-1",
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: "GET /api/products/456 404",
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-03T10:00:00.300Z",
		received_at: "2026-06-03T10:00:00.300Z",
		expires_at: "2026-06-10T10:00:00.300Z",
	},
	{
		project_id: "default",
		log_id: "log-3",
		trace_id: "trace-1",
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: "GET /api/products/789 404",
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-03T10:00:00.400Z",
		received_at: "2026-06-03T10:00:00.400Z",
		expires_at: "2026-06-10T10:00:00.400Z",
	},
	{
		project_id: "default",
		log_id: "log-4",
		trace_id: "trace-1",
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: "GET /api/products/999 404",
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-03T10:00:00.500Z",
		received_at: "2026-06-03T10:00:00.500Z",
		expires_at: "2026-06-10T10:00:00.500Z",
	},
	{
		project_id: "default",
		log_id: "log-5",
		trace_id: "trace-1",
		span_id: "payment",
		service_name: "checkout-api",
		severity: "ERROR",
		severity_number: 17,
		logger_name: "checkout",
		message: "Stripe timeout after 5000ms",
		attributes_json: "{}",
		flags: 0,
		dropped_attributes_count: 0,
		occurred_at: "2026-06-03T10:00:00.600Z",
		received_at: "2026-06-03T10:00:00.600Z",
		expires_at: "2026-06-10T10:00:00.600Z",
	},
];

const actionRoot = {
	id: "run-123",
	project_id: "default",
	root_action_id: "run-123",
	caused_by_action_id: null,
	actor_type: "agent",
	actor_id: "billing-agent",
	action_kind: "agent.run",
	name: "Billing agent",
	status: "ok",
	started_at: "2026-06-03T10:00:00.000Z",
	ended_at: "2026-06-03T10:00:01.000Z",
	duration_ms: 1000,
	trace_id: "trace-1",
	span_id: "root",
	session_id: "session-1",
	interaction_id: null,
	user_id: null,
	agent_run_id: "run-123",
	step_id: null,
	tool_call_id: null,
	prompt_version: "billing-v1",
	model_name: "gpt-4.1",
	provider: "openai",
	total_cost_usd: 0.01,
	attrs_json: "{}",
};

const actionTool = {
	...actionRoot,
	id: "act-tool",
	caused_by_action_id: "run-123",
	action_kind: "tool.call",
	name: "Update invoice",
	status: "error",
	started_at: "2026-06-03T10:00:00.300Z",
	ended_at: "2026-06-03T10:00:00.700Z",
	duration_ms: 400,
	span_id: "payment",
	tool_call_id: "tool-1",
	total_cost_usd: 0,
};

const agentRun = {
	id: "run-123",
	project_id: "default",
	agent_id: "billing-agent",
	agent_name: "Billing Agent",
	agent_version: "2026-06-03",
	goal: "Resolve invoice update",
	outcome: "Tool failed",
	autonomy_level: "human_approved_write",
	status: "error",
	error_message: "Tool failed",
	total_cost_usd: 0.01,
	total_duration_ms: 1000,
	metadata_json: "{}",
};

const toolCall = {
	id: "tool-1",
	action_id: "act-tool",
	project_id: "default",
	tool_name: "db.update_invoice",
	args_hash: "args-hash",
	result_hash: "result-hash",
	error_type: "Timeout",
	side_effect: 1,
	approval_state: "human_approved",
	args_redacted: "{}",
	result_redacted: "{}",
	mcp_audit_json: null,
	mutation_before_json: null,
	mutation_after_json: null,
	mutation_diff_json: null,
	mutation_artifact_id: null,
};

const aiCall = {
	call_id: "ai-1",
	trace_id: "trace-1",
	span_id: "root",
	service_name: "checkout-api",
	model_name: "gpt-4.1",
	provider: "openai",
	call_type: "chat",
	request_json: '{"secret":"do-not-return"}',
	response_json: '{"secret":"do-not-return"}',
	prompt_tokens: 120,
	completion_tokens: 40,
	total_cost_usd: 0.02,
	latency_ms: 250,
	is_error: 0,
	error_message: null,
	occurred_at: "2026-06-03T10:00:00.250Z",
	received_at: "2026-06-03T10:00:00.251Z",
	expires_at: "2026-06-10T10:00:00.251Z",
	interaction_id: null,
	session_id: "session-1",
};

const replayMetadata = {
	session_id: "session-1",
	project_id: "default",
	visitor_id: "visitor-1",
	first_chunk_at: "2026-06-03T10:00:00.000Z",
	last_chunk_at: "2026-06-03T10:00:02.000Z",
	chunk_count: 2,
	events_count: 10,
	storage_bytes: 2048,
};

const profileRow = {
	id: "profile-1",
	service_name: "checkout-api",
	profile_type: "cpu",
	start_ts: "2026-06-03T10:00:00.000Z",
	end_ts: "2026-06-03T10:01:00.000Z",
	duration_ms: 60000,
	blob_size_bytes: 4096,
	blob_url: "profiles/default/2026-06-03/profile-1.pprof.gz",
	sample_count: 100,
	agent: "test-profiler",
	received_at: "2026-06-03T10:01:01.000Z",
	expires_at: "2026-06-10T10:01:01.000Z",
};

const tinyProfile = (): PprofProfile => {
	const stringTable = [
		"",
		"cpu",
		"nanoseconds",
		"checkout.authorize",
		"src/checkout.ts",
		"trace_id",
		"trace-1",
	];
	const functions = new Map();
	functions.set(1, { id: 1, nameIdx: 3, filenameIdx: 4 });
	const locations = new Map();
	locations.set(1, {
		id: 1,
		lines: [{ functionId: 1, line: 42 }],
		functionIds: [1],
	});
	return {
		sampleTypes: [{ typeIdx: 1, unitIdx: 2 }],
		samples: [
			{
				locationIds: [1],
				values: [500],
				labels: [{ keyIdx: 5, strIdx: 6, num: 0 }],
			},
		],
		locations,
		functions,
		stringTable,
	};
};

const profileBytes = gzipBytes(encodePprof(tinyProfile()));

const evalResult = {
	id: "eval-1",
	action_id: "act-tool",
	project_id: "default",
	evaluator_name: "tenant_boundary_check",
	evaluator_version: "v1",
	score: 0,
	passed: 0,
	reasoning: "Tool write failed policy check",
	rubric_json: "{}",
};

const setup = (options: { projectId?: string; buckets?: boolean } = {}) => {
	const db = new MemSqlDb({
		all: (sql, binds) => {
			if (sql.includes("FROM evidence_retrieval_refs r")) {
				if (sql.includes("GROUP BY r.kind")) {
					return [{ kind: "logs", issuedCount: 3, expansionCount: 2 }];
				}
				if (sql.includes("GROUP BY r.source")) {
					return [
						{
							source: "evidence.bundle.connected_logs",
							kind: "logs",
							issuedCount: 3,
							expansionCount: 2,
						},
					];
				}
			}
			if (
				sql.includes("FROM evidence_retrieval_refs") &&
				sql.includes("ORDER BY last_seen_at")
			) {
				return [
					{
						ref_id: "eref_logs",
						kind: "logs",
						anchor_kind: "trace",
						anchor_id: "trace-1",
						source: "evidence.bundle.connected_logs",
						issued_at: "2026-06-03T10:00:00.000Z",
						last_seen_at: "2026-06-03T10:00:01.000Z",
					},
				];
			}
			if (
				sql.includes("FROM evidence_ref_expansions") &&
				sql.includes("ORDER BY expanded_at")
			) {
				return [
					{
						id: "exp-1",
						ref_id: "eref_logs",
						kind: "logs",
						source: "evidence.bundle.connected_logs",
						operation: "retrieve",
						result_status: "ok",
						limit_value: 100,
						query_text: null,
						expanded_at: "2026-06-03T10:00:02.000Z",
					},
				];
			}
			if (sql.includes("FROM telemetry_spans")) return spanRows;
			if (sql.includes("FROM logs")) {
				const search = binds.find(
					(bind): bind is string =>
						typeof bind === "string" && bind.startsWith("%"),
				);
				if (search) {
					const needle = search.replace(/%/g, "").toLowerCase();
					return logRows.filter((row) =>
						row.message.toLowerCase().includes(needle),
					);
				}
				return logRows;
			}
			if (sql.includes("FROM actions")) return [actionRoot, actionTool];
			if (sql.includes("FROM agent_runs")) return [agentRun];
			if (sql.includes("FROM tool_calls")) return [toolCall];
			if (sql.includes("FROM eval_results")) return [evalResult];
			if (
				sql.includes("FROM profile_trace_index") &&
				sql.includes("JOIN profile_blobs")
			) {
				return [profileRow];
			}
			if (sql.includes("FROM profile_trace_index")) {
				return [{ trace_id: "trace-1" }];
			}
			if (sql.includes("FROM ai_calls")) return [aiCall];
			if (
				sql.includes("FROM retrieval_events") ||
				sql.includes("FROM artifacts") ||
				sql.includes("FROM metric_exemplars") ||
				sql.includes("FROM replay")
			) {
				return [];
			}
			return [];
		},
		first: (sql) => {
			if (sql.includes("FROM logs")) {
				return {
					totalLogs: logRows.length,
					errorLogs: logRows.length,
					warnLogs: 0,
				};
			}
			if (sql.includes("FROM evidence_retrieval_refs")) {
				return { source: "evidence.bundle.connected_logs" };
			}
			if (sql.includes("FROM profile_blobs")) return profileRow;
			if (sql.includes("FROM session_replay_metadata")) return replayMetadata;
			if (sql.includes("FROM ai_calls")) return aiCall;
			if (sql.includes("FROM actions")) return actionTool;
			if (sql.includes("FROM agent_runs")) return agentRun;
			if (sql.includes("SELECT * FROM tool_calls")) return toolCall;
			if (sql.includes("FROM tool_calls")) return { action_id: "act-tool" };
			return null;
		},
	});
	const app = new Hono<{ Bindings: CollectorEnv }>();
	const projectId = options.projectId;
	if (projectId) {
		app.use("*", async (c, next) => {
			(c as unknown as { set(key: "projectId", value: string): void }).set(
				"projectId",
				projectId,
			);
			await next();
		});
	}
	const runtime = new CollectorRuntime(undefined, undefined, () => db);
	evidenceRetrievalRoutesPlugin.register(app, runtime);
	const env: CollectorEnv = {
		DB: db as unknown as D1Database,
		...(options.buckets
			? {
					PROFILES_BUCKET: {
						async get(key: string) {
							if (key !== profileRow.blob_url) return null;
							return {
								async arrayBuffer() {
									const bytes = await profileBytes;
									return bytes.buffer.slice(
										bytes.byteOffset,
										bytes.byteOffset + bytes.byteLength,
									);
								},
							};
						},
					} as unknown as R2Bucket,
					REPLAYS_BUCKET: {
						async list() {
							return {
								objects: [
									{ key: "replays/default/session-1/000001.json" },
									{ key: "replays/default/session-1/000002.json" },
								],
								truncated: false,
								cursor: undefined,
							};
						},
						async get(key: string) {
							return {
								async json<T>() {
									return [{ type: "click", key }] as T;
								},
							};
						},
					} as unknown as R2Bucket,
				}
			: {}),
	};
	return { app, db, env };
};

describe("evidenceRetrievalRoutesPlugin", () => {
	const getBundle = async (
		app: Hono<{ Bindings: CollectorEnv }>,
		env: CollectorEnv,
	): Promise<EvidenceBundle> => {
		const bundleRes = await app.request(
			"/internal/evidence/bundle",
			{
				method: "POST",
				body: JSON.stringify({
					anchor: { entityKind: "trace", entityId: "trace-1" },
				}),
				headers: { "content-type": "application/json" },
			},
			env,
		);
		expect(bundleRes.status).toBe(200);
		return (await bundleRes.json()) as EvidenceBundle;
	};

	it("returns an incident-local trace bundle with log compaction provenance", async () => {
		const { app, env } = setup();
		const res = await app.request(
			"/internal/evidence/bundle",
			{
				method: "POST",
				body: JSON.stringify({
					anchor: { entityKind: "trace", entityId: "trace-1" },
					intent: "debug_failure",
					budget: { targetTokens: 4000, detailLevel: "standard" },
				}),
				headers: { "content-type": "application/json" },
			},
			env,
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as EvidenceBundle;
		expect(body.schemaVersion).toBe("obs-unified.evidence-bundle.v1");
		expect(body.anchor).toEqual({ entityKind: "trace", entityId: "trace-1" });
		expect(
			body.derivedSummaries.some((s) => s.title === "Trace critical path"),
		).toBe(true);
		expect(body.findings[0]?.title).toBe("Failed span present");
		expect(body.compactions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					kind: "logs",
					strategy: "signature_cluster",
					inputCount: 4,
					outputCount: 3,
				}),
			]),
		);
		expect(body.retrievalRefs.map((ref) => ref.kind)).toEqual(
			expect.arrayContaining(["trace", "logs", "profile"]),
		);
		expect(
			body.suggestedNextPivots.some((pivot) => pivot.entityKind === "profile"),
		).toBe(true);
	});

	it("expands and searches a log retrieval ref", async () => {
		const { app, env } = setup();
		const bundle = await getBundle(app, env);
		const logsRef = bundle.retrievalRefs.find((ref) => ref.kind === "logs");
		expect(logsRef).toBeDefined();

		const retrieveRes = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}`,
			{ method: "GET" },
			env,
		);
		expect(retrieveRes.status).toBe(200);
		const retrieved = (await retrieveRes.json()) as {
			data: { logs: unknown[] };
		};
		expect(retrieved.data.logs).toHaveLength(5);

		const searchRes = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}/search`,
			{
				method: "POST",
				body: JSON.stringify({ query: "Stripe", limit: 5 }),
				headers: { "content-type": "application/json" },
			},
			env,
		);
		expect(searchRes.status).toBe(200);
		const searched = (await searchRes.json()) as {
			data: { logs: Array<{ logId: string }> };
		};
		expect(searched.data.logs.map((log) => log.logId)).toEqual(["log-5"]);
	});

	it("returns action, agent run, and tool call bundles with side-effect evidence", async () => {
		const { app, env } = setup();

		for (const anchor of [
			{ entityKind: "action", entityId: "act-tool" },
			{ entityKind: "agent_run", entityId: "run-123" },
			{ entityKind: "tool_call", entityId: "tool-1" },
		]) {
			const res = await app.request(
				"/internal/evidence/bundle",
				{
					method: "POST",
					body: JSON.stringify({
						anchor,
						intent: "inspect_agent_run",
						budget: { targetTokens: 4000, detailLevel: "standard" },
					}),
					headers: { "content-type": "application/json" },
				},
				env,
			);

			expect(res.status).toBe(200);
			const body = (await res.json()) as EvidenceBundle;
			expect(body.anchor).toEqual(anchor);
			expect(body.derivedSummaries.map((summary) => summary.title)).toContain(
				"Causal action path",
			);
			expect(body.findings.map((finding) => finding.title)).toContain(
				"Side-effecting tool call present",
			);
			expect(body.findings.map((finding) => finding.title)).toContain(
				"Failed eval present",
			);
			expect(
				body.retrievalRefs.some((ref) => ref.kind === anchor.entityKind),
			).toBe(true);
			expect(body.retrievalRefs.some((ref) => ref.kind === "trace")).toBe(true);
			expect(body.retrievalRefs.some((ref) => ref.kind === "logs")).toBe(true);
			expect(body.retrievalRefs.some((ref) => ref.kind === "tool_call")).toBe(
				true,
			);
			expect(body.retrievalRefs.some((ref) => ref.kind === "ai_call")).toBe(
				true,
			);
			expect(body.retrievalRefs.some((ref) => ref.kind === "replay")).toBe(
				true,
			);
			expect(body.retrievalRefs.some((ref) => ref.kind === "profile")).toBe(
				true,
			);

			const graphRef = body.retrievalRefs.find(
				(ref) => ref.kind === anchor.entityKind,
			);
			const retrieveRes = await app.request(
				`/internal/evidence/refs/${graphRef?.refId}`,
				{ method: "GET" },
				env,
			);
			expect(retrieveRes.status).toBe(200);
			const expanded = (await retrieveRes.json()) as {
				data: {
					actions: unknown[];
					toolCalls: unknown[];
					evalResults: unknown[];
				};
			};
			expect(expanded.data.actions).toHaveLength(2);
			expect(expanded.data.toolCalls).toHaveLength(1);
			expect(expanded.data.evalResults).toHaveLength(1);

			for (const kind of [
				"tool_call",
				"ai_call",
				"replay",
				"profile",
			] as const) {
				const ref = body.retrievalRefs.find((candidate) =>
					kind === "tool_call"
						? candidate.source === "evidence.bundle.tool_call_payloads"
						: candidate.kind === kind,
				);
				expect(ref).toBeDefined();
				const refRes = await app.request(
					`/internal/evidence/refs/${ref?.refId}`,
					{ method: "GET" },
					env,
				);
				expect(refRes.status).toBe(200);
				const refBody = (await refRes.json()) as {
					kind: string;
					data: Record<string, unknown>;
				};
				expect(refBody.kind).toBe(kind);
				if (kind === "ai_call") {
					expect(refBody.data.requestJson).toBe("[redacted]");
					expect(refBody.data.responseJson).toBe("[redacted]");
				}
				if (kind === "tool_call") {
					expect(refBody.data.argsHash).toBe("args-hash");
					expect(refBody.data.resultHash).toBe("result-hash");
				}
			}
		}
	});

	it("expands explicit replay event windows and profile frames", async () => {
		const { app, env } = setup({ buckets: true });
		const res = await app.request(
			"/internal/evidence/bundle",
			{
				method: "POST",
				body: JSON.stringify({
					anchor: { entityKind: "action", entityId: "act-tool" },
				}),
				headers: { "content-type": "application/json" },
			},
			env,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as EvidenceBundle;

		const replayEventsRef = body.retrievalRefs.find(
			(ref) => ref.source === "evidence.bundle.replay_event_window",
		);
		expect(replayEventsRef).toBeDefined();
		const replayRes = await app.request(
			`/internal/evidence/refs/${replayEventsRef?.refId}?limit=1`,
			{ method: "GET" },
			env,
		);
		expect(replayRes.status).toBe(200);
		const replayBody = (await replayRes.json()) as {
			data: {
				events: Array<{ key: string }>;
				chunks: {
					returned: number;
					total: number;
					nextChunkOffset: number | null;
				};
			};
		};
		expect(replayBody.data.events).toEqual([
			{ type: "click", key: "replays/default/session-1/000001.json" },
		]);
		expect(replayBody.data.chunks).toEqual(
			expect.objectContaining({
				returned: 1,
				total: 2,
				nextChunkOffset: 1,
			}),
		);

		const profileFramesRef = body.retrievalRefs.find(
			(ref) => ref.source === "evidence.bundle.profile_frames",
		);
		expect(profileFramesRef).toBeDefined();
		const profileRes = await app.request(
			`/internal/evidence/refs/${profileFramesRef?.refId}?limit=5`,
			{ method: "GET" },
			env,
		);
		expect(profileRes.status).toBe(200);
		const profileBody = (await profileRes.json()) as {
			data: { frames: Array<{ name: string; value: number }> };
		};
		expect(profileBody.data.frames).toEqual([
			expect.objectContaining({
				name: "checkout.authorize",
				value: 500,
			}),
		]);
	});

	it("surfaces materialized ref stats and records expansions", async () => {
		const { app, db, env } = setup();
		const bundle = await getBundle(app, env);
		const logsRef = bundle.retrievalRefs.find((ref) => ref.kind === "logs");
		expect(logsRef).toBeDefined();

		const retrieveRes = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}`,
			{ method: "GET" },
			env,
		);
		expect(retrieveRes.status).toBe(200);

		const statsRes = await app.request("/internal/evidence/stats", {}, env);
		expect(statsRes.status).toBe(200);
		const stats = (await statsRes.json()) as {
			byKind: Array<{
				kind: string;
				issuedCount: number;
				expansionCount: number;
			}>;
			bySource: Array<{ source: string }>;
			recentRefs: Array<{ refId: string }>;
			recentExpansions: Array<{ refId: string; operation: string }>;
		};
		expect(stats.byKind).toEqual([
			{ kind: "logs", issuedCount: 3, expansionCount: 2 },
		]);
		expect(stats.bySource[0]?.source).toBe("evidence.bundle.connected_logs");
		expect(stats.recentRefs[0]?.refId).toBe("eref_logs");
		expect(stats.recentExpansions[0]).toEqual(
			expect.objectContaining({ refId: "eref_logs", operation: "retrieve" }),
		);
		expect(db.callsMatching("INSERT INTO evidence_retrieval_refs")).not.toEqual(
			[],
		);
		expect(db.callsMatching("INSERT INTO evidence_ref_expansions")).not.toEqual(
			[],
		);
	});

	it("returns 404 for malformed retrieval refs", async () => {
		const { app, env } = setup();

		const plainRes = await app.request(
			"/internal/evidence/refs/not-a-ref",
			{ method: "GET" },
			env,
		);
		expect(plainRes.status).toBe(404);

		const missingTraceIdRes = await app.request(
			`/internal/evidence/refs/${encodeRef({ kind: "logs", projectId: "default" })}`,
			{ method: "GET" },
			env,
		);
		expect(missingTraceIdRes.status).toBe(404);
	});

	it("does not expand refs across project scopes", async () => {
		const { app: defaultApp, env: defaultEnv } = setup();
		const bundle = await getBundle(defaultApp, defaultEnv);
		const logsRef = bundle.retrievalRefs.find((ref) => ref.kind === "logs");
		expect(logsRef).toBeDefined();

		const { app: otherApp, env: otherEnv } = setup({ projectId: "other" });
		const res = await otherApp.request(
			`/internal/evidence/refs/${logsRef?.refId}`,
			{ method: "GET" },
			otherEnv,
		);

		expect(res.status).toBe(404);
	});

	it("clamps retrieval ref limits to the route maximum", async () => {
		const { app, db, env } = setup();
		const bundle = await getBundle(app, env);
		const logsRef = bundle.retrievalRefs.find((ref) => ref.kind === "logs");
		expect(logsRef).toBeDefined();

		const res = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}?limit=999999`,
			{ method: "GET" },
			env,
		);
		expect(res.status).toBe(200);

		const logSelects = db
			.callsMatching("SELECT * FROM logs")
			.filter((call) => call.op === "all");
		expect(logSelects.at(-1)?.binds.at(-1)).toBe(1000);
	});

	it("rejects invalid log severity filters", async () => {
		const { app, env } = setup();
		const bundle = await getBundle(app, env);
		const logsRef = bundle.retrievalRefs.find((ref) => ref.kind === "logs");
		expect(logsRef).toBeDefined();

		const res = await app.request(
			`/internal/evidence/refs/${logsRef?.refId}?severity=TRACE`,
			{ method: "GET" },
			env,
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual(
			expect.objectContaining({ message: "severity is invalid" }),
		);
	});

	it("rejects search for unsupported retrieval ref kinds", async () => {
		const { app, env } = setup();
		const bundle = await getBundle(app, env);
		const traceRef = bundle.retrievalRefs.find((ref) => ref.kind === "trace");
		expect(traceRef).toBeDefined();

		const res = await app.request(
			`/internal/evidence/refs/${traceRef?.refId}/search`,
			{
				method: "POST",
				body: JSON.stringify({ query: "Stripe" }),
				headers: { "content-type": "application/json" },
			},
			env,
		);

		expect(res.status).toBe(400);
		expect(await res.json()).toEqual(
			expect.objectContaining({
				message: "Search is currently supported for log refs only.",
			}),
		);
	});

	it("rejects bad bundle anchors without hitting trace lookup", async () => {
		const badAnchors = [
			undefined,
			{ entityKind: "log", entityId: "log-1" },
			{ entityKind: "trace", entityId: "" },
			{ entityKind: "span", entityId: "trace-1:span-1" },
		];

		for (const anchor of badAnchors) {
			const { app, db, env } = setup();
			const res = await app.request(
				"/internal/evidence/bundle",
				{
					method: "POST",
					body: JSON.stringify({ anchor }),
					headers: { "content-type": "application/json" },
				},
				env,
			);

			expect(res.status).toBe(400);
			expect(db.callsMatching("FROM telemetry_spans")).toHaveLength(0);
		}
	});
});
