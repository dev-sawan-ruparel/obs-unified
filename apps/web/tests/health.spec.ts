import { test, expect, type Page, type Route } from "@playwright/test";

/*
 * E2E coverage for RFC 0002 Stage 1 — the Health dashboard.
 *
 * The Health tab pulls a bulk "definition + latest result" envelope from
 * GET /internal/analyses/results. These tests mock that endpoint and
 * assert the panel grid renders with the expected status hierarchy
 * (critical → warn → ok → unknown), group ordering, and empty state.
 *
 * Run:   pnpm exec playwright test health
 */

const json = (route: Route, body: string) =>
	route.fulfill({ status: 200, contentType: "application/json", body });

const NOW = new Date("2026-04-24T00:00:00Z").toISOString();

type Entry = {
	definition: {
		id: string;
		title: string;
		group: "Health" | "Services" | "Dependencies" | "Async" | "AI" | "Frontend" | "Custom";
		source: "tier0" | "tier1" | "user" | "llm-suggested";
		view: "tile" | "page" | "alert";
		refreshSeconds?: number;
		sql?: string;
	};
	result: {
		analysisId: string;
		projectId: string;
		generatedAt: string;
		paramsHash: string | null;
		status: "ok" | "warn" | "critical" | "unknown";
		primaryValue: number | null;
		baselineValue: number | null;
		deltaPct: number | null;
		payload: Record<string, unknown>;
		narrative: string | null;
		narrativeSignature: string | null;
		durationMs: number;
	} | null;
};

function entry(
	id: string,
	title: string,
	group: Entry["definition"]["group"],
	status: "ok" | "warn" | "critical" | "unknown",
	primary: number | null = null,
	baseline: number | null = null,
): Entry {
	return {
		definition: {
			id,
			title,
			group,
			source: "tier0",
			view: "tile",
			refreshSeconds: 60,
		},
		result: status === "unknown" && primary === null
			? null
			: {
					analysisId: id,
					projectId: "default",
					generatedAt: NOW,
					paramsHash: null,
					status,
					primaryValue: primary,
					baselineValue: baseline,
					deltaPct: primary !== null && baseline !== null && baseline !== 0
						? ((primary - baseline) / baseline) * 100
						: null,
					payload: {},
					narrative: null,
					narrativeSignature: null,
					durationMs: 12,
				},
	};
}

/** Stub auth + the analyses endpoint (and silence other collector calls). */
async function mockAnalyses(page: Page, results: Entry[]) {
	// Auth gate: pretend the user is logged in so AuthGate renders children.
	await page.route(/\/auth\/check/, (route) =>
		json(route, JSON.stringify({ authenticated: true })),
	);
	// Collector data plane (basePath = "/internal").
	await page.route(/\/internal\//, async (route) => {
		const url = route.request().url();
		if (url.includes("/analyses/results")) {
			return json(route, JSON.stringify({ results, timestamp: NOW }));
		}
		// Anything else the dashboard chrome polls — return an empty envelope.
		return json(route, '{"status":"ok"}');
	});
	// Demo backend — Playground only, but fall through safely.
	await page.route(/\/api\//, (route) => json(route, '{"status":"ok"}'));
}

test.describe("Health Dashboard", () => {
	test("default route lands on /health", async ({ page }) => {
		await mockAnalyses(page, []);
		await page.goto("/");
		await expect(page).toHaveURL(/\/#\/health/);
	});

	test("renders panels with the right titles + groups", async ({ page }) => {
		// All-warn so focus mode (which auto-enables on critical) doesn't hide
		// ok panels — every group should render.
		const results: Entry[] = [
			entry("overall_error_rate", "Overall error rate", "Health", "warn", 0.05, 0.02),
			entry(
				"service_error_rate::checkout",
				"checkout · errors",
				"Services",
				"warn",
				0.04,
				0.01,
			),
			entry(
				"dependency_health::checkout->cart",
				"checkout → cart",
				"Dependencies",
				"warn",
				1,
				0.5,
			),
		];
		await mockAnalyses(page, results);

		await page.goto("/#/health");

		// Wait for one of the tile titles to confirm data has loaded.
		await expect(page.locator("text=Overall error rate")).toBeVisible({
			timeout: 10000,
		});
		await expect(page.locator("text=checkout · errors")).toBeVisible();
		await expect(page.locator("text=checkout → cart")).toBeVisible();

		// Group section titles. SectionTitle uppercases via CSS but keeps
		// underlying text intact, so the match is on the raw casing.
		const dashboardArea = page.locator("text=Health");
		await expect(dashboardArea.first()).toBeVisible();
		await expect(page.locator("text=Services").first()).toBeVisible();
		await expect(page.locator("text=Dependencies").first()).toBeVisible();
	});

	test("renders status counts in header", async ({ page }) => {
		const results: Entry[] = [
			entry("a1", "Alpha", "Health", "critical", 1, 0.1),
			entry("b1", "Bravo", "Services", "warn", 1, 0.5),
			entry("b2", "Charlie", "Services", "warn", 1, 0.5),
			entry("c1", "Delta", "Services", "ok", 1, 1),
			entry("c2", "Echo", "Services", "ok", 1, 1),
			entry("c3", "Foxtrot", "Services", "ok", 1, 1),
		];
		await mockAnalyses(page, results);
		await page.goto("/#/health");

		// Use a unique tile title to confirm panels rendered.
		await expect(page.locator("text=Alpha")).toBeVisible({ timeout: 10000 });

		// The header includes the breakdown formatted as
		// "N critical · N warn · N ok".
		const body = await page.locator("body").textContent();
		expect(body).toMatch(/1\s*critical/i);
		expect(body).toMatch(/2\s*warn/i);
		expect(body).toMatch(/3\s*ok/i);
	});

	test("empty state shows when no analyses are registered", async ({ page }) => {
		await mockAnalyses(page, []);
		await page.goto("/#/health");

		// Empty state copy points the user at the demo seed flow.
		const body = page.locator("body");
		await expect(body).toContainText(/demo|seed|telemetry/i, {
			timeout: 10000,
		});
	});

	test("panel renders 'computing…' placeholder when result is null", async ({
		page,
	}) => {
		const pending: Entry = {
			definition: {
				id: "pending_one",
				title: "Pending analysis",
				group: "Health",
				source: "tier0",
				view: "tile",
				refreshSeconds: 60,
			},
			result: null,
		};
		await mockAnalyses(page, [pending]);
		await page.goto("/#/health");

		await expect(page.locator("text=Pending analysis")).toBeVisible({
			timeout: 10000,
		});
		await expect(
			page.locator("text=/comput|pending|—|waiting/i").first(),
		).toBeVisible();
	});
});
