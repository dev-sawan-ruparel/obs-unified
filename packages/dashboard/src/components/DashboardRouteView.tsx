import {
	type DashboardRoute,
	KNOWN_TABS,
	parseDashboardRouteHash,
	type Route,
	routeToHash,
} from "@obsunified/types";
import { lazy, type ReactNode, Suspense, useCallback } from "react";
import { ActionDashboard } from "../dashboards/ActionDashboard";
import { AgentRunDashboard } from "../dashboards/AgentRunDashboard";
import { AgentVersionDiffDashboard } from "../dashboards/AgentVersionDiffDashboard";
import { AIDashboard } from "../dashboards/AIDashboard";
import { AlertsDashboard } from "../dashboards/AlertsDashboard";
import { AutonomousReviewDashboard } from "../dashboards/AutonomousReviewDashboard";
import { CostAttributionDashboard } from "../dashboards/CostAttributionDashboard";
import { EvaluationsDashboard } from "../dashboards/EvaluationsDashboard";
import { EvidenceDashboard } from "../dashboards/EvidenceDashboard";
import { HealthDashboard } from "../dashboards/HealthDashboard";
import { InvestigationPage } from "../dashboards/InvestigationPage";
import { InvestigationsDashboard } from "../dashboards/InvestigationsDashboard";
import { LogsDashboard } from "../dashboards/LogsDashboard";
import { OnboardingDashboard } from "../dashboards/OnboardingDashboard";
import { ProfileDashboard } from "../dashboards/ProfileDashboard";
import { ProjectsDashboard } from "../dashboards/ProjectsDashboard";
import { ReplayDashboard } from "../dashboards/ReplayDashboard";
import { ResourcesDashboard } from "../dashboards/ResourcesDashboard";
import { ServiceMapDashboard } from "../dashboards/ServiceMapDashboard";
import { TelemetryDashboard } from "../dashboards/TelemetryDashboard";
import { TimelineDashboard } from "../dashboards/TimelineDashboard";
import { ToolCallDashboard } from "../dashboards/ToolCallDashboard";
import { ToolReliabilityDashboard } from "../dashboards/ToolReliabilityDashboard";
import { UsageDashboard } from "../dashboards/UsageDashboard";
import { UserDashboard } from "../dashboards/UserDashboard";
import { normalizeConnectedHref } from "./ConnectedRail";

