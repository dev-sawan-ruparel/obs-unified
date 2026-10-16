// ── Hash Router ──
// Pure parse/serialize live in packages/dashboard/src/routes.ts (unit tested).

import { useEffect, useState } from "react";
import {
	parseRouteHash,
	type Route,
	routeToHash,
} from "../../../../packages/dashboard/src/routes";

export type { Route };

export const KNOWN_TABS = new Set([
	"playground",
	"health",
	"onboarding",
	"investigate",
	"traces",
	"service-map",
	"issues",
	"logs",
	"ai",
	"evidence",
	"usage",
	"replay",
	"timeline",
	"alerts",
	"resources",
	"projects",
	"users",
	"agent-runs",
	"actions",
	"tool-calls",
	"profiles",
	"tool-reliability",
	"cost-attribution",
	"autonomous-review",
	"agent-version-diff",
	"evaluations",
	"changes",
	"findings",
	"incidents",
	"remediations",
]);

export function parseHash(): Route {
	return parseRouteHash(location.hash);
}

export function navigate(route: Partial<Route>) {
	location.hash = routeToHash({ ...parseHash(), ...route });
}

export function useRoute(): Route {
	const [route, setRoute] = useState(parseHash);
	useEffect(() => {
		const handler = () => setRoute(parseHash());
		window.addEventListener("hashchange", handler);
		return () => window.removeEventListener("hashchange", handler);
	}, []);
	return route;
}
