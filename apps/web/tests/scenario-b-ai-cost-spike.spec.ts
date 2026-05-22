/**
 * Scenario B end-to-end — RFC 0003 acceptance #2.
 *
 *   AI cost spike → heavy-spender user → latest session → trace
 *
 * The synthetic seed (scripts/seed-everything/run.mjs) plants a "Heavy
 * Spender (seed)" user with 8-9 concentrated claude-3-5-haiku calls in
 * a single session that dominates cost. This walks the identity
 * skeleton the rail is meant to make navigable in ≤1 click per hop:
 *
 *   user_profiles → visitor_id → usage_events.session_id → telemetry_spans
 *
 * Gated on E2E_LIVE_STACK=1 because it needs the collector + dashboard
 * running and the seed applied. Default `pnpm test:e2e` ignores it
 * (only features.spec.ts runs there).
 *
 * Setup:
 *   make run-with-demo && make seed
 *   E2E_LIVE_STACK=1 pnpm --filter @obs-demo/web test:e2e:all -- scenario-b
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const COLLECTOR_URL = process.env.OBS_COLLECTOR_URL ?? "http://localhost:8790";
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "e2e-test-pass";
const LIVE_STACK = !!process.env.E2E_LIVE_STACK;

interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
}

interface ConnectedSection {
	label: string;
	links: ConnectedLink[];
	emptyReason?: string;
}

interface ConnectedManifest {
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

const queryD1 = async (
	request: APIRequestContext,
	cookie: string,
	sql: string,
): Promise<unknown> => {
	// We don't have a direct D1 query endpoint exposed to dashboard auth;
	// instead the tests below derive identifiers from the /internal/* read
	// endpoints which are dashboard-auth-gated. queryD1 is unused but kept
	// as a hook for future tests that need raw lookups.
	void request;
	void cookie;
	void sql;
	throw new Error("queryD1 not implemented — use /internal/* endpoints");
};
void queryD1;

const fetchManifest = async (
	request: APIRequestContext,
	cookie: string,
	path: string,
): Promise<ConnectedManifest> => {
	const res = await request.get(`${COLLECTOR_URL}${path}`, {
		headers: { Cookie: cookie, "X-Project-Id": "default" },
	});
	expect(res.status(), `GET ${path}`).toBe(200);
	return (await res.json()) as ConnectedManifest;
};

test.describe("Scenario B — AI cost spike → user → session → trace", () => {
	test.skip(
		!LIVE_STACK,
		"set E2E_LIVE_STACK=1 with `make run-with-demo && make seed`",
	);

	test("walks the identity skeleton end-to-end from heavy spender to trace", async ({
		request,
	}) => {
		const cookie = await loginCookie(request);

		// Step 1 — AI tab shows a heavy spender. We pull the AI overview
		// endpoint and confirm one session dominates the cost. The seed
		// concentrates ~8 calls on the last session; the next-most session
		// has ~1.
		const aiRes = await request.get(
			`${COLLECTOR_URL}/internal/ai/overview?hours=24`,
			{ headers: { Cookie: cookie, "X-Project-Id": "default" } },
		);
		expect(aiRes.status(), "GET /internal/ai/overview").toBe(200);
		const aiOverview = (await aiRes.json()) as {
			calls: Array<{
				sessionId: string | null;
				totalCostUsd: number | null;
				modelName: string;
			}>;
		};
		expect(
			aiOverview.calls.length,
			"seed should have plenty of AI calls",
		).toBeGreaterThanOrEqual(8);

		// Group by session and pick the top spender.
		const byCost = new Map<string, number>();
		for (const c of aiOverview.calls) {
			if (!c.sessionId) continue;
			byCost.set(
				c.sessionId,
				(byCost.get(c.sessionId) ?? 0) + (c.totalCostUsd ?? 0),
			);
		}
		const ranked = Array.from(byCost.entries()).sort((a, b) => b[1] - a[1]);
		expect(ranked.length, "at least one session has AI cost").toBeGreaterThan(
			0,
		);
		const [topSessionId, topCost] = ranked[0];
		// Sanity: the seed's heavy spender should be at least 5× the next session.
		if (ranked.length > 1) {
			const [, runnerUp] = ranked[1];
			expect(
				topCost,
				`heavy spender (${topCost}) should dominate the next session (${runnerUp})`,
			).toBeGreaterThan(runnerUp * 5);
		}

		// Step 2 — pivot from session to its rail manifest. This is the
		// "click latest session" hop in Scenario B step 3.
		const sessionManifest = await fetchManifest(
			request,
			cookie,
			`/internal/connected/usage/${encodeURIComponent(topSessionId)}?session_id=${encodeURIComponent(topSessionId)}`,
		);
		// Rail's `across` must include "Spans in this session" or similar —
		// the link that opens the trace list scoped to the session.
		const sessionSpansSection = sessionManifest.across.find((s) =>
			s.label.toLowerCase().includes("span"),
		);
		expect(
			sessionSpansSection,
			"session rail must surface spans across",
		).toBeDefined();
		expect(
			sessionSpansSection!.links.length,
			"session has at least one trace",
		).toBeGreaterThan(0);

		// Extract a trace_id from the session's spans link. The link's
		// href format is `#/traces?q=<traceId>` (count-link collapse) or
		// `#/traces/<traceId>#span=...` for inline links — handle both.
		const sampleHref = sessionSpansSection!.links[0].href;
		const traceIdMatch = sampleHref.match(/(?:traces\/|q=)([0-9a-f]{16,32})/i);
		expect(traceIdMatch, `extract trace_id from ${sampleHref}`).not.toBeNull();
		const traceId = traceIdMatch![1];

		// Step 3 — confirm the trace's rail surfaces the "Click that
		// caused this trace" RELATED link. This is the RFC 0004 headline.
		// Pull spans from the trace to drive the span rail.
		const spanFetchRes = await request.get(
			`${COLLECTOR_URL}/internal/telemetry/traces/${traceId}`,
			{ headers: { Cookie: cookie, "X-Project-Id": "default" } },
		);
		expect(
			spanFetchRes.status(),
			`GET /internal/telemetry/traces/${traceId}`,
		).toBe(200);
		const traceData = (await spanFetchRes.json()) as {
			spans: Array<{
				spanId: string;
				attributes: Record<string, unknown>;
			}>;
		};
		const spanWithInteraction = traceData.spans.find(
			(s) =>
				typeof s.attributes["obs.interaction.id"] === "string" &&
				(s.attributes["obs.interaction.id"] as string).length > 0,
		);
		// Not every trace has an interaction_id — but the seed concentrates
		// interaction_ids on the heavy spender's session, so at least one
		// span in this trace should carry one.
		expect(
			spanWithInteraction,
			"heavy-spender trace should have an interaction-stamped span",
		).toBeDefined();

		const spanRail = await fetchManifest(
			request,
			cookie,
			`/internal/connected/span/${traceId}:${spanWithInteraction!.spanId}`,
		);
		const originatingClick = spanRail.related.find((s) =>
			s.label.toLowerCase().includes("click"),
		);
		expect(
			originatingClick,
			"span rail must offer 'Click that caused this trace'",
		).toBeDefined();
		expect(
			originatingClick!.links.length,
			"originating-click link should be populated, not informative-absence",
		).toBeGreaterThan(0);
	});

	test("dashboard AI tab renders the heavy spender (smoke)", async ({
		page,
	}) => {
		// One real DOM hop — confirms the UI side of the chain isn't
		// regressed. Deep navigation tests live above as API walks; the
		// browser leg here is intentionally narrow so flakes don't tank
		// the assertion that matters (the identity-graph chain).
		await page.goto("/");
		await page.locator('input[type="password"]').fill(DASHBOARD_PASSWORD);
		await page.locator("button", { hasText: "Login" }).click();
		// Login lands at /#/health by default; wait for the password input
		// to disappear instead of a specific URL.
		await expect(page.locator('input[type="password"]')).toHaveCount(0);

		// Navigate to the AI tab via hash route.
		await page.goto("/#/ai");
		await page.waitForLoadState("networkidle");
		// Any LLM model name from the seed should be visible.
		await expect(page.locator("body")).toContainText(/claude|gpt|gemini/i);
	});
});