export const LazyAIDashboard = lazy(() =>
	import("../dashboards/AIDashboard").then((m) => ({
		default: m.AIDashboard,
	})),
);
export const LazyAlertsDashboard = lazy(() =>
	import("../dashboards/AlertsDashboard").then((m) => ({
		default: m.AlertsDashboard,
	})),
);
export const LazyHealthDashboard = lazy(() =>
	import("../dashboards/HealthDashboard").then((m) => ({
		default: m.HealthDashboard,
	})),
);
export const LazyInvestigationPage = lazy(() =>
	import("../dashboards/InvestigationPage").then((m) => ({
		default: m.InvestigationPage,
	})),
);
export const LazyInvestigationsDashboard = lazy(() =>
	import("../dashboards/InvestigationsDashboard").then((m) => ({
		default: m.InvestigationsDashboard,
	})),
);
export const LazyLogsDashboard = lazy(() =>
	import("../dashboards/LogsDashboard").then((m) => ({
		default: m.LogsDashboard,
	})),
);
export const LazyOnboardingDashboard = lazy(() =>
	import("../dashboards/OnboardingDashboard").then((m) => ({
		default: m.OnboardingDashboard,
	})),
);
export const LazyProjectsDashboard = lazy(() =>
	import("../dashboards/ProjectsDashboard").then((m) => ({
		default: m.ProjectsDashboard,
	})),
);
export const LazyProfileDashboard = lazy(() =>
	import("../dashboards/ProfileDashboard").then((m) => ({
		default: m.ProfileDashboard,
	})),
);
export const LazyReplayDashboard = lazy(() =>
	import("../dashboards/ReplayDashboard").then((m) => ({
		default: m.ReplayDashboard,
	})),
);
export const LazyResourcesDashboard = lazy(() =>
	import("../dashboards/ResourcesDashboard").then((m) => ({
		default: m.ResourcesDashboard,
	})),
);
export const LazyServiceMapDashboard = lazy(() =>
	import("../dashboards/ServiceMapDashboard").then((m) => ({
		default: m.ServiceMapDashboard,
	})),
);
export const LazyTelemetryDashboard = lazy(() =>
	import("../dashboards/TelemetryDashboard").then((m) => ({
		default: m.TelemetryDashboard,
	})),
);
export const LazyTimelineDashboard = lazy(() =>
	import("../dashboards/TimelineDashboard").then((m) => ({
		default: m.TimelineDashboard,
	})),
);
export const LazyUsageDashboard = lazy(() =>
	import("../dashboards/UsageDashboard").then((m) => ({
		default: m.UsageDashboard,
	})),
);
export const LazyUserDashboard = lazy(() =>
	import("../dashboards/UserDashboard").then((m) => ({
		default: m.UserDashboard,
	})),
);
export const LazyAgentRunDashboard = lazy(() =>
	import("../dashboards/AgentRunDashboard").then((m) => ({
		default: m.AgentRunDashboard,
	})),
);
export const LazyActionDashboard = lazy(() =>
	import("../dashboards/ActionDashboard").then((m) => ({
		default: m.ActionDashboard,
	})),
);
export const LazyToolCallDashboard = lazy(() =>
	import("../dashboards/ToolCallDashboard").then((m) => ({
		default: m.ToolCallDashboard,
	})),
);
export const LazyToolReliabilityDashboard = lazy(() =>
	import("../dashboards/ToolReliabilityDashboard").then((m) => ({
		default: m.ToolReliabilityDashboard,
	})),
);
export const LazyCostAttributionDashboard = lazy(() =>
	import("../dashboards/CostAttributionDashboard").then((m) => ({
		default: m.CostAttributionDashboard,
	})),
);
export const LazyAutonomousReviewDashboard = lazy(() =>
	import("../dashboards/AutonomousReviewDashboard").then((m) => ({
		default: m.AutonomousReviewDashboard,
	})),
);
export const LazyAgentVersionDiffDashboard = lazy(() =>
	import("../dashboards/AgentVersionDiffDashboard").then((m) => ({
		default: m.AgentVersionDiffDashboard,
	})),
);
export const LazyEvaluationsDashboard = lazy(() =>
	import("../dashboards/EvaluationsDashboard").then((m) => ({
		default: m.EvaluationsDashboard,
	})),
);
export const LazyEvidenceDashboard = lazy(() =>
	import("../dashboards/EvidenceDashboard").then((m) => ({
		default: m.EvidenceDashboard,
	})),
);

const EAGER_VIEWS = {
	ActionDashboard,
	AgentRunDashboard,
	AgentVersionDiffDashboard,
	AIDashboard,
	AlertsDashboard,
	AutonomousReviewDashboard,
	CostAttributionDashboard,
	EvaluationsDashboard,
	EvidenceDashboard,
	HealthDashboard,
	InvestigationPage,
	InvestigationsDashboard,
	LogsDashboard,
	OnboardingDashboard,
	ProfileDashboard,
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
};

const LAZY_VIEWS = {
	ActionDashboard: LazyActionDashboard,
	AgentRunDashboard: LazyAgentRunDashboard,
	AgentVersionDiffDashboard: LazyAgentVersionDiffDashboard,
	AIDashboard: LazyAIDashboard,
	AlertsDashboard: LazyAlertsDashboard,
	AutonomousReviewDashboard: LazyAutonomousReviewDashboard,
	CostAttributionDashboard: LazyCostAttributionDashboard,
	EvaluationsDashboard: LazyEvaluationsDashboard,
	EvidenceDashboard: LazyEvidenceDashboard,
	HealthDashboard: LazyHealthDashboard,
	InvestigationPage: LazyInvestigationPage,
	InvestigationsDashboard: LazyInvestigationsDashboard,
	LogsDashboard: LazyLogsDashboard,
	OnboardingDashboard: LazyOnboardingDashboard,
	ProfileDashboard: LazyProfileDashboard,
	ProjectsDashboard: LazyProjectsDashboard,
	ReplayDashboard: LazyReplayDashboard,
	ResourcesDashboard: LazyResourcesDashboard,
	ServiceMapDashboard: LazyServiceMapDashboard,
	TelemetryDashboard: LazyTelemetryDashboard,
	TimelineDashboard: LazyTimelineDashboard,
	ToolCallDashboard: LazyToolCallDashboard,
	ToolReliabilityDashboard: LazyToolReliabilityDashboard,
	UsageDashboard: LazyUsageDashboard,
	UserDashboard: LazyUserDashboard,
};

