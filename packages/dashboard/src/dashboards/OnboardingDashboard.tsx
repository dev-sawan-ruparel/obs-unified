// Onboarding dashboard — accessible from the left rail navigation to guide
// users setting up signal ingestion and agent debugging. Probes the collector's
// signal tables for emptiness and renders the relevant "you need to wire X"
// snippet inline.
//
// Reuses the platform's "informative absence" pattern (RFC 0006) at
// the app level: never silent empty state, always tell the user what
// to do next.

import { useEffect, useState } from "react";
import { useApi } from "../use-api";

interface SignalCounts {
	spans: number;
	logs: number;
	usageEvents: number;
	identifiedUsers: number;
	aiCalls: number;
	replayChunks: number;
	spansWithInteraction: number;
}

interface OnboardingStep {
	id: string;
	title: string;
	complete: boolean;
	body: React.ReactNode;
}

interface InvestigationCapability {
	id: string;
	title: string;
	badge: string;
	description: string;
	details?: string;
	productSurface?: {
		label: string;
		href: string;
		hint: string;
	};
	docsLinks: Array<{
		label: string;
		href: string;
	}>;
}

const INVESTIGATION_CAPABILITIES: InvestigationCapability[] = [
	{
		id: "action-graph",
		title: "Agent Action Graph",
		badge: "Causal workflow",
		description:
			"Debug AI agents as causal workflows connecting user actions, agent runs, LLM calls, tool executions, and backend traces into a single graph to understand why each step happened.",
		details:
			"Builds on your ingested AI calls and spans. Derives action graphs automatically from GenAI and OpenInference spans or explicit action attributes.",
		productSurface: {
			label: "Open AI Calls tab",
			href: "#/ai",
			hint: "Drill into action graphs from AI spans, or deep-link to #/actions/:id and #/agent-runs/:id",
		},
		docsLinks: [
			{
				label: "Agent Action Graph docs",
				href: "https://docs.obsunified.com/docs/agent-action-graph",
			},
		],
	},
	{
		id: "mcp-server",
		title: "Read-only investigation MCP server",
		badge: "Agent tools",
		description:
			"Equip AI agents via Claude Desktop or compatible local MCP hosts with @obsunified/mcp-server to inspect traces, logs, replays, action graphs, and profiles with read-only safety.",
		details:
			"Runs over stdio on your agent host. Connects directly to your collector URL (OBS_COLLECTOR_URL) with an ingest key or dashboard token—no telemetry emission required.",
		docsLinks: [
			{
				label: "MCP server docs & setup",
				href: "https://docs.obsunified.com/docs/mcp-server",
			},
		],
	},
	{
		id: "ccr",
		title: "Evidence retrieval (CCR)",
		badge: "Compressed context",
		description:
			"Compressed Context Retrieval (RFC 0011) generates token-budgeted evidence bundles and retrieval refs so agents isolate root causes without blowing token limits on raw logs or traces.",
		details:
			"Exposes get_evidence_bundle and retrieve_evidence_ref tools through the MCP server and interactive inspection in the dashboard.",
		productSurface: {
			label: "Open Evidence dashboard",
			href: "#/evidence",
			hint: "Inspect issued bundles, retrieval refs, and expansion queries in the Evidence tab",
		},
		docsLinks: [
			{
				label: "Evidence retrieval (CCR) docs",
				href: "https://docs.obsunified.com/docs/evidence-retrieval",
			},
			{
				label: "Evidence reference schema",
				href: "https://docs.obsunified.com/docs/evidence-reference",
			},
		],
	},
	{
		id: "profiles",
		title: "Profiles (CPU & off-CPU)",
		badge: "Continuous profiling",
		description:
			"Correlate runtime pprof CPU and off-CPU profiles directly to distributed traces via trace_id. Spans with linked profiling display prof indicators in trace waterfalls; profile matches appear in trace details and can be opened via profile or Connected Rail links to inspect interactive flame graphs.",
		details:
			"Optional pprof ingestion at /v1/profiles/pprof. Connects to traces through trace_id labels to enable click-to-CPU investigation.",
		productSurface: {
			label: "Open Traces waterfall",
			href: "#/traces",
			hint: "Profile matches appear in trace details and can be opened via profile or Connected Rail links",
		},
		docsLinks: [
			{
				label: "Click-to-CPU walkthrough",
				href: "https://docs.obsunified.com/docs/what-to-expect",
			},
			{
				label: "Profiling ingestion recipe",
				href: "https://github.com/dev-sawan-ruparel/obs-unified/blob/main/docs/howto/profiling.md",
			},
		],
	},
];

