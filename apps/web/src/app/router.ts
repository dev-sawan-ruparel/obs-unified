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
};

export const KNOWN_TABS = new Set([
	"playground",
	"health",
	"investigate",
	"traces",
	"service-map",
	"issues",
	"logs",
	"ai",
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
	"tool-reliability",
	"cost-attribution",
	"autonomous-review",
	"agent-version-diff",
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
	return {
		tab,
		traceId: params.get("trace") ?? undefined,
		issueId: params.get("issue") ?? undefined,
		sessionId: params.get("session") ?? undefined,
		service: params.get("service") ?? undefined,
		investigationId,
		userId,
		agentRunId,
		actionId,
		toolCallId,
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
	const params = new URLSearchParams();
	if (next.traceId) params.set("trace", next.traceId);
	if (next.issueId) params.set("issue", next.issueId);
	if (next.sessionId) params.set("session", next.sessionId);
	if (next.service) params.set("service", next.service);
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