export function DashboardLoading() {
	return (
		<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted">
			Loading dashboard…
		</div>
	);
}

export interface DashboardRouteViewProps {
	route: DashboardRoute | Route;
	onNavigate?: (next: DashboardRoute | Partial<Route>) => void;
	/** Host-supplied renderer for the `#/playground` route. */
	renderPlayground?: () => ReactNode;
	/**
	 * When true, wraps views in `<Suspense>` and uses lazy-loaded dashboard boundaries.
	 * Defaults to `false` so unit/DOM tests render synchronously without chunk splits.
	 */
	useLazyViews?: boolean;
	loadingFallback?: ReactNode;
}

function coerceToStrictRoute(route: DashboardRoute | Route): DashboardRoute {
	if (KNOWN_TABS.has(route.tab)) {
		if (route.tab === "traces" && route.spanId && !route.traceId) {
			return { tab: "health" };
		}
		if (
			route.tab === "evidence" &&
			((route.evidenceKind && !route.evidenceId) ||
				(!route.evidenceKind && route.evidenceId))
		) {
			return { tab: "health" };
		}
		return route as DashboardRoute;
	}
	const parsed = parseDashboardRouteHash(routeToHash(route as Route));
	return parsed.ok ? parsed.route : parsed.fallbackRoute;
}

