/**
 * Central hash-route builders for AutoSRE entities so components do not
 * hand-assemble `#/findings/...` style strings.
 */
const segment = (id: string): string => encodeURIComponent(id);

export const hashRoutes = {
	change: (id: string): string => `#/changes/${segment(id)}`,
	finding: (id: string): string => `#/findings/${segment(id)}`,
	incident: (id: string): string => `#/incidents/${segment(id)}`,
	remediation: (id: string): string => `#/remediations/${segment(id)}`,
} as const;

// ── Hash route parse/serialize (pure; consumed by apps/web router) ──

export type Route = {
	tab: string;
	traceId?: string;
	issueId?: string;
	sessionId?: string;
	service?: string;
	/** Stage 4: investigation page id, parsed from /#/investigate/<id>. */
	investigationId?: string;
	/** RFC 0006 Scenario B: user_profiles.user_id from /#/users/<id>. */
	userId?: string;
	agentRunId?: string;
	actionId?: string;
	toolCallId?: string;
	profileId?: string;
	changeId?: string;
	findingId?: string;
	incidentId?: string;
	remediationId?: string;
	/** `ai_calls.call_id` from /#/ai/calls/<id>; selects that call in the AI tab. */
	aiCallId?: string;
	/** `eval_cases.id` from /#/evaluations/<id>; selects that case. */
	evaluationId?: string;
	evidenceKind?: string;
	evidenceId?: string;
};

/** Tabs whose detail id rides as `/<tab>/<id>`, mapped to the Route field. */
const PATH_ID_TABS = {
	investigate: "investigationId",
	users: "userId",
	"agent-runs": "agentRunId",
	actions: "actionId",
	"tool-calls": "toolCallId",
	profiles: "profileId",
	changes: "changeId",
	findings: "findingId",
	incidents: "incidentId",
	remediations: "remediationId",
	evaluations: "evaluationId",
} as const satisfies Record<string, keyof Route>;

export function parseRouteHash(rawHash: string): Route {
	const hash = rawHash.replace(/^#/, "") || "/health";
	const [path, query] = hash.split("?");
	const params = new URLSearchParams(query ?? "");
	const segments = path.replace(/^\//, "").split("/").filter(Boolean);
	const tab = segments[0] || "health";
	const route: Route = {
		tab,
		traceId: params.get("trace") ?? params.get("trace_id") ?? undefined,
		issueId: params.get("issue") ?? undefined,
		sessionId: params.get("session") ?? undefined,
		service: params.get("service") ?? undefined,
		evidenceKind: params.get("kind") ?? undefined,
		evidenceId: params.get("id") ?? undefined,
	};
	const idField = (PATH_ID_TABS as Record<string, keyof Route>)[tab];
	if (idField && segments.length > 1) {
		route[idField] = decodeURIComponent(segments.slice(1).join("/"));
	}
	if (tab === "ai" && segments[1] === "calls" && segments.length > 2) {
		route.aiCallId = decodeURIComponent(segments.slice(2).join("/"));
	}
	// `#/evaluations?case=<id>` (legacy) is the same selection.
	if (tab === "evaluations" && !route.evaluationId) {
		route.evaluationId =
			params.get("case") ?? params.get("eval_case_id") ?? undefined;
	}
	return route;
}

export function routeToHash(next: Route): string {
	let hash = `/${next.tab}`;
	const idField = (PATH_ID_TABS as Record<string, keyof Route>)[next.tab];
	const id = idField ? next[idField] : undefined;
	if (id) hash += `/${encodeURIComponent(id)}`;
	if (next.tab === "ai" && next.aiCallId) {
		hash += `/calls/${encodeURIComponent(next.aiCallId)}`;
	}
	const params = new URLSearchParams();
	if (next.traceId) {
		params.set(next.tab === "profiles" ? "trace_id" : "trace", next.traceId);
	}
	if (next.issueId) params.set("issue", next.issueId);
	if (next.sessionId) params.set("session", next.sessionId);
	if (next.service) params.set("service", next.service);
	if (next.tab === "evidence" && next.evidenceKind) {
		params.set("kind", next.evidenceKind);
	}
	if (next.tab === "evidence" && next.evidenceId) {
		params.set("id", next.evidenceId);
	}
	const qs = params.toString();
	return qs ? `${hash}?${qs}` : hash;
}
