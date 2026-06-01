#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const dashboardUrl = process.env.DASHBOARD_URL ?? "http://localhost:5173";
const collectorUrl = process.env.COLLECTOR_URL ?? "http://localhost:8790";
const password = process.env.DASHBOARD_PASSWORD ?? "";
const ingestKey =
	process.env.OBS_INGEST_KEY ??
	process.env.INGEST_KEY ??
	"obs_default_60738b1b3c903a2f6e8a504e92d8444872e17871acd04504";
const outDir =
	process.env.MARKETING_SCREENSHOT_OUT ??
	path.resolve("marketing-screenshots/app");
const captureAll = process.env.MARKETING_SCREENSHOT_SET !== "website";
if (!password) {
	throw new Error("DASHBOARD_PASSWORD is required for marketing screenshots");
}

const TARGETS = [
	{
		id: "health-agentic-overview",
		title: "Health overview with agentic investigation entry points",
		route: "/#/health",
		website: true,
		review:
			"Hero proof: shows this is a real operational dashboard, not a concept diagram.",
	},
	{
		id: "service-map-astronomy",
		title: "Astronomy Shop service map",
		route: "/#/service-map",
		website: true,
		review:
			"Best realism proof for the demo: microservices and dependencies from live Astronomy traffic.",
	},
	{
		id: "traces-astronomy",
		title: "Traces from live Astronomy traffic",
		route: "/#/traces",
		website: true,
		review:
			"Shows OTLP traffic landing as trace rows with real services and durations.",
	},
	{
		id: "trace-waterfall-connected-rail",
		title: "Trace waterfall with Connected rail",
		route: "/#/traces",
		website: true,
		action: "openFirstTraceAndSpan",
		review:
			"Primary click-to-root-cause proof: waterfall plus neighboring signals in the rail.",
	},
	{
		id: "interaction-id-path",
		title: "Interaction ID path from click to backend",
		route: "/#/traces",
		website: true,
		action: "openFirstTraceAndSpan",
		review:
			"Use when explaining interaction_id: frontend action anchors the trace and related signals.",
	},
	{
		id: "logs-correlated",
		title: "Correlated structured logs",
		route: "/#/logs",
		website: true,
		review:
			"Makes logs feel first-class and connected, not a separate product bolted on.",
	},
	{
		id: "ai-cost-spans",
		title: "AI cost and LLM spans",
		route: "/#/ai",
		website: true,
		review:
			"Supports the AI-cost part of the public claim with tokens, cost, model, and trace context.",
	},
	{
		id: "agent-action-graph",
		title: "Agent action graph",
		route: "/#/ai",
		website: true,
		action: "openAgentGraph",
		review:
			"Most important new positioning image: an agent-readable graph a human can inspect.",
	},
	{
		id: "agent-governance",
		title: "Agent graph governance tab",
		route: "/#/ai",
		website: false,
		action: "openAgentGraphGovernance",
		review:
			"Good follow-up for enterprise/governance language once the core graph is understood.",
	},
	{
		id: "replay-sessions",
		title: "Session replay list",
		route: "/#/replay",
		website: true,
		review:
			"Makes frontend experience concrete; can be empty unless a browser replay was recorded.",
	},
	{
		id: "timeline-unified",
		title: "Unified session timeline",
		route: "/#/timeline",
		website: true,
		review:
			"Shows the identity graph as a timeline of usage, logs, spans, and AI calls.",
	},
	{
		id: "usage-analytics",
		title: "Usage analytics in the same stack",
		route: "/#/usage",
		website: true,
		review: "Proof that product analytics are part of the observability graph.",
	},
	{
		id: "alerts-rules",
		title: "Alert rules and operational triggers",
		route: "/#/alerts",
		website: true,
		review:
			"Shows alerting is not just mentioned in copy; it has a real surface.",
	},
	{
		id: "investigations-list",
		title: "Investigation narratives",
		route: "/#/investigate",
		website: true,
		review:
			"Good agentic debugging bridge: evidence, narratives, and linked signals.",
	},
	{
		id: "resources-hosts",
		title: "Infrastructure resources",
		route: "/#/resources",
		website: false,
		review:
			"Use as a secondary proof point for CPU/host-level context when populated.",
	},
	{
		id: "projects-keys",
		title: "Project routing and ingest keys",
		route: "/#/projects",
		website: false,
		review:
			"Useful for docs and enterprise onboarding, less important for the homepage.",
	},
	{
		id: "playground-replay-capture",
		title: "Replay capture playground",
		route: "/#/playground",
		website: false,
		review: "Explains how to create replay data when demo/state is empty.",
	},
	{
		id: "issues-dashboard",
		title: "Issues grouped from traces",
		route: "/#/issues",
		website: false,
		review:
			"Supports debugging workflow after traces/logs/service-map are established.",
	},
	{
		id: "ai-sessions-heavy-spender",
		title: "AI sessions and heavy spender",
		route: "/#/ai",
		website: false,
		action: "openAISessions",
		review: "Good docs screenshot for AI cost spike → user/session tracing.",
	},
	{
		id: "trace-profile-slot",
		title: "CPU profile join point",
		route: "/#/traces",
		website: false,
		action: "openFirstTraceAndSpan",
		review:
			"Use to review whether profile badges are present; requires profiling data to show flame graph.",
	},
	{
		id: "live-tail-logs",
		title: "Live tail logs",
		route: "/#/logs",
		website: false,
		action: "startLiveTail",
		review: "Good motion/demo capture; static screenshot is secondary.",
	},
	{
		id: "collapsed-sidebar",
		title: "Dense dashboard chrome",
		route: "/#/health",
		website: false,
		action: "collapseSidebar",
		review: "Useful for responsive/chrome review rather than public proof.",
	},
	{
		id: "mobile-health",
		title: "Mobile health view",
		route: "/#/health",
		website: false,
		viewport: { width: 390, height: 844 },
		review:
			"Mobile QA screenshot; keep out of homepage unless we build a responsive story.",
	},
	{
		id: "docs-to-product-proof",
		title: "Dashboard as the docs proof point",
		route: "/#/health",
		website: false,
		review: "Reserved for docs/website comparison pages.",
	},
];

