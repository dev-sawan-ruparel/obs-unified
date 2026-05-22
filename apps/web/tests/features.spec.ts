import { expect, type Page, test } from "@playwright/test";

/*
 * End-to-end tests for the four groundcover-inspired features:
 *   1. Live Tail (SSE)
 *   2. Service/Dependency Map
 *   3. Sessions Explorer filters
 *   4. Unified Timeline
 *
 * Unlike dashboards.spec.ts these hit a real collector via the vite proxy
 * at /internal and /v1 (default: http://localhost:8790). The collector must
 * be running with the .dev.vars values from apps/collector/.dev.vars.
 *
 * Run:   pnpm --filter @obs-demo/web exec playwright test features.spec.ts
 */

// These tests share a single D1 database and a Durable Object pub/sub hub.
// Running them in parallel leaves them racing for seeded rows and live-tail
// subscribers, which surfaces as flakes. Serial execution is fast enough
// (sub-15s for the whole file) and deterministic.
test.describe.configure({ mode: "serial" });

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass";
const INGEST_KEY =
	process.env.INGEST_KEY ??
	"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504";

// Helpers ────────────────────────────────────────────────────────────────

async function login(page: Page) {
	const res = await page.request.post("/auth/login", {
		data: { password: DASHBOARD_PASSWORD },
	});
	expect(res.ok(), `login failed: ${res.status()}`).toBeTruthy();
}

const hex = (n: number) =>
	Array.from({ length: n }, () =>
		Math.floor(Math.random() * 256)
			.toString(16)
			.padStart(2, "0"),
	).join("");

const kv = (key: string, value: string) => ({
	key,
	value: { stringValue: value },
});

async function ingestLogs(
	page: Page,
	serviceName: string,
	records: Array<{
		severity: "INFO" | "WARN" | "ERROR";
		message: string;
		sessionId?: string;
	}>,
) {
	const now = BigInt(Date.now()) * 1_000_000n;
	const payload = {
		resourceLogs: [
			{
				resource: { attributes: [kv("service.name", serviceName)] },
				scopeLogs: [
					{
						scope: { name: "e2e" },
						logRecords: records.map((r, i) => ({
							timeUnixNano: String(now + BigInt(i)),
							severityText: r.severity,
							severityNumber:
								r.severity === "ERROR" ? 17 : r.severity === "WARN" ? 13 : 9,
							body: { stringValue: r.message },
							attributes: r.sessionId ? [kv("session.id", r.sessionId)] : [],
						})),
					},
				],
			},
		],
	};
	const res = await page.request.post("/v1/logs", {
		data: payload,
		headers: { "X-API-Key": INGEST_KEY },
	});
	expect(res.ok(), `ingestLogs failed: ${res.status()}`).toBeTruthy();
}

async function ingestTrace(
	page: Page,
	serviceName: string,
	spans: Array<{
		spanId: string;
		parentSpanId?: string;
		name: string;
		statusCode?: 1 | 2;
		statusMessage?: string;
		durationMs?: number;
		sessionId?: string;
		traceId?: string;
	}>,
) {
	const sharedTrace = hex(16);
	const now = BigInt(Date.now()) * 1_000_000n;
	const payload = {
		resourceSpans: [
			{
				resource: { attributes: [kv("service.name", serviceName)] },
				scopeSpans: [
					{
						spans: spans.map((s, i) => {
							const start = now + BigInt(i) * 1_000_000n;
							const dur = BigInt((s.durationMs ?? 50) * 1_000_000);
							return {
								traceId: s.traceId ?? sharedTrace,
								spanId: s.spanId,
								parentSpanId: s.parentSpanId,
								name: s.name,
								kind: 2,
								startTimeUnixNano: String(start),
								endTimeUnixNano: String(start + dur),
								status: {
									code: s.statusCode ?? 1,
									message: s.statusMessage ?? null,
								},
								attributes: s.sessionId ? [kv("session.id", s.sessionId)] : [],
							};
						}),
					},
				],
			},
		],
	};
	const res = await page.request.post("/v1/traces", {
		data: payload,
		headers: { "X-API-Key": INGEST_KEY },
	});
	expect(res.ok(), `ingestTrace failed: ${res.status()}`).toBeTruthy();
	return sharedTrace;
}

