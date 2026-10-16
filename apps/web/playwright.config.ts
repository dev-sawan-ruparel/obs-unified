import { defineConfig, devices } from "@playwright/test";

// Default to a port nothing else in the stack uses (the dashboard image serves
// 5173, `pnpm dev` here defaults to 5173/5174, the collector 8790). Reusing an
// already-running server is only allowed when DEV_WEB_PORT is set explicitly;
// otherwise a stale dashboard on the default port would be tested silently.
const webPort = Number(process.env.DEV_WEB_PORT ?? 5199);
const reuseExistingServer =
	Boolean(process.env.DEV_WEB_PORT) && !process.env.CI;
const baseURL = `http://localhost:${webPort}`;

export default defineConfig({
	testDir: "./tests",
	/* Run tests in files in parallel */
	fullyParallel: true,
	/* Fail the build on CI if you accidentally left test.only in the source code. */
	forbidOnly: !!process.env.CI,
	/* Retry on CI only */
	retries: process.env.CI ? 2 : 0,
	/* Opt out of parallel tests on CI. */
	workers: process.env.CI ? 1 : undefined,
	/* Reporter to use. See https://playwright.dev/docs/test-reporters */
	reporter: "html",
	/* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
	use: {
		/* Base URL to use in actions like `await page.goto('/')`. */
		baseURL,

		/* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
		trace: "on-first-retry",
	},

	/* Configure projects for major browsers */
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],

	/* Run your local dev server before starting the tests */
	webServer: {
		// pnpm forwards a literal `--` to vite, which then ignores the port flags, so
		// the port is passed through the env var vite.config.ts reads (strictPort on).
		command: "pnpm run dev",
		env: { ...process.env, DEV_WEB_PORT: String(webPort) },
		url: baseURL,
		reuseExistingServer,
	},
});
