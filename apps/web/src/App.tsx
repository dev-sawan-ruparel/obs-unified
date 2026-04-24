import { useAnalytics } from "@obs/analytics-sdk/react";
import {
	TelemetryDashboard,
	TimelineDashboard,
	UsageDashboard,
	LogsDashboard,
	AIDashboard,
	ReplayDashboard,
	ResourcesDashboard,
	ServiceMapDashboard,
	ProjectsDashboard,
	AlertsDashboard,
	ProjectSwitcher,
} from "@obs/dashboard";
import { useEffect, useState } from "react";

// ── Hash Router ──

type Route = {
	tab: string;
	traceId?: string;
	issueId?: string;
	sessionId?: string;
};

function parseHash(): Route {
	const hash = location.hash.slice(1) || "/traces";
	const [path, query] = hash.split("?");
	const params = new URLSearchParams(query ?? "");
	const tab = path.replace(/^\//, "").split("/")[0] || "traces";
	return {
		tab,
		traceId: params.get("trace") ?? undefined,
		issueId: params.get("issue") ?? undefined,
		sessionId: params.get("session") ?? undefined,
	};
}

function navigate(route: Partial<Route>) {
	const current = parseHash();
	const next = { ...current, ...route };
	let hash = `/${next.tab}`;
	const params = new URLSearchParams();
	if (next.traceId) params.set("trace", next.traceId);
	if (next.issueId) params.set("issue", next.issueId);
	if (next.sessionId) params.set("session", next.sessionId);
	const qs = params.toString();
	if (qs) hash += `?${qs}`;
	location.hash = hash;
}

function useRoute(): Route {
	const [route, setRoute] = useState(parseHash);
	useEffect(() => {
		const handler = () => setRoute(parseHash());
		window.addEventListener("hashchange", handler);
		return () => window.removeEventListener("hashchange", handler);
	}, []);
	return route;
}

// ── App ──

const TABS = [
	{ key: "playground", label: "Playground" },
	{ key: "traces", label: "Traces" },
	{ key: "service-map", label: "Service Map" },
	{ key: "issues", label: "Issues" },
	{ key: "logs", label: "Logs" },
	{ key: "ai", label: "AI Calls" },
	{ key: "usage", label: "Usage" },
	{ key: "replay", label: "Replays" },
	{ key: "timeline", label: "Timeline" },
	{ key: "alerts", label: "Alerts" },
	{ key: "resources", label: "Resources" },
	{ key: "projects", label: "Projects" },
] as const;

export function App() {
	const route = useRoute();
	const { trackInteraction } = useAnalytics();

	// Set default hash on first load
	useEffect(() => {
		if (!location.hash) location.hash = "/traces";
	}, []);

	const switchTab = (tab: string) => {
		trackInteraction("tab_switch", { from: route.tab, to: tab });
		navigate({
			tab,
			traceId: undefined,
			issueId: undefined,
			sessionId: undefined,
		});
	};

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface">
			<header className="flex h-12 flex-none items-center gap-2 bg-sys-surface px-2 py-2">
				<span className="mr-6 text-xs font-bold uppercase tracking-widest text-sys-on-surface">
					obs-unified
				</span>
				<ProjectSwitcher />
				{TABS.map(({ key, label }) => (
					<button
						key={key}
						onClick={() => switchTab(key)}
						className={`px-3 py-1.5 text-[0.875rem] uppercase tracking-[0.05em] transition-none ${
							route.tab === key
								? "bg-sys-surface-low font-bold text-sys-on-surface"
								: "text-sys-outline hover:bg-sys-surface-low hover:text-sys-on-surface"
						}`}
					>
						{label}
					</button>
				))}
			</header>
			<main className="min-h-0 flex-1 overflow-y-auto">
				{route.tab === "playground" && <Playground />}
				{route.tab === "traces" && (
					<TelemetryDashboard
						mode="traces"
						initialTraceId={route.traceId}
						onNavigate={navigate}
					/>
				)}
				{route.tab === "service-map" && <ServiceMapDashboard />}
				{route.tab === "issues" && (
					<TelemetryDashboard
						mode="issues"
						initialIssueId={route.issueId}
						onNavigate={navigate}
					/>
				)}
				{route.tab === "logs" && <LogsDashboard />}
				{route.tab === "ai" && <AIDashboard />}
				{route.tab === "usage" && (
					<UsageDashboard onNavigate={navigate} />
				)}
				{route.tab === "replay" && (
					<ReplayDashboard
						initialSessionId={route.sessionId}
						onNavigate={navigate}
					/>
				)}
				{route.tab === "timeline" && (
					<TimelineDashboard
						initialSessionId={route.sessionId}
						onNavigate={navigate}
					/>
				)}
				{route.tab === "alerts" && <AlertsDashboard />}
				{route.tab === "resources" && <ResourcesDashboard />}
				{route.tab === "projects" && <ProjectsDashboard />}
			</main>
		</div>
	);
}