async function ingestUsage(
	page: Page,
	events: Array<{
		sessionId: string;
		visitorId: string;
		type: "page_view" | "interaction" | "frontend_error";
		name?: string;
		path?: string;
		severity?: "info" | "error";
		loadTimeMs?: number;
		offsetMs?: number;
	}>,
) {
	const t0 = Date.now();
	const res = await page.request.post("/v1/usage", {
		data: {
			events: events.map((e) => ({
				sessionId: e.sessionId,
				visitorId: e.visitorId,
				type: e.type,
				name: e.name ?? e.type,
				path: e.path ?? "/",
				title: "E2E",
				severity: e.severity,
				occurredAt: new Date(t0 + (e.offsetMs ?? 0)).toISOString(),
				properties: e.loadTimeMs != null ? { loadTimeMs: e.loadTimeMs } : {},
				context: {},
			})),
		},
		headers: { "X-API-Key": INGEST_KEY },
	});
	expect(res.ok(), `ingestUsage failed: ${res.status()}`).toBeTruthy();
}

// 1 ─ Live Tail ──────────────────────────────────────────────────────────

test.describe("Feature: Live Tail", () => {
	test("LIVE toggle opens SSE stream and renders newly-ingested logs", async ({
		page,
	}) => {
		page.on("console", (msg) => {
			if (msg.type() === "error") console.log("PAGE ERROR:", msg.text());
		});
		page.on("pageerror", (err) => console.log("PAGEERR:", err.message));

		await login(page);
		await page.goto("/#/logs");
		await page.getByRole("button", { name: /^LIVE$/i }).click();
		await expect(page.getByRole("button", { name: /●\s*LIVE/i })).toBeVisible({
			timeout: 10_000,
		});

		// After the button flips green, give the transform stream a moment
		// to flush the initial `: connected` comment and let React commit
		// the connected state before firing events.
		await page.waitForTimeout(500);

		// Fire a burst so a single dropped frame doesn't fail the test.
		const run = Date.now();
		const markers = [0, 1, 2, 3, 4].map((i) => `e2e-live-${run}-${i}`);
		await ingestLogs(
			page,
			"live-tail-e2e",
			markers.map((m) => ({ severity: "INFO", message: m })),
		);

		await expect(
			page.getByText(new RegExp(`e2e-live-${run}-\\d`)).first(),
		).toBeVisible({ timeout: 20_000 });
	});

	test("pause buffers events and RESUME flushes them into the list", async ({
		page,
	}) => {
		await login(page);
		await page.goto("/#/logs");

		const tailResponse = page.waitForResponse(
			(r) => r.url().includes("/internal/telemetry/tail") && r.status() === 200,
		);
		await page.getByRole("button", { name: /^LIVE$/i }).click();
		await tailResponse;
		await expect(page.getByRole("button", { name: /●\s*LIVE/i })).toBeVisible({
			timeout: 5000,
		});

		// Pause the stream.
		await page.getByRole("button", { name: /^PAUSE$/ }).click();

		// Fire three logs while paused.
		const prefix = `e2e-pause-${Date.now()}`;
		await ingestLogs(page, "live-tail-e2e", [
			{ severity: "WARN", message: `${prefix}-A` },
			{ severity: "WARN", message: `${prefix}-B` },
			{ severity: "WARN", message: `${prefix}-C` },
		]);

		// RESUME button should show a buffered count.
		await expect(
			page.getByRole("button", { name: /RESUME\s*\(\d+\)/ }),
		).toBeVisible({ timeout: 5000 });

		// Resume and verify all three buffered events are rendered.
		await page.getByRole("button", { name: /RESUME/ }).click();
		for (const suffix of ["A", "B", "C"]) {
			await expect(page.getByText(`${prefix}-${suffix}`)).toBeVisible({
				timeout: 3000,
			});
		}
	});
});

// 2 ─ Service/Dependency Map ─────────────────────────────────────────────

