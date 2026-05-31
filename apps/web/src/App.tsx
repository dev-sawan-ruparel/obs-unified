import { useAnalytics } from "@obs-unified/analytics-sdk/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { AskBox } from "../../../packages/dashboard/src/components/AskBox";
import {
	FilterGroup,
	FilterPanel,
} from "../../../packages/dashboard/src/components/FilterPanel";
import { ProjectSwitcher } from "../../../packages/dashboard/src/components/ProjectSwitcher";
import {
	GlobalSearch,
	TimeRangePicker,
} from "../../../packages/dashboard/src/components/TopBar";

const AIDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/AIDashboard").then(
		(m) => ({
			default: m.AIDashboard,
		}),
	),
);
const AlertsDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/AlertsDashboard").then(
		(m) => ({ default: m.AlertsDashboard }),
	),
);
const HealthDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/HealthDashboard").then(
		(m) => ({ default: m.HealthDashboard }),
	),
);
const InvestigationPage = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/InvestigationPage").then(
		(m) => ({ default: m.InvestigationPage }),
	),
);
const InvestigationsDashboard = lazy(() =>
	import(
		"../../../packages/dashboard/src/dashboards/InvestigationsDashboard"
	).then((m) => ({ default: m.InvestigationsDashboard })),
);
const LogsDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/LogsDashboard").then(
		(m) => ({ default: m.LogsDashboard }),
	),
);
const ProjectsDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/ProjectsDashboard").then(
		(m) => ({ default: m.ProjectsDashboard }),
	),
);
const ReplayDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/ReplayDashboard").then(
		(m) => ({ default: m.ReplayDashboard }),
	),
);
const ResourcesDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/ResourcesDashboard").then(
		(m) => ({ default: m.ResourcesDashboard }),
	),
);
const ServiceMapDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/ServiceMapDashboard").then(
		(m) => ({ default: m.ServiceMapDashboard }),
	),
);
const TelemetryDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/TelemetryDashboard").then(
		(m) => ({ default: m.TelemetryDashboard }),
	),
);
const TimelineDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/TimelineDashboard").then(
		(m) => ({ default: m.TimelineDashboard }),
	),
);
const UsageDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/UsageDashboard").then(
		(m) => ({ default: m.UsageDashboard }),
	),
);
const UserDashboard = lazy(() =>
	import("../../../packages/dashboard/src/dashboards/UserDashboard").then(
		(m) => ({ default: m.UserDashboard }),
	),
);

// ── Hash Router ──

type Route = {
	tab: string;
	traceId?: string;
	issueId?: string;
	sessionId?: string;
	service?: string;
	/** Stage 4: investigation page id, parsed from /#/investigate/<id>. */
	investigationId?: string;
	/** RFC 0006 Scenario B: user_profiles.user_id from /#/users/<id>. */
	userId?: string;
};

