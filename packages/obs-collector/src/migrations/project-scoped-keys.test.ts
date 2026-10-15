/**
 * Migrations 045–048 move four row families from globally unique keys to
 * project-scoped composite keys. These tests run the real D1 migration
 * files through node:sqlite and then exercise the real write paths
 * (/v1/identify, ActionStore, the AI span payload processor, span ingest)
 * with two projects that emit identical ids.
 */

import type { StoredSpan } from "@obsunified/types";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it } from "vitest";
import {
	type CollectorRuntime,
	createTelemetryCollectorApp,
	type SpanProcessorPlugin,
} from "../framework/collector";
import type { CollectorEnv, CollectorRouteContext } from "../framework/env";
import { ActionStore } from "../lib/actions-store";
import { getAISpansOverview } from "../lib/ai-store/spans";
import { manifestByUser } from "../lib/identity-index/user-lookup";
import { ingestTelemetrySpans } from "../lib/store/ingest";
import { actionRecord } from "../lib/test-utils/action-graph-fixtures";
import {
	applySqliteMigrations,
	createMigratedSqliteDb,
	indexNames,
	type NodeSqliteDb,
	primaryKeyColumns,
} from "../lib/test-utils/node-sqlite-db";
import { aiSpanPayloadsProcessorPlugin } from "../plugins/ai-span-payloads-processor";
import { identityReceiverPlugin } from "../plugins/identity-receiver";

const NOW = "2026-10-13T05:00:00.000Z";
const LATER = "2026-10-14T05:00:00.000Z";

const EXPECTED_KEYS: Record<string, string[]> = {
	user_profiles: ["project_id", "user_id"],
	actions: ["project_id", "id"],
	agent_runs: ["project_id", "id"],
	tool_calls: ["project_id", "id"],
	retrieval_events: ["project_id", "id"],
	eval_results: ["project_id", "id"],
	artifacts: ["project_id", "id"],
	ai_span_payloads: ["project_id", "trace_id", "span_id"],
	telemetry_spans: ["project_id", "trace_id", "span_id"],
};

const EXPECTED_INDEXES: Record<string, string[]> = {
	user_profiles: ["idx_user_visitor", "idx_users_project_last"],
	actions: [
		"idx_actions_project_actor",
		"idx_actions_project_agent_run",
		"idx_actions_project_interaction",
		"idx_actions_project_root",
		"idx_actions_project_trace",
		"idx_actions_started_at",
	],
	agent_runs: ["idx_agent_runs_project_agent"],
	tool_calls: ["idx_tool_calls_action", "idx_tool_calls_name"],
	retrieval_events: ["idx_retrieval_events_action"],
	eval_results: ["idx_eval_results_action"],
	artifacts: ["idx_artifacts_action"],
	ai_span_payloads: [
		"idx_ai_payloads_action",
		"idx_ai_payloads_kind",
		"idx_ai_payloads_project",
		"idx_ai_payloads_received",
		"idx_ai_payloads_session",
		"idx_ai_payloads_user",
	],
	telemetry_spans: [
		"idx_spans_interaction",
		"idx_spans_project_received",
		"idx_spans_project_service_received",
		"idx_spans_received_at",
		"idx_spans_root",
		"idx_spans_sdk_name",
		"idx_spans_service",
		"idx_spans_session",
		"idx_spans_status",
		"idx_spans_trace_id",
		"idx_spans_with_links",
	],
};

const span = (over: Partial<StoredSpan>): StoredSpan => ({
	projectId: "alpha",
	traceId: "trace-shared",
	spanId: "span-shared",
	parentSpanId: null,
	traceState: null,
	serviceName: "agent",
	scopeName: null,
	scopeVersion: null,
	spanName: "llm",
	spanKind: 1,
	statusCode: 1,
	statusMessage: null,
	startTime: NOW,
	endTime: NOW,
	durationMs: 5,
	attributesJson: "{}",
	droppedAttributesCount: 0,
	resourceAttributesJson: "{}",
	eventsJson: "[]",
	droppedEventsCount: 0,
	linksJson: "[]",
	droppedLinksCount: 0,
	receivedAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
	sessionId: null,
	interactionId: null,
	...over,
});

