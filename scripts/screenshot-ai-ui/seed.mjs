// Seed the throwaway collector with a representative AI corpus:
//   - 3 LLM spans across providers and models (incl. one errored)
//   - 1 RETRIEVER + 1 LLM linked in the same trace (RAG)
//   - 1 TOOL + 1 LLM linked in the same trace (agent-ish)
//   - 1 multi-turn session: 3 LLM spans stamped with the same session.id
//   - Evaluations attached to most LLM spans
//
// Usage: node seed.mjs <collector-base-url>

const BASE = process.argv[2];
if (!BASE) {
	console.error("usage: node seed.mjs <collector-url>");
	process.exit(1);
}

const hex = (bytes) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

const _nowNs = () => String(BigInt(Date.now()) * 1_000_000n);
const agoNs = (ms) => String(BigInt(Date.now() - ms) * 1_000_000n);

const kv = (k, v) => {
	if (typeof v === "string") return { key: k, value: { stringValue: v } };
	if (typeof v === "boolean") return { key: k, value: { boolValue: v } };
	if (typeof v === "number")
		return Number.isInteger(v)
			? { key: k, value: { intValue: v } }
			: { key: k, value: { doubleValue: v } };
	return { key: k, value: { stringValue: String(v) } };
};

const postSpans = async (spans) => {
	const body = {
		resourceSpans: [
			{
				resource: { attributes: [kv("service.name", "obs-demo")] },
				scopeSpans: [
					{
						scope: { name: "obs-demo" },
						spans,
					},
				],
			},
		],
	};
	const res = await fetch(`${BASE}/v1/traces`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok)
		throw new Error(`trace post failed: ${res.status} ${await res.text()}`);
};

const postEval = async (opts) => {
	const res = await fetch(`${BASE}/v1/ai/evaluations`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ evaluations: [opts] }),
	});
	if (!res.ok)
		throw new Error(`eval post failed: ${res.status} ${await res.text()}`);
};

const mkSpan = ({
	traceId,
	spanId,
	parentSpanId,
	name,
	startMsAgo,
	durationMs,
	attrs,
	status = 1,
	statusMessage,
}) => ({
	traceId,
	spanId,
	parentSpanId,
	name,
	kind: 2,
	startTimeUnixNano: agoNs(startMsAgo),
	endTimeUnixNano: agoNs(startMsAgo - durationMs),
	attributes: Object.entries(attrs).map(([k, v]) => kv(k, v)),
	status: statusMessage
		? { code: status, message: statusMessage }
		: { code: status },
});