function Playground() {
	const { trackInteraction, identify, startReplay, fetch: analyticalFetch } = useAnalytics();
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);

	const call = async (path: string, label: string, opts?: RequestInit) => {
		setLoading(true);
		const method = opts?.method || "GET";
		const start = Date.now();
		try {
			const r = await analyticalFetch(path, opts);
			setResponse(JSON.stringify(await r.json(), null, 2));
			trackInteraction(`api_${label}`, { path, method, status: r.status, durationMs: Date.now() - start });
		} catch (e) {
			setResponse(`Error: ${e instanceof Error ? e.message : e}`);
			trackInteraction(`api_${label}`, { path, method, status: "error", error: String(e), durationMs: Date.now() - start });
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="p-3">
			<div className="mb-2 flex flex-wrap gap-3">
				<Btn onClick={() => call("/api/health", "health")} disabled={loading}>
					Health
				</Btn>
				<Btn onClick={() => call("/api/items", "items")} disabled={loading}>
					Items
				</Btn>
				<Btn onClick={() => call("/api/items/1", "item1")} disabled={loading}>
					Item 1
				</Btn>
				<Btn
					onClick={() =>
						call("/api/items", "create", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: '{"name":"W","price":9.99}',
						})
					}
					disabled={loading}
					c="primary"
				>
					Create
				</Btn>
				<div className="w-4" />
				<Btn
					onClick={() => call("/api/items/999", "404")}
					disabled={loading}
					c="warn"
				>
					404
				</Btn>
				<Btn
					onClick={() => call("/api/slow", "slow")}
					disabled={loading}
					c="warn"
				>
					Slow
				</Btn>
				<Btn
					onClick={() => call("/api/error", "err")}
					disabled={loading}
					c="err"
				>
					Error
				</Btn>
				<Btn
					onClick={() => {
						trackInteraction("crash_test", { reason: "User triggered hard crash via Playground UI" });
						throw new Error("Crash");
					}}
					c="err"
				>
					Crash
				</Btn>
				<div className="w-4" />
				<Btn
					onClick={() => {
						trackInteraction("mock_ai_chat", { promptType: "default", simulated: true });
						call("/api/chat", "chat", { method: "POST" });
					}}
					disabled={loading}
				>
					Mock AI Chat
				</Btn>
				<div className="w-4" />
				{/* Real LLM demos — each emits typed OpenInference spans that show
				    up under AI CALLS. Require provider keys in apps/obs-demo/.dev.vars. */}
				<Btn
					onClick={() => call("/api/demo/chat", "demo_chat")}
					disabled={loading}
					c="primary"
					title="Fan out one prompt across every enabled LLM provider"
				>
					AI: Chat
				</Btn>
				<Btn
					onClick={() => call("/api/demo/rag", "demo_rag")}
					disabled={loading}
					c="primary"
					title="RETRIEVER → LLM with a fake doc store + rag_faithfulness eval"
				>
					AI: RAG
				</Btn>
				<Btn
					onClick={() => call("/api/demo/tool", "demo_tool")}
					disabled={loading}
					c="primary"
					title="TOOL → LLM weather summary + mentions_temperature eval"
				>
					AI: Tool
				</Btn>
				<Btn
					onClick={() => call("/api/demo/session", "demo_session")}
					disabled={loading}
					c="primary"
					title="Three-turn conversation, all stamped with the same session.id"
				>
					AI: Session
				</Btn>
				<Btn
					onClick={() => call("/api/demo/run-all", "demo_all")}
					disabled={loading}
					c="primary"
					title="Every scenario back-to-back — one-click end-to-end demo"
				>
					AI: Run all
				</Btn>
				<div className="w-4" />
				<Btn
					onClick={() => {
						identify("test-user-123", { email: "test@example.com", plan: "pro" });
						setResponse("Called identify() for test-user-123");
					}}
					disabled={loading}
				>
					Identify User
				</Btn>
				<Btn
					onClick={() => {
						trackInteraction("start_replay_click", { manual: true });
						startReplay();
						setResponse("Started rrweb session replay recording...");
					}}
					disabled={loading}
					c="primary"
				>
					Start Replay
				</Btn>
			</div>
			{response && (
				<pre className="bg-sys-surface p-2 font-mono text-[0.875rem] leading-relaxed text-sys-on-surface max-h-[600px] overflow-auto">
					{response}
				</pre>
			)}
		</div>
	);
}

function Btn({
	children,
	onClick,
	disabled,
	c,
	title,
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	c?: "warn" | "err" | "primary";
	title?: string;
}) {
	const cls =
		c === "err"
			? "bg-sys-error text-white hover:opacity-90"
			: c === "primary"
				? "bg-sys-primary text-white hover:bg-micro-gradient"
				: c === "warn"
					? "bg-transparent text-sys-error shadow-[inset_0_0_0_1px_var(--color-sys-error)] hover:bg-sys-surface-low"
					: "bg-transparent text-sys-outline shadow-[inset_0_0_0_1px_var(--color-sys-outline)] hover:bg-sys-surface-low hover:text-sys-on-surface";
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] transition-none disabled:opacity-40 rounded-none cursor-pointer ${cls}`}
		>
			{children}
		</button>
	);
}
