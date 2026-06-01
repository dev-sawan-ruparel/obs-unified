import { useAnalytics } from "@obs-unified/analytics-sdk/react";
import { Suspense, useEffect, useState } from "react";
import { AskBox } from "../../../packages/dashboard/src/components/AskBox";
import { ProjectSwitcher } from "../../../packages/dashboard/src/components/ProjectSwitcher";
import {
	GlobalSearch,
	TimeRangePicker,
} from "../../../packages/dashboard/src/components/TopBar";
import {
	ActionDashboard,
	AgentRunDashboard,
	AgentVersionDiffDashboard,
	AIDashboard,
	AlertsDashboard,
	AutonomousReviewDashboard,
	CostAttributionDashboard,
	HealthDashboard,
	InvestigationPage,
	InvestigationsDashboard,
	LogsDashboard,
	ProjectsDashboard,
	ReplayDashboard,
	ResourcesDashboard,
	ServiceMapDashboard,
	TelemetryDashboard,
	TimelineDashboard,
	ToolCallDashboard,
	ToolReliabilityDashboard,
	UsageDashboard,
	UserDashboard,
} from "./app/dashboard-modules";
import { NAV_GROUPS, type NavItem, PINNED_ITEMS } from "./app/navigation";
import { Playground } from "./app/Playground";
import {
	readRailCollapsed,
	readTheme,
	type Theme,
	writeRailCollapsed,
	writeTheme,
} from "./app/preferences";
import { KNOWN_TABS, navigate, useRoute } from "./app/router";

// ── App ──

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
						{route.tab === "users" && !route.userId && <ProjectsDashboard />}
						{route.tab === "agent-runs" && route.agentRunId && (
							<AgentRunDashboard
								agentRunId={route.agentRunId}
								onNavigate={(href) => {
									location.hash = href.startsWith("#") ? href.slice(1) : href;
								}}
							/>
						)}
						{route.tab === "actions" && route.actionId && (
							<ActionDashboard
								actionId={route.actionId}
								onNavigate={(href) => {
									location.hash = href.startsWith("#") ? href.slice(1) : href;
								}}
							/>
						)}
						{route.tab === "tool-calls" && route.toolCallId && (
							<ToolCallDashboard
								toolCallId={route.toolCallId}
								onNavigate={(href) => {
									location.hash = href.startsWith("#") ? href.slice(1) : href;
								}}
							/>
						)}
						{route.tab === "tool-reliability" && <ToolReliabilityDashboard />}
						{route.tab === "cost-attribution" && <CostAttributionDashboard />}
						{route.tab === "autonomous-review" && (
							<AutonomousReviewDashboard onNavigate={navigate} />
						)}
						{route.tab === "agent-version-diff" && (
							<AgentVersionDiffDashboard />
						)}
						{!KNOWN_TABS.has(route.tab) && <HealthDashboard />}
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
