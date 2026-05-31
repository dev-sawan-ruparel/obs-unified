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