const hex = (bytes) =>
	Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");

const kv = (key, value) => {
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { key, value: { intValue: value } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: String(value) } };
};

const nowNs = (offsetMs = 0) =>
	String(BigInt(Date.now() - offsetMs) * 1_000_000n);

function span({
	traceId,
	spanId,
	parentSpanId,
	name,
	startMs,
	durationMs,
	attrs,
}) {
	return {
		traceId,
		spanId,
		parentSpanId,
		name,
		kind: 2,
		startTimeUnixNano: nowNs(startMs),
		endTimeUnixNano: nowNs(startMs - durationMs),
		status: { code: 1 },
		attributes: Object.entries(attrs).map(([key, value]) => kv(key, value)),
	};
}

async function seedAgentGraph() {
	const traceId = hex(16);
	const run = hex(8);
	const plan = hex(8);
	const retrieve = hex(8);
	const tool = hex(8);
	const llm = hex(8);
	const evalSpan = hex(8);
	const sessionId = "marketing-agent-session";
	const interactionId = "ix_marketing_agentic_debug";
	const common = {
		"session.id": sessionId,
		"obs.interaction.id": interactionId,
		"obs.action.root_id": run,
		"obs.action.agent_run_id": run,
		"obs.action.actor_type": "agent",
		"obs.action.actor_id": "debug-agent",
	};
	const spans = [
		span({
			traceId,
			spanId: run,
			name: "agent.debug_checkout_regression",
			startMs: 90000,
			durationMs: 8400,
			attrs: {
				...common,
				"obs.action.id": run,
				"obs.action.kind": "agent.run",
				"obs.agent_run.agent_id": "debug-agent",
				"obs.agent_run.agent_name": "Debug Agent",
				"obs.agent_run.agent_version": "2026.05",
				"obs.agent_run.goal":
					"Explain why checkout latency spiked after deploy",
				"obs.agent_run.autonomy_level": "supervised",
				"obs.agent_run.outcome":
					"Found slow payment dependency and linked trace evidence",
			},
		}),
		span({
			traceId,
			spanId: plan,
			parentSpanId: run,
			name: "plan telemetry pivots",
			startMs: 88000,
			durationMs: 900,
			attrs: {
				...common,
				"obs.action.id": plan,
				"obs.action.caused_by_id": run,
				"obs.action.kind": "agent.step",
				"obs.action.name": "Plan investigation",
			},
		}),
		span({
			traceId,
			spanId: retrieve,
			parentSpanId: run,
			name: "retrieve related traces",
			startMs: 87000,
			durationMs: 650,
			attrs: {
				...common,
				"obs.action.id": retrieve,
				"obs.action.caused_by_id": plan,
				"obs.action.kind": "retrieval",
				"openinference.span.kind": "RETRIEVER",
				"retrieval.query": "checkout latency trace with interaction id",
				"retrieval.documents.count": 3,
			},
		}),
		span({
			traceId,
			spanId: tool,
			parentSpanId: run,
			name: "query service map",
			startMs: 85800,
			durationMs: 720,
			attrs: {
				...common,
				"obs.action.id": tool,
				"obs.action.caused_by_id": retrieve,
				"obs.action.kind": "tool.call",
				"obs.action.tool_name": "obs.query",
				"tool.name": "obs.query",
			},
		}),
		span({
			traceId,
			spanId: llm,
			parentSpanId: run,
			name: "openai.chat.completions",
			startMs: 84600,
			durationMs: 2100,
			attrs: {
				...common,
				"obs.action.id": llm,
				"obs.action.caused_by_id": tool,
				"obs.action.kind": "llm.call",
				"openinference.span.kind": "LLM",
				"llm.provider": "openai",
				"llm.model_name": "gpt-4o",
				"llm.token_count.prompt": 1240,
				"llm.token_count.completion": 218,
				"llm.token_count.total": 1458,
				"llm.cost.total_usd": 0.0184,
				"ai.payload.input": JSON.stringify([
					{ role: "system", content: "You are a production debugging agent." },
					{ role: "user", content: "Find the checkout latency regression." },
				]),
				"ai.payload.output": JSON.stringify({
					role: "assistant",
					content:
						"Payment dependency p95 rose after deploy. Trace, logs, replay, and CPU profile all point to checkout/payment.",
				}),
			},
		}),
		span({
			traceId,
			spanId: evalSpan,
			parentSpanId: run,
			name: "evaluate proposed root cause",
			startMs: 82000,
			durationMs: 520,
			attrs: {
				...common,
				"obs.action.id": evalSpan,
				"obs.action.caused_by_id": llm,
				"obs.action.kind": "eval",
				"eval.name": "evidence_grounded",
				"eval.score": 0.94,
			},
		}),
	];
	const res = await fetch(`${collectorUrl}/v1/traces`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-API-Key": ingestKey,
			"X-Project-Id": "default",
		},
		body: JSON.stringify({
			resourceSpans: [
				{
					resource: {
						attributes: [kv("service.name", "agent-debugger")],
					},
					scopeSpans: [{ scope: { name: "marketing-agent" }, spans }],
				},
			],
		}),
	});
	if (!res.ok) {
		throw new Error(
			`agent graph seed failed: ${res.status} ${await res.text()}`,
		);
	}
}

