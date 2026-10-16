// ── Hash Router ──

import { useEffect, useState } from "react";

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
	evidenceKind?: string;
	evidenceId?: string;
};

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
	const agentRunId =
		tab === "agent-runs" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const actionId =
		tab === "actions" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const toolCallId =
		tab === "tool-calls" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const profileId =
		tab === "profiles" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const changeId =
		tab === "changes" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const findingId =
		tab === "findings" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const incidentId =
		tab === "incidents" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const remediationId =
		tab === "remediations" && segments.length > 1
			? decodeURIComponent(segments.slice(1).join("/"))
			: undefined;
	const aiCallId =
		tab === "ai" && segments[1] === "calls" && segments.length > 2
			? decodeURIComponent(segments.slice(2).join("/"))
			: undefined;
	return {
		tab,
		traceId: params.get("trace") ?? params.get("trace_id") ?? undefined,
		issueId: params.get("issue") ?? undefined,
		sessionId: params.get("session") ?? undefined,
		service: params.get("service") ?? undefined,
		investigationId,
		userId,
		agentRunId,
		actionId,
		toolCallId,
		profileId,
		changeId,
		findingId,
		incidentId,
		remediationId,
		aiCallId,
		evidenceKind: params.get("kind") ?? undefined,
		evidenceId: params.get("id") ?? undefined,
	};
}

export function navigate(route: Partial<Route>) {
	const current = parseHash();
	const next = { ...current, ...route };
	let hash = `/${next.tab}`;
	if (next.tab === "investigate" && next.investigationId) {
		hash += `/${encodeURIComponent(next.investigationId)}`;
	}
	if (next.tab === "users" && next.userId) {
		hash += `/${encodeURIComponent(next.userId)}`;
	}
	if (next.tab === "agent-runs" && next.agentRunId) {
		hash += `/${encodeURIComponent(next.agentRunId)}`;
	}
	if (next.tab === "actions" && next.actionId) {
		hash += `/${encodeURIComponent(next.actionId)}`;
	}
	if (next.tab === "tool-calls" && next.toolCallId) {
		hash += `/${encodeURIComponent(next.toolCallId)}`;
	}
	if (next.tab === "profiles" && next.profileId) {
		hash += `/${encodeURIComponent(next.profileId)}`;
	}
	if (next.tab === "changes" && next.changeId) {
		hash += `/${encodeURIComponent(next.changeId)}`;
	}
	if (next.tab === "findings" && next.findingId) {
		hash += `/${encodeURIComponent(next.findingId)}`;
	}
	if (next.tab === "incidents" && next.incidentId) {
		hash += `/${encodeURIComponent(next.incidentId)}`;
	}
	if (next.tab === "remediations" && next.remediationId) {
		hash += `/${encodeURIComponent(next.remediationId)}`;
	}
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
	if (qs) hash += `?${qs}`;
	location.hash = hash;
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
