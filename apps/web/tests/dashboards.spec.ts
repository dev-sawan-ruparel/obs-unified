import { test, expect, type Page, type Route } from "@playwright/test";

/*
 * E2E tests for the obs-unified dashboard.
 *
 * All tests mock API responses via Playwright route interception so
 * they run without any backend services.
 *
 * Run:   pnpm exec playwright test
 * UI:    pnpm exec playwright test --ui
 * Debug: pnpm exec playwright test --debug
 */

const json = (route: Route, body: string) =>
	route.fulfill({ status: 200, contentType: "application/json", body });

const EMPTY = {
	traces: JSON.stringify({ traces: [], services: [], summary: { totalTraces: 0, errorTraces: 0, successTraces: 0, errorRate: 0, averageDurationMs: 0, p95DurationMs: 0 }, timestamp: "" }),
	issues: JSON.stringify({ issues: [], services: [], summary: { totalIssues: 0, criticalIssues: 0, highIssues: 0, affectedTraces: 0, errorIssues: 0, latencyIssues: 0, dependencyIssues: 0 }, timestamp: "" }),
	logs: JSON.stringify({ logs: [], summary: { totalLogs: 0, errorLogs: 0, warnLogs: 0 }, windowHours: 24, timestamp: "" }),
	ai: JSON.stringify({ calls: [], summary: { totalCalls: 0, totalCostUsd: 0, totalPromptTokens: 0, totalCompletionTokens: 0, errorCalls: 0 }, windowHours: 24, timestamp: "" }),
};

/** Intercept all /api/ requests with sensible defaults. Overrides keyed by URL substring. */
async function mockApis(page: Page, overrides?: Record<string, (route: Route) => void>) {
	await page.route(/\/api\//, async (route) => {
		const url = route.request().url();

		// Check test-specific overrides first
		for (const [pattern, handler] of Object.entries(overrides ?? {})) {
			if (url.includes(pattern)) return handler(route);
		}

		// Default stubs
		const p = new URL(url).pathname;
		if (p.includes("/telemetry/overview")) return json(route, EMPTY.traces);
		if (p.includes("/telemetry/issues")) return json(route, EMPTY.issues);
		if (p.includes("/logs/overview")) return json(route, EMPTY.logs);
		if (p.includes("/ai/overview")) return json(route, EMPTY.ai);
		if (p.includes("/telemetry/export")) return json(route, "{}");
		if (p.includes("/replays")) return json(route, '{"replays":[]}');
		if (p.includes("/usage/stream")) return route.abort();
		if (p.includes("/usage/sessions")) return json(route, "{}");
		if (p.includes("/platform/resources")) return json(route, '{"plugins":[],"database":{"tables":[]}}');
		return json(route, '{"status":"ok"}');
	});
}

// ── Navigation ──