async function login(page) {
	if (password) {
		await page.context().request.post(`${dashboardUrl}/auth/login`, {
			data: { password },
			headers: { "Content-Type": "application/json" },
		});
	}
	await page.goto(dashboardUrl, { waitUntil: "domcontentloaded" });
	const passwordInput = page.locator('input[type="password"]');
	if ((await passwordInput.count()) > 0) {
		await passwordInput.fill(password);
		await page.locator("button").filter({ hasText: /login/i }).click();
		await page.waitForTimeout(800);
	}
	if ((await page.locator('input[type="password"]').count()) > 0) {
		throw new Error(
			"dashboard login failed; set DASHBOARD_PASSWORD before running screenshots",
		);
	}
}

async function ensureLoggedIn(page) {
	const passwordInput = page.locator('input[type="password"]').first();
	if ((await passwordInput.count()) === 0) return;
	await passwordInput.fill(password);
	await page.locator("button").filter({ hasText: /login/i }).click();
	await page.waitForTimeout(900);
	if ((await page.locator('input[type="password"]').count()) > 0) {
		throw new Error("dashboard route returned to login during capture");
	}
}

async function waitForSettled(page) {
	await page.waitForLoadState("domcontentloaded");
	await page.waitForTimeout(1200);
	await page
		.waitForFunction(
			() => {
				const text = document.body.innerText;
				return !/Initializing|Loading (AI spans|neighbors|action graph)|Loading…/i.test(
					text,
				);
			},
			undefined,
			{ timeout: 10000 },
		)
		.catch(() => {});
	await page.waitForTimeout(500);
}

