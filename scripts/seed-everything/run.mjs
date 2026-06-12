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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";

const noopSpan = {
	end() {},
	recordException() {},
	setAttribute() {},
	setStatus() {},
};
const fallbackTrace = {
	getTracer: () => ({
		startActiveSpan: async (_name, fn) => fn(noopSpan),
	}),
};
let SpanStatusCode = { OK: 1, ERROR: 2 };
let trace = fallbackTrace;
try {
	({ SpanStatusCode, trace } = await import("@opentelemetry/api"));
} catch {
	// Optional: plain seeding should work even when self-instrumentation deps
	// have not been installed.
}

// Get a tracer scoped to the seeder. The actual provider was set up in
// `instrumentation.mjs` (loaded via --import). When run without that
// loader, this returns a no-op tracer and every wrap is a pass-through.
const tracer = trace.getTracer("obs-seeder");

// ── args ────────────────────────────────────────────────────────────

function arg(name, fallback) {
	const idx = process.argv.indexOf(`--${name}`);
	if (idx === -1) return fallback;
	return process.argv[idx + 1] ?? fallback;
}

function readCollectorDevVars() {
	const path = resolve("apps/collector/.dev.vars");
	try {
		const entries = {};
		for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eq = trimmed.indexOf("=");
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			let value = trimmed.slice(eq + 1).trim();
			value = value.replace(/^['"]|['"]$/g, "");
			entries[key] = value;
		}
		return entries;
	} catch {
		return {};
	}
}

const collectorDevVars = readCollectorDevVars();
const COLLECTOR = arg("collector", "http://localhost:8790");
const DEMO = arg("demo", "http://localhost:8787");
const PASSWORD = arg(
	"password",
	process.env.DASHBOARD_PASSWORD ??
		collectorDevVars.DASHBOARD_PASSWORD ??
		"e2e-test-pass",
);
const PROJECT_KEY = arg(
	"key",
	process.env.OBS_INGEST_KEY ??
		collectorDevVars.INGEST_KEY ??
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
	// Wrap the step in a span. Anything fn does — including the outbound
	// fetches that undici instrumentation will trace — becomes children
	// of this span, so the seed run shows up in obs-dashboard as a
	// labelled tree of phases.
	const spanName = `seed.${label.split(/\s/)[0].toLowerCase()}`;
	return tracer.startActiveSpan(spanName, async (span) => {
		span.setAttribute("seed.label", label);
		try {
			const result = await fn();
			const display =
				typeof result === "string"
					? result
					: result && typeof result === "object" && "summary" in result
						? result.summary
						: "";
			if (display) span.setAttribute("seed.summary", display);
			span.setStatus({ code: SpanStatusCode.OK });
			console.log(ok("✓"), display ? dim(`(${display})`) : "");
			return result;
		} catch (e) {
			span.recordException(e);
			span.setStatus({ code: SpanStatusCode.ERROR, message: e.message });
			console.log(err(`✗ ${e.message}`));
			return null;
		} finally {
			span.end();
		}
	});
};

const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── helpers ─────────────────────────────────────────────────────────

const _callDemo = async (path) => {
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

// ── RFC 0004 — interaction_id minting ───────────────────────────────
//
// 26-char Crockford-base32, same shape as @obsunified/analytics-sdk emits at
// click time. Time-prefixed so they sort within a session in seeded
// data the same way real ids would.
const ENCODING_B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const mintInteractionId = () => {
	let t = Date.now();
	let timePart = "";
	for (let i = 0; i < 10; i++) {
		timePart = ENCODING_B32[t % 32] + timePart;
		t = Math.floor(t / 32);
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let randPart = "";
	for (let i = 0; i < 16; i++) randPart += ENCODING_B32[bytes[i] % 32];
	return timePart + randPart;
};

// ── usage events (Usage / Sessions / Timeline tabs) ─────────────────

/**
 * Seed usage. Returns the session windows so spans + logs can later be
 * stamped with the same session.id (and time-aligned) so the Timeline tab
 * shows a real cross-signal join. Each "interaction" event gets a fresh
 * interaction_id, returned in the session's `interactions` array so
 * downstream signals (traces / logs / AI calls) can be linked back to
 * the click that caused them.
 *
 * @returns {Promise<{ inserted: number, sessions: Array<{
 *   sessionId: string;
 *   visitorId: string;
 *   startMs: number;
 *   endMs: number;
 *   interactions: Array<{ interactionId: string; occurredAt: number; name: string }>;
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
		const sessionInteractions = [];
		sessionWindows.push({
			sessionId,
			visitorId,
			startMs: startTs,
			endMs: startTs + eventDurationMs,
			interactions: sessionInteractions,
		});
		const paths = ["/", "/dashboard", "/dashboard/traces", "/dashboard/logs"];

		for (let i = 0; i < eventsPerSession; i++) {
			const ts = startTs + i * 7_000;
			const path = paths[i % paths.length];
			const isLast = i === eventsPerSession - 1;
			const isInteraction = i % 3 !== 0;
			const interactionId = isInteraction ? mintInteractionId() : null;
			if (interactionId) {
				sessionInteractions.push({
					interactionId,
					occurredAt: ts,
					name: `click_${i}`,
				});
			}

			// page view (every 3rd event) or click
			events.push({
				type: isInteraction ? "interaction" : "page_view",
				name: isInteraction ? `click_${i}` : "page_view",
				sessionId,
				visitorId,
				occurredAt: new Date(ts).toISOString(),
				pagePath: path,
				// RFC 0004 — interactionId is the click-scoped correlation
				// key. Page views deliberately don't carry one — they're not
				// the originating click of any downstream trace.
				interactionId,
				properties: {
					seed: true,
					action: isInteraction ? "click" : "navigate",
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
			name: "Slow checkout p95",
			signal: "spans",
			query: { spanName: "POST /api/checkout" },
			threshold: 1,
			windowMins: 15,
			comparison: ">=",
			channels: [
				{ type: "webhook", url: "https://hooks.example.com/checkout-slow" },
			],
			enabled: true,
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

const ingestBinary = async (path, body, headers = {}) => {
	const res = await fetch(`${COLLECTOR}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${PROJECT_KEY}`,
			"X-Project-Id": "default",
			...headers,
		},
		body,
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`${path} → ${res.status}: ${text.slice(0, 80)}`);
	}
	return res.json().catch(() => ({}));
};

const writeVarint = (out, value) => {
	while (value >= 0x80) {
		out.push((value & 0x7f) | 0x80);
		value = Math.floor(value / 128);
	}
	out.push(value & 0x7f);
};
const writeTag = (out, fieldNum, wireType) =>
	writeVarint(out, (fieldNum << 3) | wireType);
const writeLengthDelimited = (out, fieldNum, bytes) => {
	writeTag(out, fieldNum, 2);
	writeVarint(out, bytes.length);
	for (const byte of bytes) out.push(byte);
};
const writeString = (out, fieldNum, value) =>
	writeLengthDelimited(out, fieldNum, new TextEncoder().encode(value));
const writePackedVarints = (out, fieldNum, values) => {
	const inner = [];
	for (const value of values) writeVarint(inner, value);
	writeLengthDelimited(out, fieldNum, inner);
};
const encodeSeedPprof = (traceId) => {
	const strings = [
		"",
		"cpu",
		"nanoseconds",
		"checkout.handle",
		"apps/obs-demo/src/routes/checkout.ts",
		"payment.charge",
		"packages/payments/src/charge.ts",
		"json.parse",
		"node:internal/json",
		"trace_id",
		traceId,
	];
	const out = [];
	const valueType = [];
	writeTag(valueType, 1, 0);
	writeVarint(valueType, 1);
	writeTag(valueType, 2, 0);
	writeVarint(valueType, 2);
	writeLengthDelimited(out, 1, valueType);

	const functions = [
		{ id: 1, nameIdx: 3, filenameIdx: 4 },
		{ id: 2, nameIdx: 5, filenameIdx: 6 },
		{ id: 3, nameIdx: 7, filenameIdx: 8 },
	];
	for (const fn of functions) {
		const bytes = [];
		writeTag(bytes, 1, 0);
		writeVarint(bytes, fn.id);
		writeTag(bytes, 2, 0);
		writeVarint(bytes, fn.nameIdx);
		writeTag(bytes, 4, 0);
		writeVarint(bytes, fn.filenameIdx);
		writeLengthDelimited(out, 5, bytes);
	}

	const locations = [
		{ id: 1, functionId: 1, line: 88 },
		{ id: 2, functionId: 2, line: 47 },
		{ id: 3, functionId: 3, line: 1 },
	];
	for (const loc of locations) {
		const bytes = [];
		writeTag(bytes, 1, 0);
		writeVarint(bytes, loc.id);
		const line = [];
		writeTag(line, 1, 0);
		writeVarint(line, loc.functionId);
		writeTag(line, 2, 0);
		writeVarint(line, loc.line);
		writeLengthDelimited(bytes, 4, line);
		writeLengthDelimited(out, 4, bytes);
	}

	const samples = [
		{ locations: [3, 2, 1], value: 920 },
		{ locations: [2, 1], value: 680 },
		{ locations: [1], value: 160 },
	];
	for (const sample of samples) {
		const bytes = [];
		writePackedVarints(bytes, 1, sample.locations);
		writePackedVarints(bytes, 2, [sample.value]);
		const label = [];
		writeTag(label, 1, 0);
		writeVarint(label, 9);
		writeTag(label, 2, 0);
		writeVarint(label, 10);
		writeLengthDelimited(bytes, 3, label);
		writeLengthDelimited(out, 2, bytes);
	}

	for (const str of strings) writeString(out, 6, str);
	return gzipSync(Uint8Array.from(out));
};

// ── traces (Traces, Service Map, Issues) ────────────────────────────

const SCENARIO_A = {
	traceId: "0a000000000000000000000000000001",
	rootSpanId: "0a00000000000101",
	paymentSpanId: "0a00000000000102",
	dbSpanId: "0a00000000000103",
};

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
			startMs = Date.now() - inSession.startMs - offsetIntoWindow;
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
		// RFC 0004 — when a trace falls inside a session window we also pick
		// one of the session's interaction_ids so the rail's "Trace caused
		// by this click" + "Originating click" links resolve against
		// seeded data. Picked round-robin across the session's clicks.
		let stampedInteractionId = null;
		if (inSession) {
			baseAttrs.push(kv("session.id", inSession.sessionId));
			baseAttrs.push(kv("user.id", `user-${inSession.visitorId}`));
			const interactions = inSession.interactions ?? [];
			if (interactions.length > 0) {
				const pick = interactions[r % interactions.length];
				stampedInteractionId = pick.interactionId;
				baseAttrs.push(kv("obs.interaction.id", stampedInteractionId));
			}
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
				status: {
					code: isError ? 2 : 1,
					message: isError ? "internal error" : "",
				},
				attributes: baseAttrs,
			},
		});

		// Child spans inherit the parent's interaction_id so the rail's
		// span-detail "Originating click" link resolves no matter which
		// span the user lands on (root or a deep child).
		const childInteractionKv = stampedInteractionId
			? [kv("obs.interaction.id", stampedInteractionId)]
			: [];

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
					...childInteractionKv,
				],
			},
		});

		// Outbound dependency for service-map edges:
		// CLIENT span in `svc` paired with a SERVER span in `downstream`,
		// linked by parent_span_id so the cross-service self-join sees an edge.
		const downstream = services[(services.indexOf(svc) + 1) % services.length];
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
					...childInteractionKv,
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
					...childInteractionKv,
				],
			},
		});
	}

	const checkoutSession = sessionWindows[sessionWindows.length - 1] ?? null;
	const checkoutInteraction = checkoutSession?.interactions?.[0] ?? null;
	const checkoutAttrs = [
		kv("http.request.method", "POST"),
		kv("http.route", "/api/checkout"),
		kv("url.path", "/api/checkout"),
		kv("http.response.status_code", 200),
		kv("seed.scenario", "A"),
	];
	if (checkoutSession) {
		checkoutAttrs.push(kv("session.id", checkoutSession.sessionId));
		checkoutAttrs.push(kv("user.id", `user-${checkoutSession.visitorId}`));
	}
	if (checkoutInteraction) {
		checkoutAttrs.push(
			kv("obs.interaction.id", checkoutInteraction.interactionId),
		);
	}

	allSpans.push(
		{
			service: "checkout-api",
			span: {
				traceId: SCENARIO_A.traceId,
				spanId: SCENARIO_A.rootSpanId,
				name: "POST /api/checkout",
				kind: 2,
				startTimeUnixNano: agoNs(2 * 60_000 + 980),
				endTimeUnixNano: agoNs(2 * 60_000),
				status: { code: 1, message: "" },
				attributes: checkoutAttrs,
			},
		},
		{
			service: "checkout-api",
			span: {
				traceId: SCENARIO_A.traceId,
				spanId: SCENARIO_A.paymentSpanId,
				parentSpanId: SCENARIO_A.rootSpanId,
				name: "payment.charge",
				kind: 3,
				startTimeUnixNano: agoNs(2 * 60_000 + 840),
				endTimeUnixNano: agoNs(2 * 60_000 + 130),
				status: { code: 1, message: "" },
				attributes: [
					kv("peer.service", "payments-worker"),
					kv("payment.provider", "stripe"),
					kv("seed.scenario", "A"),
					...(checkoutSession
						? [kv("session.id", checkoutSession.sessionId)]
						: []),
					...(checkoutInteraction
						? [kv("obs.interaction.id", checkoutInteraction.interactionId)]
						: []),
				],
			},
		},
		{
			service: "payments-worker",
			span: {
				traceId: SCENARIO_A.traceId,
				spanId: SCENARIO_A.dbSpanId,
				parentSpanId: SCENARIO_A.paymentSpanId,
				name: "payments-db.insert charge",
				kind: 3,
				startTimeUnixNano: agoNs(2 * 60_000 + 620),
				endTimeUnixNano: agoNs(2 * 60_000 + 500),
				status: { code: 1, message: "" },
				attributes: [
					kv("db.system", "postgresql"),
					kv("db.statement", "INSERT INTO charges (...) VALUES (...)"),
					kv("seed.scenario", "A"),
				],
			},
		},
	);

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
	return {
		summary: `${allSpans.length} spans across ${bySvc.size} services (${sessionStamped} stamped with session.id, Scenario A checkout trace ${SCENARIO_A.traceId})`,
		scenarioA: {
			...SCENARIO_A,
			sessionId: checkoutSession?.sessionId ?? null,
			interactionId: checkoutInteraction?.interactionId ?? null,
		},
	};
};

const seedProfiles = async (scenarioA) => {
	if (!scenarioA?.traceId) return "no Scenario A trace";
	const body = encodeSeedPprof(scenarioA.traceId);
	const now = new Date();
	const startedAt = new Date(now.getTime() - 60_000).toISOString();
	const result = await ingestBinary("/v1/profiles/pprof", body, {
		"Content-Type": "application/octet-stream",
		"Content-Encoding": "gzip",
		"x-obs-service": "checkout-api",
		"x-obs-profile-type": "cpu",
		"x-obs-agent": "seed-everything",
		"x-obs-duration-ms": "60000",
		"x-obs-start-ts": startedAt,
		"x-obs-trace-ids": scenarioA.traceId,
	});
	return `cpu profile ${result.profileId ?? "accepted"} indexed to ${scenarioA.traceId}`;
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
				// RFC 0004 — stamp obs.interaction.id on ~half of session
				// logs so the rail's "logs from this trace" + "logs caused
				// by this click" both have populated data to surface.
				const interactions = inSession.interactions ?? [];
				if (interactions.length > 0 && idx % 2 === 0) {
					const pick = interactions[idx % interactions.length];
					attrs.push(kv("obs.interaction.id", pick.interactionId));
				}
			}

			logRecords.push({
				service: svc,
				record: {
					timeUnixNano: agoNs(offsetMs),
					severityText: sample.severity,
					severityNumber:
						sample.severity === "ERROR"
							? 17
							: sample.severity === "WARN"
								? 13
								: 9,
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

const seedAi = async (sessionWindows = []) => {
	const models = [
		{
			provider: "openai",
			model: "gpt-4o-mini",
			inputCost: 0.00015,
			outputCost: 0.0006,
		},
		{
			provider: "anthropic",
			model: "claude-3-5-haiku",
			inputCost: 0.001,
			outputCost: 0.005,
		},
		{
			provider: "google",
			model: "gemini-1.5-flash",
			inputCost: 0.000075,
			outputCost: 0.0003,
		},
	];
	const prompts = [
		"Summarize this transaction history",
		"Classify this support ticket",
		"Generate a product description for a wireless mouse",
		"Translate the following text to French",
	];

	const aiSpans = [];
	const actionGraphSpans = [];
	const sessionRoot = `seed-ai-${Date.now().toString(36)}`;
	const totalCalls = 12;
	// RFC 0006 Scenario B — last session is the "heavy spender" with 8
	// high-cost calls in a row; the rest of the seed has the original
	// shape. This lets the dashboard's AI tab show a believable spike,
	// the cost-by-user view show one user dominating, and the rail's
	// user → latest session → trace pivot resolve to populated data.
	const heavySpenderSession =
		sessionWindows.length > 0
			? sessionWindows[sessionWindows.length - 1]
			: null;
	const scenarioBFixture = {
		traceId: "0b000000000000000000000000000001",
		runSpanId: "0b00000000000001",
		llmSpanId: "0b00000000000002",
		toolSpanId: "0b00000000000003",
		evalSpanId: "0b00000000000004",
		runActionId: "01K00000000000000000000001",
		llmActionId: "01K00000000000000000000002",
		toolActionId: "01K00000000000000000000003",
		evalActionId: "01K00000000000000000000004",
	};

	for (let i = 0; i < totalCalls; i++) {
		const m = models[i % models.length];
		const p = prompts[i % prompts.length];
		const isHeavy = heavySpenderSession && i >= totalCalls - 8;
		const isScenarioBProofCall = isHeavy && i === totalCalls - 8;

		// Place heavy-spender calls inside the session window (so the
		// timeline tab shows them lined up with the user's clicks); other
		// calls scatter over the last 3 hours.
		const offsetMs = isHeavy
			? Date.now() -
				(heavySpenderSession.startMs +
					Math.floor(
						(heavySpenderSession.endMs - heavySpenderSession.startMs) *
							(i / totalCalls),
					))
			: Math.floor(Math.random() * 3 * 60 * 60 * 1000);

		const dur = 200 + Math.floor(Math.random() * 1500);
		const isError = i === 7; // one failed call
		// Heavy-spender prompts are longer + use the most expensive model so
		// the cost ratio is visually obvious in the dashboard.
		const promptTokens = isHeavy
			? 1200 + Math.floor(Math.random() * 800)
			: 150 + Math.floor(Math.random() * 400);
		const completionTokens = isError
			? 0
			: isHeavy
				? 600 + Math.floor(Math.random() * 400)
				: 50 + Math.floor(Math.random() * 300);
		const effectiveModel = isHeavy ? models[1] : m; // claude-3-5-haiku, most expensive
		const cost =
			(promptTokens * effectiveModel.inputCost +
				completionTokens * effectiveModel.outputCost) /
			1000;

		// Pick the session + interaction id for this call.
		const session = isHeavy
			? heavySpenderSession
			: sessionWindows.length > 0 && i % 3 === 0
				? sessionWindows[i % sessionWindows.length]
				: null;
		const sessionId = session ? session.sessionId : `${sessionRoot}-${i % 3}`;
		const interactions = session?.interactions ?? [];
		const interactionId =
			interactions.length > 0
				? interactions[i % interactions.length].interactionId
				: null;

		const attrs = [
			kv("openinference.span.kind", "LLM"),
			kv("llm.provider", effectiveModel.provider),
			kv("llm.model_name", effectiveModel.model),
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
			kv("session.id", sessionId),
		];
		if (session) {
			// OTel semantics: user.id is the authenticated identity, not the
			// anonymous visitor. Use the user_profiles PK so the dashboard's
			// `👤 {userId}` chip can link straight to the user detail page.
			attrs.push(kv("user.id", `user-${session.visitorId}`));
		}
		if (interactionId) {
			attrs.push(kv("obs.interaction.id", interactionId));
		}
		if (isScenarioBProofCall) {
			attrs.push(kv("obs.action.id", scenarioBFixture.llmActionId));
			attrs.push(kv("obs.action.root_id", scenarioBFixture.runActionId));
			attrs.push(kv("obs.action.caused_by_id", scenarioBFixture.runActionId));
			attrs.push(kv("obs.action.kind", "llm.call"));
			attrs.push(kv("obs.action.name", "Generate expensive recommendations"));
			attrs.push(kv("obs.agent.run_id", scenarioBFixture.runActionId));
			attrs.push(kv("obs.action.prompt_version", "seed-scenario-b-v1"));
			attrs.push(kv("obs.action.model_name", effectiveModel.model));
			attrs.push(kv("obs.action.provider", effectiveModel.provider));
			attrs.push(kv("obs.action.total_cost_usd", cost));
		}

		const traceId = isScenarioBProofCall ? scenarioBFixture.traceId : hex(16);
		const spanId = isScenarioBProofCall ? scenarioBFixture.llmSpanId : hex(8);

		aiSpans.push({
			service: "obs-demo",
			span: {
				traceId,
				spanId,
				parentSpanId: isScenarioBProofCall
					? scenarioBFixture.runSpanId
					: undefined,
				name: `${effectiveModel.provider}.chat`,
				kind: 3, // CLIENT
				startTimeUnixNano: agoNs(offsetMs + dur),
				endTimeUnixNano: agoNs(offsetMs),
				status: {
					code: isError ? 2 : 1,
					message: isError ? "rate_limit_exceeded" : "",
				},
				attributes: attrs,
			},
		});

		if (isScenarioBProofCall) {
			const baseActionAttrs = [
				kv("session.id", sessionId),
				kv("user.id", `user-${heavySpenderSession.visitorId}`),
				kv("obs.interaction.id", interactionId ?? ""),
				kv("obs.agent.run_id", scenarioBFixture.runActionId),
			];
			actionGraphSpans.push(
				{
					traceId,
					spanId: scenarioBFixture.runSpanId,
					name: "agent.run.recommendation-cost-spike",
					kind: 1,
					startTimeUnixNano: agoNs(offsetMs + dur + 75),
					endTimeUnixNano: agoNs(offsetMs - 200),
					status: { code: 1, message: "" },
					attributes: [
						...baseActionAttrs,
						kv("obs.action.id", scenarioBFixture.runActionId),
						kv("obs.action.kind", "agent.run"),
						kv("obs.action.name", "Seed recommendation agent run"),
						kv("obs.actor.type", "agent"),
						kv("obs.actor.id", "seed-recommendation-agent"),
						kv("obs.agent.id", "seed-recommendation-agent"),
						kv("obs.agent.name", "Seed Recommendation Agent"),
						kv("obs.agent.version", "scenario-b-v1"),
						kv(
							"obs.agent.goal",
							"Generate recommendations for a heavy-spender session",
						),
						kv(
							"obs.agent.outcome",
							"Returned high-token recommendations after inventory lookup",
						),
						kv("obs.agent.autonomy_level", "suggested_action"),
						kv("obs.action.total_cost_usd", cost),
					],
				},
				{
					traceId,
					spanId: scenarioBFixture.toolSpanId,
					parentSpanId: scenarioBFixture.llmSpanId,
					name: "catalog.lookup_recommendations",
					kind: 3,
					startTimeUnixNano: agoNs(offsetMs + Math.floor(dur / 2)),
					endTimeUnixNano: agoNs(offsetMs + Math.floor(dur / 2) - 80),
					status: { code: 1, message: "" },
					attributes: [
						...baseActionAttrs,
						kv("obs.action.id", scenarioBFixture.toolActionId),
						kv("obs.action.root_id", scenarioBFixture.runActionId),
						kv("obs.action.caused_by_id", scenarioBFixture.llmActionId),
						kv("obs.action.kind", "tool.call"),
						kv("obs.action.name", "Lookup recommendation catalog"),
						kv("obs.tool.name", "catalog.lookup_recommendations"),
						kv(
							"obs.tool.args",
							JSON.stringify({ category: "premium", limit: 50 }),
						),
						kv(
							"obs.tool.result",
							JSON.stringify({ returned: 50, cache: "miss" }),
						),
						kv("obs.tool.side_effect", false),
						kv("obs.tool.approval_state", "suggested"),
					],
				},
				{
					traceId,
					spanId: scenarioBFixture.evalSpanId,
					parentSpanId: scenarioBFixture.llmSpanId,
					name: "eval.recommendation_budget_guard",
					kind: 1,
					startTimeUnixNano: agoNs(offsetMs + 40),
					endTimeUnixNano: agoNs(offsetMs + 20),
					status: { code: 2, message: "budget_guard_failed" },
					attributes: [
						...baseActionAttrs,
						kv("obs.action.id", scenarioBFixture.evalActionId),
						kv("obs.action.root_id", scenarioBFixture.runActionId),
						kv("obs.action.caused_by_id", scenarioBFixture.llmActionId),
						kv("obs.action.kind", "eval"),
						kv("obs.action.name", "Recommendation budget guard"),
						kv("obs.eval.evaluator_name", "recommendation_budget_guard"),
						kv("obs.eval.evaluator_version", "seed-v1"),
						kv("obs.eval.score", 0.35),
						kv("obs.eval.passed", false),
						kv(
							"obs.eval.reasoning",
							"Heavy-spender recommendation call exceeded the seed budget threshold.",
						),
					],
				},
			);
		}
	}

	const resourceSpans = [
		{
			resource: { attributes: [kv("service.name", "obs-demo")] },
			scopeSpans: [
				{
					scope: { name: "seed-ai" },
					spans: [...actionGraphSpans, ...aiSpans.map((s) => s.span)],
				},
			],
		},
	];

	await ingestPost("/v1/traces", { resourceSpans });

	// Also write to /v1/ai so the ai_calls denormalized table lights up
	// — that's what the rail's "AI calls in this trace/session" sections
	// query (not telemetry_spans). Without this the rail's AI links read
	// as informative-absence even when the seed has plenty of AI traffic.
	const aiCalls = aiSpans.map(({ span }) => {
		const attrs = Object.fromEntries(
			(span.attributes || []).map((kvp) => {
				const v = kvp.value || {};
				const val =
					v.stringValue !== undefined
						? v.stringValue
						: v.intValue !== undefined
							? Number(v.intValue)
							: v.doubleValue !== undefined
								? Number(v.doubleValue)
								: v.boolValue !== undefined
									? Boolean(v.boolValue)
									: null;
				return [kvp.key, val];
			}),
		);
		return {
			traceId: span.traceId,
			spanId: span.spanId,
			serviceName: "obs-demo",
			modelName: attrs["llm.model_name"],
			provider: attrs["llm.provider"],
			callType: "chat",
			promptTokens: attrs["llm.token_count.prompt"],
			completionTokens: attrs["llm.token_count.completion"],
			totalCostUsd: attrs["llm.cost_usd"],
			latencyMs: 800,
			isError: span.status?.code === 2,
			errorMessage: span.status?.message || null,
			occurredAt: new Date(
				Number(BigInt(span.startTimeUnixNano) / 1_000_000n),
			).toISOString(),
			sessionId: attrs["session.id"] ?? null,
			interactionId: attrs["obs.interaction.id"] ?? null,
		};
	});
	await ingestPost("/v1/ai", { calls: aiCalls });

	const heavyShare = heavySpenderSession ? 8 : 0;
	return heavySpenderSession
		? `${aiSpans.length} AI spans + ai_calls (${heavyShare} on heavy spender, 1 action proof chain)`
		: `${aiSpans.length} AI spans + ai_calls across ${models.length} providers`;
};

// ── identified users (Scenario B: AI cost spike → user pivot) ───────

const seedUserProfiles = async (sessionWindows) => {
	if (sessionWindows.length === 0) return "no sessions";
	// Identify every seeded visitor so the rail's user → sessions pivot
	// has populated data for any of them. The last one is the heavy
	// spender — give them an obvious display name so the dashboard's
	// user list makes the headline clear.
	let created = 0;
	for (let i = 0; i < sessionWindows.length; i++) {
		const w = sessionWindows[i];
		const isHeavy = i === sessionWindows.length - 1;
		const userId = `user-${w.visitorId}`;
		// Backdate firstSeenAt to the user's first session start. Without
		// this every seeded user shows firstSeenAt = lastSeenAt = "now",
		// which makes the user-detail page look unconvincing — every user
		// appears to have arrived in the same second.
		const firstSeenAt = new Date(w.startMs).toISOString();
		await ingestPost("/v1/identify", {
			userId,
			visitorId: w.visitorId,
			email: isHeavy ? "heavy-spender@seed.local" : `seed-user-${i}@seed.local`,
			name: isHeavy ? "Heavy Spender (seed)" : `Seed User ${i}`,
			properties: {
				seed: true,
				heavy_spender: isHeavy,
			},
			firstSeenAt,
		});
		created += 1;
	}
	return `${created} profiles (1 heavy spender)`;
};

// ── main ────────────────────────────────────────────────────────────

console.log();
console.log(`  ${dim("collector:")} ${COLLECTOR}`);
console.log(`  ${dim("demo:")}      ${DEMO}`);
console.log(`  ${dim("password:")}  ${PASSWORD}`);
console.log(`  ${dim("rounds:")}    ${ROUNDS}`);
console.log();

await tracer.startActiveSpan("seed.run", async (rootSpan) => {
	rootSpan.setAttribute("seed.collector_url", COLLECTOR);
	rootSpan.setAttribute("seed.demo_url", DEMO);
	rootSpan.setAttribute("seed.rounds", ROUNDS);

	try {
		const cookie = await step("login to dashboard auth", dashboardLogin);
		if (!cookie) {
			console.error(
				err("\n  cannot continue without dashboard auth — exiting"),
			);
			rootSpan.setStatus({
				code: SpanStatusCode.ERROR,
				message: "dashboard auth failed",
			});
			process.exit(1);
		}

		// Seed usage first so we have session windows. Spans + logs then get
		// stamped with session.id matching those windows — that's what makes
		// the Timeline tab show a real cross-signal join (frontend events
		// alongside backend spans/logs in the same session).
		const usageResult = await step(
			"usage / sessions / timeline (/v1/usage)",
			seedUsage,
		);
		const sessionWindows = usageResult?.sessions ?? [];

		const tracesResult = await step(
			"traces / service map / issues (/v1/traces)",
			() => seedTraces(sessionWindows),
		);
		await step("CPU profile for Scenario A (/v1/profiles/pprof)", () =>
			seedProfiles(tracesResult?.scenarioA),
		);
		await step("logs (/v1/logs)", () => seedLogs(sessionWindows));
		await step("AI calls (/v1/traces with LLM kind)", () =>
			seedAi(sessionWindows),
		);
		await step("user profiles (/v1/identify)", () =>
			seedUserProfiles(sessionWindows),
		);
		await step("alert rules (/internal/alerts/rules)", () =>
			seedAlerts(cookie),
		);
		rootSpan.setStatus({ code: SpanStatusCode.OK });
	} finally {
		rootSpan.end();
	}
});

console.log();
console.log(
	`  ${ok("done.")} open http://localhost:5173 to see populated tabs`,
);
console.log(
	`  ${warn("note:")} for the Replays tab, visit /playground in the browser`,
);
console.log(`         and click "Start replay" — rrweb chunks need a real DOM`);
console.log();
