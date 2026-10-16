import {
	type AnalysisDefinition,
	dashboardRouteToHref,
} from "@obsunified/types";

/**
 * Map an Analysis definition to a hash-router URL the user lands on when they
 * click the tile. Stage 1: route to the relevant raw-signal view filtered by
 * the analysis's scope; Stage 4 will substitute investigation pages where
 * available, falling back to this same mapping.
 *
 * Rules (most-specific first):
 *   - scope.service                 → /#/traces?service=<svc>
 *   - scope.source / scope.target   → /#/service-map (we don't yet support
 *                                     deep-linking the highlighted edge)
 *   - scope.topic                   → /#/traces (no topic filter on traces yet)
 *   - id starts with "log_"         → /#/logs
 *   - id starts with "ai_"          → /#/ai
 *   - everything else               → /#/traces
 */
export function tileHref(def: AnalysisDefinition): string {
	const scope = (def.scope ?? {}) as Record<string, unknown>;
	const service = typeof scope.service === "string" ? scope.service : null;
	if (def.id.startsWith("log_")) {
		const severity = def.id.includes("warn")
			? "WARN"
			: def.id.includes("error")
				? "ERROR"
				: undefined;
		return dashboardRouteToHref({
			tab: "logs",
			...(severity ? { severity } : {}),
			...(service ? { service } : {}),
		});
	}
	if (def.id.startsWith("ai_")) return dashboardRouteToHref({ tab: "ai" });

	if (service) return dashboardRouteToHref({ tab: "traces", service });

	const source = typeof scope.source === "string" ? scope.source : null;
	const target = typeof scope.target === "string" ? scope.target : null;
	if (source || target) return dashboardRouteToHref({ tab: "service-map" });

	const topic = typeof scope.topic === "string" ? scope.topic : null;
	if (topic) return dashboardRouteToHref({ tab: "traces" });

	return dashboardRouteToHref({ tab: "traces" });
}
