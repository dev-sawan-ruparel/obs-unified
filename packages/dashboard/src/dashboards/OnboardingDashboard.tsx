// Onboarding dashboard — the first thing a new user sees when their
// collector has no (or sparse) data. Probes the collector's signal
// tables for emptiness and renders the relevant "you need to wire X"
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

export function OnboardingDashboard() {
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

	return (
		<div style={{ padding: 24, maxWidth: 880 }}>
			<header style={{ marginBottom: 24 }}>
				<h1 style={{ margin: 0, fontSize: 22 }}>Onboarding</h1>
				<p style={{ color: "var(--color-sys-on-surface-muted)", margin: "4px 0 0" }}>
					{allDone
						? "All signal types are flowing. You can hide this tab from the left rail in settings."
						: `${completeCount} of ${steps.length} steps complete.`}
				</p>
			</header>

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
									color: step.complete ? "var(--color-sys-on-primary)" : "inherit",
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
} from "@obs-unified/telemetry-sdk";

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
						<strong>Browser:</strong> wrap your app in <code>AnalyticsProvider</code>.
					</p>
					<Snippet
						lang="tsx"
						code={`import { AnalyticsProvider } from "@obs-unified/analytics-sdk/react";

<AnalyticsProvider collectorUrl={...} apiKey={...} trackPageViews captureErrors>
  <App />
</AnalyticsProvider>`}
					/>
					<p style={{ marginTop: 12 }}>
						<strong>Server:</strong> call <code>stampInteractionFromRequest</code> on the root span.
					</p>
					<Snippet
						lang="ts"
						code={`import { stampInteractionFromRequest } from "@obs-unified/telemetry-sdk";

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
					code={`import { createLogger } from "@obs-unified/telemetry-sdk";

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
				<Snippet
					lang="ts"
					code={`import { startLLMSpan } from "@obs-unified/telemetry-sdk";

await startLLMSpan({
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
}, async (span) => {
  const response = await anthropic.messages.create({ /* ... */ });
  span.setUsage(response.usage);
  return response;
});`}
				/>
			),
		},
		{
			id: "replay",
			title: "Capture a session replay",
			complete: c.replayChunks > 0,
			body: (
				<p>
					rrweb chunks are captured client-side by{" "}
					<code>@obs-unified/analytics-sdk</code> when{" "}
					<code>captureReplay</code> is set on the provider. Visit the
					Playground tab and click <strong>Start replay</strong> to
					seed one.
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