async function openFirstTraceAndSpan(page) {
	const traceCandidate = page
		.locator("main button, main tr, main [role='button']")
		.filter({
			hasText:
				/GET|POST|HTTP|checkout|frontend|cart|payment|recommendation|span/i,
		})
		.first();
	if ((await traceCandidate.count()) > 0) {
		await traceCandidate.click({ timeout: 3000 }).catch(() => {});
		await page.waitForTimeout(1000);
	}
	const spanCandidate = page
		.locator(
			'[data-testid="trace-waterfall-span"], main button, main [role="button"]',
		)
		.filter({
			hasText: /GET|POST|query|checkout|payment|recommendation|call|span/i,
		})
		.first();
	if ((await spanCandidate.count()) > 0) {
		await spanCandidate.click({ timeout: 3000 }).catch(() => {});
		await page.waitForTimeout(1200);
	}
}

async function openAgentGraph(page) {
	const agentRow = page
		.locator("main div.w-full.text-left")
		.filter({ hasText: /agent-debugger|Debug Agent|gpt-4o/i })
		.first();
	const openButton = agentRow
		.locator('button[aria-label^="Open span"]')
		.first();
	const targetedAgentButton = page
		.locator('button[aria-label="Open span openai.chat.completions"]')
		.first();
	if ((await targetedAgentButton.count()) > 0) {
		await targetedAgentButton.click({ timeout: 5000 });
		await page.waitForTimeout(900);
	} else if ((await openButton.count()) > 0) {
		await openButton.click({ timeout: 5000 });
		await page.waitForTimeout(900);
	} else if ((await agentRow.count()) > 0) {
		await agentRow.click({ timeout: 5000 });
		await page.waitForTimeout(900);
	} else {
		throw new Error("agent graph target span was not found");
	}
	const tab = page.getByText("Action Graph", { exact: false }).first();
	if ((await tab.count()) > 0) {
		await tab.click({ timeout: 5000 });
		await waitForAgentGraph(page);
		await page.waitForTimeout(800);
	} else {
		throw new Error("Action Graph tab was not found after opening agent span");
	}
}

async function openAgentGraphGovernance(page) {
	await openAgentGraph(page);
	const tab = page.getByText("Governance", { exact: false }).first();
	if ((await tab.count()) > 0) {
		await tab.click({ timeout: 5000 });
		await waitForText(
			page,
			/Autonomy & Governance Audit Log|Tool Invocations|Security Approval/i,
			"governance audit content",
		);
	} else {
		throw new Error("Governance tab was not found after opening action graph");
	}
}

async function openAISessions(page) {
	const tab = page.getByText("Sessions", { exact: false }).first();
	if ((await tab.count()) > 0) {
		await tab.click({ timeout: 5000 }).catch(() => {});
		await page.waitForTimeout(1000);
	}
}

async function startLiveTail(page) {
	const live = page.getByRole("button", { name: /^LIVE$/i }).first();
	if ((await live.count()) > 0) {
		await live.click({ timeout: 3000 }).catch(() => {});
		await page.waitForTimeout(1000);
	}
}

async function collapseSidebar(page) {
	const collapse = page
		.locator('aside button[title="Collapse sidebar"]')
		.first();
	if ((await collapse.count()) > 0) {
		await collapse.click({ timeout: 3000 }).catch(() => {});
		await page.waitForTimeout(400);
	}
}

const actions = {
	openFirstTraceAndSpan,
	openAgentGraph,
	openAgentGraphGovernance,
	openAISessions,
	startLiveTail,
	collapseSidebar,
};

