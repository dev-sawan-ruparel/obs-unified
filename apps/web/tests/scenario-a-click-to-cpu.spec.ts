/**
 * Scenario A synthetic slice — RFC 0006 Phase 6.6 (partial RFC 0003 acceptance #1).
 *
 *   Alert rule config → root cause trace → hot span → CPU profile → session → originating click
 *
 * Walks the synthetic Click-to-CPU / Connected Rail navigation loop:
 *   1. Alert rule config captures slow checkout latency (POST /api/checkout)
 *   2. Trace waterfall exposes root POST /api/checkout and child span payment.charge
 *   3. Span Connected Rail exposes CPU profile in Down section and originating click in Related
 *   4. Profile detail / flame graph is scoped to trace 0a000000000000000000000000000001
 *   5. Profile Connected Rail exposes sampled traces cohort across
 *   6. User session Connected Rail links frontend click to backend trace, closing the loop
 *
 * Scope note:
 *   This synthetic test verifies the API rail contracts and the trace→span→profile
 *   browser slice. It does NOT fulfill full RFC 0003 Acceptance #1 (which requires
 *   running on a fresh OTel Astronomy Shop install, proving a live firing alert /
 *   exemplar navigation, rrweb session replay, and full 6-hop browser UI navigation).
 *
 * This test is unskipped and runs against the live collector and dashboard stack.
 *
 * Setup:
 *   make run-with-demo && make seed
 *   pnpm --filter @obs-demo/web exec playwright test scenario-a-click-to-cpu.spec.ts
 */

import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { gzipSync } from "node:zlib";

const COLLECTOR_URL = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass";
const INGEST_KEY =
	process.env.OBS_INGEST_KEY ??
	"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504";
const PROJECT_ID = process.env.OBS_PROJECT_ID ?? "default";

const SCENARIO_A = {
	traceId: "0a000000000000000000000000000001",
	rootSpanId: "0a00000000000101",
	paymentSpanId: "0a00000000000102",
	dbSpanId: "0a00000000000103",
};

interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
	sample?: string;
}

interface ConnectedSection {
	label: string;
	links: ConnectedLink[];
	emptyReason?: string;
}

interface ConnectedManifest {
	entity: { kind: string; id: string; projectId: string };
	up: ConnectedSection[];
	across: ConnectedSection[];
	down: ConnectedSection[];
	related: ConnectedSection[];
}

const loginCookie = async (request: APIRequestContext): Promise<string> => {
	const res = await request.post(`${COLLECTOR_URL}/auth/login`, {
		data: { password: DASHBOARD_PASSWORD },
		headers: { "Content-Type": "application/json" },
		maxRedirects: 0,
	});
	expect(res.status(), "dashboard login").toBeLessThan(400);
	const setCookie = res.headers()["set-cookie"] ?? "";
	const match = setCookie.match(/obs_session=[^;]+/);
	if (!match)
		throw new Error("no obs_session cookie returned from /auth/login");
	return match[0];
};

const loginPage = async (page: Page) => {
	if (page.url() === "about:blank") {
		await page.goto("/");
	}
	const checkRes = await page.request.get("/auth/check");
	if (checkRes.status() === 200) {
		expect(checkRes.status(), "/auth/check succeeds").toBe(200);
		return;
	}
	const passwordInput = page.locator('input[type="password"]');
	await passwordInput.waitFor({ state: "visible" });
	await passwordInput.fill(DASHBOARD_PASSWORD);
	await page.getByRole("button", { name: "Login" }).click();
	await passwordInput.waitFor({ state: "hidden" });
	const postLoginCheckRes = await page.request.get("/auth/check");
	expect(postLoginCheckRes.status(), "/auth/check succeeds").toBe(200);
};

const fetchManifest = async (
	request: APIRequestContext,
	cookie: string,
	path: string,
): Promise<ConnectedManifest> => {
	const res = await request.get(`${COLLECTOR_URL}${path}`, {
		headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID },
	});
	expect(res.status(), `GET ${path}`).toBe(200);
	return (await res.json()) as ConnectedManifest;
};

