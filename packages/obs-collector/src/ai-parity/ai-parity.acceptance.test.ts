/**
 * AI-observability parity suite.
 *
 * Exercises the live collector end-to-end and asserts the wire contract we
 * need to claim Phoenix/LangSmith-level AI observability. For each dimension
 * the Phoenix docs list, this suite sends a realistic OTLP payload and
 * verifies the collector exposes it through `/internal/ai/*`:
 *
 *   1. Typed OpenInference span kinds (LLM, TOOL, RETRIEVER) flow through
 *      telemetry_spans → ai_span_payloads and come back from /ai/spans
 *   2. Payloads (input/output) are stripped from attributes_json and land
 *      in the payload side table without truncation
 *   3. gen_ai.* auto-instrumentation attrs are normalized to OpenInference
 *      on ingest (no SDK required on the caller)
 *   4. Token counts, cost, and provider metadata are queryable
 *   5. Evaluations post via /v1/ai/evaluations and join back by (trace,span)
 *   6. Sessions group spans across traces under one session.id
 *
 * Skipped unless AI_PARITY_URL is set (the runner script provides it).
 */

import { describe, expect, it } from "vitest";

declare const process: { env: Record<string, string | undefined> };

const BASE = process.env.AI_PARITY_URL;

// Helper: build a minimal OTLP trace payload with a single span carrying
// the given attribute map.
const buildSpan = (opts: {
	traceId: string;
	spanId: string;
	parentSpanId?: string;
	name: string;
	serviceName: string;
	attributes: Record<string, unknown>;
	startNano: string;
	endNano: string;
	statusCode?: number;
}) => {
	const kv = (k: string, v: unknown) => {
		if (typeof v === "string") return { key: k, value: { stringValue: v } };
		if (typeof v === "boolean") return { key: k, value: { boolValue: v } };
		if (typeof v === "number")
			return Number.isInteger(v)
				? { key: k, value: { intValue: v } }
				: { key: k, value: { doubleValue: v } };
		return { key: k, value: { stringValue: String(v) } };
	};
	return {
		resourceSpans: [
			{
				resource: { attributes: [kv("service.name", opts.serviceName)] },
				scopeSpans: [
					{
						scope: { name: opts.serviceName },
						spans: [
							{
								traceId: opts.traceId,
								spanId: opts.spanId,
								parentSpanId: opts.parentSpanId,
								name: opts.name,
								kind: 2,
								startTimeUnixNano: opts.startNano,
								endTimeUnixNano: opts.endNano,
								attributes: Object.entries(opts.attributes).map(([k, v]) =>
									kv(k, v),
								),
								status: { code: opts.statusCode ?? 1 },
							},
						],
					},
				],
			},
		],
	};
};

const randomHex = (bytes: number): string => {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
};

