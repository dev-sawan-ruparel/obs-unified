/**
 * Consolidated demo Worker.
 *
 * Exposes:
 *   - /api/health, /api/items, /api/items/:id, /api/chat (legacy)
 *   - /api/slow, /api/error (legacy, for dashboard error panel)
 *   - /api/demo/chat        → fan out one prompt across all available LLM providers
 *   - /api/demo/rag         → RETRIEVER → LLM + evaluation
 *   - /api/demo/tool        → TOOL → LLM + evaluation
 *   - /api/demo/session     → multi-turn session with session.id stamping
 *   - /api/demo/run-all     → runs every demo scenario back-to-back
 *
 * The demo endpoints use OpenInference-typed spans via @obs-unified/telemetry-sdk,
 * so everything shows up in the dashboard's AI tab under service "obs-demo".
 */

import {
	createLogger,
	createRequestSpan,
	flushAICalls,
	flushLogs,
	getActiveSpan,
	initObservability,
	runWithSpan,
	setAISessionContext,
	stampInteractionFromRequest,
	startRetrieverSpan,
	startToolSpan,
	withChildSpan,
} from "@obs-unified/telemetry-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
	ask,
	availableProviders,
	type Message,
} from "./providers.js";

interface Env {
	OBS_COLLECTOR_URL: string;
	OBS_INGEST_KEY: string;
	OPENAI_API_KEY?: string;
	ANTHROPIC_API_KEY?: string;
	GOOGLE_API_KEY?: string;
	OPENAI_MODEL?: string;
	ANTHROPIC_MODEL?: string;
	GEMINI_MODEL?: string;
}

const app = new Hono<{ Bindings: Env }>();
const logger = createLogger("obs-demo");

// CORS for local dashboard. allowHeaders explicitly enumerates the obs
// session + interaction headers so the browser doesn't strip them via
// preflight (custom non-safelisted request headers need explicit allow).
app.use(
	"*",
	cors({
		origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
		credentials: true,
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"X-Obs-Session-Id",
			"x-obs-interaction",
		],
	}),
);

// Init observability once per request
app.use("*", async (c, next) => {
	initObservability({
		collectorUrl: c.env.OBS_COLLECTOR_URL,
		apiKey: c.env.OBS_INGEST_KEY,
		serviceName: "obs-demo",
	});
	await next();
});

// Root span middleware: every request gets a span, exported on exit.
// RFC 0004 — pulls `x-obs-interaction` from the inbound request and
// stamps it on the span so the rail's "Trace caused by this click"
// pivot works end-to-end. No-op when the header is absent or invalid.
app.use("*", async (c, next) => {
	const method = c.req.method;
	const path = new URL(c.req.url).pathname;
	const span = createRequestSpan("obs-demo", `${method} ${path}`);

	span.setAttribute("http.request.method", method);
	span.setAttribute("url.path", path);
	stampInteractionFromRequest(span, c.req.raw);

	// Surface the session id from the dashboard's analytics provider too.
	// Same rationale: the rail's Replay → Trace link needs session_id on
	// the span to join across signals.
	const sessionId = c.req.header("x-obs-session-id");
	if (sessionId) span.setAttribute("session.id", sessionId);

	try {
		await runWithSpan(span, () => next());
		span.setAttribute("http.response.status_code", c.res.status);
		span.setStatus(c.res.status >= 400 ? 2 : 1);
	} catch (err) {
		span.setStatus(2, err instanceof Error ? err.message : String(err));
		throw err;
	} finally {
		span.end();
		await exportSpan(c.env, span);
		await Promise.all([flushLogs(), flushAICalls()]).catch(() => {});
	}
});

async function exportSpan(env: Env, span: ReturnType<typeof createRequestSpan>) {
	if (!env.OBS_COLLECTOR_URL) return;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (env.OBS_INGEST_KEY) headers["Authorization"] = `Bearer ${env.OBS_INGEST_KEY}`;
	try {
		await fetch(`${env.OBS_COLLECTOR_URL}/v1/traces`, {
			method: "POST",
			headers,
			body: JSON.stringify(span.toOtlpExportRequest()),
		});
	} catch (err) {
		console.warn("[obs-demo] failed to export span:", err);
	}
}

async function postEvaluation(
	env: Env,
	opts: {
		traceId: string;
		spanId: string;
		name: string;
		score?: number;
		label?: string;
		explanation?: string;
		source: "llm_judge" | "code" | "human" | "user";
	},
): Promise<void> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};
	if (env.OBS_INGEST_KEY) headers["Authorization"] = `Bearer ${env.OBS_INGEST_KEY}`;
	try {
		await fetch(`${env.OBS_COLLECTOR_URL}/v1/ai/evaluations`, {
			method: "POST",
			headers,
			body: JSON.stringify({ evaluations: [opts] }),
		});
	} catch (err) {
		console.warn("[obs-demo] failed to post evaluation:", err);
	}
}

