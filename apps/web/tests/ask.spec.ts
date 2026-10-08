import { expect, type Page, type Route, test } from "@playwright/test";

/*
 * E2E coverage for RFC 0002 Stage 5 — Ask box.
 *
 * The collector's /internal/ask runs an LLM tool-use loop on the server.
 * For e2e we mock the response shape directly — testing that the AskBox
 * UI calls the right endpoint, renders the answer + evidence + queries,
 * and handles error states.
 */

const json = (route: Route, body: string, status = 200) =>
	route.fulfill({ status, contentType: "application/json", body });

const NOW = new Date("2026-04-28T00:00:00Z").toISOString();

const STUB_ANSWER = {
	answer: "errors at 5% in the last 5 minutes, up from 1% (overall_error_rate)",
	evidence: [
		{
			analysisId: "overall_error_rate",
			definition: {
				id: "overall_error_rate",
				title: "Overall error rate",
				group: "Health",
				source: "tier0",
				view: "tile",
				refreshSeconds: 60,
			},
			result: {
				analysisId: "overall_error_rate",
				projectId: "default",
				generatedAt: NOW,
				paramsHash: null,
				status: "warn",
				primaryValue: 0.05,
				baselineValue: 0.01,
				deltaPct: 400,
				payload: {},
				narrative: null,
				narrativeSignature: "warn|0.05|0.01|",
				durationMs: 5,
			},
		},
	],
	queries: [
		{ tool: "list_analyses", args: { group: "Health" }, durationMs: 12 },
		{ tool: "run_analysis", args: { id: "overall_error_rate" }, durationMs: 7 },
	],
	error: null,
	timestamp: NOW,
};

async function mockAsk(
	page: Page,
	response: object | null = STUB_ANSWER,
	status = 200,
) {
	const seen: { url: string; body: string }[] = [];
	await page.route(/\/auth\/check/, (route) =>
		json(route, JSON.stringify({ authenticated: true })),
	);
	await page.route(/\/internal\//, async (route) => {
		const url = route.request().url();
		const method = route.request().method();
		if (method === "POST" && url.endsWith("/internal/ask")) {
			seen.push({
				url,
				body: route.request().postData() ?? "",
			});
			return json(route, JSON.stringify(response ?? {}), status);
		}
		// Default empty analyses payload so the rest of the page doesn't error.
		if (url.includes("/analyses/results")) {
			return json(route, JSON.stringify({ results: [], timestamp: NOW }));
		}
		return json(route, '{"status":"ok"}');
	});
	await page.route(/\/api\//, (route) => json(route, '{"status":"ok"}'));
	return { seen };
}

test.describe("Ask box", () => {
	test("toggle button reveals the input", async ({ page }) => {
		await mockAsk(page);
		await page.goto("/");

		await expect(page.locator("[data-test-ask-toggle]")).toBeVisible({
			timeout: 10000,
		});
		await page.locator("[data-test-ask-toggle]").click();
		await expect(page.locator("[data-test-ask-panel]")).toBeVisible();
		await expect(page.locator("[data-test-ask-input]")).toBeFocused();
	});

	test("submitting a question renders the answer + evidence", async ({
		page,
	}) => {
		const { seen } = await mockAsk(page);
		await page.goto("/");
		await page.locator("[data-test-ask-toggle]").click();
		await page.locator("[data-test-ask-input]").fill("any errors?");
		await page.locator("[data-test-ask-input]").press("Enter");

		await expect(page.locator("[data-test-ask-answer]")).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("[data-test-ask-answer]")).toContainText(
			"errors at 5%",
		);
		// Evidence chip links to the analysis on the dashboard.
		await expect(
			page.locator('[data-test-ask-evidence="overall_error_rate"]'),
		).toBeVisible();

		// POST body went out with the question.
		expect(seen.length).toBe(1);
		expect(seen[0]?.body).toContain("any errors?");
	});

	test("Show queries expands the audit log", async ({ page }) => {
		await mockAsk(page);
		await page.goto("/");
		await page.locator("[data-test-ask-toggle]").click();
		await page.locator("[data-test-ask-input]").fill("any errors?");
		await page.locator("[data-test-ask-input]").press("Enter");
		await expect(page.locator("[data-test-ask-answer]")).toBeVisible({
			timeout: 10000,
		});

		// Queries collapsed initially.
		await expect(page.locator("[data-test-ask-queries]")).toHaveCount(0);

		await page.locator("[data-test-ask-toggle-queries]").click();
		await expect(page.locator("[data-test-ask-queries]")).toBeVisible();
		await expect(page.locator("[data-test-ask-queries]")).toContainText(
			"list_analyses",
		);
		await expect(page.locator("[data-test-ask-queries]")).toContainText(
			"run_analysis",
		);
	});

	test("503 from /ask renders a configuration error", async ({ page }) => {
		await mockAsk(
			page,
			{
				answer: null,
				evidence: [],
				queries: [],
				error:
					"Ask is not configured — set OPENAI_API_KEY or ANTHROPIC_API_KEY on the collector to enable it.",
				timestamp: NOW,
			},
			503,
		);
		await page.goto("/");
		await page.locator("[data-test-ask-toggle]").click();
		await page.locator("[data-test-ask-input]").fill("any errors?");
		await page.locator("[data-test-ask-input]").press("Enter");

		await expect(page.locator("[data-test-ask-error]")).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("[data-test-ask-error]")).toContainText(
			/OPENAI_API_KEY|ANTHROPIC_API_KEY/i,
		);
	});
});