function parseHash(): Route {
	const hash = location.hash.slice(1) || "/health";
	const [path, query] = hash.split("?");
	const params = new URLSearchParams(query ?? "");
	const segments = path.replace(/^\//, "").split("/").filter(Boolean);
	const tab = segments[0] || "health";
	const investigationId =
		tab === "investigate" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const userId =
		tab === "users" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	return {
		tab,
		traceId: params.get("trace") ?? undefined,
		issueId: params.get("issue") ?? undefined,
		sessionId: params.get("session") ?? undefined,
		service: params.get("service") ?? undefined,
		investigationId,
		userId,
	};
}

function navigate(route: Partial<Route>) {
	const current = parseHash();
	const next = { ...current, ...route };
	let hash = `/${next.tab}`;
	if (next.tab === "investigate" && next.investigationId) {
		hash += `/${encodeURIComponent(next.investigationId)}`;
	}
	if (next.tab === "users" && next.userId) {
		hash += `/${encodeURIComponent(next.userId)}`;
	}
	const params = new URLSearchParams();
	if (next.traceId) params.set("trace", next.traceId);
	if (next.issueId) params.set("issue", next.issueId);
	if (next.sessionId) params.set("session", next.sessionId);
	if (next.service) params.set("service", next.service);
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

type NavItem = { key: string; label: string; short: string };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
	{
		label: "Observe",
		items: [
			{ key: "health", label: "Health", short: "HE" },
			{ key: "timeline", label: "Timeline", short: "TL" },
			{ key: "service-map", label: "Service Map", short: "SM" },
			{ key: "logs", label: "Logs", short: "LG" },
		],
	},
	{
		label: "Investigate",
		items: [
			{ key: "investigate", label: "Investigations", short: "IV" },
			{ key: "traces", label: "Traces", short: "TR" },
			{ key: "issues", label: "Issues", short: "IS" },
			{ key: "ai", label: "AI Calls", short: "AI" },
		],
	},
	{
		label: "Experience",
		items: [{ key: "replay", label: "Replays", short: "RP" }],
	},
	{
		label: "Operate",
		items: [
			{ key: "alerts", label: "Alerts", short: "AL" },
			{ key: "usage", label: "Usage", short: "US" },
			{ key: "resources", label: "Resources", short: "RS" },
		],
	},
];

const PINNED_ITEMS: NavItem[] = [
	{ key: "projects", label: "Projects", short: "PR" },
	{ key: "playground", label: "Playground", short: "PG" },
];

const RAIL_COLLAPSED_KEY = "obs.railCollapsed";
const THEME_KEY = "obs.theme";

function readRailCollapsed(): boolean {
	if (typeof localStorage === "undefined") return false;
	try {
		return localStorage.getItem(RAIL_COLLAPSED_KEY) === "1";
	} catch {
		return false;
	}
}

function writeRailCollapsed(collapsed: boolean): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? "1" : "0");
	} catch {
		// ignore
	}
}

type Theme = "light" | "dark";

function readTheme(): Theme {
	if (typeof localStorage === "undefined") return "light";
	try {
		const v = localStorage.getItem(THEME_KEY);
		return v === "dark" ? "dark" : "light";
	} catch {
		return "light";
	}
}

function writeTheme(theme: Theme): void {
	if (typeof localStorage === "undefined") return;
	try {
		localStorage.setItem(THEME_KEY, theme);
	} catch {
		// ignore
	}
}