export interface OnboardingDashboardProps {
	onNavigate?: (href: string) => void;
}

export function OnboardingDashboard({
	onNavigate,
}: OnboardingDashboardProps = {}) {
	const api = useApi();
	const [counts, setCounts] = useState<SignalCounts | null>(null);

	useEffect(() => {
		let cancelled = false;
		api<SignalCounts>("/internal/onboarding/counts").then((r) => {
			if (!cancelled) setCounts(r);
		});
		return () => {
			cancelled = true;
		};
	}, [api]);

	if (!counts) return <div style={{ padding: 24 }}>Loading…</div>;

	const steps = buildSteps(counts);
	const completeCount = steps.filter((s) => s.complete).length;
	const allDone = completeCount === steps.length;

	const handleNavigate = (
		e: React.MouseEvent<HTMLAnchorElement>,
		href: string,
	) => {
		if (onNavigate && href.startsWith("#/")) {
			e.preventDefault();
			onNavigate(href);
		}
	};

	return (
		<div style={{ padding: 24, maxWidth: 880 }}>
			<header style={{ marginBottom: 24 }}>
				<h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Onboarding</h1>
				<p
					style={{
						color: "var(--color-sys-on-surface-muted)",
						margin: "4px 0 0",
					}}
				>
					{allDone
						? "All six onboarding steps are complete. Explore agent debugging below."
						: `${completeCount} of ${steps.length} steps complete.`}
				</p>
			</header>

			<section
				aria-labelledby="core-signals-heading"
				style={{ marginBottom: 36 }}
			>
				<h2
					id="core-signals-heading"
					style={{
						fontSize: 12,
						fontWeight: 700,
						textTransform: "uppercase",
						letterSpacing: "0.1em",
						color: "var(--color-sys-on-surface-subtle)",
						margin: "0 0 12px",
					}}
				>
					Core telemetry ingest ({completeCount} of {steps.length} complete)
				</h2>
				<ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
					{steps.map((step) => (
						<li
							key={step.id}
							style={{
								marginBottom: 16,
								padding: 16,
								background: step.complete
									? "var(--color-sys-surface-container-low)"
									: "var(--color-sys-surface)",
								borderLeft: step.complete
									? "3px solid var(--color-sys-primary)"
									: "3px solid var(--color-sys-outline-variant)",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 12,
									fontWeight: 600,
									marginBottom: step.complete ? 0 : 12,
								}}
							>
								<span
									style={{
										width: 18,
										height: 18,
										display: "inline-flex",
										alignItems: "center",
										justifyContent: "center",
										background: step.complete
											? "var(--color-sys-primary)"
											: "transparent",
										color: step.complete
											? "var(--color-sys-on-primary)"
											: "inherit",
										border: step.complete
											? "none"
											: "1px solid var(--color-sys-outline-variant)",
										fontSize: 12,
									}}
								>
									{step.complete ? "✓" : ""}
								</span>
								{step.title}
							</div>
							{!step.complete && (
								<div style={{ marginLeft: 30, marginTop: 8 }}>{step.body}</div>
							)}
						</li>
					))}
				</ol>
			</section>

			<section
				aria-labelledby="investigation-capabilities-heading"
				style={{
					marginTop: 36,
					paddingTop: 24,
					borderTop: "1px solid var(--color-sys-outline-soft, #e5e7e3)",
				}}
			>
				<div style={{ marginBottom: 20 }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							marginBottom: 6,
						}}
					>
						<h2
							id="investigation-capabilities-heading"
							style={{
								margin: 0,
								fontSize: 16,
								fontWeight: 700,
								color: "var(--color-sys-on-surface)",
							}}
						>
							Next steps: Agent debugging & investigation
						</h2>
						<span
							style={{
								display: "inline-flex",
								alignItems: "center",
								padding: "2px 6px",
								fontSize: 10,
								fontWeight: 700,
								letterSpacing: "0.08em",
								textTransform: "uppercase",
								background: "var(--color-sys-surface-low, #f3f3f3)",
								color: "var(--color-sys-on-surface-muted, #4e5555)",
								border: "1px solid var(--color-sys-outline-soft, #e5e7e3)",
							}}
						>
							Optional capabilities
						</span>
					</div>
					<p
						style={{
							color: "var(--color-sys-on-surface-muted)",
							margin: 0,
							fontSize: 13,
							lineHeight: 1.5,
						}}
					>
						Built for agentic debugging: once your core signals are flowing,
						explore these shipped investigation surfaces, causal action graphs,
						and evidence retrieval tools. These capabilities build on your
						existing telemetry and do not require emitting separate signal
						counts or telemetry milestones.
					</p>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					{INVESTIGATION_CAPABILITIES.map((cap) => (
						<article
							key={cap.id}
							style={{
								padding: 16,
								background: "var(--color-sys-surface, #ffffff)",
								borderLeft: "3px solid var(--color-sys-outline, #bdcbb6)",
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 12,
									marginBottom: 8,
									flexWrap: "wrap",
								}}
							>
								<h3
									style={{
										margin: 0,
										fontSize: 14,
										fontWeight: 700,
										color: "var(--color-sys-on-surface)",
									}}
								>
									{cap.title}
								</h3>
								<span
									style={{
										fontSize: 10,
										fontWeight: 700,
										textTransform: "uppercase",
										letterSpacing: "0.08em",
										padding: "2px 6px",
										background: "var(--color-sys-surface-low, #f3f3f3)",
										color: "var(--color-sys-accent, #17497b)",
									}}
								>
									{cap.badge}
								</span>
							</div>

							<p
								style={{
									margin: "0 0 8px",
									fontSize: 13,
									lineHeight: 1.5,
									color: "var(--color-sys-on-surface)",
								}}
							>
								{cap.description}
							</p>

							{cap.details && (
								<p
									style={{
										margin: "0 0 12px",
										fontSize: 12,
										lineHeight: 1.5,
										color: "var(--color-sys-on-surface-muted)",
									}}
								>
									{cap.details}
								</p>
							)}

							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 16,
									flexWrap: "wrap",
									paddingTop: 10,
									borderTop: "1px solid var(--color-sys-surface-low, #f3f3f3)",
									fontSize: 12,
								}}
							>
								{cap.productSurface && (
									<div
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											flexWrap: "wrap",
										}}
									>
										<span
											style={{
												color: "var(--color-sys-on-surface-subtle)",
												fontWeight: 600,
												fontSize: 11,
												textTransform: "uppercase",
												letterSpacing: "0.05em",
											}}
										>
											Surface:
										</span>
										<a
											href={cap.productSurface.href}
											onClick={(e) =>
												handleNavigate(
													e,
													e.currentTarget.getAttribute("href") ?? "",
												)
											}
											style={{
												color: "var(--color-sys-primary)",
												fontWeight: 600,
												textDecoration: "underline",
											}}
										>
											{cap.productSurface.label} →
										</a>
										{cap.productSurface.hint && (
											<span
												style={{
													color: "var(--color-sys-on-surface-muted)",
													fontSize: 11,
												}}
											>
												({cap.productSurface.hint})
											</span>
										)}
									</div>
								)}

								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										flexWrap: "wrap",
									}}
								>
									<span
										style={{
											color: "var(--color-sys-on-surface-subtle)",
											fontWeight: 600,
											fontSize: 11,
											textTransform: "uppercase",
											letterSpacing: "0.05em",
										}}
									>
										Docs:
									</span>
									{cap.docsLinks.map((doc) => (
										<a
											key={doc.href}
											href={doc.href}
											target="_blank"
											rel="noreferrer"
											style={{
												color: "var(--color-sys-primary)",
												fontWeight: 500,
												textDecoration: "underline",
												display: "inline-flex",
												alignItems: "center",
												gap: 2,
											}}
										>
											{doc.label}
											<span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>
												↗
											</span>
										</a>
									))}
								</div>
							</div>
						</article>
					))}
				</div>
			</section>
		</div>
	);
}

