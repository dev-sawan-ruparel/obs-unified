import { useAnalytics } from "@obs/analytics-sdk/react";
import { useEffect, useState } from "react";
import { TelemetryDashboard } from "./dashboards/TelemetryDashboard";
import { UsageDashboard } from "./dashboards/UsageDashboard";
import { LogsDashboard } from "./dashboards/LogsDashboard";
import { AIDashboard } from "./dashboards/AIDashboard";
import { ReplayDashboard } from "./dashboards/ReplayDashboard";

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
	{ key: "issues", label: "Issues" },
	{ key: "logs", label: "Logs" },
	{ key: "ai", label: "AI Calls" },
	{ key: "usage", label: "Usage" },
	{ key: "replay", label: "Replays" },
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
		<div className="flex h-screen flex-col overflow-hidden bg-white">
			<header className="flex h-10 flex-none items-center gap-1 border-b border-stone-200 px-3">
				<span className="mr-3 text-xs font-semibold text-stone-900">
					obs-unified
				</span>
				{TABS.map(({ key, label }) => (
					<button
						key={key}
						onClick={() => switchTab(key)}
						className={`border-b-2 px-2.5 py-2 text-[11px] font-medium transition-colors ${
							route.tab === key
								? "border-stone-900 text-stone-900"
								: "border-transparent text-stone-400 hover:text-stone-700"
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
			<div className="mb-2 flex flex-wrap gap-1.5">
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
				>
					Create
				</Btn>
				<span className="w-px bg-stone-200" />
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
				<span className="w-px bg-stone-200" />
				<Btn
					onClick={() => {
						trackInteraction("mock_ai_chat", { promptType: "default", simulated: true });
						call("/api/chat", "chat", { method: "POST" });
					}}
					disabled={loading}
				>
					Mock AI Chat
				</Btn>
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
					c="warn"
				>
					Start Replay
				</Btn>
			</div>
			{response && (
				<pre className="rounded border border-stone-200 bg-stone-50 p-2 font-mono text-[10px] leading-relaxed text-stone-700 max-h-80 overflow-auto">
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
}: {
	children: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
	c?: "warn" | "err";
}) {
	const cls =
		c === "err"
			? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
			: c === "warn"
				? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
				: "border-stone-300 bg-white text-stone-700 hover:bg-stone-50";
	return (
		<button
			onClick={onClick}
			disabled={disabled}
			className={`rounded border px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${cls}`}
		>
			{children}
		</button>
	);
}