// ── Legacy demo routes (preserved from apps/api) ──────────────────────────

app.get("/api/health", (c) => {
	logger.info("Health check");
	return c.json({
		status: "ok",
		service: "obs-demo",
		timestamp: new Date().toISOString(),
		providers: availableProviders(c.env),
	});
});

app.get("/api/items", async (c) => {
	logger.info("Listing items");
	const items = await withChildSpan("db.query.items", async (child) => {
		child.setAttribute("db.system", "mock");
		child.setAttribute("db.operation", "SELECT");
		await new Promise((r) => setTimeout(r, 15));
		return [
			{ id: 1, name: "Widget A", price: 29.99 },
			{ id: 2, name: "Widget B", price: 49.99 },
			{ id: 3, name: "Gadget X", price: 99.99 },
		];
	});
	return c.json({ items, count: items.length });
});

app.get("/api/items/:id", async (c) => {
	const id = Number(c.req.param("id"));
	if (id > 3) {
		logger.warn("Item not found", { id });
		return c.json({ error: "Not found" }, 404);
	}
	const item = await withChildSpan("db.query.item", async (child) => {
		child.setAttribute("db.operation", "SELECT");
		await new Promise((r) => setTimeout(r, 10));
		return { id, name: `Widget ${id}`, price: 29.99 * id };
	});
	return c.json({ item });
});

app.get("/api/slow", async (c) => {
	logger.warn("Slow endpoint");
	await withChildSpan("external.slow-service", async (child) => {
		child.setAttribute("peer.service", "slow-api.example.com");
		await new Promise((r) => setTimeout(r, 1500));
	});
	return c.json({ status: "eventually done" });
});

app.get("/api/error", (c) => {
	logger.error("Intentional error");
	return c.json({ error: "Something went wrong" }, 500);
});

// ── AI demo routes ─────────────────────────────────────────────────────────

function requireProviders(c: any) {
	const providers = availableProviders(c.env);
	if (providers.length === 0) {
		return c.json(
			{
				error:
					"No LLM keys set. Add OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY to apps/obs-demo/.dev.vars",
			},
			400,
		);
	}
	return null;
}

/**
 * Fan one prompt across every available provider.
 * GET /api/demo/chat
 */
