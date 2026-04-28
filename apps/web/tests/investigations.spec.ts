import { test, expect, type Page, type Route } from "@playwright/test";

/*
 * E2E coverage for RFC 0002 Stage 4 — investigation pages.
 *
 * Mocks the analyses API to return one page-view investigation with
 * structured `payload.evidence` tables and a narrative. Asserts:
 *   - Index lists the investigation as a clickable link
 *   - /#/investigate/:id renders the narrative + evidence tables
 *   - Re-run button POSTs and re-renders with the new payload
 *   - Back button navigates to /#/investigate (the index)
 */

const json = (route: Route, body: string) =>
	route.fulfill({ status: 200, contentType: "application/json", body });

const NOW = new Date("2026-04-28T00:00:00Z").toISOString();

const buildInvestigation = (overrides: {
	narrative?: string | null;
	evidenceRows?: number;
	status?: "ok" | "warn" | "critical" | "unknown";
}) => ({
	definition: {
		id: "investigate.error_top_offenders",
		title: "Error top offenders",
		group: "Health",
		source: "tier0",
		view: "page",
		refreshSeconds: 300,
		narrate: { prompt: "x", only_when: "always" },
	},
	result: {
		analysisId: "investigate.error_top_offenders",
		projectId: "default",
		generatedAt: NOW,
		paramsHash: null,
		status: overrides.status ?? "warn",
		primaryValue: 12,
		baselineValue: 4,
		deltaPct: 200,
		payload: {
			evidence: {
				current_top_services: {
					title: "Top error services — last 5 minutes",
					headers: ["service", "errors"],
					rows: Array.from(
						{ length: overrides.evidenceRows ?? 3 },
						(_, i) => [`svc-${i}`, 12 - i],
					),
				},
				baseline_top_services: {
					title: "Top error services — 5–60 minutes ago",
					headers: ["service", "errors"],
					rows: [["svc-0", 4]],
				},
			},
		},
		narrative:
			overrides.narrative === undefined
				? "checkout dominates errors with 12 in the last 5 minutes, up from 4 in the prior hour"
				: overrides.narrative,
		narrativeSignature: "warn|12|4|",
		durationMs: 8,
	},
});

async function mockInvestigations(page: Page, opts: {
	resultEntry: ReturnType<typeof buildInvestigation>;
	rerunEntry?: ReturnType<typeof buildInvestigation>;
}) {
	const seenRunPosts: string[] = [];
	await page.route(/\/auth\/check/, (route) =>
		json(route, JSON.stringify({ authenticated: true })),
	);
	await page.route(/\/internal\//, async (route) => {
		const url = route.request().url();
		const method = route.request().method();
		// On-demand re-run.
		if (
			method === "POST" &&
			url.includes("/analyses/") &&
			url.endsWith("/run")
		) {
			seenRunPosts.push(url);
			return json(
				route,
				JSON.stringify({
					definition: opts.resultEntry.definition,
					result: opts.rerunEntry?.result ?? opts.resultEntry.result,
					timestamp: NOW,
				}),
			);
		}
		// Index endpoint.
		if (url.endsWith("/internal/analyses")) {
			return json(
				route,
				JSON.stringify({
					analyses: [opts.resultEntry.definition],
					timestamp: NOW,
				}),
			);
		}
		// Bulk + per-id GET.
		if (url.includes("/analyses/results")) {
			return json(
				route,
				JSON.stringify({ results: [opts.resultEntry], timestamp: NOW }),
			);
		}
		if (url.includes("/analyses/") && url.endsWith("/result")) {
			return json(
				route,
				JSON.stringify({
					definition: opts.resultEntry.definition,
					result: opts.resultEntry.result,
					timestamp: NOW,
				}),
			);
		}
		return json(route, '{"status":"ok"}');
	});
	await page.route(/\/api\//, (route) => json(route, '{"status":"ok"}'));
	return { seenRunPosts };
}

test.describe("Investigations", () => {
	test("index lists page-view analyses as clickable links", async ({ page }) => {
		await mockInvestigations(page, {
			resultEntry: buildInvestigation({}),
		});
		await page.goto("/#/investigate");
		await expect(
			page.locator('[data-test-investigation-link="investigate.error_top_offenders"]'),
		).toBeVisible({ timeout: 10000 });
		await expect(page.locator("text=Error top offenders").first()).toBeVisible();
	});

	test("page renders narrative + evidence tables", async ({ page }) => {
		await mockInvestigations(page, {
			resultEntry: buildInvestigation({
				narrative:
					"checkout dominates errors with 12 in the last 5 minutes, up from 4 in the prior hour",
			}),
		});
		await page.goto("/#/investigate/investigate.error_top_offenders");

		await expect(page.locator("[data-test-narrative]")).toContainText(
			"checkout dominates errors",
			{ timeout: 10000 },
		);
		await expect(
			page.locator('[data-test-evidence="current_top_services"]'),
		).toBeVisible();
		await expect(page.locator("text=svc-0").first()).toBeVisible();
		await expect(
			page.locator('[data-test-evidence="baseline_top_services"]'),
		).toBeVisible();
	});

	test("Re-run button POSTs and re-renders new payload", async ({ page }) => {
		const initial = buildInvestigation({
			narrative: "first run narrative",
			evidenceRows: 1,
		});
		const refreshed = buildInvestigation({
			narrative: "fresh data shows 5 services in tail",
			evidenceRows: 5,
		});
		const { seenRunPosts } = await mockInvestigations(page, {
			resultEntry: initial,
			rerunEntry: refreshed,
		});

		await page.goto("/#/investigate/investigate.error_top_offenders");
		await expect(page.locator("[data-test-narrative]")).toContainText(
			"first run narrative",
			{ timeout: 10000 },
		);

		await page.locator("[data-test-rerun]").click();

		// New rows from the refreshed entry should now be visible.
		await expect(page.locator("text=svc-4")).toBeVisible({ timeout: 10000 });
		await expect(page.locator("[data-test-narrative]")).toContainText(
			"fresh data shows",
		);
		expect(seenRunPosts.length).toBeGreaterThan(0);
		expect(seenRunPosts[0]).toMatch(/\/analyses\/.*\/run$/);
	});

	test("Back button navigates from page to index", async ({ page }) => {
		await mockInvestigations(page, {
			resultEntry: buildInvestigation({}),
		});
		await page.goto("/#/investigate/investigate.error_top_offenders");
		await expect(page.locator("[data-test-narrative]")).toBeVisible({
			timeout: 10000,
		});
		await page.locator("[data-test-back]").click();
		await expect(page).toHaveURL(/\/#\/investigate$/);
	});

	test("page renders fallback narrative when none has been generated yet", async ({
		page,
	}) => {
		await mockInvestigations(page, {
			resultEntry: buildInvestigation({ narrative: null }),
		});
		await page.goto("/#/investigate/investigate.error_top_offenders");
		await expect(page.locator("[data-test-narrative]")).toContainText(
			/no narrative yet/i,
			{ timeout: 10000 },
		);
	});
});