test.describe("Navigation", () => {
	test("default route redirects to traces", async ({ page }) => {
		await mockApis(page);
		await page.goto("/");
		await expect(page).toHaveURL(/\/#\/traces/);
	});

	test("tab bar renders all expected tabs", async ({ page }) => {
		await mockApis(page);
		await page.goto("/");
		for (const label of [
			"Playground", "Traces", "Issues", "Logs",
			"AI Calls", "Usage", "Replays", "Resources",
		]) {
			await expect(page.locator("button", { hasText: label })).toBeVisible();
		}
	});

	test("clicking tabs changes URL hash", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/playground");
		await page.waitForLoadState("domcontentloaded");
		await page.locator("button", { hasText: "Logs" }).click();
		await expect(page).toHaveURL(/\/#\/logs/);
		await page.locator("button", { hasText: "Replays" }).click();
		await expect(page).toHaveURL(/\/#\/replay/);
	});
});

// ── Traces Dashboard ──

test.describe("Traces Dashboard", () => {
	test("renders traces with mocked data", async ({ page }) => {
		const now = new Date().toISOString();
		const body = JSON.stringify({
			traces: [{
				traceId: "abc123", serviceName: "demo-api", spanName: "GET /api/items",
				statusCode: 1, statusMessage: null, durationMs: 42,
				startTime: now, endTime: now, receivedAt: now,
				spanCount: 3, errorSpanCount: 0,
			}],
			services: [{ serviceName: "demo-api", traceCount: 3, errorTraceCount: 0 }],
			summary: { totalTraces: 1, errorTraces: 0, successTraces: 1, errorRate: 0, averageDurationMs: 42, p95DurationMs: 42 },
			timestamp: now,
		});
		await mockApis(page, {
			"/telemetry/overview": (r) => json(r, body),
		});
		await page.goto("/#/traces");
		await expect(page.locator("text=GET /api/items")).toBeVisible({ timeout: 10000 });
	});
});

// ── Issues Dashboard ──

test.describe("Issues Dashboard", () => {
	test("renders issues with mocked data", async ({ page }) => {
		const now = new Date().toISOString();
		const body = JSON.stringify({
			issues: [{
				issueId: "err-timeout", title: "Connection Timeout",
				category: "error", severity: "high",
				serviceName: "demo-api", routeLabel: "GET /timeout",
				occurrenceCount: 12, affectedTraceCount: 5,
				lastSeen: now, latestStatusMessage: null,
				culpritSpanName: "db.query", dependencyTarget: null,
				sampleTraceId: "abc",
			}],
			services: [{ serviceName: "demo-api", issueCount: 1 }],
			summary: { totalIssues: 1, criticalIssues: 0, highIssues: 1, affectedTraces: 5, errorIssues: 1, latencyIssues: 0, dependencyIssues: 0 },
			timestamp: now,
		});
		await mockApis(page, {
			"/telemetry/issues": (r) => json(r, body),
		});
		await page.goto("/#/issues");
		await expect(page.locator("text=GET /timeout")).toBeVisible({ timeout: 10000 });
	});
});

// ── Logs Dashboard ──

test.describe("Logs Dashboard", () => {
	test("renders and displays log entries", async ({ page }) => {
		const body = JSON.stringify({
			summary: { totalLogs: 2, errorLogs: 1, warnLogs: 0 },
			logs: [
				{ logId: "1", severity: "INFO", loggerName: "test-logger", message: "Database query successful", occurredAt: new Date().toISOString() },
				{ logId: "2", severity: "ERROR", loggerName: "test-logger", message: "Connection timeout", occurredAt: new Date().toISOString() },
			],
			windowHours: 24, timestamp: new Date().toISOString(),
		});
		await mockApis(page, {
			"/logs/overview": (r) => json(r, body),
		});
		await page.goto("/#/logs");
		await expect(page.locator("text=Database query successful")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Connection timeout")).toBeVisible();
		await expect(page.locator("text=ERROR").first()).toBeVisible();
	});

	// Error state tests require package dashboard changes (tracked separately)
});

// ── AI Calls Dashboard ──

test.describe("AI Calls Dashboard", () => {
	test("renders and displays AI call stats", async ({ page }) => {
		const body = JSON.stringify({
			summary: { totalCalls: 42, totalCostUsd: 0.154, totalPromptTokens: 100, totalCompletionTokens: 50, errorCalls: 1 },
			calls: [{
				callId: "1", callType: "chat", modelName: "gpt-4o", provider: "openai",
				isError: false, requestJson: "Summarize this log",
				responseJson: "The log indicates a connection timeout",
				occurredAt: new Date().toISOString(),
			}],
			windowHours: 24, timestamp: new Date().toISOString(),
		});
		await mockApis(page, {
			"/ai/overview": (r) => json(r, body),
		});
		await page.goto("/#/ai");
		await expect(page.locator("text=TOTAL CALLS")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=42").first()).toBeVisible();
		await expect(page.locator("text=gpt-4o")).toBeVisible();
	});

	// Error state tests require package dashboard changes (tracked separately)
});

// ── Usage Dashboard ──

test.describe("Usage Dashboard", () => {
	test("renders usage tab", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/usage");
		await expect(page.locator("button", { hasText: "Usage" })).toBeVisible();
	});
});

// ── Replays Dashboard ──

test.describe("Replays Dashboard", () => {
	test("renders replay list with mocked data", async ({ page }) => {
		const body = JSON.stringify({
			replays: [{
				session_id: "sess-001", visitor_id: "v-001",
				chunk_count: 3, events_count: 45,
				first_chunk_at: new Date().toISOString(),
				last_chunk_at: new Date().toISOString(),
				starting_link: "/dashboard",
			}],
		});
		await mockApis(page, {
			"/replays": (r) => json(r, body),
		});
		await page.goto("/#/replay");
		// Replay list shows starting_link and events count
		await expect(page.locator("text=/dashboard/").first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=45 EVENTS").first()).toBeVisible();
	});
});

// ── Resources Dashboard ──

test.describe("Resources Dashboard", () => {
	test("renders resources view", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/resources");
		await expect(page.locator("button", { hasText: "Resources" })).toBeVisible();
	});
});

// ── Playground ──

test.describe("Playground", () => {
	test("renders API test buttons", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/playground");
		for (const label of ["Health", "Items", "Error", "Mock AI Chat"]) {
			await expect(page.locator("button", { hasText: label })).toBeVisible();
		}
	});

	test("health button calls API and shows response", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/playground");
		await page.locator("button", { hasText: "Health" }).click();
		await expect(page.locator("pre")).toContainText("ok", { timeout: 5000 });
	});
});
