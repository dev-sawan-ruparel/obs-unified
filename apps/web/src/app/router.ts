// ── Hash Router ──
// Pure parse/serialize live in @obsunified/types and are re-exported by @obsunified/dashboard.

import {
	type DashboardRoute,
	KNOWN_TABS,
	parseRouteHash,
	type Route,
	routeToHash,
} from "@obsunified/dashboard";
import { useEffect, useState } from "react";

export { type DashboardRoute, KNOWN_TABS, type Route };

export function parseHash(): Route {
	return parseRouteHash(location.hash);
}

/**
 * Navigates to the next route or hash string.
 * When `next.tab` changes to a different tab, previous tab selection IDs are
 * NOT merged into the new route.
 */
export function navigate(next: DashboardRoute | Partial<Route> | string) {
	if (typeof next === "string") {
		location.hash = next.startsWith("#") ? next.slice(1) : next;
		return;
	}
	const current = parseHash();
	const target: Route =
		next.tab && next.tab !== current.tab
			? ({ ...next, tab: next.tab } as Route)
			: ({ ...current, ...next } as Route);
	location.hash = routeToHash(target);
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
