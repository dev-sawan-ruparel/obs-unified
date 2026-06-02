import { lazy } from "react";

export const AIDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/AIDashboard").then(
		(m) => ({
			default: m.AIDashboard,
		}),
	),
);
export const AlertsDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/AlertsDashboard").then(
		(m) => ({ default: m.AlertsDashboard }),
	),
);
export const HealthDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/HealthDashboard").then(
		(m) => ({ default: m.HealthDashboard }),
	),
);
export const InvestigationPage = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/InvestigationPage"
	).then((m) => ({ default: m.InvestigationPage })),
);
export const InvestigationsDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/InvestigationsDashboard"
	).then((m) => ({ default: m.InvestigationsDashboard })),
);
export const LogsDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/LogsDashboard").then(
		(m) => ({ default: m.LogsDashboard }),
	),
);
export const ProjectsDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/ProjectsDashboard"
	).then((m) => ({ default: m.ProjectsDashboard })),
);
export const ProfileDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/ProfileDashboard").then(
		(m) => ({ default: m.ProfileDashboard }),
	),
);
export const ReplayDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/ReplayDashboard").then(
		(m) => ({ default: m.ReplayDashboard }),
	),
);
export const ResourcesDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/ResourcesDashboard"
	).then((m) => ({ default: m.ResourcesDashboard })),
);
export const ServiceMapDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/ServiceMapDashboard"
	).then((m) => ({ default: m.ServiceMapDashboard })),
);
export const TelemetryDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/TelemetryDashboard"
	).then((m) => ({ default: m.TelemetryDashboard })),
);
export const TimelineDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/TimelineDashboard"
	).then((m) => ({ default: m.TimelineDashboard })),
);
export const UsageDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/UsageDashboard").then(
		(m) => ({ default: m.UsageDashboard }),
	),
);
export const UserDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/UserDashboard").then(
		(m) => ({ default: m.UserDashboard }),
	),
);
export const AgentRunDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/AgentRunDashboard"
	).then((m) => ({ default: m.AgentRunDashboard })),
);
export const ActionDashboard = lazy(() =>
	import("../../../../packages/dashboard/src/dashboards/ActionDashboard").then(
		(m) => ({ default: m.ActionDashboard }),
	),
);
export const ToolCallDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/ToolCallDashboard"
	).then((m) => ({ default: m.ToolCallDashboard })),
);
export const ToolReliabilityDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/ToolReliabilityDashboard"
	).then((m) => ({ default: m.ToolReliabilityDashboard })),
);
export const CostAttributionDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/CostAttributionDashboard"
	).then((m) => ({ default: m.CostAttributionDashboard })),
);
export const AutonomousReviewDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/AutonomousReviewDashboard"
	).then((m) => ({ default: m.AutonomousReviewDashboard })),
);
export const AgentVersionDiffDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/AgentVersionDiffDashboard"
	).then((m) => ({ default: m.AgentVersionDiffDashboard })),
);
export const EvaluationsDashboard = lazy(() =>
	import(
		"../../../../packages/dashboard/src/dashboards/EvaluationsDashboard"
	).then((m) => ({ default: m.EvaluationsDashboard })),
);