function buildSteps(c: SignalCounts): OnboardingStep[] {
	return [
		{
			id: "spans",
			title: "Send your first span",
			complete: c.spans > 0,
			body: (
				<Snippet
					lang="ts"
					code={`import {
  initObservability,
  createRequestSpan,
  runWithSpan,
  flushLogs,
} from "@obsunified/telemetry-sdk";

initObservability({
  collectorUrl: process.env.OBS_COLLECTOR_URL!,
  apiKey: process.env.OBS_INGEST_KEY!,
  serviceName: "my-api",
});

const span = createRequestSpan("my-api", "manual.test");
await runWithSpan(span, async () => { /* your work */ });
span.end();
await flushLogs();`}
				/>
			),
		},
		{
			id: "interaction",
			title: "Wire the browser → server interaction_id link",
			complete: c.spansWithInteraction > 0,
			body: (
				<>
					<p>
						<strong>Browser:</strong> wrap your app in{" "}
						<code>AnalyticsProvider</code>.
					</p>
					<Snippet
						lang="tsx"
						code={`import { AnalyticsProvider } from "@obsunified/analytics-sdk/react";

<AnalyticsProvider collectorUrl={...} apiKey={...} trackPageViews captureErrors>
  <App />
</AnalyticsProvider>`}
					/>
					<p style={{ marginTop: 12 }}>
						<strong>Server:</strong> call{" "}
						<code>stampInteractionFromRequest</code> on the root span.
					</p>
					<Snippet
						lang="ts"
						code={`import { stampInteractionFromRequest } from "@obsunified/telemetry-sdk";

app.use("*", async (c, next) => {
  const span = createRequestSpan("my-api", \`\${c.req.method} \${c.req.path}\`);
  stampInteractionFromRequest(span, c.req.raw);
  await runWithSpan(span, () => next());
  span.end();
});`}
					/>
				</>
			),
		},
		{
			id: "users",
			title: "Identify a user",
			complete: c.identifiedUsers > 0,
			body: (
				<Snippet
					lang="ts"
					code={`const { identify } = useAnalytics();

identify("user-123", { email: "user@example.com", plan: "pro" });`}
				/>
			),
		},
		{
			id: "logs",
			title: "Emit a structured log",
			complete: c.logs > 0,
			body: (
				<Snippet
					lang="ts"
					code={`import { createLogger } from "@obsunified/telemetry-sdk";

const log = createLogger("my-api");
log.info("Cart loaded", { cartId, itemCount: 3 });`}
				/>
			),
		},
		{
			id: "ai",
			title: "Track an AI call",
			complete: c.aiCalls > 0,
			body: (
				<>
					<Snippet
						lang="ts"
						code={`import { startLLMSpan } from "@obsunified/telemetry-sdk";

await startLLMSpan({
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
}, async (span) => {
  const response = await anthropic.messages.create({ /* ... */ });
  span.setUsage(response.usage);
  return response;
});`}
					/>
					<p
						style={{
							marginTop: 8,
							fontSize: 12,
							color: "var(--color-sys-on-surface-muted)",
						}}
					>
						AI spans automatically populate the{" "}
						<a
							href="#/ai"
							style={{
								color: "var(--color-sys-primary)",
								textDecoration: "underline",
							}}
						>
							AI Calls surface
						</a>{" "}
						and connect into the causal Agent Action Graph.
					</p>
				</>
			),
		},
		{
			id: "replay",
			title: "Capture a session replay",
			complete: c.replayChunks > 0,
			body: (
				<p>
					rrweb chunks are captured client-side by{" "}
					<code>@obsunified/analytics-sdk</code> when <code>captureReplay</code>{" "}
					is set on the provider. Visit the{" "}
					<a
						href="#/playground"
						style={{
							color: "var(--color-sys-primary)",
							textDecoration: "underline",
						}}
					>
						Playground tab
					</a>{" "}
					and click <strong>Start replay</strong> to seed one.
				</p>
			),
		},
	];
}

function Snippet({ lang, code }: { lang: string; code: string }) {
	return (
		<pre
			style={{
				margin: 0,
				padding: 12,
				background: "var(--color-sys-surface-container-high)",
				overflowX: "auto",
				fontSize: 12,
				lineHeight: 1.5,
			}}
		>
			<code data-lang={lang}>{code}</code>
		</pre>
	);
}
