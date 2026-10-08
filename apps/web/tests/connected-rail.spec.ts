import { expect, test } from "@playwright/test";

/**
 * RFC 0003 / 0006 Phase 6.6 — any-to-any matrix coverage.
 *
 * Walks the matrix from docs/ux/click-to-cpu.md § The any-to-any matrix.
 * Every cell marked `≤1` in that table corresponds to one `test()` here.
 *
 * Status: scaffold. Most cells are `test.skip` placeholders until the
 * docker-compose demo SDK overlay (Phase 6.1-6.3) populates the full live
 * interaction_id / pprof / Beyla paths. The synthetic seed now covers the
 * Scenario A trace -> CPU profile fixture, but these browser cells still need
 * the live stack for end-to-end UI assertions. Current implementation status
 * lives in docs/rfc-status.md.
 *
 * Today's coverage of the same contract:
 *   - Server-side (manifest shape, count-collapse, informative-absence,
 *     400 on unknown kind): packages/obs-collector/src/plugins/
 *     connected-routes.test.ts (vitest, runs on every commit).
 *   - Live cells: gated on E2E_LIVE_STACK=1 and the demo running.
 *
 * To run live cells against a live stack:
 *   make run-with-demo && make seed
 *   E2E_LIVE_STACK=1 pnpm --filter @obs-demo/web test:e2e:all
 *
 * Prerequisite for live cells:
 *   - `make run-with-demo` running with SDKs wired per
 *     docs/archive/implementation/demo-integration.md
 *   - dashboard at http://localhost:5173 with password e2e-test-pass
 */

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass";
const LIVE_STACK = !!process.env.E2E_LIVE_STACK;

test.describe("Connected rail — any-to-any matrix", () => {
	test.skip(
		!LIVE_STACK,
		"set E2E_LIVE_STACK=1 with `make run-with-demo` running",
	);

	test.beforeEach(async ({ page }) => {
		await page.goto("/");
		await page.locator('input[type="password"]').fill(DASHBOARD_PASSWORD);
		await page.locator("button", { hasText: "Login" }).click();
		await page.waitForURL("**/dashboard**");
	});

	// ── From a Trace ─────────────────────────────────────────────────────

	// Working template for the rest of the matrix. Other cells stay as
	// test.skip until the demo SDK overlay (Phase 6.1-6.3) lands and we
	// know real fixture trace ids to assert against. Run this with
	// E2E_LIVE_STACK=1 against a `make run-with-demo` stack.
	test("Trace → Span (≤1 click via waterfall row)", async ({ page }) => {
		await page.goto("/dashboard?tab=telemetry");
		// First trace in the seed should expose its waterfall via inline expand.
		const firstTraceRow = page.locator('[data-testid="trace-row"]').first();
		await firstTraceRow.click();
		// Span rows render as siblings inside the same expanded section.
		const firstSpanRow = page
			.locator('[data-testid="trace-waterfall-span"]')
			.first();
		await expect(firstSpanRow).toBeVisible();
		await firstSpanRow.click();
		// Rail must render the four canonical sections after navigation.
		await expect(page.getByText("CONNECTED — SPAN")).toBeVisible();
	});

	test.skip("Trace → Log (≤1 click via rail 'Logs in this trace')", async () => {});
	test.skip("Trace → Replay (≤1 click via rail when interaction_id present)", async () => {});
	test.skip("Trace → Session (≤1 click via rail 'User session')", async () => {});
	test.skip("Trace → AI call (≤1 click via rail 'AI calls in this trace')", async () => {});
	test.skip("Trace → Profile (≤1 click via 🔥 badge in summary)", async () => {});
	test.skip("Trace → Alert (≤1 click via rail 'Triggered alerts')", async () => {});
	test.skip("Trace → Analysis (≤1 click via rail 'Cited by analyses')", async () => {});

	// ── From a Span ──────────────────────────────────────────────────────

	test.skip("Span → Trace (≤1 click via rail 'Parent trace')", async () => {});
	test.skip("Span → Log (≤1 click via rail 'Other logs in this trace')", async () => {});
	test.skip("Span → Replay (≤1 click via rail when session_id present)", async () => {});
	test.skip("Span → Session (≤1 click via rail 'User session')", async () => {});
	test.skip("Span → AI call (≤1 click via rail when trace contains an AI call)", async () => {});
	test.skip("Span → Profile (≤1 click via 🔥 next to span name)", async () => {});

	// ── From a Log ───────────────────────────────────────────────────────

	test.skip("Log → Trace (≤1 click via rail 'Parent trace')", async () => {});
	test.skip("Log → Span (≤1 click via attribute span_id link)", async () => {});
	test.skip("Log → Replay (≤1 click via rail 'Replay')", async () => {});
	test.skip("Log → Session (≤1 click via rail 'User session')", async () => {});

	// ── From a Replay ────────────────────────────────────────────────────

	test.skip("Replay → Trace (≤1 click via interactions panel 'Trace caused by this click')", async () => {});
	test.skip("Replay → Session (≤1 click — replay IS the session view)", async () => {});

	// ── From a Session ───────────────────────────────────────────────────

	test.skip("Session → Trace (≤1 click via timeline event row)", async () => {});
	test.skip("Session → Replay (≤1 click via session detail)", async () => {});
	test.skip("Session → Logs (≤1 click via timeline)", async () => {});
	test.skip("Session → User (≤1 click via session header user_id)", async () => {});
	test.skip("Session → AI call (≤1 click via timeline)", async () => {});

	// ── From an AI call ──────────────────────────────────────────────────

	test.skip("AI call → Trace (≤1 click via rail 'Parent trace')", async () => {});
	test.skip("AI call → Span (≤1 click via rail span list)", async () => {});
	test.skip("AI call → Replay (≤1 click via rail when interaction_id present)", async () => {});
	test.skip("AI call → Session (≤1 click via rail 'Session')", async () => {});

	// ── From a Profile ───────────────────────────────────────────────────

	test.skip("Profile → Trace (≤1 click — flame graph filter scope)", async () => {});
	test.skip("Profile → Span (≤1 click via per-trace flame graph)", async () => {});

	// ── From an Alert ────────────────────────────────────────────────────

	test.skip("Alert → Analysis (≤1 click via Stage 6 binding)", async () => {});
	test.skip("Alert → Trace (≤1 click via exemplar in narrative)", async () => {});
	test.skip("Alert → Profile (≤1 click via rail 'Profiles for affected service')", async () => {});

	// ── From an Analysis ─────────────────────────────────────────────────

	test.skip("Analysis → Alert (≤1 click via rail 'Bound alerts')", async () => {});
	test.skip("Analysis → Trace (≤1 click via narrative exemplar)", async () => {});
});

/**
 * Two-click cells (≤2) are intentionally not enumerated as separate
 * tests — the rail's contract is a one-click promise, and ≤2 means
 * "open detail + click rail link." Once each `≤1` test passes, the
 * `≤2` reachability follows mechanically.
 *
 * `n/a` cells are by design (e.g. Profile → User isn't a question this
 * product answers) and never get tests.
 */