export function App() {
	const route = useRoute();
	const { trackInteraction } = useAnalytics();
	// User's stated preference — persisted, only written by explicit toggle.
	const [userCollapsed, setUserCollapsed] =
		useState<boolean>(readRailCollapsed);
	// Whether the viewport is forcing a collapse independent of preference.
	const [viewportForce, setViewportForce] = useState<boolean>(
		typeof window !== "undefined" && window.innerWidth < 1100,
	);
	const collapsed = viewportForce || userCollapsed;
	const [theme, setTheme] = useState<Theme>(readTheme);

	// Set default hash on first load
	useEffect(() => {
		if (!location.hash) location.hash = "/health";
	}, []);

	useEffect(() => {
		writeRailCollapsed(userCollapsed);
	}, [userCollapsed]);

	useEffect(() => {
		writeTheme(theme);
		document.documentElement.dataset.theme = theme;
	}, [theme]);

	useEffect(() => {
		const onResize = () => setViewportForce(window.innerWidth < 1100);
		onResize();
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	const toggleCollapsed = () => {
		// If the viewport is forcing collapse, the toggle no-ops.
		if (viewportForce) return;
		setUserCollapsed((v) => !v);
	};

	const switchTab = (tab: string) => {
		trackInteraction("tab_switch", { from: route.tab, to: tab });
		navigate({
			tab,
			traceId: undefined,
			issueId: undefined,
			sessionId: undefined,
		});
	};

	const renderNavItem = ({ key, label, short }: NavItem) => {
		const active = route.tab === key;
		if (collapsed) {
			return (
				<button
					type="button"
					key={key}
					onClick={() => switchTab(key)}
					title={label}
					className={`relative mx-auto my-0.5 flex h-9 w-9 items-center justify-center text-[0.6875rem] font-semibold tracking-[0.08em] transition-none ${
						active
							? "bg-sys-primary text-white"
							: "bg-sys-surface-low text-sys-on-surface-muted hover:bg-sys-surface-high hover:text-sys-on-surface"
					}`}
				>
					{short}
				</button>
			);
		}
		return (
			<button
				type="button"
				key={key}
				onClick={() => switchTab(key)}
				className={`relative flex h-8 items-center pl-4 pr-3 text-left text-[0.8125rem] transition-none ${
					active
						? "bg-sys-surface-low font-semibold text-sys-on-surface"
						: "font-medium text-sys-on-surface-muted hover:bg-sys-surface-low hover:text-sys-on-surface"
				}`}
			>
				{active && (
					<span
						aria-hidden
						className="absolute left-0 top-0 h-full w-[3px] bg-sys-primary"
					/>
				)}
				{label}
			</button>
		);
	};

	return (
		<div className="flex h-screen overflow-hidden bg-sys-bg font-sans text-sys-on-surface">
			<aside
				className={`flex h-full flex-none flex-col border-r border-sys-outline-soft bg-sys-surface ${
					collapsed ? "w-[56px]" : "w-[220px]"
				}`}
			>
				<div
					className={`flex h-12 flex-none items-center border-b border-sys-outline-soft ${
						collapsed ? "justify-center" : "px-4"
					}`}
				>
					<span
						className={`font-bold uppercase tracking-[0.14em] text-sys-on-surface ${
							collapsed ? "text-[0.625rem]" : "text-[0.8125rem]"
						}`}
						title={collapsed ? "obs-unified" : undefined}
					>
						{collapsed ? "OBS" : "obs-unified"}
					</span>
				</div>
				<nav className="flex-1 overflow-y-auto py-3">
					{NAV_GROUPS.map((group) => (
						<div key={group.label} className={collapsed ? "mb-2" : "mb-4"}>
							{!collapsed && (
								<div className="mb-1 px-4 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
									{group.label}
								</div>
							)}
							{collapsed && (
								<div
									aria-hidden
									className="mx-auto mb-1 h-[1px] w-6 bg-sys-outline-soft"
								/>
							)}
							<div className="flex flex-col">
								{group.items.map(renderNavItem)}
							</div>
						</div>
					))}
				</nav>
				<div className="flex-none border-t border-sys-outline-soft py-2">
					{PINNED_ITEMS.map(renderNavItem)}
					<button
						type="button"
						onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
						title={theme === "dark" ? "Switch to light" : "Switch to dark"}
						className={`mt-1 flex h-8 items-center text-[0.8125rem] font-medium text-sys-on-surface-subtle hover:text-sys-on-surface ${
							collapsed ? "mx-auto w-9 justify-center" : "px-4"
						}`}
					>
						<span aria-hidden>{theme === "dark" ? "☀" : "☾"}</span>
						{!collapsed && (
							<span className="ml-2">
								{theme === "dark" ? "Light" : "Dark"} mode
							</span>
						)}
					</button>
					<button
						type="button"
						onClick={toggleCollapsed}
						title={
							viewportForce
								? "Sidebar collapsed (viewport too narrow)"
								: collapsed
									? "Expand sidebar"
									: "Collapse sidebar"
						}
						disabled={viewportForce}
						className={`mt-1 flex h-8 items-center text-[0.8125rem] font-medium text-sys-on-surface-subtle hover:text-sys-on-surface disabled:opacity-50 disabled:cursor-not-allowed ${
							collapsed ? "mx-auto w-9 justify-center" : "px-4"
						}`}
					>
						<span aria-hidden>{collapsed ? "»" : "«"}</span>
						{!collapsed && <span className="ml-2">Collapse</span>}
					</button>
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-12 flex-none items-center gap-3 border-b border-sys-outline-soft bg-sys-surface px-3">
					<GlobalSearch />
					<TimeRangePicker />
					<ProjectSwitcher />
					<div className="ml-auto">
						<AskBox />
					</div>
				</header>
				<main className="min-h-0 flex-1 overflow-y-auto">
					<Suspense fallback={<DashboardLoading />}>
						{route.tab === "playground" && <Playground />}
						{route.tab === "health" && <HealthDashboard />}
						{route.tab === "investigate" &&
							(route.investigationId ? (
								<InvestigationPage
									investigationId={route.investigationId}
									onNavigate={navigate}
								/>
							) : (
								<InvestigationsDashboard onNavigate={navigate} />
							))}
						{route.tab === "traces" && (
							<TelemetryDashboard
								mode="traces"
								initialTraceId={route.traceId}
								initialService={route.service}
								onNavigate={navigate}
							/>
						)}
						{route.tab === "service-map" && (
							<ServiceMapDashboard onNavigate={navigate} />
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
						{route.tab === "usage" && <UsageDashboard onNavigate={navigate} />}
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
						{route.tab === "users" && route.userId && (
							<UserDashboard
								userId={route.userId}
								onNavigate={(href) => {
									location.hash = href.startsWith("#") ? href.slice(1) : href;
								}}
							/>
						)}
					</Suspense>
				</main>
			</div>
		</div>
	);
}

function DashboardLoading() {
	return (
		<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted">
			Loading dashboard…
		</div>
	);
}

function Playground() {
	const {
		trackInteraction,
		identify,
		startReplay,
		fetch: analyticalFetch,
	} = useAnalytics();
	const [response, setResponse] = useState("");
	const [loading, setLoading] = useState(false);
	const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
	const [severityFilter, setSeverityFilter] = useState<Set<string>>(new Set());

	const toggleSet = (s: Set<string>, v: string) => {
		const next = new Set(s);
		if (next.has(v)) next.delete(v);
		else next.add(v);
		return next;
	};

	const call = async (path: string, label: string, opts?: RequestInit) => {
		setLoading(true);
		const method = opts?.method || "GET";
		const start = Date.now();
		try {
			const r = await analyticalFetch(path, opts);
			setResponse(JSON.stringify(await r.json(), null, 2));
			trackInteraction(`api_${label}`, {
				path,
				method,
				status: r.status,
				durationMs: Date.now() - start,
			});
		} catch (e) {
			setResponse(`Error: ${e instanceof Error ? e.message : e}`);
			trackInteraction(`api_${label}`, {
				path,
				method,
				status: "error",
				error: String(e),
				durationMs: Date.now() - start,
			});
		} finally {
			setLoading(false);
		}
	};

	const activeFilterCount = statusFilter.size + severityFilter.size;

	return (
		<div className="flex h-full min-h-0">
			<FilterPanel
				storageKey="playground.filters"
				onClear={
					activeFilterCount > 0
						? () => {
								setStatusFilter(new Set());
								setSeverityFilter(new Set());
							}
						: undefined
				}
			>
				<FilterGroup title="Status" count={statusFilter.size}>
					<div className="flex flex-col gap-1">
						{["ok", "error", "timeout", "cancelled"].map((v) => (
							<label
								key={v}
								className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface"
							>
								<input
									type="checkbox"
									checked={statusFilter.has(v)}
									onChange={() => setStatusFilter((s) => toggleSet(s, v))}
									className="h-3 w-3 accent-sys-primary"
								/>
								<span className="">{v}</span>
							</label>
						))}
					</div>
				</FilterGroup>
				<FilterGroup title="Severity" count={severityFilter.size}>
					<div className="flex flex-col gap-1">
						{["debug", "info", "warn", "error"].map((v) => (
							<label
								key={v}
								className="flex cursor-pointer items-center gap-2 text-[0.75rem] text-sys-on-surface-muted hover:text-sys-on-surface"
							>
								<input
									type="checkbox"
									checked={severityFilter.has(v)}
									onChange={() => setSeverityFilter((s) => toggleSet(s, v))}
									className="h-3 w-3 accent-sys-primary"
								/>
								<span className="">{v}</span>
							</label>
						))}
					</div>
				</FilterGroup>
			</FilterPanel>
			<div className="flex-1 overflow-y-auto p-3">
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
							trackInteraction("crash_test", {
								reason: "User triggered hard crash via Playground UI",
							});
							throw new Error("Crash");
						}}
						c="err"
					>
						Crash
					</Btn>
					<div className="w-4" />
					<Btn
						onClick={() => {
							trackInteraction("mock_ai_chat", {
								promptType: "default",
								simulated: true,
							});
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
							identify("test-user-123", {
								email: "test@example.com",
								plan: "pro",
							});
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
					: "bg-transparent text-sys-on-surface-muted shadow-[inset_0_0_0_1px_var(--color-sys-outline)] hover:bg-sys-surface-low hover:text-sys-on-surface";
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={`px-3 py-1.5 text-[0.875rem] font-semibold transition-none disabled:opacity-40 rounded-none cursor-pointer ${cls}`}
		>
			{children}
		</button>
	);
}