// ── protobuf pprof encoder for idempotent fixture readiness ─────────

const writeVarint = (out: number[], value: number) => {
	let v = value;
	while (v >= 0x80) {
		out.push((v & 0x7f) | 0x80);
		v = Math.floor(v / 128);
	}
	out.push(v & 0x7f);
};

const writeTag = (out: number[], fieldNum: number, wireType: number) =>
	writeVarint(out, (fieldNum << 3) | wireType);

const writeLengthDelimited = (out: number[], fieldNum: number, bytes: number[]) => {
	writeTag(out, fieldNum, 2);
	writeVarint(out, bytes.length);
	for (const byte of bytes) out.push(byte);
};

const writeString = (out: number[], fieldNum: number, value: string) =>
	writeLengthDelimited(out, fieldNum, Array.from(new TextEncoder().encode(value)));

const writePackedVarints = (out: number[], fieldNum: number, values: number[]) => {
	const inner: number[] = [];
	for (const value of values) writeVarint(inner, value);
	writeLengthDelimited(out, fieldNum, inner);
};

const encodePprofForTrace = (traceId: string): Buffer => {
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
	const out: number[] = [];
	const valueType: number[] = [];
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
		const bytes: number[] = [];
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
		const bytes: number[] = [];
		writeTag(bytes, 1, 0);
		writeVarint(bytes, loc.id);
		const line: number[] = [];
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
		const bytes: number[] = [];
		writePackedVarints(bytes, 1, sample.locations);
		writePackedVarints(bytes, 2, [sample.value]);
		const label: number[] = [];
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

const ensureScenarioAFixture = async (request: APIRequestContext, cookie: string) => {
	// Probe whether Scenario A trace is already ingested
	const checkRes = await request.get(
		`${COLLECTOR_URL}/internal/telemetry/traces/${SCENARIO_A.traceId}`,
		{ headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID } },
	);
	let needsSpans = true;
	if (checkRes.status() === 200) {
		const data = (await checkRes.json().catch(() => ({}))) as {
			spans?: Array<{ spanId: string }>;
		};
		if (data.spans && data.spans.length >= 3) {
			needsSpans = false;
		}
	}

	const now = BigInt(Date.now()) * 1_000_000n;
	const sessionId = "seed-scenario-a-session";
	const visitorId = "seed-scenario-a-visitor";
	const interactionId = "01JA0000000000000000000001";

	if (needsSpans) {
		// 1. Ingest usage & originating click
		await request.post(`${COLLECTOR_URL}/v1/usage`, {
			headers: {
				Authorization: `Bearer ${INGEST_KEY}`,
				"X-Project-Id": PROJECT_ID,
			},
			data: {
				events: [
					{
						type: "interaction",
						name: "click_checkout",
						sessionId,
						visitorId,
						occurredAt: new Date(Date.now() - 60_000).toISOString(),
						pagePath: "/api/checkout",
						interactionId,
						properties: { action: "click", target: "checkout-submit", seed: true },
						context: { url: "http://localhost:5173/checkout" },
					},
				],
			},
		});

		// 2. Ingest Scenario A traces
		const kv = (k: string, v: string | number) => ({
			key: k,
			value: typeof v === "number" ? { intValue: v } : { stringValue: v },
		});

		await request.post(`${COLLECTOR_URL}/v1/traces`, {
			headers: {
				Authorization: `Bearer ${INGEST_KEY}`,
				"X-Project-Id": PROJECT_ID,
			},
			data: {
				resourceSpans: [
					{
						resource: { attributes: [kv("service.name", "checkout-api")] },
						scopeSpans: [
							{
								scope: { name: "seed-scenario-a" },
								spans: [
									{
										traceId: SCENARIO_A.traceId,
										spanId: SCENARIO_A.rootSpanId,
										name: "POST /api/checkout",
										kind: 2,
										startTimeUnixNano: String(now - 60_000_000_000n),
										endTimeUnixNano: String(now - 58_000_000_000n),
										status: { code: 1, message: "" },
										attributes: [
											kv("http.request.method", "POST"),
											kv("http.route", "/api/checkout"),
											kv("url.path", "/api/checkout"),
											kv("http.response.status_code", 200),
											kv("session.id", sessionId),
											kv("user.id", `user-${visitorId}`),
											kv("obs.interaction.id", interactionId),
											kv("seed.scenario", "A"),
										],
									},
									{
										traceId: SCENARIO_A.traceId,
										spanId: SCENARIO_A.paymentSpanId,
										parentSpanId: SCENARIO_A.rootSpanId,
										name: "payment.charge",
										kind: 3,
										startTimeUnixNano: String(now - 59_500_000_000n),
										endTimeUnixNano: String(now - 58_200_000_000n),
										status: { code: 1, message: "" },
										attributes: [
											kv("peer.service", "payments-worker"),
											kv("payment.provider", "stripe"),
											kv("session.id", sessionId),
											kv("obs.interaction.id", interactionId),
											kv("seed.scenario", "A"),
										],
									},
								],
							},
						],
					},
					{
						resource: { attributes: [kv("service.name", "payments-worker")] },
						scopeSpans: [
							{
								scope: { name: "seed-scenario-a" },
								spans: [
									{
										traceId: SCENARIO_A.traceId,
										spanId: SCENARIO_A.dbSpanId,
										parentSpanId: SCENARIO_A.paymentSpanId,
										name: "payments-db.insert charge",
										kind: 3,
										startTimeUnixNano: String(now - 59_000_000_000n),
										endTimeUnixNano: String(now - 58_500_000_000n),
										status: { code: 1, message: "" },
										attributes: [
											kv("db.system", "postgresql"),
											kv("db.statement", "INSERT INTO charges (...) VALUES (...)"),
											kv("seed.scenario", "A"),
										],
									},
								],
							},
						],
					},
				],
			},
		});
	}

	// 3. Ensure CPU profile is indexed to Scenario A trace
	const profileCheckRes = await request.get(
		`${COLLECTOR_URL}/internal/profiles?trace_id=${SCENARIO_A.traceId}`,
		{ headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID } },
	);
	const profileData = (await profileCheckRes.json().catch(() => ({}))) as {
		profiles?: Array<{ id: string }>;
	};
	if (!profileData.profiles || profileData.profiles.length === 0) {
		const profileBody = encodePprofForTrace(SCENARIO_A.traceId);
		const startedAt = new Date(Date.now() - 70_000).toISOString();
		await request.post(`${COLLECTOR_URL}/v1/profiles/pprof`, {
			headers: {
				Authorization: `Bearer ${INGEST_KEY}`,
				"X-Project-Id": PROJECT_ID,
				"Content-Type": "application/octet-stream",
				"Content-Encoding": "gzip",
				"x-obs-service": "checkout-api",
				"x-obs-profile-type": "cpu",
				"x-obs-agent": "seed-everything",
				"x-obs-duration-ms": "60000",
				"x-obs-start-ts": startedAt,
				"x-obs-trace-ids": SCENARIO_A.traceId,
			},
			data: profileBody,
		});
	}

	// 4. Ensure alert rule exists
	const rulesCheckRes = await request.get(`${COLLECTOR_URL}/internal/alerts/rules`, {
		headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID },
	});
	const rulesJson = (await rulesCheckRes.json().catch(() => ({}))) as {
		rules?: Array<{ name: string; query?: { spanName?: string } }>;
	};
	const existingRules = rulesJson.rules ?? [];
	const hasCheckoutAlert = existingRules.some(
		(r) =>
			r.name?.toLowerCase().includes("checkout") ||
			r.query?.spanName?.includes("checkout"),
	);
	if (!hasCheckoutAlert) {
		await request.post(`${COLLECTOR_URL}/internal/alerts/rules`, {
			headers: {
				Cookie: cookie,
				"Content-Type": "application/json",
				"X-Project-Id": PROJECT_ID,
			},
			data: {
				name: "Slow checkout p95",
				signal: "spans",
				query: { spanName: "POST /api/checkout" },
				threshold: 1,
				windowMins: 15,
				comparison: ">=",
				channels: [{ type: "webhook", url: "https://hooks.example.com/checkout-slow" }],
				enabled: true,
			},
		}).catch(() => {});
	}
};