async function reviewPage(page) {
	const text = await page.locator("body").innerText({ timeout: 5000 });
	const hasErrorState = /FAILED TO LOAD|500|Error loading/i.test(text);
	return {
		hasData:
			!hasErrorState &&
			!/No data|No traces|No logs|No sessions|No action graph data found/i.test(
				text,
			),
		hasErrorState,
		hasConnectedRail: /Connected —/i.test(text),
		hasAgentGraph:
			/Causal Plan Sequence|CAUSAL ACTION TREE/i.test(text) &&
			/Plan investigation|openai\.chat\.completions|query service map/i.test(
				text,
			),
		hasGovernance:
			/Autonomy & Governance Audit Log|Tool Invocations|Security Approval/i.test(
				text,
			),
		hasInteractionId: /interaction/i.test(text),
		hasCpuProfile: /Profile|CPU|pprof|flame/i.test(text),
		textSample: text.replace(/\s+/g, " ").slice(0, 320),
	};
}

async function waitForText(page, pattern, label) {
	await page.waitForFunction(
		(source) => new RegExp(source, "i").test(document.body.innerText),
		pattern.source,
		{ timeout: 30000 },
	);
	const text = await page.locator("body").innerText({ timeout: 5000 });
	if (!pattern.test(text)) {
		throw new Error(`expected ${label} before screenshot capture`);
	}
}

async function waitForAgentGraph(page) {
	await page.waitForFunction(
		() => {
			const text = document.body.innerText;
			return (
				!/Loading action graph/i.test(text) &&
				/Causal Plan Sequence|CAUSAL ACTION TREE/i.test(text) &&
				/Plan investigation|openai\.chat\.completions|query service map/i.test(
					text,
				)
			);
		},
		undefined,
		{ timeout: 30000 },
	);
}

function assertCaptureAccepted(target, review) {
	if (review.hasErrorState) {
		throw new Error(
			`${target.id} rendered an error state: ${review.textSample}`,
		);
	}

	if (target.id === "agent-action-graph" && !review.hasAgentGraph) {
		throw new Error(
			"agent-action-graph did not render seeded graph content before capture",
		);
	}

	if (target.id === "agent-governance") {
		if (!review.hasGovernance) {
			throw new Error("agent-governance did not render governance content");
		}
	}

	if (
		target.id === "traces-astronomy" ||
		target.id === "trace-waterfall-connected-rail" ||
		target.id === "interaction-id-path"
	) {
		if (!review.hasData) {
			throw new Error(`${target.id} did not render usable trace data`);
		}
	}
}

async function main() {
	await mkdir(outDir, { recursive: true });
	await seedAgentGraph().catch((err) => {
		console.warn(`[warn] ${err.message}`);
	});
	await new Promise((resolve) => setTimeout(resolve, 5000));

	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await login(page);

	const selected = TARGETS.filter((target) => captureAll || target.website);
	const reviews = [];
	for (const target of selected) {
		await page.setViewportSize(target.viewport ?? { width: 1440, height: 900 });
		await page.goto(`${dashboardUrl}${target.route}`, {
			waitUntil: "domcontentloaded",
		});
		await ensureLoggedIn(page);
		await waitForSettled(page);
		if (target.action) {
			await actions[target.action]?.(page);
		}
		const review = await reviewPage(page);
		assertCaptureAccepted(target, review);
		const fileName = `${target.id}.png`;
		const filePath = path.join(outDir, fileName);
		await page.screenshot({ path: filePath, fullPage: false });
		reviews.push({
			...target,
			file: fileName,
			...review,
		});
		console.log(`captured ${fileName}`);
	}
	await browser.close();

	await writeFile(
		path.join(outDir, "manifest.json"),
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				source: { dashboardUrl, collectorUrl },
				targets: reviews,
			},
			null,
			2,
		),
	);
	await writeFile(
		path.join(outDir, "review.md"),
		[
			"# Marketing Screenshot Review",
			"",
			`Generated: ${new Date().toISOString()}`,
			`Dashboard: ${dashboardUrl}`,
			`Collector: ${collectorUrl}`,
			"",
			"## Inventory",
			"",
			...reviews.map(
				(r, i) =>
					`${i + 1}. **${r.title}** (${r.file}) — ${r.review} Data:${r.hasData ? "yes" : "check"} Error:${r.hasErrorState ? "yes" : "no"} Rail:${r.hasConnectedRail ? "yes" : "no"} Agent graph:${r.hasAgentGraph ? "yes" : "no"} Interaction:${r.hasInteractionId ? "yes" : "no"} CPU/profile:${r.hasCpuProfile ? "yes" : "no"}`,
			),
			"",
		].join("\n"),
	);
	console.log(`\nWrote ${reviews.length} screenshots to ${outDir}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