const aiSpan = (projectId: string, input: string): StoredSpan =>
	span({
		projectId,
		attributesJson: JSON.stringify({
			"openinference.span.kind": "LLM",
			"ai.payload.input": input,
			"ai.payload.output": `${input}-output`,
		}),
	});

const runPayloadProcessor = async (db: NodeSqliteDb, spans: StoredSpan[]) => {
	const processors: SpanProcessorPlugin[] = [];
	aiSpanPayloadsProcessorPlugin.register(
		{} as Parameters<typeof aiSpanPayloadsProcessorPlugin.register>[0],
		{
			addSpanProcessor(p: SpanProcessorPlugin) {
				processors.push(p);
			},
		} as unknown as CollectorRuntime,
	);
	const process = processors[0]?.process;
	if (!process) throw new Error("span processor was not registered");
	return process(spans, {
		env: { DB: db, OBS_PAYLOAD_CAPTURE_DEFAULT: "true" },
		now: new Date(),
		logger: { ...console, error: () => {} },
	} as unknown as CollectorRouteContext);
};

const identifyApp = () => {
	const setProject: MiddlewareHandler<{
		Bindings: CollectorEnv;
		Variables: { projectId: string };
	}> = async (c, next) => {
		const header = c.req.header("x-project-id");
		if (header) c.set("projectId", header);
		await next();
	};
	return createTelemetryCollectorApp({
		plugins: [identityReceiverPlugin],
		auth: { middleware: setProject },
		dashboardAuth: { middleware: setProject, registerRoutes: () => {} },
	});
};

const identify = (
	app: ReturnType<typeof identifyApp>,
	db: NodeSqliteDb,
	projectId: string,
	body: Record<string, unknown>,
) =>
	app.request(
		"/v1/identify",
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-project-id": projectId,
			},
			body: JSON.stringify(body),
		},
		{ DB: db as unknown as D1Database } as CollectorEnv,
	);

describe("migrations 045–048 (project-scoped composite keys)", () => {
	it("rebuild each table in place, keeping rows, defaults and indexes", async () => {
		const db = createMigratedSqliteDb({ upTo: "044" });
		const raw = db.raw;

		// Legacy rows written under the old global keys (project_id defaults
		// to 'default' on user_profiles / telemetry_spans).
		raw.exec(`
			INSERT INTO user_profiles (user_id, visitor_id, email, first_seen_at, last_seen_at)
			VALUES ('ada@example.com', 'vis-1', 'ada@example.com', '${NOW}', '${NOW}');
			INSERT INTO actions (id, project_id, root_action_id, actor_type, action_kind, started_at)
			VALUES ('01ACTION', 'alpha', '01ACTION', 'agent', 'agent.run', '${NOW}');
			INSERT INTO agent_runs (id, project_id, agent_id, agent_name, agent_version, autonomy_level)
			VALUES ('01ACTION', 'alpha', 'bot', 'Bot', '1', 'read_only');
			INSERT INTO tool_calls (id, action_id, project_id, tool_name, args_hash, result_hash, mutation_diff_json)
			VALUES ('span-1', '01ACTION', 'alpha', 'sql_query', 'a', 'r', '{"diff":true}');
			INSERT INTO retrieval_events (id, action_id, project_id, retriever_name, query_hash)
			VALUES ('span-2', '01ACTION', 'alpha', 'vector', 'q');
			INSERT INTO eval_results (id, action_id, project_id, evaluator_name, evaluator_version, score)
			VALUES ('span-3', '01ACTION', 'alpha', 'groundedness', '1', 0.9);
			INSERT INTO artifacts (id, action_id, project_id, artifact_name, artifact_type)
			VALUES ('span-4', '01ACTION', 'alpha', 'invoice', 'file');
			INSERT INTO ai_span_payloads (project_id, trace_id, span_id, span_kind, input_json, received_at, expires_at, input_hash, action_id)
			VALUES ('alpha', 't1', 's1', 'LLM', '"prompt"', '${NOW}', '${LATER}', 'hash', '01ACTION');
			INSERT INTO telemetry_spans (trace_id, span_id, span_name, start_time, end_time, duration_ms, received_at, expires_at, telemetry_sdk_name)
			VALUES ('t1', 's1', 'llm', '${NOW}', '${NOW}', 5, '${NOW}', '${LATER}', 'beyla');
		`);

		const applied = applySqliteMigrations(raw, { from: "045", upTo: "048" });
		expect(applied.map((f) => f.slice(0, 3))).toEqual([
			"045",
			"046",
			"047",
			"048",
		]);

		for (const [table, key] of Object.entries(EXPECTED_KEYS)) {
			expect(primaryKeyColumns(raw, table), table).toEqual(key);
			expect(indexNames(raw, table), table).toEqual(EXPECTED_INDEXES[table]);
			expect(
				raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
				table,
			).toEqual({ n: 1 });
			expect(
				raw
					.prepare(`SELECT name FROM sqlite_master WHERE name = ?`)
					.get(`${table}_new`),
				`${table}_new left behind`,
			).toBeUndefined();
		}

		expect(
			raw.prepare(`SELECT project_id, email FROM user_profiles`).get(),
		).toEqual({ project_id: "default", email: "ada@example.com" });
		expect(
			raw
				.prepare(
					`SELECT project_id, status, mutation_diff_json, side_effect FROM tool_calls JOIN actions USING (project_id)`,
				)
				.get(),
		).toEqual({
			project_id: "alpha",
			status: "ok",
			mutation_diff_json: '{"diff":true}',
			side_effect: 0,
		});
		expect(
			raw
				.prepare(
					`SELECT project_id, telemetry_sdk_name, dropped_links_count FROM telemetry_spans`,
				)
				.get(),
		).toEqual({
			project_id: "default",
			telemetry_sdk_name: "beyla",
			dropped_links_count: 0,
		});
		expect(
			raw.prepare(`SELECT input_hash, action_id FROM ai_span_payloads`).get(),
		).toEqual({ input_hash: "hash", action_id: "01ACTION" });

		// Re-applying the rebuild files is a no-op in effect.
		applySqliteMigrations(raw, { from: "045", upTo: "048" });
		for (const [table, key] of Object.entries(EXPECTED_KEYS)) {
			expect(primaryKeyColumns(raw, table), table).toEqual(key);
			expect(
				raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
				table,
			).toEqual({ n: 1 });
		}
		db.close();
	});
});

