import type { AICallPayload, AICallRecord } from "@obs/types";
import type { CollectorPlugin } from "../framework/collector";
import { AIStore } from "../lib/ai-store";
import { getProjectId } from "./_context";

export const aiReceiverPlugin: CollectorPlugin = {
	name: "ai-receiver",
	register(app, runtime) {
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
				return c.json({ error: `Too many AI calls: ${payload.calls.length} (max 500)` }, 413);
			}
			const store = new AIStore(c.env.DB);

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
			}));

			await store.ingestBatch(records);

			return c.json({ accepted: records.length }, 202);
		});

		app.get("/internal/ai/overview", async (c) => {
			const projectId = getProjectId(c);
			const store = new AIStore(c.env.DB);
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
	},
};