app.get("/api/demo/chat", async (c) => {
	const err = requireProviders(c);
	if (err) return err;

	const active = availableProviders(c.env);
	const messages: Message[] = [
		{ role: "system", content: "You answer in one word." },
		{ role: "user", content: "Name one planet in the solar system." },
	];

	const results: Array<{ provider: string; model: string; text: string }> = [];
	for (const provider of active) {
		try {
			const res = await ask(c.env, provider, messages);
			results.push({ provider: res.provider, model: res.model, text: res.text });
			await postEvaluation(c.env, {
				traceId: getCurrentTraceId(),
				spanId: res.spanId,
				name: "answer_length_ok",
				score: res.text.trim().length > 0 && res.text.length < 40 ? 1 : 0,
				label: res.text.length < 40 ? "pass" : "fail",
				source: "code",
			});
		} catch (e) {
			logger.error(`Provider ${provider} failed`, {
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}
	return c.json({ results });
});

/**
 * Retriever + LLM (mini RAG loop).
 * GET /api/demo/rag
 */
app.get("/api/demo/rag", async (c) => {
	const err = requireProviders(c);
	if (err) return err;

	const question = "What's the capital of France?";
	const retriever = startRetrieverSpan({
		query: question,
		name: "knowledge_base.search",
	});
	retriever.addDocuments([
		{
			id: "doc_001",
			score: 0.92,
			content: "Paris is the capital and most populous city of France.",
		},
		{
			id: "doc_042",
			score: 0.71,
			content: "France is a country in Western Europe.",
		},
	]);
	retriever.end();

	const messages: Message[] = [
		{
			role: "system",
			content:
				"Answer concisely using only the provided context. Context: Paris is the capital of France.",
		},
		{ role: "user", content: question },
	];
	const provider = availableProviders(c.env)[0]!;
	const res = await ask(c.env, provider, messages);

	const passed = /paris/i.test(res.text);
	await postEvaluation(c.env, {
		traceId: getCurrentTraceId(),
		spanId: res.spanId,
		name: "rag_faithfulness",
		score: passed ? 1 : 0,
		label: passed ? "faithful" : "unfaithful",
		source: "code",
		explanation: passed
			? "Answer mentions retrieved fact"
			: "Answer did not surface retrieval",
	});

	return c.json({ question, answer: res.text, model: res.model });
});

/**
 * Tool call + LLM summary.
 * GET /api/demo/tool
 */
app.get("/api/demo/tool", async (c) => {
	const err = requireProviders(c);
	if (err) return err;

	const city = "Tokyo";
	const tool = startToolSpan({
		name: "get_weather",
		parameters: { city },
		description: "Current weather for a given city",
	});
	await new Promise((r) => setTimeout(r, 120));
	const weather = { city, tempC: 18, condition: "partly cloudy", humidity: 63 };
	tool.setOutput(weather);
	tool.end();

	const provider = availableProviders(c.env)[0]!;
	const res = await ask(c.env, provider, [
		{ role: "system", content: "Summarize weather data in one friendly sentence." },
		{
			role: "user",
			content: `Weather JSON: ${JSON.stringify(weather)}. Summarize.`,
		},
	]);

	await postEvaluation(c.env, {
		traceId: getCurrentTraceId(),
		spanId: res.spanId,
		name: "mentions_temperature",
		score: /\d/.test(res.text) ? 1 : 0,
		source: "code",
	});

	return c.json({ weather, summary: res.text });
});

/**
 * Multi-turn session — all turns share one session.id + user.id so they
 * appear as a single conversation in the Sessions tab.
 * GET /api/demo/session
 */
app.get("/api/demo/session", async (c) => {
	const err = requireProviders(c);
	if (err) return err;

	const sessionId = `session-${Date.now().toString(36)}`;
	const resetCtx = setAISessionContext({
		sessionId,
		userId: "demo-user-1",
	});

	try {
		const messages: Message[] = [
			{ role: "system", content: "You are a travel concierge. Keep replies short." },
		];
		const turns = [
			"I'm planning a weekend in Lisbon. What should I do?",
			"Which of those is best on a rainy day?",
			"Budget-friendly dinner near the rainy-day option?",
		];

		const provider = availableProviders(c.env)[0]!;
		const replies: string[] = [];
		for (const turn of turns) {
			messages.push({ role: "user", content: turn });
			const res = await ask(c.env, provider, messages);
			messages.push({ role: "assistant", content: res.text });
			replies.push(res.text);
			await postEvaluation(c.env, {
				traceId: getCurrentTraceId(),
				spanId: res.spanId,
				name: "non_empty",
				score: res.text.trim().length > 0 ? 1 : 0,
				source: "code",
			});
		}

		return c.json({ sessionId, turns, replies });
	} finally {
		resetCtx();
	}
});

/**
 * One endpoint to trigger all scenarios back-to-back — convenient for a
 * "run demo" button in the dashboard or a quick smoke test.
 * GET /api/demo/run-all
 */
app.get("/api/demo/run-all", async (c) => {
	const err = requireProviders(c);
	if (err) return err;

	const providers = availableProviders(c.env);
	const summary: Record<string, unknown> = { providers };

	// Chat fan-out
	try {
		const chatRes = await Promise.all(
			providers.map((p) =>
				ask(c.env, p, [
					{ role: "system", content: "Answer in one word." },
					{ role: "user", content: "Name one planet." },
				]).catch((e) => ({ error: String(e) })),
			),
		);
		summary.chat = chatRes;
	} catch (e) {
		summary.chat = { error: String(e) };
	}

	// RAG
	try {
		const retriever = startRetrieverSpan({
			query: "capital of France",
			name: "knowledge_base.search",
		});
		retriever.addDocuments([
			{ id: "d1", score: 0.9, content: "Paris is the capital of France." },
		]);
		retriever.end();
		const rag = await ask(c.env, providers[0]!, [
			{
				role: "system",
				content: "Use context: Paris is the capital of France.",
			},
			{ role: "user", content: "What's the capital of France?" },
		]);
		summary.rag = rag.text;
	} catch (e) {
		summary.rag = { error: String(e) };
	}

	// Tool
	try {
		const tool = startToolSpan({
			name: "get_weather",
			parameters: { city: "Tokyo" },
		});
		tool.setOutput({ city: "Tokyo", tempC: 18 });
		tool.end();
		const weather = await ask(c.env, providers[0]!, [
			{ role: "user", content: "Weather: Tokyo 18C. One line." },
		]);
		summary.tool = weather.text;
	} catch (e) {
		summary.tool = { error: String(e) };
	}

	// Session
	try {
		const sessionId = `session-${Date.now().toString(36)}`;
		const reset = setAISessionContext({ sessionId, userId: "demo-user" });
		const msgs: Message[] = [
			{ role: "system", content: "Keep replies under 12 words." },
		];
		for (const q of [
			"Capital of Japan?",
			"Population of that city roughly?",
			"One famous landmark there?",
		]) {
			msgs.push({ role: "user", content: q });
			const r = await ask(c.env, providers[0]!, msgs);
			msgs.push({ role: "assistant", content: r.text });
		}
		reset();
		summary.session = sessionId;
	} catch (e) {
		summary.session = { error: String(e) };
	}

	return c.json({ ok: true, summary });
});

// ── Legacy mock AI route kept for backwards-compat tests ──────────────────

app.post("/api/chat", async (c) => {
	logger.info("Processing AI chat (mock)");
	return c.json({ response: "This is a mock response." });
});

// Read active trace id from the AsyncLocalStorage-backed request span
function getCurrentTraceId(): string {
	return getActiveSpan()?.traceId ?? "";
}

export default app;
