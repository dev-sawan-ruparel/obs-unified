#!/usr/bin/env node
/**
 * Seed every dashboard tab with demo data so you can see the UI work
 * end-to-end without manually clicking through the Playground.
 *
 * What it touches:
 *   - Demo workload (apps/obs-demo)  — generates spans / logs / AI calls
 *   - Collector ingest /v1/usage     — fakes browser sessions for Usage tab
 *   - Collector dashboard /internal  — creates alert rules + a kept replay
 *
 * What it can't seed:
 *   - Session replays (rrweb chunks) — captured only in a real browser.
 *     Visit the Playground tab and click "Start replay" once.
 *
 * Usage:
 *   node scripts/seed-everything/run.mjs
 *   node scripts/seed-everything/run.mjs --collector http://localhost:8790 \
 *                                        --demo http://localhost:8787 \
 *                                        --password e2e-test-pass \
 *                                        --rounds 8
 */

import process from "node:process";

// ── args ────────────────────────────────────────────────────────────

function arg(name, fallback) {
	const idx = process.argv.indexOf(`--${name}`);
	if (idx === -1) return fallback;
	return process.argv[idx + 1] ?? fallback;
}

const COLLECTOR = arg("collector", "http://localhost:8790");
const DEMO = arg("demo", "http://localhost:8787");
const PASSWORD = arg(
	"password",
	process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass",
);
const PROJECT_KEY = arg(
	"key",
	process.env.OBS_INGEST_KEY ??
		"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504",
);
const ROUNDS = Number.parseInt(arg("rounds", "6"), 10);

// ── pretty logging ──────────────────────────────────────────────────

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const warn = (s) => `\x1b[33m${s}\x1b[0m`;
const err = (s) => `\x1b[31m${s}\x1b[0m`;