export function DashboardRouteView({
	route,
	onNavigate,
	renderPlayground,
	useLazyViews = false,
	loadingFallback,
}: DashboardRouteViewProps) {
	const strictRoute = coerceToStrictRoute(route);
	const Views = useLazyViews ? LAZY_VIEWS : EAGER_VIEWS;

	const handleRouteNavigate = useCallback(
		(next: Partial<Route>) => {
			if (onNavigate) {
				onNavigate(next);
				return;
			}
			if (typeof location !== "undefined") {
				const merged: Route =
					next.tab && next.tab !== strictRoute.tab
						? ({ ...next, tab: next.tab } as Route)
						: ({ ...strictRoute, ...next } as Route);
				location.hash = routeToHash(merged);
			}
		},
		[onNavigate, strictRoute],
	);

	const handleHrefNavigate = useCallback(
		(href: string) => {
			const normalized = normalizeConnectedHref(href);
			if (onNavigate) {
				const parsed = parseDashboardRouteHash(normalized);
				onNavigate(parsed.ok ? parsed.route : parsed.fallbackRoute);
				return;
			}
			if (typeof location !== "undefined") {
				location.hash = normalized.startsWith("#")
					? normalized.slice(1)
					: normalized;
			}
		},
		[onNavigate],
	);

	const renderView = (): ReactNode => {
		switch (strictRoute.tab) {
			case "playground":
				return renderPlayground ? (
					renderPlayground()
				) : (
					<Views.HealthDashboard />
				);

			case "onboarding":
				return <Views.OnboardingDashboard onNavigate={handleHrefNavigate} />;

			case "health":
				return <Views.HealthDashboard />;

			case "investigate":
				return strictRoute.investigationId ? (
					<Views.InvestigationPage
						investigationId={strictRoute.investigationId}
						onNavigate={handleRouteNavigate}
					/>
				) : (
					<Views.InvestigationsDashboard onNavigate={handleRouteNavigate} />
				);

			case "traces":
				return (
					<Views.TelemetryDashboard
						mode="traces"
						initialTraceId={strictRoute.traceId}
						initialSpanId={strictRoute.spanId}
						initialService={strictRoute.service}
						initialSearch={strictRoute.query}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "service-map":
				return (
					<Views.ServiceMapDashboard
						initialService={strictRoute.service}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "issues":
				return (
					<Views.TelemetryDashboard
						mode="issues"
						initialIssueId={strictRoute.issueId}
						initialService={strictRoute.service}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "logs":
				return (
					<Views.LogsDashboard
						initialLogId={strictRoute.logId}
						initialSearch={strictRoute.query}
						initialSeverity={strictRoute.severity}
						initialService={strictRoute.service}
						initialTraceId={strictRoute.traceId}
					/>
				);

			case "ai":
				return <Views.AIDashboard initialCallId={strictRoute.aiCallId} />;

			case "evidence":
				return (
					<Views.EvidenceDashboard
						initialAnchorKind={strictRoute.evidenceKind}
						initialAnchorId={strictRoute.evidenceId}
						onNavigate={handleHrefNavigate}
					/>
				);

			case "changes":
				return (
					<Views.EvidenceDashboard
						initialAnchorKind="change"
						initialAnchorId={strictRoute.changeId}
						onNavigate={handleHrefNavigate}
					/>
				);

			case "findings":
				return (
					<Views.EvidenceDashboard
						initialAnchorKind="finding"
						initialAnchorId={strictRoute.findingId}
						onNavigate={handleHrefNavigate}
					/>
				);

			case "incidents":
				return (
					<Views.EvidenceDashboard
						initialAnchorKind="incident"
						initialAnchorId={strictRoute.incidentId}
						onNavigate={handleHrefNavigate}
					/>
				);

			case "usage":
				return (
					<Views.UsageDashboard
						initialUsageId={strictRoute.usageId}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "replay":
				return (
					<Views.ReplayDashboard
						initialSessionId={strictRoute.sessionId}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "timeline":
				return (
					<Views.TimelineDashboard
						initialSessionId={strictRoute.sessionId}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "alerts":
				return (
					<Views.AlertsDashboard
						initialAlertId={strictRoute.alertId}
						onNavigate={handleRouteNavigate}
					/>
				);

			case "resources":
				return <Views.ResourcesDashboard />;

			case "projects":
				return <Views.ProjectsDashboard />;

			case "users":
				return strictRoute.userId ? (
					<Views.UserDashboard
						userId={strictRoute.userId}
						onNavigate={handleHrefNavigate}
					/>
				) : (
					<Views.ProjectsDashboard />
				);

			case "agent-runs":
				return strictRoute.agentRunId ? (
					<Views.AgentRunDashboard
						agentRunId={strictRoute.agentRunId}
						onNavigate={handleHrefNavigate}
					/>
				) : (
					<Views.AutonomousReviewDashboard onNavigate={handleRouteNavigate} />
				);

			case "actions":
				return strictRoute.actionId ? (
					<Views.ActionDashboard
						actionId={strictRoute.actionId}
						onNavigate={handleHrefNavigate}
					/>
				) : (
					<Views.AutonomousReviewDashboard onNavigate={handleRouteNavigate} />
				);

			case "tool-calls":
				return strictRoute.toolCallId ? (
					<Views.ToolCallDashboard
						toolCallId={strictRoute.toolCallId}
						onNavigate={handleHrefNavigate}
					/>
				) : (
					<Views.AutonomousReviewDashboard onNavigate={handleRouteNavigate} />
				);

			case "profiles":
				return strictRoute.profileId ? (
					<Views.ProfileDashboard
						profileId={strictRoute.profileId}
						traceIdFilter={strictRoute.traceId}
						onNavigate={handleHrefNavigate}
					/>
				) : (
					<Views.ResourcesDashboard />
				);

			case "tool-reliability":
				return (
					<Views.ToolReliabilityDashboard onNavigate={handleHrefNavigate} />
				);

			case "cost-attribution":
				return (
					<Views.CostAttributionDashboard onNavigate={handleHrefNavigate} />
				);

			case "autonomous-review":
			case "remediations":
				return (
					<Views.AutonomousReviewDashboard
						onNavigate={handleRouteNavigate}
						selectedProposalId={strictRoute.remediationId}
					/>
				);

			case "agent-version-diff":
				return (
					<Views.AgentVersionDiffDashboard onNavigate={handleHrefNavigate} />
				);

			case "evaluations":
				return (
					<Views.EvaluationsDashboard
						initialCaseId={strictRoute.evaluationId}
					/>
				);

			default: {
				const _exhaustive: never = strictRoute;
				void _exhaustive;
				return <Views.HealthDashboard />;
			}
		}
	};

	if (useLazyViews) {
		return (
			<div data-route-tab={strictRoute.tab} className="contents">
				<Suspense fallback={loadingFallback ?? <DashboardLoading />}>
					{renderView()}
				</Suspense>
			</div>
		);
	}

	return (
		<div data-route-tab={strictRoute.tab} className="contents">
			{renderView()}
		</div>
	);
}