describe("tenant isolation on project-scoped keys", () => {
	it("/v1/identify keeps one profile per project for the same userId", async () => {
		const db = createMigratedSqliteDb();
		const app = identifyApp();
		const userId = "ada@example.com";

		const alpha = await identify(app, db, "alpha", {
			userId,
			visitorId: "vis-alpha",
			email: userId,
			name: "Ada (alpha)",
			properties: { plan: "alpha-plan" },
		});
		expect(alpha.status).toBe(200);
		const beta = await identify(app, db, "beta", {
			userId,
			visitorId: "vis-beta",
			name: "Ada (beta)",
		});
		expect(beta.status).toBe(200);

		const rows = await db
			.prepare(
				`SELECT project_id, visitor_id, email, name, properties_json
				 FROM user_profiles WHERE user_id = ? ORDER BY project_id`,
			)
			.bind(userId)
			.all();
		expect(rows.results).toEqual([
			{
				project_id: "alpha",
				visitor_id: "vis-alpha",
				email: userId,
				name: "Ada (alpha)",
				properties_json: JSON.stringify({ plan: "alpha-plan" }),
			},
			{
				project_id: "beta",
				visitor_id: "vis-beta",
				email: null,
				name: "Ada (beta)",
				properties_json: null,
			},
		]);

		// A repeat identify from beta updates beta only.
		await identify(app, db, "beta", { userId, visitorId: "vis-beta-2" });
		const visitors = await db
			.prepare(
				`SELECT project_id, visitor_id FROM user_profiles WHERE user_id = ? ORDER BY project_id`,
			)
			.bind(userId)
			.all();
		expect(visitors.results).toEqual([
			{ project_id: "alpha", visitor_id: "vis-alpha" },
			{ project_id: "beta", visitor_id: "vis-beta-2" },
		]);

		// The identity index resolves the visitor inside the caller's project.
		const alphaCalls = db.raw.prepare(
			`INSERT INTO usage_events (project_id, event_id, session_id, visitor_id, event_type, event_name, context_json, properties_json, occurred_at, received_at, expires_at)
			 VALUES (?, ?, ?, ?, 'page_view', 'page_view', '{}', '{}', ?, ?, ?)`,
		);
		alphaCalls.run("alpha", "evt-a", "sess-a", "vis-alpha", NOW, NOW, LATER);
		alphaCalls.run("beta", "evt-b", "sess-b", "vis-beta-2", NOW, NOW, LATER);
		const alphaManifest = await manifestByUser(db, "alpha", userId);
		const betaManifest = await manifestByUser(db, "beta", userId);
		expect(alphaManifest.usageEvents.map((e) => e.sessionId)).toEqual([
			"sess-a",
		]);
		expect(betaManifest.usageEvents.map((e) => e.sessionId)).toEqual([
			"sess-b",
		]);
		db.close();
	});

	it("ActionStore keeps the same action id separate per project", async () => {
		const db = createMigratedSqliteDb();
		const store = new ActionStore(db);
		await store.upsertAction(
			actionRecord({ id: "01SHARED", projectId: "alpha", name: "alpha run" }),
		);
		await store.upsertAction(
			actionRecord({ id: "01SHARED", projectId: "beta", name: "beta run" }),
		);
		// A second write from beta must not reach alpha.
		await store.upsertAction(
			actionRecord({ id: "01SHARED", projectId: "beta", name: "beta run v2" }),
		);

		expect((await store.getAction("alpha", "01SHARED"))?.name).toBe(
			"alpha run",
		);
		expect((await store.getAction("beta", "01SHARED"))?.name).toBe(
			"beta run v2",
		);
		const count = await db
			.prepare(`SELECT COUNT(*) AS n FROM actions WHERE id = ?`)
			.bind("01SHARED")
			.first<{ n: number }>();
		expect(count?.n).toBe(2);
		db.close();
	});

	it("AI span payloads with identical trace/span ids stay with their project", async () => {
		const db = createMigratedSqliteDb();
		await runPayloadProcessor(db, [aiSpan("alpha", "alpha prompt")]);
		await runPayloadProcessor(db, [aiSpan("beta", "beta prompt")]);
		await runPayloadProcessor(db, [aiSpan("beta", "beta prompt v2")]);

		const rows = await db
			.prepare(
				`SELECT project_id, input_json FROM ai_span_payloads
				 WHERE trace_id = ? AND span_id = ? ORDER BY project_id`,
			)
			.bind("trace-shared", "span-shared")
			.all<{ project_id: string; input_json: string }>();
		expect(rows.results).toEqual([
			{ project_id: "alpha", input_json: "alpha prompt" },
			{ project_id: "beta", input_json: "beta prompt v2" },
		]);
		db.close();
	});

	it("span ingest keeps colliding ids per project and the AI span join stays in-project", async () => {
		const db = createMigratedSqliteDb();
		const alphaSpan = span({ projectId: "alpha", spanName: "alpha-llm" });
		const betaSpan = span({ projectId: "beta", spanName: "beta-llm" });
		await ingestTelemetrySpans(db, [alphaSpan]);
		// Previously INSERT OR IGNORE dropped this row: same (trace_id, span_id).
		await ingestTelemetrySpans(db, [betaSpan]);

		const names = await db
			.prepare(
				`SELECT project_id, span_name FROM telemetry_spans
				 WHERE trace_id = ? AND span_id = ? ORDER BY project_id`,
			)
			.bind("trace-shared", "span-shared")
			.all();
		expect(names.results).toEqual([
			{ project_id: "alpha", span_name: "alpha-llm" },
			{ project_id: "beta", span_name: "beta-llm" },
		]);

		// Only alpha has a payload row; beta's span must not be joined to it.
		await runPayloadProcessor(db, [aiSpan("alpha", "alpha prompt")]);
		const alpha = await getAISpansOverview(db, {
			projectId: "alpha",
			hours: 24,
		});
		const beta = await getAISpansOverview(db, {
			projectId: "beta",
			hours: 24,
		});
		expect(alpha.spans.map((s) => s.spanName)).toEqual(["alpha-llm"]);
		expect(beta.spans).toEqual([]);
		db.close();
	});
});
