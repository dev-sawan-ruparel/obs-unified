import type { AnalysisDefinition } from "@obsunified/types";

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
		const params = new URLSearchParams();
		if (def.id.includes("error")) params.set("severity", "ERROR");
		if (def.id.includes("warn")) params.set("severity", "WARN");
		if (service) params.set("service", service);
		const qs = params.toString();
		return qs ? `#/logs?${qs}` : "#/logs";
	}
	if (def.id.startsWith("ai_")) return "#/ai";

	if (service) return `#/traces?service=${encodeURIComponent(service)}`;

	const source = typeof scope.source === "string" ? scope.source : null;
	const target = typeof scope.target === "string" ? scope.target : null;
	if (source || target) return "#/service-map";

	const topic = typeof scope.topic === "string" ? scope.topic : null;
	if (topic) return "#/traces";

	return "#/traces";
}
