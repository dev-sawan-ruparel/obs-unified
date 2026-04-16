import {
	createLogger,
	createRequestSpan,
	initObservability,
	runWithSpan,
	withChildSpan,
	trackAICall,
	flushLogs,
	flushAICalls
} from "@obs/telemetry-sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";

interface Env {
	OBS_COLLECTOR_URL: string;
	OBS_INGEST_KEY: string;
}

const app = new Hono<{ Bindings: Env }>();
const logger = createLogger("obs-demo-api");

// CORS for the web app
app.use("*", cors({ origin: "http://localhost:5173", credentials: true }));

app.use("*", async (c, next) => {
	// Initialize observability in one call
	initObservability({
		collectorUrl: c.env.OBS_COLLECTOR_URL,
		apiKey: c.env.OBS_INGEST_KEY,
		serviceName: "obs-demo-api",
	});
	await next();
});

// ── Telemetry span middleware ──
// Wraps every request in a span and exports to collector
app.use("*", async (c, next) => {
	const method = c.req.method;
	const path = new URL(c.req.url).pathname;
	const span = createRequestSpan("obs-demo-api", `${method} ${path}`);

	span.setAttribute("http.request.method", method);
	span.setAttribute("url.path", path);
	span.setAttribute("user_agent", c.req.header("User-Agent") || "unknown");

	const sessionId = c.req.header("X-Obs-Session-Id");
	if (sessionId) {
		span.setAttribute("app.session.id", sessionId);
	}

	try {
		await runWithSpan(span, () => next());
		span.setAttribute("http.response.status_code", c.res.status);
		if (c.res.status >= 400) {
			span.setStatus(2, `HTTP ${c.res.status}`);
		} else {
			span.setStatus(1);
		}
	} catch (error) {
		span.setStatus(2, error instanceof Error ? error.message : String(error));
		span.addEvent("exception", {
			"exception.type":
				error instanceof Error ? error.constructor.name : "Error",
			"exception.message":
				error instanceof Error ? error.message : String(error),
		});
		throw error;
	} finally {
		span.end();

		// Export span to collector (fire-and-forget)
		const collectorUrl = c.env.OBS_COLLECTOR_URL;
		if (collectorUrl) {
			const exportPayload = span.toOtlpExportRequest();
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
			};
			const apiKey = c.env.OBS_INGEST_KEY;
			if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

			try {
				await fetch(`${collectorUrl}/v1/traces`, {
					method: "POST",
					headers,
					body: JSON.stringify(exportPayload),
				});
			} catch (err) {
				logger.warn("Failed to export span", {
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}

		// Flush logs and AI calls to ensure dashboard accurately updates in mock setup
		try {
			await flushLogs();
			await flushAICalls();
		} catch {}
	}
});

// ── Demo routes ──

app.get("/api/health", (c) => {
	logger.info("Health check");
	return c.json({
		status: "ok",
		service: "obs-demo-api",
		timestamp: new Date().toISOString(),
	});
});

app.get("/api/items", async (c) => {
	logger.info("Listing items");

	const items = await withChildSpan("db.query.items", async (child) => {
		child.setAttribute("db.system", "mock");
		child.setAttribute("db.operation", "SELECT");
		// Simulate a database call
		await new Promise((resolve) => setTimeout(resolve, 15));
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
	logger.info("Getting item", { id });

	if (id > 3) {
		logger.warn("Item not found", { id });
		return c.json({ error: "Not found" }, 404);
	}

	const item = await withChildSpan("db.query.item", async (child) => {
		child.setAttribute("db.system", "mock");
		child.setAttribute("db.operation", "SELECT");
		child.setAttribute("item.id", id);
		await new Promise((resolve) => setTimeout(resolve, 10));
		return { id, name: `Widget ${id}`, price: 29.99 * id };
	});

	return c.json({ item });
});

app.post("/api/items", async (c) => {
	const body = await c.req.json();
	logger.info("Creating item", { name: body.name });

	const created = await withChildSpan("db.insert.item", async (child) => {
		child.setAttribute("db.system", "mock");
		child.setAttribute("db.operation", "INSERT");
		await new Promise((resolve) => setTimeout(resolve, 20));
		return {
			id: Math.floor(Math.random() * 1000),
			...body,
			createdAt: new Date().toISOString(),
		};
	});

	return c.json({ item: created }, 201);
});

// Intentionally slow endpoint to trigger latency issues
app.get("/api/slow", async (c) => {
	logger.warn("Slow endpoint called", { path: "/api/slow" });

	await withChildSpan("external.slow-service", async (child) => {
		child.setAttribute("peer.service", "slow-api.example.com");
		await new Promise((resolve) => setTimeout(resolve, 1500));
	});

	return c.json({ status: "eventually done" });
});

// Mock AI endpoint
app.post("/api/chat", async (c) => {
	logger.info("Processing AI Chat Request");
	
	const responseText = "This is a streaming mock response generated by a fake model.";
	
	trackAICall({
		modelName: "gpt-4",
		provider: "openai",
		callType: "chat",
		promptTokens: 42,
		completionTokens: 25,
		latencyMs: 450,
		totalCostUsd: 0.0015,
	});

	return c.json({ response: responseText });
});

// Intentionally broken endpoint to trigger error issues
app.get("/api/error", (c) => {
	logger.error("Intentional error endpoint");
	return c.json({ error: "Something went wrong" }, 500);
});

export default app;
