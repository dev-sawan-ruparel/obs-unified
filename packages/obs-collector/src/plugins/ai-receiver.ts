import type {
	AICallPayload,
	AICallRecord,
	AIEvaluationPayload,
} from "@obs-unified/types";
import { getConfiguredRetentionHours } from "@obs-unified/types/constants";
import type { CollectorPlugin } from "../framework/collector";
import { AIStore, type IngestEvaluation } from "../lib/ai-store";
import { sqlDbFor } from "../lib/sql-db";
import { getProjectId } from "./_context";

export const aiReceiverPlugin: CollectorPlugin = {
	name: "ai-receiver",
	register(app, _runtime) {
		app.post("/v1/ai", async (c) => {
			const projectId = getProjectId(c);
			let payload: AICallPayload;
			try {
				payload = await c.req.json<AICallPayload>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			if (!payload.calls || !Array.isArray(payload.calls)) {
				return c.json({ error: "Missing calls array" }, 400);
			}
			if (payload.calls.length > 500) {
				return c.json(
					{ error: `Too many AI calls: ${payload.calls.length} (max 500)` },
					413,
				);
			}
			const store = new AIStore(sqlDbFor(c.env));

			const retentionHours = parseInt(c.env.RETENTION_HOURS || "72", 10);
			const now = new Date();
			const nowStr = now.toISOString();
			const expires = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			const records: AICallRecord[] = payload.calls.map((call) => ({
				projectId,
				callId: crypto.randomUUID(),
				traceId: call.traceId || null,
				spanId: call.spanId || null,
				serviceName: call.serviceName || null,
				modelName: call.modelName,
				provider: call.provider,
				callType: call.callType,
				requestJson: call.request ? JSON.stringify(call.request) : null,
				responseJson: call.response ? JSON.stringify(call.response) : null,
				promptTokens: call.promptTokens || null,
				completionTokens: call.completionTokens || null,
				totalCostUsd: call.totalCostUsd || null,
				latencyMs: call.latencyMs || null,
				isError: call.isError || false,
				errorMessage: call.errorMessage || null,
				occurredAt: call.occurredAt || nowStr,
				receivedAt: nowStr,
				expiresAt: expires,
				// RFC 0004 — denormalized from the active root span, when the
				// SDK was told to propagate it.
				sessionId: call.sessionId ?? null,
				interactionId: call.interactionId ?? null,
			}));

			await store.ingestBatch(records);

			return c.json({ accepted: records.length }, 202);
		});

		app.get("/internal/ai/overview", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(sqlDbFor(c.env));
			const query = c.req.query();
			const hours = parseInt(query.hours || "24", 10);

			const response = await store.getAICalls({
				projectId,
				hours,
				service: query.service,
				model: query.model,
				isError:
					query.isError === "true"
						? true
						: query.isError === "false"
							? false
							: undefined,
				traceId: query.traceId,
				limit: parseInt(query.limit || "100", 10),
			});

			return c.json(response);
		});

		// OpenInference-kind spans (LLM/TOOL/RETRIEVER/CHAIN/AGENT/...) joined
		// with their payload side-table. This is the replacement for the flat
		// ai_calls endpoint — it returns typed spans that live inside the
		// regular trace tree.
		app.get("/internal/ai/spans", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(sqlDbFor(c.env));
			const query = c.req.query();

			const response = await store.getAISpans({
				projectId,
				hours: parseInt(query.hours || "24", 10),
				kind: query.kind,
				service: query.service,
				traceId: query.traceId,
				limit: parseInt(query.limit || "100", 10),
			});

			return c.json(response);
		});

		// Attach evaluations to AI spans. Accepts a batch of evaluation records
		// keyed by (traceId, spanId). Caller supplies name (e.g. "hallucination"),
		// one or both of score/label, and optional explanation + metadata.
		app.post("/v1/ai/evaluations", async (c) => {
			const projectId = getProjectId(c);
			let payload: AIEvaluationPayload;
			try {
				payload = await c.req.json<AIEvaluationPayload>();
			} catch {
				return c.json({ error: "Invalid JSON body" }, 400);
			}
			if (!payload.evaluations || !Array.isArray(payload.evaluations)) {
				return c.json({ error: "Missing evaluations array" }, 400);
			}
			if (payload.evaluations.length > 500) {
				return c.json(
					{
						error: `Too many evaluations: ${payload.evaluations.length} (max 500)`,
					},
					413,
				);
			}

			const retentionHours = getConfiguredRetentionHours(c.env.RETENTION_HOURS);
			const now = new Date();
			const nowStr = now.toISOString();
			const expires = new Date(
				now.getTime() + retentionHours * 60 * 60 * 1000,
			).toISOString();

			const records: IngestEvaluation[] = [];
			for (const e of payload.evaluations) {
				if (!e.traceId || !e.spanId || !e.name || !e.source) {
					return c.json(
						{ error: "Each evaluation needs traceId, spanId, name, source" },
						400,
					);
				}
				records.push({
					projectId,
					evaluationId: crypto.randomUUID(),
					traceId: e.traceId,
					spanId: e.spanId,
					name: e.name,
					score: typeof e.score === "number" ? e.score : null,
					label: e.label ?? null,
					explanation: e.explanation ?? null,
					source: e.source,
					metadataJson: e.metadata ? JSON.stringify(e.metadata) : null,
					createdAt: nowStr,
					expiresAt: expires,
				});
			}

			const store = new AIStore(sqlDbFor(c.env));
			await store.ingestEvaluations(records);
			return c.json({ accepted: records.length }, 202);
		});

		// List conversation sessions — one row per distinct session.id with
		// aggregated stats (span count, tokens, cost, error count, etc.).
		app.get("/internal/ai/sessions", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(sqlDbFor(c.env));
			const query = c.req.query();
			const response = await store.listSessions({
				projectId,
				hours: parseInt(query.hours || "24", 10),
				userId: query.userId,
				limit: parseInt(query.limit || "100", 10),
			});
			return c.json(response);
		});

		// Full detail for a single session: every AI span in timestamp order
		// (across one or more traces) plus any evaluations attached to them.
		app.get("/internal/ai/sessions/:sessionId", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(sqlDbFor(c.env));
			const sessionId = c.req.param("sessionId");
			const response = await store.getSession(projectId, sessionId);
			return c.json(response);
		});

		// List evaluations, optionally scoped to a single span or trace.
		app.get("/internal/ai/evaluations", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(sqlDbFor(c.env));
			const query = c.req.query();

			const response = await store.listEvaluations({
				projectId,
				traceId: query.traceId,
				spanId: query.spanId,
				name: query.name,
				limit: parseInt(query.limit || "200", 10),
			});

			return c.json(response);
		});
	},
};