test.describe("Feature: Service Map", () => {
	test("service-map endpoint returns nodes and edges for cross-service traces", async ({
		page,
	}) => {
		await login(page);

		// Build a trace: frontend → api → db with a shared trace_id.
		// Services differ by using separate resourceSpans entries.
		const traceId = hex(16);
		const frontSpan = hex(8);
		const apiSpan = hex(8);
		const dbSpan = hex(8);
		const now = BigInt(Date.now()) * 1_000_000n;
		const mkSpan = (
			spanId: string,
			parent: string | undefined,
			name: string,
			offset: bigint,
			status: 1 | 2 = 1,
		) => ({
			traceId,
			spanId,
			parentSpanId: parent,
			name,
			kind: 2,
			startTimeUnixNano: String(now + offset),
			endTimeUnixNano: String(now + offset + 30_000_000n),
			status: { code: status },
		});
		const tag = `sm-${Date.now()}`;
		const res = await page.request.post("/v1/traces", {
			data: {
				resourceSpans: [
					{
						resource: { attributes: [kv("service.name", `${tag}-frontend`)] },
						scopeSpans: [
							{
								spans: [mkSpan(frontSpan, undefined, "GET /page", 0n)],
							},
						],
					},
					{
						resource: { attributes: [kv("service.name", `${tag}-api`)] },
						scopeSpans: [
							{
								spans: [
									mkSpan(apiSpan, frontSpan, "POST /work", 5_000_000n, 2),
								],
							},
						],
					},
					{
						resource: { attributes: [kv("service.name", `${tag}-db`)] },
						scopeSpans: [
							{
								spans: [mkSpan(dbSpan, apiSpan, "SELECT", 10_000_000n)],
							},
						],
					},
				],
			},
			headers: { "X-API-Key": INGEST_KEY },
		});
		expect(res.ok()).toBeTruthy();

		const body = await page.request
			.get("/internal/telemetry/service-map?hours=24")
			.then((r) => r.json());

		const services = new Set(
			(body.nodes as Array<{ service: string }>).map((n) => n.service),
		);
		expect(services.has(`${tag}-frontend`)).toBeTruthy();
		expect(services.has(`${tag}-api`)).toBeTruthy();
		expect(services.has(`${tag}-db`)).toBeTruthy();

		const edges = body.edges as Array<{
			source: string;
			target: string;
			calls: number;
			errorRate: number;
		}>;
		const frontToApi = edges.find(
			(e) => e.source === `${tag}-frontend` && e.target === `${tag}-api`,
		);
		const apiToDb = edges.find(
			(e) => e.source === `${tag}-api` && e.target === `${tag}-db`,
		);
		expect(frontToApi).toBeTruthy();
		expect(frontToApi?.calls).toBeGreaterThanOrEqual(1);
		expect(frontToApi?.errorRate).toBeGreaterThan(0); // api span was status=2
		expect(apiToDb).toBeTruthy();
		expect(apiToDb?.calls).toBeGreaterThanOrEqual(1);
	});

	test("Service Map tab renders React Flow nodes", async ({ page }) => {
		await login(page);
		await page.goto("/#/service-map");

		// At least one node should be rendered (pre-existing or seeded data).
		await expect(page.locator(".react-flow__node").first()).toBeVisible({
			timeout: 10_000,
		});
	});
});

// 3 ─ Sessions Explorer filters ──────────────────────────────────────────

test.describe("Feature: Sessions Explorer", () => {
	test("ended_in_error, dropoff, slow filters each return the seeded session", async ({
		page,
	}) => {
		await login(page);

		const suffix = Date.now().toString(36);
		const errSid = `e2e-err-${suffix}`;
		const dropSid = `e2e-drop-${suffix}`;
		const slowSid = `e2e-slow-${suffix}`;
		const healthySid = `e2e-good-${suffix}`;

		await ingestUsage(page, [
			// errored
			{ sessionId: errSid, visitorId: "v1", type: "page_view", path: "/e" },
			{
				sessionId: errSid,
				visitorId: "v1",
				type: "frontend_error",
				severity: "error",
				offsetMs: 100,
			},
			// dropoff (page view only, no interaction)
			{
				sessionId: dropSid,
				visitorId: "v2",
				type: "page_view",
				path: "/d",
			},
			// slow
			{
				sessionId: slowSid,
				visitorId: "v3",
				type: "page_view",
				path: "/s",
				loadTimeMs: 9000,
			},
			{
				sessionId: slowSid,
				visitorId: "v3",
				type: "interaction",
				offsetMs: 500,
			},
			// healthy — must not appear in any filter
			{
				sessionId: healthySid,
				visitorId: "v4",
				type: "page_view",
				path: "/h",
			},
			{
				sessionId: healthySid,
				visitorId: "v4",
				type: "interaction",
				offsetMs: 500,
			},
		]);

		const fetchFilter = async (filter: string) =>
			page.request
				.get(`/internal/usage/sessions?hours=72&filter=${filter}&limit=500`)
				.then((r) => r.json()) as Promise<{
				sessions: Array<{ sessionId: string }>;
			}>;

		const errored = await fetchFilter("ended_in_error");
		expect(errored.sessions.map((s) => s.sessionId)).toContain(errSid);
		expect(errored.sessions.map((s) => s.sessionId)).not.toContain(healthySid);

		const dropoff = await fetchFilter("dropoff");
		expect(dropoff.sessions.map((s) => s.sessionId)).toContain(dropSid);
		expect(dropoff.sessions.map((s) => s.sessionId)).not.toContain(healthySid);

		const slow = await fetchFilter("slow");
		expect(slow.sessions.map((s) => s.sessionId)).toContain(slowSid);
		expect(slow.sessions.map((s) => s.sessionId)).not.toContain(dropSid);
	});

	test("Usage tab filter chips toggle the sessions list", async ({ page }) => {
		await login(page);

		// Seed one errored session with a distinctive path so we can target it.
		// Both events carry the same path so `lastPath` in the session rollup
		// ends up as `pathTag`, not "/" (the default for events without path).
		const pathTag = `/e2e-errchip-${Date.now()}`;
		const sid = `e2e-chip-${Date.now()}`;
		await ingestUsage(page, [
			{ sessionId: sid, visitorId: "vc", type: "page_view", path: pathTag },
			{
				sessionId: sid,
				visitorId: "vc",
				type: "frontend_error",
				severity: "error",
				path: pathTag,
				offsetMs: 50,
			},
		]);

		await page.goto("/#/usage");

		// All chips visible (exact match — session rows may include these words).
		for (const label of ["All", "Errored", "Drop-off", "Slow"]) {
			await expect(
				page.getByRole("button", { name: label, exact: true }),
			).toBeVisible({ timeout: 5000 });
		}

		// Confirm the seed actually landed before testing UI.
		const apiBody = (await page.request
			.get("/internal/usage/sessions?hours=72&filter=ended_in_error&limit=500")
			.then((r) => r.json())) as {
			sessions: Array<{ sessionId: string; lastPath: string | null }>;
		};
		const found = apiBody.sessions.find((s) => s.sessionId === sid);
		expect(
			found,
			`seeded session ${sid} not returned by /internal/usage/sessions`,
		).toBeTruthy();

		// Set a wide viewport so the sessions panel (hidden under `lg:`) renders.
		await page.setViewportSize({ width: 1400, height: 900 });

		await page.getByRole("button", { name: "Errored", exact: true }).click();

		// The seeded session renders in the sessions panel — the panel-scoped
		// span shows `lastPath`, so target that span directly.
		await expect(
			page.locator("span.font-mono.font-bold").filter({ hasText: pathTag }),
		).toBeVisible({ timeout: 10_000 });
	});
});