async function main() {
	console.log(`seeding → ${BASE}`);

	// ── 1. LLM fan-out across providers ────────────────────────────────────
	const fanoutTrace = hex(16);
	const rootFanoutSpanId = hex(8);
	const fanoutSpans = [
		mkSpan({
			traceId: fanoutTrace,
			spanId: rootFanoutSpanId,
			name: "GET /api/demo/chat",
			startMsAgo: 2000,
			durationMs: 1800,
			attrs: {
				"http.request.method": "GET",
				"url.path": "/api/demo/chat",
			},
		}),
	];

	const providers = [
		{ model: "gpt-4o-mini", provider: "openai", pt: 14, ct: 3 },
		{ model: "claude-3-5-haiku", provider: "anthropic", pt: 16, ct: 2 },
		{ model: "gemini-1.5-flash", provider: "google", pt: 15, ct: 4 },
	];

	const llmSpanIds = [];
	for (let i = 0; i < providers.length; i++) {
		const p = providers[i];
		const spanId = hex(8);
		llmSpanIds.push({ spanId, p });
		const input = [
			{ role: "system", content: "You answer in one word." },
			{ role: "user", content: "Name one planet in the solar system." },
		];
		const output = {
			role: "assistant",
			content:
				p.provider === "openai"
					? "Mars."
					: p.provider === "anthropic"
						? "Venus."
						: "Jupiter.",
		};
		fanoutSpans.push(
			mkSpan({
				traceId: fanoutTrace,
				spanId,
				parentSpanId: rootFanoutSpanId,
				name: `${p.provider}.chat.completions`,
				startMsAgo: 1900 - i * 50,
				durationMs: 900 + i * 120,
				attrs: {
					"openinference.span.kind": "LLM",
					"llm.model_name": p.model,
					"llm.provider": p.provider,
					"llm.token_count.prompt": p.pt,
					"llm.token_count.completion": p.ct,
					"llm.token_count.total": p.pt + p.ct,
					"ai.payload.input": JSON.stringify(input),
					"ai.payload.output": JSON.stringify(output),
				},
			}),
		);
	}
	await postSpans(fanoutSpans);
	for (const { spanId } of llmSpanIds) {
		await postEval({
			traceId: fanoutTrace,
			spanId,
			name: "answer_length_ok",
			score: 1,
			label: "pass",
			source: "code",
			explanation: "Answer is a single word",
		});
	}

	// ── 2. RAG: RETRIEVER → LLM ───────────────────────────────────────────
	const ragTrace = hex(16);
	const ragRoot = hex(8);
	const ragRetriever = hex(8);
	const ragLLM = hex(8);
	const ragSpans = [
		mkSpan({
			traceId: ragTrace,
			spanId: ragRoot,
			name: "GET /api/demo/rag",
			startMsAgo: 5000,
			durationMs: 1400,
			attrs: { "http.request.method": "GET", "url.path": "/api/demo/rag" },
		}),
		mkSpan({
			traceId: ragTrace,
			spanId: ragRetriever,
			parentSpanId: ragRoot,
			name: "knowledge_base.search",
			startMsAgo: 4900,
			durationMs: 180,
			attrs: {
				"openinference.span.kind": "RETRIEVER",
				"retrieval.query": "What's the capital of France?",
				"retrieval.documents.count": 2,
				"retrieval.documents.0.document.id": "doc_001",
				"retrieval.documents.0.document.score": 0.92,
				"retrieval.documents.0.document.content":
					"Paris is the capital and most populous city of France.",
				"retrieval.documents.1.document.id": "doc_042",
				"retrieval.documents.1.document.score": 0.71,
				"retrieval.documents.1.document.content":
					"France is a country in Western Europe bordered by Belgium, Germany, Switzerland, Italy, and Spain.",
				"ai.payload.output": JSON.stringify([
					{ id: "doc_001", score: 0.92, content: "Paris is the capital…" },
					{ id: "doc_042", score: 0.71, content: "France is a country…" },
				]),
			},
		}),
		mkSpan({
			traceId: ragTrace,
			spanId: ragLLM,
			parentSpanId: ragRoot,
			name: "openai.chat.completions",
			startMsAgo: 4700,
			durationMs: 1100,
			attrs: {
				"openinference.span.kind": "LLM",
				"llm.model_name": "gpt-4o-mini",
				"llm.provider": "openai",
				"llm.token_count.prompt": 85,
				"llm.token_count.completion": 6,
				"llm.token_count.total": 91,
				"ai.payload.input": JSON.stringify([
					{
						role: "system",
						content:
							"Answer concisely using only the provided context. Context: Paris is the capital of France.",
					},
					{ role: "user", content: "What's the capital of France?" },
				]),
				"ai.payload.output": JSON.stringify({
					role: "assistant",
					content: "Paris.",
				}),
			},
		}),
	];
	await postSpans(ragSpans);
	await postEval({
		traceId: ragTrace,
		spanId: ragLLM,
		name: "rag_faithfulness",
		score: 1,
		label: "faithful",
		source: "code",
		explanation: "Answer mentions 'Paris' from the retrieved context.",
	});
	await postEval({
		traceId: ragTrace,
		spanId: ragLLM,
		name: "hallucination",
		score: 0.05,
		label: "grounded",
		source: "llm_judge",
		explanation: "Model output is consistent with retrieved documents.",
	});

	// ── 3. Agent-ish: TOOL → LLM ──────────────────────────────────────────
	const toolTrace = hex(16);
	const toolRoot = hex(8);
	const toolCall = hex(8);
	const toolLLM = hex(8);
	const toolSpans = [
		mkSpan({
			traceId: toolTrace,
			spanId: toolRoot,
			name: "GET /api/demo/tool",
			startMsAgo: 8000,
			durationMs: 1300,
			attrs: { "http.request.method": "GET", "url.path": "/api/demo/tool" },
		}),
		mkSpan({
			traceId: toolTrace,
			spanId: toolCall,
			parentSpanId: toolRoot,
			name: "get_weather",
			startMsAgo: 7900,
			durationMs: 120,
			attrs: {
				"openinference.span.kind": "TOOL",
				"tool.name": "get_weather",
				"tool.description": "Current weather for a given city",
				"ai.payload.input": JSON.stringify({ city: "Tokyo" }),
				"ai.payload.output": JSON.stringify({
					city: "Tokyo",
					tempC: 18,
					condition: "partly cloudy",
					humidity: 63,
				}),
			},
		}),
		mkSpan({
			traceId: toolTrace,
			spanId: toolLLM,
			parentSpanId: toolRoot,
			name: "openai.chat.completions",
			startMsAgo: 7750,
			durationMs: 1100,
			attrs: {
				"openinference.span.kind": "LLM",
				"llm.model_name": "gpt-4o-mini",
				"llm.provider": "openai",
				"llm.token_count.prompt": 72,
				"llm.token_count.completion": 22,
				"ai.payload.input": JSON.stringify([
					{
						role: "system",
						content: "Summarize weather data in one friendly sentence.",
					},
					{
						role: "user",
						content:
							'Weather JSON: {"city":"Tokyo","tempC":18,"condition":"partly cloudy","humidity":63}. Summarize.',
					},
				]),
				"ai.payload.output": JSON.stringify({
					role: "assistant",
					content:
						"Tokyo is a pleasant 18°C with partly cloudy skies and moderate humidity — a comfortable day.",
				}),
			},
		}),
	];
	await postSpans(toolSpans);
	await postEval({
		traceId: toolTrace,
		spanId: toolLLM,
		name: "mentions_temperature",
		score: 1,
		source: "code",
	});

	// ── 4. Multi-turn session (same session.id across traces) ─────────────
	const sessionId = `travel-${Date.now().toString(36)}`;
	const userId = "demo-user-1";
	const turns = [
		{
			user: "I'm planning a weekend in Lisbon. What should I do?",
			assistant:
				"Walk the Alfama district, ride Tram 28, catch sunset at Miradouro da Senhora do Monte, and try a pastel de nata at Manteigaria.",
		},
		{
			user: "Which of those is best on a rainy day?",
			assistant:
				"Visit the Gulbenkian Museum or wander the indoor Ribeira Market — both stay dry and close to dinner spots.",
		},
		{
			user: "Budget-friendly dinner near the Ribeira Market?",
			assistant:
				"Time Out Market next door has lots of sub-€12 options from top chefs, or Cervejaria Ramiro if you want classic Portuguese seafood.",
		},
	];
	for (let i = 0; i < turns.length; i++) {
		const t = turns[i];
		const traceId = hex(16);
		const rootId = hex(8);
		const llmId = hex(8);
		const pt = 40 + i * 20;
		const ct = (t.assistant.length / 4) | 0;
		await postSpans([
			mkSpan({
				traceId,
				spanId: rootId,
				name: `GET /api/demo/session (turn ${i + 1})`,
				startMsAgo: 30000 - i * 4000,
				durationMs: 1500,
				attrs: {
					"http.request.method": "GET",
					"url.path": "/api/demo/session",
					"session.id": sessionId,
					"user.id": userId,
				},
			}),
			mkSpan({
				traceId,
				spanId: llmId,
				parentSpanId: rootId,
				name: "openai.chat.completions",
				startMsAgo: 29900 - i * 4000,
				durationMs: 1300,
				attrs: {
					"openinference.span.kind": "LLM",
					"llm.model_name": "gpt-4o-mini",
					"llm.provider": "openai",
					"llm.token_count.prompt": pt,
					"llm.token_count.completion": ct,
					"llm.token_count.total": pt + ct,
					"session.id": sessionId,
					"user.id": userId,
					"ai.payload.input": JSON.stringify([
						{
							role: "system",
							content: "You are a travel concierge. Keep replies short.",
						},
						...turns.slice(0, i).flatMap((prev) => [
							{ role: "user", content: prev.user },
							{ role: "assistant", content: prev.assistant },
						]),
						{ role: "user", content: t.user },
					]),
					"ai.payload.output": JSON.stringify({
						role: "assistant",
						content: t.assistant,
					}),
				},
			}),
		]);
		await postEval({
			traceId,
			spanId: llmId,
			name: "non_empty",
			score: 1,
			source: "code",
		});
	}

	// ── 5. One errored LLM span (shows the red detail pane) ───────────────
	const errTrace = hex(16);
	const errSpan = hex(8);
	await postSpans([
		mkSpan({
			traceId: errTrace,
			spanId: errSpan,
			name: "openai.chat.completions",
			startMsAgo: 15000,
			durationMs: 320,
			status: 2,
			statusMessage: "OpenAI 429: Rate limit exceeded",
			attrs: {
				"openinference.span.kind": "LLM",
				"llm.model_name": "gpt-4o-mini",
				"llm.provider": "openai",
				"ai.payload.input": JSON.stringify([
					{ role: "user", content: "a very long request…" },
				]),
			},
		}),
	]);

	console.log(`seeded: 3 fan-out LLM + RAG + agent + 3-turn session + 1 error`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