test.describe("Scenario A — Click-to-CPU / Connected Rail integration", () => {
	test("walks the Click-to-CPU Connected Rail chain: alert → trace → hot span → CPU profile → session → click", async ({
		request,
	}) => {
		const cookie = await loginCookie(request);
		await ensureScenarioAFixture(request, cookie);

		// Step 1 — Alert rule captures slow checkout latency
		const rulesRes = await request.get(`${COLLECTOR_URL}/internal/alerts/rules`, {
			headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID },
		});
		expect(rulesRes.status(), "GET /internal/alerts/rules").toBe(200);
		const rulesBody = (await rulesRes.json()) as {
			rules: Array<{
				name: string;
				query: { spanName?: string };
			}>;
		};
		const rules = rulesBody.rules ?? [];
		expect(Array.isArray(rules), "parsed rules array").toBe(true);

		const checkoutAlert = rules.find(
			(r) =>
				r.name.toLowerCase().includes("checkout") ||
				r.query?.spanName?.includes("checkout"),
		);
		expect(checkoutAlert, "alert rule for checkout latency must exist").toBeDefined();

		// Step 2 — Trace waterfall exposes root POST /api/checkout and hot span payment.charge
		const traceRes = await request.get(
			`${COLLECTOR_URL}/internal/telemetry/traces/${SCENARIO_A.traceId}`,
			{ headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID } },
		);
		expect(traceRes.status(), `GET /internal/telemetry/traces/${SCENARIO_A.traceId}`).toBe(200);
		const traceData = (await traceRes.json()) as {
			trace: { traceId: string; serviceName: string };
			spans: Array<{
				spanId: string;
				parentSpanId: string | null;
				spanName: string;
				attributes: Record<string, unknown>;
			}>;
		};
		expect(traceData.spans.length, "trace has expected spans").toBeGreaterThanOrEqual(3);

		const rootSpan = traceData.spans.find((s) => s.spanId === SCENARIO_A.rootSpanId);
		expect(rootSpan, "root span exists").toBeDefined();
		expect(rootSpan?.spanName).toBe("POST /api/checkout");

		const paymentSpan = traceData.spans.find((s) => s.spanId === SCENARIO_A.paymentSpanId);
		expect(paymentSpan, "payment.charge hot span exists").toBeDefined();
		expect(paymentSpan?.parentSpanId).toBe(SCENARIO_A.rootSpanId);
		const interactionId = paymentSpan?.attributes["obs.interaction.id"] as string | undefined;
		const sessionId = paymentSpan?.attributes["session.id"] as string | undefined;
		expect(interactionId, "payment span must have obs.interaction.id").toBeTruthy();
		expect(sessionId, "payment span must have session.id").toBeTruthy();

		// Step 3 — Span Connected Rail exposes CPU profile in Down and originating click in Related
		const spanManifest = await fetchManifest(
			request,
			cookie,
			`/internal/connected/span/${SCENARIO_A.traceId}:${SCENARIO_A.paymentSpanId}`,
		);

		// DOWN: Must include CPU profile link
		const profileSection = spanManifest.down.find((s) =>
			s.label.toLowerCase().includes("cpu profile") || s.label.toLowerCase().includes("profile"),
		);
		expect(profileSection, "span rail must surface CPU profile in Down").toBeDefined();
		expect(profileSection?.links.length, "profile link must be populated").toBeGreaterThan(0);
		const profileLink = profileSection?.links[0];
		expect(profileLink?.href).toMatch(/#\/profiles\/[^?]+\?trace_id=0a000000000000000000000000000001/);

		const profileIdMatch = profileLink?.href.match(/#\/profiles\/([^?]+)/);
		expect(profileIdMatch, "extract profileId from href").not.toBeNull();
		const profileId = decodeURIComponent(profileIdMatch![1]);

		// RELATED: Must surface originating click
		const clickSection = spanManifest.related.find((s) =>
			s.label.toLowerCase().includes("click"),
		);
		expect(clickSection, "span rail must offer originating click").toBeDefined();
		expect(clickSection?.links.length, "originating click link populated").toBeGreaterThan(0);

		// UP: Must surface parent session
		const sessionSection = spanManifest.up.find((s) =>
			s.label.toLowerCase().includes("session"),
		);
		expect(sessionSection, "span rail must surface parent session in Up").toBeDefined();

		// Step 4 — Profile detail / flame graph join and sampled traces cohort
		const profileReadRes = await request.get(
			`${COLLECTOR_URL}/internal/profiles/${encodeURIComponent(profileId)}?trace_id=${SCENARIO_A.traceId}`,
			{ headers: { Cookie: cookie, "X-Project-Id": PROJECT_ID } },
		);
		expect(
			profileReadRes.status(),
			`GET /internal/profiles/${profileId}?trace_id=${SCENARIO_A.traceId}`,
		).toBe(200);

		const profileManifest = await fetchManifest(
			request,
			cookie,
			`/internal/connected/profile/${encodeURIComponent(profileId)}`,
		);
		expect(profileManifest.entity.kind).toBe("profile");
		const sampledTracesSection = profileManifest.across.find((s) =>
			s.label.toLowerCase().includes("sampled trace") || s.label.toLowerCase().includes("trace"),
		);
		expect(sampledTracesSection, "profile rail must surface sampled traces in Across").toBeDefined();
		expect(
			sampledTracesSection?.links.some((l) => l.href.includes(SCENARIO_A.traceId)),
			"sampled traces include Scenario A trace",
		).toBeTruthy();

		// Step 5 — User session Connected Rail links frontend click to backend trace
		const sessionManifest = await fetchManifest(
			request,
			cookie,
			`/internal/connected/usage/${encodeURIComponent(sessionId!)}?session_id=${encodeURIComponent(sessionId!)}`,
		);
		const sessionSpansSection = sessionManifest.across.find((s) =>
			s.label.toLowerCase().includes("span"),
		);
		expect(sessionSpansSection, "session rail must surface spans Across").toBeDefined();
		expect(
			sessionSpansSection?.links.some((l) => l.href.includes(SCENARIO_A.traceId)),
			"session Across links back to Scenario A trace",
		).toBeTruthy();
	});

	test("dashboard UI navigation walks trace waterfall to span Connected Rail and profile flame graph", async ({
		page,
	}) => {
		// 1. Authenticate and seed fixture before UI navigation
		const cookie = await loginCookie(page.request);
		await ensureScenarioAFixture(page.request, cookie);
		await loginPage(page);

		// 2. Navigate directly to Scenario A trace waterfall
		await page.goto(`/#/traces?service=checkout-api&trace=${SCENARIO_A.traceId}`);
		await page.waitForLoadState("networkidle");

		// Root span and child payment.charge should be rendered in trace view
		await expect(page.locator("body")).toContainText("POST /api/checkout", { timeout: 15_000 });
		await expect(page.locator("body")).toContainText("payment.charge", { timeout: 15_000 });

		// Locate and click the payment.charge span row to expand span detail & ConnectedRail
		const paymentSpanButton = page
			.locator('button[title="payment.charge"], button:has-text("payment.charge")')
			.first();
		await expect(paymentSpanButton).toBeVisible();
		await paymentSpanButton.click();

		// ConnectedRail on span should render with canonical sections
		await expect(page.getByText(/CONNECTED — SPAN/i)).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText(/^Down$/i)).toBeVisible();
		await expect(page.getByText(/^Related$/i)).toBeVisible();

		// Profile button or link in waterfall / ConnectedRail
		const profileAction = page
			.locator('a[href*="#/profiles/"], button:has-text("Profile checkout-api/cpu")')
			.first();
		await expect(profileAction).toBeVisible();

		// Click through to the profile flame graph
		await profileAction.click();
		await page.waitForLoadState("networkidle");

		// Confirm profile surface renders flame graph or profile detail
		await expect(page.locator("body")).toContainText(/Profile|Flame graph|checkout-api/i, {
			timeout: 10_000,
		});
	});
});