const postTrace = async (payload: unknown): Promise<Response> =>
	fetch(`${BASE}/v1/traces`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

const nowNano = (): string => (BigInt(Date.now()) * 1_000_000n).toString();
const agoNano = (ms: number): string =>
	(BigInt(Date.now() - ms) * 1_000_000n).toString();

interface AISpan {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	spanKind: string;
	spanName: string;
	serviceName: string | null;
	durationMs: number;
	statusCode: number;
	attributes: Record<string, unknown>;
	inputJson: string | null;
	outputJson: string | null;
}

interface AISpansResponse {
	spans: AISpan[];
	summary: {
		totalSpans: number;
		byKind: Record<string, number>;
		errorSpans: number;
	};
}

describe.skipIf(!BASE)("AI observability parity", () => {
	it("1. LLM span with OpenInference attrs round-trips through /ai/spans", async () => {
		const traceId = randomHex(16);
		const spanId = randomHex(8);
		const messages = [
			{ role: "system", content: "You are concise." },
			{ role: "user", content: "Capital of France?" },
		];
		const output = { role: "assistant", content: "Paris." };

		const payload = buildSpan({
			traceId,
			spanId,
			name: "openai.chat.completions",
			serviceName: "ai-parity",
			startNano: agoNano(1200),
			endNano: nowNano(),
			attributes: {
				"openinference.span.kind": "LLM",
				"llm.model_name": "gpt-4o-mini",
				"llm.provider": "openai",
				"llm.token_count.prompt": 18,
				"llm.token_count.completion": 2,
				"llm.token_count.total": 20,
				"ai.payload.input": JSON.stringify(messages),
				"ai.payload.output": JSON.stringify(output),
			},
		});

		const res = await postTrace(payload);
		expect(res.status).toBe(200);

		// Give the collector a beat — SpanProcessor runs during the ingest,
		// so by the time POST returns the row should exist, but CI is noisy.
		await new Promise((r) => setTimeout(r, 300));

		const q = await fetch(
			`${BASE}/internal/ai/spans?traceId=${traceId}&hours=1`,
		);
		expect(q.status).toBe(200);
		const body = (await q.json()) as AISpansResponse;

		const llm = body.spans.find((s) => s.spanId === spanId);
		expect(llm, "LLM span not found in /ai/spans response").toBeTruthy();
		expect(llm?.spanKind).toBe("LLM");
		expect(llm?.attributes["llm.model_name"]).toBe("gpt-4o-mini");
		expect(llm?.attributes["llm.provider"]).toBe("openai");
		expect(llm?.attributes["llm.token_count.prompt"]).toBe(18);
		expect(llm?.attributes["llm.token_count.completion"]).toBe(2);

		// Payload blobs MUST be stripped from attributes and routed to the
		// side table — Phoenix parity requires input/output be rehydratable
		// for replay.
		expect(llm?.attributes).not.toHaveProperty("ai.payload.input");
		expect(llm?.attributes).not.toHaveProperty("ai.payload.output");
		expect(llm?.inputJson).toBe(JSON.stringify(messages));
		expect(llm?.outputJson).toBe(JSON.stringify(output));

		// Cost must be auto-computed from the vendor pricing table since we
		// didn't report it directly. gpt-4o-mini is in our table.
		expect(llm?.attributes["llm.cost.total_usd"]).toBeGreaterThan(0);
		expect(llm?.attributes["llm.cost.computed"]).toBe(true);
	});

	it("2. RETRIEVER span preserves document attributes for RAG debugging", async () => {
		const traceId = randomHex(16);
		const spanId = randomHex(8);

		const payload = buildSpan({
			traceId,
			spanId,
			name: "knowledge_base.search",
			serviceName: "ai-parity",
			startNano: agoNano(200),
			endNano: nowNano(),
			attributes: {
				"openinference.span.kind": "RETRIEVER",
				"retrieval.query": "capital of France",
				"retrieval.documents.count": 2,
				"retrieval.documents.0.document.id": "doc_001",
				"retrieval.documents.0.document.score": 0.92,
				"retrieval.documents.0.document.content":
					"Paris is the capital of France.",
				"retrieval.documents.1.document.id": "doc_042",
				"retrieval.documents.1.document.score": 0.71,
				"retrieval.documents.1.document.content":
					"France is a country in Western Europe.",
			},
		});
		await postTrace(payload);
		await new Promise((r) => setTimeout(r, 300));

		const q = await fetch(
			`${BASE}/internal/ai/spans?traceId=${traceId}&hours=1`,
		);
		const body = (await q.json()) as AISpansResponse;
		const retriever = body.spans.find((s) => s.spanId === spanId);

		expect(retriever?.spanKind).toBe("RETRIEVER");
		expect(retriever?.attributes["retrieval.query"]).toBe("capital of France");
		expect(retriever?.attributes["retrieval.documents.count"]).toBe(2);
		expect(retriever?.attributes["retrieval.documents.0.document.id"]).toBe(
			"doc_001",
		);
		expect(
			retriever?.attributes["retrieval.documents.0.document.score"],
		).toBeCloseTo(0.92, 2);
	});

	it("3. TOOL span captures name + parameters + output", async () => {
		const traceId = randomHex(16);
		const spanId = randomHex(8);
		const params = { city: "Tokyo" };
		const result = { city: "Tokyo", tempC: 18, condition: "partly cloudy" };

		await postTrace(
			buildSpan({
				traceId,
				spanId,
				name: "get_weather",
				serviceName: "ai-parity",
				startNano: agoNano(80),
				endNano: nowNano(),
				attributes: {
					"openinference.span.kind": "TOOL",
					"tool.name": "get_weather",
					"ai.payload.input": JSON.stringify(params),
					"ai.payload.output": JSON.stringify(result),
				},
			}),
		);
		await new Promise((r) => setTimeout(r, 300));

		const q = await fetch(
			`${BASE}/internal/ai/spans?traceId=${traceId}&hours=1`,
		);
		const body = (await q.json()) as AISpansResponse;
		const tool = body.spans.find((s) => s.spanId === spanId);

		expect(tool?.spanKind).toBe("TOOL");
		expect(tool?.attributes["tool.name"]).toBe("get_weather");
		expect(tool?.inputJson).toBe(JSON.stringify(params));
		expect(tool?.outputJson).toBe(JSON.stringify(result));
	});

	it("4. Auto-instrumentation: gen_ai.* attrs normalize to OpenInference", async () => {
		const traceId = randomHex(16);
		const spanId = randomHex(8);

		// Simulate what the OpenAI SDK or Vercel AI SDK would emit natively —
		// no OpenInference attrs set by the caller.
		await postTrace(
			buildSpan({
				traceId,
				spanId,
				name: "chat",
				serviceName: "ai-parity",
				startNano: agoNano(1000),
				endNano: nowNano(),
				attributes: {
					"gen_ai.system": "openai",
					"gen_ai.operation.name": "chat",
					"gen_ai.request.model": "gpt-4o",
					"gen_ai.response.model": "gpt-4o-2024-11-20",
					"gen_ai.usage.input_tokens": 42,
					"gen_ai.usage.output_tokens": 120,
					"gen_ai.prompt.0.role": "user",
					"gen_ai.prompt.0.content": "hello",
					"gen_ai.completion.0.role": "assistant",
					"gen_ai.completion.0.content": "hi there",
				},
			}),
		);
		await new Promise((r) => setTimeout(r, 300));

		const q = await fetch(
			`${BASE}/internal/ai/spans?traceId=${traceId}&hours=1`,
		);
		const body = (await q.json()) as AISpansResponse;
		const span = body.spans.find((s) => s.spanId === spanId);

		expect(span, "gen_ai.* span not normalized to OpenInference").toBeTruthy();
		expect(span?.spanKind).toBe("LLM");
		// Normalization: gen_ai.response.model wins (actual served model) over
		// gen_ai.request.model, and maps to llm.model_name.
		expect(span?.attributes["llm.model_name"]).toBe("gpt-4o-2024-11-20");
		expect(span?.attributes["llm.provider"]).toBe("openai");
		expect(span?.attributes["llm.token_count.prompt"]).toBe(42);
		expect(span?.attributes["llm.token_count.completion"]).toBe(120);
		// Indexed prompt/completion arrays get reassembled into input/output
		// payloads and routed to the side table, same as native SDK spans.
		expect(span?.inputJson).toBeTruthy();
		expect(span?.outputJson).toBeTruthy();
		expect(span?.inputJson).toContain("hello");
		expect(span?.outputJson).toContain("hi there");
	});

	it("5. Evaluation attaches to a span and returns via /ai/evaluations", async () => {
		const traceId = randomHex(16);
		const spanId = randomHex(8);

		await postTrace(
			buildSpan({
				traceId,
				spanId,
				name: "openai.chat.completions",
				serviceName: "ai-parity",
				startNano: agoNano(500),
				endNano: nowNano(),
				attributes: {
					"openinference.span.kind": "LLM",
					"llm.model_name": "gpt-4o-mini",
					"llm.provider": "openai",
					"ai.payload.input": "[]",
					"ai.payload.output": "{}",
				},
			}),
		);
		await new Promise((r) => setTimeout(r, 200));

		const postEval = await fetch(`${BASE}/v1/ai/evaluations`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				evaluations: [
					{
						traceId,
						spanId,
						name: "hallucination",
						score: 0.08,
						label: "grounded",
						explanation: "Answer is consistent with retrieved context.",
						source: "llm_judge",
					},
				],
			}),
		});
		expect(postEval.status).toBe(202);

		const list = await fetch(
			`${BASE}/internal/ai/evaluations?traceId=${traceId}`,
		);
		const body = (await list.json()) as {
			evaluations: Array<{
				name: string;
				score: number | null;
				label: string | null;
				source: string;
				spanId: string;
			}>;
		};
		const evalRow = body.evaluations.find((e) => e.spanId === spanId);
		expect(evalRow?.name).toBe("hallucination");
		expect(evalRow?.score).toBeCloseTo(0.08, 4);
		expect(evalRow?.label).toBe("grounded");
		expect(evalRow?.source).toBe("llm_judge");
	});

	it("6. Sessions group multiple traces under one session.id", async () => {
		const sessionId = `parity-session-${Date.now().toString(36)}`;
		const userId = "parity-user";

		// Emit three LLM spans across three DIFFERENT trace IDs — only the
		// session.id stamps them together. This is the Phoenix Sessions model.
		for (let i = 0; i < 3; i++) {
			const traceId = randomHex(16);
			const spanId = randomHex(8);
			await postTrace(
				buildSpan({
					traceId,
					spanId,
					name: `turn-${i}`,
					serviceName: "ai-parity",
					startNano: agoNano(500 - i * 100),
					endNano: agoNano(500 - i * 100 - 50),
					attributes: {
						"openinference.span.kind": "LLM",
						"llm.model_name": "gpt-4o-mini",
						"llm.provider": "openai",
						"llm.token_count.prompt": 10 + i,
						"llm.token_count.completion": 5 + i,
						"session.id": sessionId,
						"user.id": userId,
						"ai.payload.input": JSON.stringify([
							{ role: "user", content: `message ${i}` },
						]),
						"ai.payload.output": JSON.stringify({
							role: "assistant",
							content: `reply ${i}`,
						}),
					},
				}),
			);
		}
		await new Promise((r) => setTimeout(r, 400));

		const detail = await fetch(
			`${BASE}/internal/ai/sessions/${encodeURIComponent(sessionId)}`,
		);
		expect(detail.status).toBe(200);
		const body = (await detail.json()) as {
			sessionId: string;
			userId: string | null;
			spans: Array<{
				spanId: string;
				spanKind: string;
				inputJson: string | null;
			}>;
			summary: { spanCount: number; totalPromptTokens: number };
		};

		expect(body.sessionId).toBe(sessionId);
		expect(body.userId).toBe(userId);
		expect(body.summary.spanCount).toBe(3);
		expect(body.summary.totalPromptTokens).toBe(10 + 11 + 12);
		// Each turn's input must be rehydratable for the chat view.
		for (const span of body.spans) {
			expect(span.inputJson).toMatch(/message \d/);
		}
	});

	it("7. Summary endpoint reports by-kind breakdown (Phoenix-style)", async () => {
		const q = await fetch(`${BASE}/internal/ai/spans?hours=1`);
		const body = (await q.json()) as AISpansResponse;
		// After the tests above we should have at least LLM, TOOL, RETRIEVER
		// represented in the window.
		expect(body.summary.byKind.LLM).toBeGreaterThanOrEqual(1);
		expect(body.summary.byKind.RETRIEVER).toBeGreaterThanOrEqual(1);
		expect(body.summary.byKind.TOOL).toBeGreaterThanOrEqual(1);
	});
});