const step = async (label, fn) => {
	process.stdout.write(`  ${label.padEnd(38)} `);
	try {
		const result = await fn();
		// Result can be a plain string or a richer object that exposes a
		// `.summary` field for display while passing other data through.
		const display =
			typeof result === "string"
				? result
				: result && typeof result === "object" && "summary" in result
					? result.summary
					: "";
		console.log(ok("✓"), display ? dim(`(${display})`) : "");
		return result;
	} catch (e) {
		console.log(err(`✗ ${e.message}`));
		return null;
	}
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helpers ─────────────────────────────────────────────────────────

const callDemo = async (path) => {
	const res = await fetch(`${DEMO}${path}`);
	if (!res.ok && res.status !== 404 && res.status !== 500) {
		throw new Error(`${path} → ${res.status}`);
	}
	return `${path} → ${res.status}`;
};

const dashboardLogin = async () => {
	const res = await fetch(`${COLLECTOR}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: PASSWORD }),
		redirect: "manual",
	});
	if (!res.ok && res.status !== 302) {
		throw new Error(`login → ${res.status}`);
	}
	const setCookie = res.headers.get("set-cookie") ?? "";
	const m = setCookie.match(/obs_session=[^;]+/);
	if (!m) throw new Error("no session cookie returned");
	return m[0];
};

const dashFetch = async (cookie, path, init = {}) => {
	const headers = new Headers(init.headers ?? {});
	headers.set("Cookie", cookie);
	headers.set("X-Project-Id", "default");
	if (init.body && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}
	const res = await fetch(`${COLLECTOR}${path}`, { ...init, headers });
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`${path} → ${res.status}: ${text.slice(0, 80)}`);
	}
	return res.json().catch(() => ({}));
};

// ── usage events (Usage / Sessions / Timeline tabs) ─────────────────

/**
 * Seed usage. Returns the session windows so spans + logs can later be
 * stamped with the same session.id (and time-aligned) so the Timeline tab
 * shows a real cross-signal join.
 *
 * @returns {Promise<{ inserted: number, sessions: Array<{
 *   sessionId: string;
 *   visitorId: string;
 *   startMs: number;
 *   endMs: number;
 * }> }>}
 */
const seedUsage = async () => {
	const sessions = 4;
	const eventsPerSession = 12;
	const visitorBase = `seed-${Date.now().toString(36)}`;
	const events = [];
	const now = Date.now();
	const sessionWindows = [];

	for (let s = 0; s < sessions; s++) {
		const sessionId = `${visitorBase}-s${s}`;
		const visitorId = `${visitorBase}-v${s}`;
		const startTs = now - (sessions - s) * 5 * 60_000;
		const eventDurationMs = (eventsPerSession - 1) * 7_000;
		sessionWindows.push({
			sessionId,
			visitorId,
			startMs: startTs,
			endMs: startTs + eventDurationMs,
		});
		const paths = ["/", "/dashboard", "/dashboard/traces", "/dashboard/logs"];

		for (let i = 0; i < eventsPerSession; i++) {
			const ts = startTs + i * 7_000;
			const path = paths[i % paths.length];
			const isLast = i === eventsPerSession - 1;

			// page view
			events.push({
				type: i % 3 === 0 ? "page_view" : "interaction",
				name: i % 3 === 0 ? "page_view" : `click_${i}`,
				sessionId,
				visitorId,
				occurredAt: new Date(ts).toISOString(),
				pagePath: path,
				properties: {
					seed: true,
					action: i % 3 === 0 ? "navigate" : "click",
					target: `nav-${i}`,
				},
				context: {
					url: `http://localhost:5173${path}`,
					userAgent:
						"Mozilla/5.0 (seed) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
					referrer: i === 0 ? "https://example.com" : "",
					title: "obs-unified",
				},
			});

			// occasional error event in last session
			if (s === sessions - 1 && isLast) {
				events.push({
					type: "error",
					name: "UncaughtError",
					sessionId,
					visitorId,
					occurredAt: new Date(ts + 100).toISOString(),
					pagePath: path,
					severity: "error",
					properties: {
						errorName: "TypeError",
						errorMessage: "Cannot read properties of undefined (reading 'map')",
						component: "ProjectsDashboard",
					},
				});
			}
		}
	}

	// Chunk to <=200 events per request
	const CHUNK = 150;
	let inserted = 0;
	for (let i = 0; i < events.length; i += CHUNK) {
		const slice = events.slice(i, i + CHUNK);
		const res = await fetch(`${COLLECTOR}/v1/usage`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${PROJECT_KEY}`,
				"X-Project-Id": "default",
			},
			body: JSON.stringify({ events: slice }),
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(`/v1/usage → ${res.status}: ${text.slice(0, 80)}`);
		}
		const data = await res.json().catch(() => ({}));
		inserted += data.inserted ?? slice.length;
	}
	return {
		summary: `${inserted} events across ${sessionWindows.length} sessions`,
		sessions: sessionWindows,
	};
};

// ── alerts ──────────────────────────────────────────────────────────

const seedAlerts = async (cookie) => {
	const rules = [
		{
			name: "Spike in span errors",
			signal: "spans",
			query: { statusCode: "error" },
			threshold: 5,
			windowMins: 5,
			comparison: ">=",
			channels: [
				{ type: "webhook", url: "https://hooks.example.com/spans-errors" },
			],
			enabled: true,
		},
		{
			name: "Frontend uncaught errors",
			signal: "usage",
			query: { eventName: "UncaughtError" },
			threshold: 1,
			windowMins: 10,
			comparison: ">=",
			channels: [
				{ type: "webhook", url: "https://hooks.example.com/usage-errors" },
			],
			enabled: true,
		},
		{
			name: "Slow checkout p95 (paused)",
			signal: "spans",
			query: { spanName: "POST /checkout" },
			threshold: 800,
			windowMins: 15,
			comparison: ">",
			channels: [
				{ type: "webhook", url: "https://hooks.example.com/checkout-slow" },
			],
			enabled: false,
		},
	];

	let created = 0;
	for (const rule of rules) {
		try {
			await dashFetch(cookie, "/internal/alerts/rules", {
				method: "POST",
				body: JSON.stringify(rule),
			});
			created++;
		} catch (e) {
			// ignore duplicates from re-runs
			if (!String(e.message).includes("409")) throw e;
		}
	}
	return `${created} rules`;
};

// ── OTLP helpers (write spans/logs/AI directly to the dashboard's
//    collector — bypassing the demo workload, which is wired to a
//    different test collector) ─────────────────────────────────────

const hex = (bytes) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

const nowNs = () => String(BigInt(Date.now()) * 1_000_000n);
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

const ingestPost = async (path, body) => {
	const res = await fetch(`${COLLECTOR}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${PROJECT_KEY}`,
			"X-Project-Id": "default",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`${path} → ${res.status}: ${text.slice(0, 80)}`);
	}
	return res.json().catch(() => ({}));
};

// ── traces (Traces, Service Map, Issues) ────────────────────────────

const seedTraces = async (sessionWindows = []) => {
	const services = ["obs-demo", "checkout-api", "payments-worker", "edge"];
	const routes = [
		{ name: "GET /api/items", durMin: 30, durMax: 90, errorRate: 0 },
		{ name: "GET /api/items/:id", durMin: 20, durMax: 70, errorRate: 0.05 },
		{ name: "GET /api/health", durMin: 5, durMax: 15, errorRate: 0 },
		{ name: "GET /api/slow", durMin: 800, durMax: 1500, errorRate: 0 },
		{ name: "POST /api/checkout", durMin: 250, durMax: 600, errorRate: 0.1 },
		{ name: "GET /api/error", durMin: 30, durMax: 90, errorRate: 1 },
		{ name: "GET /api/items/999", durMin: 30, durMax: 50, errorRate: 1 },
	];

	const allSpans = [];
	const totalRounds = ROUNDS * 4;
	let sessionStamped = 0;

	for (let r = 0; r < totalRounds; r++) {
		const svc = services[r % services.length];
		const route = routes[r % routes.length];
		const traceId = hex(16);
		const rootSpanId = hex(8);

		// 60% of spans are stamped with a session.id so Timeline shows a real
		// cross-signal join. Pick a session round-robin and place the span
		// somewhere inside its time window.
		const inSession =
			sessionWindows.length > 0 && r % 5 < 3
				? sessionWindows[r % sessionWindows.length]
				: null;

		let startMs;
		if (inSession) {
			const winMs = inSession.endMs - inSession.startMs;
			const offsetIntoWindow = Math.floor(Math.random() * winMs);
			startMs =
				Date.now() - inSession.startMs - offsetIntoWindow;
			sessionStamped++;
		} else {
			startMs = Math.floor(Math.random() * 60 * 1000 * 60 * 4); // last 4h
		}

		const dur =
			route.durMin + Math.floor(Math.random() * (route.durMax - route.durMin));
		const isError = Math.random() < route.errorRate;

		const baseAttrs = [
			kv("http.request.method", route.name.split(" ")[0]),
			kv("url.path", route.name.split(" ")[1]),
			kv("http.response.status_code", isError ? 500 : 200),
		];
		if (inSession) {
			baseAttrs.push(kv("session.id", inSession.sessionId));
			baseAttrs.push(kv("user.id", inSession.visitorId));
		}

		// Root server span
		allSpans.push({
			service: svc,
			span: {
				traceId,
				spanId: rootSpanId,
				name: route.name,
				kind: 2, // SERVER
				startTimeUnixNano: agoNs(startMs + dur),
				endTimeUnixNano: agoNs(startMs),
				status: { code: isError ? 2 : 1, message: isError ? "internal error" : "" },
				attributes: baseAttrs,
			},
		});

		// Child DB span (always)
		allSpans.push({
			service: svc,
			span: {
				traceId,
				spanId: hex(8),
				parentSpanId: rootSpanId,
				name: "db.query users",
				kind: 3, // CLIENT
				startTimeUnixNano: agoNs(startMs + dur - 5),
				endTimeUnixNano: agoNs(startMs + 5),
				status: { code: 1 },
				attributes: [
					kv("db.system", "sqlite"),
					kv("db.statement", "SELECT * FROM users WHERE id = ?"),
					kv("peer.service", "users-db"),
				],
			},
		});

		// Outbound dependency for service-map edges:
		// CLIENT span in `svc` paired with a SERVER span in `downstream`,
		// linked by parent_span_id so the cross-service self-join sees an edge.
		const downstream =
			services[(services.indexOf(svc) + 1) % services.length];
		const clientSpanId = hex(8);
		const downstreamStart = startMs + Math.floor(dur / 2);
		const downstreamEnd = startMs + Math.floor(dur / 4);
		allSpans.push({
			service: svc,
			span: {
				traceId,
				spanId: clientSpanId,
				parentSpanId: rootSpanId,
				name: `call ${downstream}`,
				kind: 3, // CLIENT
				startTimeUnixNano: agoNs(downstreamStart),
				endTimeUnixNano: agoNs(downstreamEnd),
				status: { code: isError ? 2 : 1 },
				attributes: [
					kv("peer.service", downstream),
					kv("http.request.method", "GET"),
				],
			},
		});
		allSpans.push({
			service: downstream,
			span: {
				traceId,
				spanId: hex(8),
				parentSpanId: clientSpanId,
				name: `${downstream} handler`,
				kind: 2, // SERVER
				startTimeUnixNano: agoNs(downstreamStart - 1),
				endTimeUnixNano: agoNs(downstreamEnd + 1),
				status: { code: isError ? 2 : 1 },
				attributes: [
					kv("http.request.method", "GET"),
					kv("http.route", `/internal/${downstream}`),
				],
			},
		});
	}

	// Group by service for OTLP packaging
	const bySvc = new Map();
	for (const { service, span } of allSpans) {
		if (!bySvc.has(service)) bySvc.set(service, []);
		bySvc.get(service).push(span);
	}

	const resourceSpans = [...bySvc.entries()].map(([service, spans]) => ({
		resource: { attributes: [kv("service.name", service)] },
		scopeSpans: [{ scope: { name: "seed-everything" }, spans }],
	}));

	await ingestPost("/v1/traces", { resourceSpans });
	return `${allSpans.length} spans across ${bySvc.size} services (${sessionStamped} stamped with session.id)`;
};

// ── logs ────────────────────────────────────────────────────────────

const seedLogs = async (sessionWindows = []) => {
	const services = ["obs-demo", "checkout-api", "payments-worker"];
	const samples = [
		{ severity: "INFO", body: "Database query successful", count: 8 },
		{ severity: "INFO", body: "Item created", count: 4 },
		{ severity: "WARN", body: "Slow query detected", count: 3 },
		{ severity: "WARN", body: "Cache miss on hot key", count: 2 },
		{ severity: "ERROR", body: "Connection timeout", count: 2 },
		{
			severity: "ERROR",
			body: "Stripe webhook signature verification failed",
			count: 1,
		},
	];

	const logRecords = [];
	let sessionStamped = 0;
	let recordIndex = 0;
	for (const sample of samples) {
		for (let i = 0; i < sample.count; i++) {
			const svc = services[i % services.length];
			const idx = recordIndex++;

			// Same 60% session-stamping logic as traces — log records placed
			// inside one of the seeded session windows so the Timeline lanes
			// light up with backend logs alongside frontend events.
			const inSession =
				sessionWindows.length > 0 && idx % 5 < 3
					? sessionWindows[idx % sessionWindows.length]
					: null;

			let offsetMs;
			if (inSession) {
				const winMs = inSession.endMs - inSession.startMs;
				const offsetIntoWindow = Math.floor(Math.random() * winMs);
				offsetMs = Date.now() - inSession.startMs - offsetIntoWindow;
				sessionStamped++;
			} else {
				offsetMs = Math.floor(Math.random() * 3 * 60 * 60 * 1000);
			}

			const attrs = [
				kv("logger.name", `${svc}.handler`),
				kv("environment", "dev"),
			];
			if (inSession) {
				attrs.push(kv("session.id", inSession.sessionId));
			}

			logRecords.push({
				service: svc,
				record: {
					timeUnixNano: agoNs(offsetMs),
					severityText: sample.severity,
					severityNumber:
						sample.severity === "ERROR" ? 17 : sample.severity === "WARN" ? 13 : 9,
					body: { stringValue: sample.body },
					attributes: attrs,
					traceId: hex(16),
					spanId: hex(8),
				},
			});
		}
	}

	const bySvc = new Map();
	for (const { service, record } of logRecords) {
		if (!bySvc.has(service)) bySvc.set(service, []);
		bySvc.get(service).push(record);
	}

	const resourceLogs = [...bySvc.entries()].map(([service, records]) => ({
		resource: { attributes: [kv("service.name", service)] },
		scopeLogs: [{ scope: { name: "seed-everything" }, logRecords: records }],
	}));

	await ingestPost("/v1/logs", { resourceLogs });
	return `${logRecords.length} log records (${sessionStamped} stamped with session.id)`;
};

// ── AI calls ────────────────────────────────────────────────────────

const seedAi = async () => {
	const models = [
		{ provider: "openai", model: "gpt-4o-mini", inputCost: 0.00015, outputCost: 0.0006 },
		{ provider: "anthropic", model: "claude-3-5-haiku", inputCost: 0.001, outputCost: 0.005 },
		{ provider: "google", model: "gemini-1.5-flash", inputCost: 0.000075, outputCost: 0.0003 },
	];
	const prompts = [
		"Summarize this transaction history",
		"Classify this support ticket",
		"Generate a product description for a wireless mouse",
		"Translate the following text to French",
	];

	const aiSpans = [];
	const sessionRoot = `seed-ai-${Date.now().toString(36)}`;
	for (let i = 0; i < 12; i++) {
		const m = models[i % models.length];
		const p = prompts[i % prompts.length];
		const offsetMs = Math.floor(Math.random() * 3 * 60 * 60 * 1000);
		const dur = 200 + Math.floor(Math.random() * 1500);
		const isError = i === 7; // one failed call
		const promptTokens = 150 + Math.floor(Math.random() * 400);
		const completionTokens = isError ? 0 : 50 + Math.floor(Math.random() * 300);
		const cost =
			(promptTokens * m.inputCost + completionTokens * m.outputCost) / 1000;

		aiSpans.push({
			service: "obs-demo",
			span: {
				traceId: hex(16),
				spanId: hex(8),
				name: `${m.provider}.chat`,
				kind: 3, // CLIENT
				startTimeUnixNano: agoNs(offsetMs + dur),
				endTimeUnixNano: agoNs(offsetMs),
				status: {
					code: isError ? 2 : 1,
					message: isError ? "rate_limit_exceeded" : "",
				},
				attributes: [
					kv("openinference.span.kind", "LLM"),
					kv("llm.provider", m.provider),
					kv("llm.model_name", m.model),
					kv("llm.input_messages.0.message.role", "user"),
					kv("llm.input_messages.0.message.content", p),
					kv("llm.output_messages.0.message.role", "assistant"),
					kv(
						"llm.output_messages.0.message.content",
						isError ? "" : `Sample response for "${p.slice(0, 30)}…"`,
					),
					kv("llm.token_count.prompt", promptTokens),
					kv("llm.token_count.completion", completionTokens),
					kv("llm.token_count.total", promptTokens + completionTokens),
					kv("llm.cost_usd", cost),
					kv("session.id", `${sessionRoot}-${i % 3}`),
				],
			},
		});
	}

	const resourceSpans = [
		{
			resource: { attributes: [kv("service.name", "obs-demo")] },
			scopeSpans: [
				{
					scope: { name: "seed-ai" },
					spans: aiSpans.map((s) => s.span),
				},
			],
		},
	];

	await ingestPost("/v1/traces", { resourceSpans });
	return `${aiSpans.length} AI spans across ${models.length} providers`;
};

// ── main ────────────────────────────────────────────────────────────

console.log();
console.log(`  ${dim("collector:")} ${COLLECTOR}`);
console.log(`  ${dim("demo:")}      ${DEMO}`);
console.log(`  ${dim("password:")}  ${PASSWORD}`);
console.log(`  ${dim("rounds:")}    ${ROUNDS}`);
console.log();

const cookie = await step("login to dashboard auth", dashboardLogin);
if (!cookie) {
	console.error(err("\n  cannot continue without dashboard auth — exiting"));
	process.exit(1);
}

// Seed usage first so we have session windows. Spans + logs then get
// stamped with session.id matching those windows — that's what makes the
// Timeline tab show a real cross-signal join (frontend events alongside
// backend spans/logs in the same session).
const usageResult = await step(
	"usage / sessions / timeline (/v1/usage)",
	seedUsage,
);
const sessionWindows = usageResult?.sessions ?? [];

await step("traces / service map / issues (/v1/traces)", () =>
	seedTraces(sessionWindows),
);
await step("logs (/v1/logs)", () => seedLogs(sessionWindows));
await step("AI calls (/v1/traces with LLM kind)", seedAi);
await step("alert rules (/internal/alerts/rules)", () => seedAlerts(cookie));

console.log();
console.log(`  ${ok("done.")} open http://localhost:5173 to see populated tabs`);
console.log(
	`  ${warn("note:")} for the Replays tab, visit /playground in the browser`,
);
console.log(`         and click "Start replay" — rrweb chunks need a real DOM`);
console.log();