// 4 ─ Unified Timeline ───────────────────────────────────────────────────

test.describe("Feature: Unified Timeline", () => {
	test("timeline endpoint merges spans, logs, and usage events for one session", async ({
		page,
	}) => {
		await login(page);

		const sid = `e2e-tl-${Date.now()}`;
		const parentId = hex(8);
		const childId = hex(8);
		await ingestTrace(page, "tl-e2e", [
			{ spanId: parentId, name: "GET /dashboard", sessionId: sid },
			{
				spanId: childId,
				parentSpanId: parentId,
				name: "db.query",
				statusCode: 2,
				statusMessage: "timeout",
				sessionId: sid,
			},
		]);
		await ingestLogs(page, "tl-e2e", [
			{ severity: "INFO", message: "request received", sessionId: sid },
			{ severity: "ERROR", message: "db timeout", sessionId: sid },
		]);
		await ingestUsage(page, [
			{ sessionId: sid, visitorId: "v", type: "page_view", path: "/dashboard" },
			{
				sessionId: sid,
				visitorId: "v",
				type: "interaction",
				name: "click",
				offsetMs: 500,
			},
		]);

		const body = await page.request
			.get(`/internal/timeline/${encodeURIComponent(sid)}`)
			.then((r) => r.json());

		expect(body.sessionId).toBe(sid);
		expect(body.counts.spans).toBe(2);
		expect(body.counts.logs).toBe(2);
		expect(body.counts.usage).toBe(2);

		const kinds = (body.events as Array<{ kind: string }>).map((e) => e.kind);
		expect(kinds).toContain("span");
		expect(kinds).toContain("log");
		expect(kinds).toContain("usage");

		// Events must be time-sorted ascending.
		const timestamps = (body.events as Array<{ t: string }>).map((e) => e.t);
		const sorted = [...timestamps].sort();
		expect(timestamps).toEqual(sorted);
	});

	test("Timeline tab renders three lanes and the event list for a seeded session", async ({
		page,
	}) => {
		await login(page);

		const sid = `e2e-tl-ui-${Date.now()}`;
		await ingestTrace(page, "tl-ui-e2e", [
			{ spanId: hex(8), name: "GET /x", sessionId: sid },
		]);
		await ingestLogs(page, "tl-ui-e2e", [
			{ severity: "INFO", message: `ui-log-${sid}`, sessionId: sid },
		]);
		await ingestUsage(page, [
			{ sessionId: sid, visitorId: "v", type: "page_view", path: "/x" },
		]);

		await page.goto(`/#/timeline?session=${sid}`);

		// Header kind filter chips with counts.
		await expect(page.getByRole("button", { name: /Spans · \d+/ })).toBeVisible(
			{ timeout: 10_000 },
		);
		await expect(
			page.getByRole("button", { name: /Logs · \d+/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Usage · \d+/ }),
		).toBeVisible();

		// Event list shows the seeded log message.
		await expect(page.getByText(`ui-log-${sid}`)).toBeVisible({
			timeout: 5000,
		});
	});
});
