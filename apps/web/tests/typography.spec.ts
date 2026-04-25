import { test, expect, type Page, type Route } from "@playwright/test";

/*
 * Typography audit: walks the new shell and reports computed font-family,
 * font-size, font-weight, letter-spacing for every visible text element
 * in the rail, top bar, and page heading. Captures screenshots for review.
 *
 * Run:   pnpm exec playwright test typography
 */

const json = (route: Route, body: string) =>
	route.fulfill({ status: 200, contentType: "application/json", body });

async function mockApis(page: Page) {
	await page.route("**/auth/check", (route) =>
		json(route, '{"authenticated":true}'),
	);
	await page.route(/\/api\//, async (route) => {
		const p = new URL(route.request().url()).pathname;
		if (p.includes("/usage/stream")) return route.abort();
		return json(route, '{"status":"ok"}');
	});
}

interface FontReport {
	label: string;
	text: string;
	fontFamily: string;
	fontSize: string;
	fontWeight: string;
	letterSpacing: string;
	textTransform: string;
}

async function reportFor(
	page: Page,
	label: string,
	selector: string,
): Promise<FontReport | null> {
	const el = page.locator(selector).first();
	if ((await el.count()) === 0) return null;
	return await el.evaluate((node, lbl) => {
		const cs = window.getComputedStyle(node as HTMLElement);
		return {
			label: lbl,
			text: (node.textContent || "").trim().slice(0, 40),
			fontFamily: cs.fontFamily,
			fontSize: cs.fontSize,
			fontWeight: cs.fontWeight,
			letterSpacing: cs.letterSpacing,
			textTransform: cs.textTransform,
		};
	}, label);
}

async function resetState(page: Page) {
	await page.addInitScript(() => {
		try {
			localStorage.clear();
		} catch {
			// ignore
		}
	});
}

test.describe("Typography audit", () => {
	test("rail + top bar font uniformity", async ({ page }) => {
		await resetState(page);
		await mockApis(page);
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.waitForSelector("aside", { state: "visible", timeout: 10000 });

		const asideHtmlPreview = await page
			.locator("aside")
			.evaluate((el) => (el as HTMLElement).outerHTML.slice(0, 800));
		console.log("\n[debug] aside outerHTML preview:");
		console.log(asideHtmlPreview);

		const reports: FontReport[] = [];

		const probes: Array<[string, () => ReturnType<Page["locator"]>]> = [
			["rail.brand", () => page.locator("aside").getByText("obs-unified")],
			["rail.group-label", () => page.locator("aside").getByText("Observe", { exact: true })],
			["rail.nav-active", () => page.locator("aside button").filter({ hasText: "Timeline" })],
			["rail.nav-inactive", () => page.locator("aside button").filter({ hasText: "Service Map" })],
			["rail.pinned", () => page.locator("aside button").filter({ hasText: "Projects" })],
			["rail.collapse", () => page.locator("aside button").filter({ hasText: "Collapse" })],
			["topbar.search-input", () => page.locator('header input[placeholder*="Search"]')],
			["topbar.time-picker", () => page.locator("header button").filter({ hasText: /\d+[hm]|d/ })],
			["topbar.project-label", () => page.locator("header").getByText("Project", { exact: true })],
			["topbar.project-select", () => page.locator("header select")],
		];

		for (const [label, locFn] of probes) {
			const loc = locFn().first();
			if ((await loc.count()) === 0) {
				console.log(`[miss] ${label}`);
				continue;
			}
			const r = await loc.evaluate((node, lbl) => {
				const cs = window.getComputedStyle(node as HTMLElement);
				return {
					label: lbl,
					text: (node.textContent || "").trim().slice(0, 40),
					fontFamily: cs.fontFamily,
					fontSize: cs.fontSize,
					fontWeight: cs.fontWeight,
					letterSpacing: cs.letterSpacing,
					textTransform: cs.textTransform,
				};
			}, label);
			reports.push(r);
		}

		// Pretty-print the audit
		console.log("\n── Typography audit ──");
		for (const r of reports) {
			console.log(
				`${r.label.padEnd(22)} | ${r.fontSize.padStart(6)} | w${r.fontWeight.padStart(3)} | ls=${r.letterSpacing.padStart(8)} | tt=${r.textTransform.padEnd(10)} | "${r.text}"`,
			);
			console.log(`${"".padEnd(22)} | family: ${r.fontFamily}`);
		}

		// Assertion: every probed element should resolve to Inter Variable.
		const families = new Set(reports.map((r) => r.fontFamily));
		console.log(`\nUnique font-family values: ${families.size}`);
		families.forEach((f) => console.log(`  - ${f}`));

		// Hard assertion: every visible piece of chrome inherits Inter.
		for (const r of reports) {
			expect.soft(r.fontFamily, `${r.label} should use Inter`).toMatch(/Inter/);
		}

		await page.screenshot({
			path: "tests/__screenshots__/typography-rail-expanded.png",
			fullPage: false,
		});
	});

	test("collapsed rail typography", async ({ page }) => {
		await resetState(page);
		await mockApis(page);
		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Collapse the rail
		await page.locator('aside button[title="Collapse sidebar"]').click();
		await page.waitForTimeout(150);

		const probes: Array<[string, string]> = [
			["collapsed.brand", 'aside span:has-text("OBS")'],
			["collapsed.nav-active", "aside button.bg-sys-primary"],
			["collapsed.nav-inactive", 'aside button[title="Service Map"]'],
			["collapsed.expand", 'aside button[title="Expand sidebar"]'],
		];

		const reports: FontReport[] = [];
		for (const [label, sel] of probes) {
			const r = await reportFor(page, label, sel);
			if (r) reports.push(r);
		}

		console.log("\n── Collapsed rail audit ──");
		for (const r of reports) {
			console.log(
				`${r.label.padEnd(22)} | ${r.fontSize.padStart(6)} | w${r.fontWeight.padStart(3)} | ls=${r.letterSpacing.padStart(8)} | tt=${r.textTransform.padEnd(10)} | "${r.text}"`,
			);
			console.log(`${"".padEnd(22)} | family: ${r.fontFamily}`);
		}

		await page.screenshot({
			path: "tests/__screenshots__/typography-rail-collapsed.png",
			fullPage: false,
		});
	});

	test("dashboard heading inherits Inter", async ({ page }) => {
		await mockApis(page);
		await page.goto("/#/timeline");
		await page.waitForLoadState("networkidle");

		const probes: Array<[string, string]> = [
			["timeline.heading", 'main span:has-text("TIMELINE")'],
			["timeline.button-load", 'main button:has-text("LOAD")'],
		];

		const reports: FontReport[] = [];
		for (const [label, sel] of probes) {
			const r = await reportFor(page, label, sel);
			if (r) reports.push(r);
		}

		console.log("\n── Dashboard chrome audit ──");
		for (const r of reports) {
			console.log(
				`${r.label.padEnd(22)} | ${r.fontSize.padStart(6)} | w${r.fontWeight.padStart(3)} | "${r.text}"`,
			);
			console.log(`${"".padEnd(22)} | family: ${r.fontFamily}`);
		}

		for (const r of reports) {
			expect.soft(r.fontFamily, `${r.label} should use Inter`).toMatch(/Inter/);
		}

		await page.screenshot({
			path: "tests/__screenshots__/typography-timeline.png",
			fullPage: false,
		});
	});

	// ── Visual sweep: every dashboard, screenshot only ──
	for (const tab of [
		"traces",
		"service-map",
		"issues",
		"logs",
		"ai",
		"usage",
		"replay",
		"timeline",
		"alerts",
		"resources",
		"projects",
		"playground",
	]) {
		test(`screenshot: ${tab}`, async ({ page }) => {
			await mockApis(page);
			await page.setViewportSize({ width: 1440, height: 900 });
			await page.goto(`/#/${tab}`);
			await page.waitForLoadState("networkidle");
			await page.waitForTimeout(400);
			await page.screenshot({
				path: `tests/__screenshots__/page-${tab}.png`,
				fullPage: false,
			});
		});
	}
});
