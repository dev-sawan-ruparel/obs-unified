/**
 * Canonical Dashboard Route Contract (RFC 0014 Workstream 1).
 *
 * Pure, zero-dependency route types, parser, serializer, and entity-to-route
 * builders shared across `@obsunified/types`, `@obsunified/collector`,
 * `@obsunified/mcp-server`, `@obsunified/dashboard`, and `apps/web`.
 */

export const DASHBOARD_TABS = [
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
] as const;

export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const KNOWN_TABS: ReadonlySet<string> = new Set<string>(DASHBOARD_TABS);

export type LogRouteSeverity = "ERROR" | "WARN" | "INFO";

/**
 * Union of all route selection field keys across all variants.
 * Used by `DisallowOtherRouteFields` so a route variant forbids fields
 * belonging to any other variant — even when passed via an intermediate variable.
 */
export interface AllDashboardRouteFields {
	traceId?: string;
	spanId?: string;
	service?: string;
	query?: string;
	severity?: LogRouteSeverity;
	issueId?: string;
	sessionId?: string;
	investigationId?: string;
	userId?: string;
	agentRunId?: string;
	actionId?: string;
	toolCallId?: string;
	profileId?: string;
	changeId?: string;
	findingId?: string;
	incidentId?: string;
	remediationId?: string;
	aiCallId?: string;
	evaluationId?: string;
	evidenceKind?: string;
	evidenceId?: string;
	alertId?: string;
	logId?: string;
	usageId?: string;
}

type DisallowOtherRouteFields<
	Allowed extends keyof AllDashboardRouteFields = never,
> = {
	[K in Exclude<keyof AllDashboardRouteFields, Allowed>]?: never;
};

type RouteVariant<
	Tab extends DashboardTab,
	Fields extends Partial<AllDashboardRouteFields> = Record<never, never>,
> = {
	tab: Tab;
} & Fields &
	DisallowOtherRouteFields<
		Extract<keyof Fields, keyof AllDashboardRouteFields>
	>;

export type TracesDashboardRoute =
	| RouteVariant<
			"traces",
			{
				traceId: string;
				spanId?: string;
				service?: string;
				query?: string;
			}
	  >
	| RouteVariant<
			"traces",
			{
				traceId?: string;
				spanId?: never;
				service?: string;
				query?: string;
			}
	  >;

export type EvidenceDashboardRoute =
	| RouteVariant<
			"evidence",
			{
				evidenceKind: string;
				evidenceId: string;
			}
	  >
	| RouteVariant<
			"evidence",
			{
				evidenceKind?: undefined;
				evidenceId?: never;
			}
	  >;

export type DashboardRoute =
	| RouteVariant<"playground">
	| RouteVariant<"health">
	| RouteVariant<"onboarding">
	| RouteVariant<"investigate", { investigationId?: string }>
	| TracesDashboardRoute
	| RouteVariant<"service-map", { service?: string }>
	| RouteVariant<"issues", { issueId?: string; service?: string }>
	| RouteVariant<
			"logs",
			{
				logId?: string;
				query?: string;
				severity?: LogRouteSeverity;
				service?: string;
				traceId?: string;
			}
	  >
	| RouteVariant<"ai", { aiCallId?: string }>
	| EvidenceDashboardRoute
	| RouteVariant<"usage", { usageId?: string }>
	| RouteVariant<"replay", { sessionId?: string }>
	| RouteVariant<"timeline", { sessionId?: string }>
	| RouteVariant<"alerts", { alertId?: string }>
	| RouteVariant<"resources">
	| RouteVariant<"projects">
	| RouteVariant<"users", { userId?: string }>
	| RouteVariant<"agent-runs", { agentRunId?: string }>
	| RouteVariant<"actions", { actionId?: string }>
	| RouteVariant<"tool-calls", { toolCallId?: string }>
	| RouteVariant<"profiles", { profileId?: string; traceId?: string }>
	| RouteVariant<"tool-reliability">
	| RouteVariant<"cost-attribution">
	| RouteVariant<"autonomous-review", { remediationId?: string }>
	| RouteVariant<"agent-version-diff">
	| RouteVariant<"evaluations", { evaluationId?: string }>
	| RouteVariant<"changes", { changeId?: string }>
	| RouteVariant<"findings", { findingId?: string }>
	| RouteVariant<"incidents", { incidentId?: string }>
	| RouteVariant<"remediations", { remediationId?: string }>;

export type DashboardRouteParseFailureReason =
	| "unknown_tab"
	| "malformed_encoding"
	| "invalid_selection";

export type ParsedDashboardRouteResult =
	| {
			ok: true;
			route: DashboardRoute;
			legacyAlias?: boolean;
	  }
	| {
			ok: false;
			reason: DashboardRouteParseFailureReason;
			rawHash: string;
			rawTab?: string;
			fallbackRoute: RouteVariant<"health">;
	  };

function safeDecode(
	encoded: string,
): { ok: true; value: string } | { ok: false } {
	try {
		return { ok: true, value: decodeURIComponent(encoded) };
	} catch {
		return { ok: false };
	}
}

function safeParseQueryParams(
	rawQuery: string,
): { ok: true; params: Map<string, string> } | { ok: false } {
	const params = new Map<string, string>();
	if (!rawQuery) return { ok: true, params };
	for (const pair of rawQuery.split("&")) {
		if (!pair) continue;
		const eqIdx = pair.indexOf("=");
		const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
		const rawVal = eqIdx === -1 ? "" : pair.slice(eqIdx + 1);
		const decodedKey = safeDecode(rawKey.replace(/\+/g, " "));
		const decodedVal = safeDecode(rawVal.replace(/\+/g, " "));
		if (!decodedKey.ok || !decodedVal.ok) {
			return { ok: false };
		}
		if (!params.has(decodedKey.value)) {
			params.set(decodedKey.value, decodedVal.value);
		}
	}
	return { ok: true, params };
}

const LEGACY_TAB_ALIASES: Readonly<Record<string, DashboardTab>> = {
	evals: "evaluations",
	services: "service-map",
};

/**
 * Strictly parses a location hash (e.g. `#/traces?trace=t1&span=s1`,
 * `/evaluations/ec_1`, or legacy `#/traces/t1#span=s1`) into a validated
 * `DashboardRoute` or an explicit failure outcome with a `{ tab: "health" }`
 * fallback. Never throws on malformed percent-encoding.
 */
export function parseDashboardRouteHash(
	rawHash: string,
): ParsedDashboardRouteResult {
	const fallbackRoute: RouteVariant<"health"> = { tab: "health" };
	const trimmed = rawHash.trim();
	if (
		trimmed === "" ||
		trimmed === "#" ||
		trimmed === "#/" ||
		trimmed === "/"
	) {
		return { ok: true, route: fallbackRoute };
	}

	const withoutLeadingHash = trimmed.replace(/^#/, "");
	let mainPart = withoutLeadingHash;
	let inlineSpanFragment: string | undefined;
	let legacyAlias = false;

	const spanHashIdx = withoutLeadingHash.indexOf("#span=");
	if (spanHashIdx !== -1) {
		mainPart = withoutLeadingHash.slice(0, spanHashIdx);
		const rawSpan = withoutLeadingHash.slice(spanHashIdx + "#span=".length);
		const decodedSpan = safeDecode(rawSpan);
		if (!decodedSpan.ok) {
			return {
				ok: false,
				reason: "malformed_encoding",
				rawHash,
				fallbackRoute,
			};
		}
		inlineSpanFragment = decodedSpan.value || undefined;
		legacyAlias = true;
	}

	const qIdx = mainPart.indexOf("?");
	const rawPath = qIdx === -1 ? mainPart : mainPart.slice(0, qIdx);
	const rawQuery = qIdx === -1 ? "" : mainPart.slice(qIdx + 1);

	const queryResult = safeParseQueryParams(rawQuery);
	if (!queryResult.ok) {
		return {
			ok: false,
			reason: "malformed_encoding",
			rawHash,
			fallbackRoute,
		};
	}
	const params = queryResult.params;
	const nonEmptyParam = (key: string): string | undefined => {
		const v = params.get(key);
		return v !== undefined && v !== "" ? v : undefined;
	};

	const rawSegments = rawPath.replace(/^\//, "").split("/").filter(Boolean);
	if (rawSegments.length === 0) {
		return { ok: true, route: fallbackRoute };
	}

	const rawTabDecoded = safeDecode(rawSegments[0]);
	if (!rawTabDecoded.ok) {
		return {
			ok: false,
			reason: "malformed_encoding",
			rawHash,
			fallbackRoute,
		};
	}
	const rawTab = rawTabDecoded.value;
	let tab: DashboardTab;
	if (KNOWN_TABS.has(rawTab)) {
		tab = rawTab as DashboardTab;
	} else if (rawTab in LEGACY_TAB_ALIASES) {
		tab = LEGACY_TAB_ALIASES[rawTab];
		legacyAlias = true;
	} else {
		return {
			ok: false,
			reason: "unknown_tab",
			rawHash,
			rawTab,
			fallbackRoute,
		};
	}

	const decodePathRemainder = (
		startIndex = 1,
	): { ok: true; value?: string } | { ok: false } => {
		if (rawSegments.length <= startIndex) return { ok: true, value: undefined };
		const decodedParts: string[] = [];
		for (let i = startIndex; i < rawSegments.length; i += 1) {
			const dec = safeDecode(rawSegments[i]);
			if (!dec.ok) return { ok: false };
			decodedParts.push(dec.value);
		}
		const joined = decodedParts.join("/");
		return { ok: true, value: joined || undefined };
	};

	switch (tab) {
		case "playground":
		case "health":
		case "onboarding":
		case "resources":
		case "projects":
		case "tool-reliability":
		case "cost-attribution":
		case "agent-version-diff":
			return {
				ok: true,
				route: { tab },
				...(legacyAlias ? { legacyAlias } : {}),
			};

		case "investigate": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "investigate",
					...(rem.value ? { investigationId: rem.value } : {}),
				},
			};
		}

		case "traces": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			if (rem.value) legacyAlias = true;
			const traceId =
				rem.value ?? nonEmptyParam("trace") ?? nonEmptyParam("trace_id");
			const spanId = inlineSpanFragment ?? nonEmptyParam("span");
			const service = nonEmptyParam("service");
			const query = nonEmptyParam("q");

			if (spanId && !traceId) {
				return {
					ok: false,
					reason: "invalid_selection",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}

			const route: TracesDashboardRoute = traceId
				? {
						tab: "traces",
						traceId,
						...(spanId ? { spanId } : {}),
						...(service ? { service } : {}),
						...(query ? { query } : {}),
					}
				: {
						tab: "traces",
						...(service ? { service } : {}),
						...(query ? { query } : {}),
					};
			return { ok: true, route, ...(legacyAlias ? { legacyAlias } : {}) };
		}

		case "service-map": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			if (rem.value) legacyAlias = true;
			const service = nonEmptyParam("service") ?? rem.value;
			return {
				ok: true,
				route: {
					tab: "service-map",
					...(service ? { service } : {}),
				},
				...(legacyAlias ? { legacyAlias } : {}),
			};
		}

		case "issues": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const issueId = nonEmptyParam("issue") ?? rem.value;
			const service = nonEmptyParam("service");
			return {
				ok: true,
				route: {
					tab: "issues",
					...(issueId ? { issueId } : {}),
					...(service ? { service } : {}),
				},
			};
		}

		case "logs": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const logId = nonEmptyParam("id") ?? rem.value;
			const query = nonEmptyParam("q") ?? nonEmptyParam("search");
			const rawSev = nonEmptyParam("severity");
			const severity: LogRouteSeverity | undefined =
				rawSev === "ERROR" || rawSev === "WARN" || rawSev === "INFO"
					? rawSev
					: undefined;
			const service = nonEmptyParam("service");
			const traceId = nonEmptyParam("trace") ?? nonEmptyParam("trace_id");
			return {
				ok: true,
				route: {
					tab: "logs",
					...(logId ? { logId } : {}),
					...(query ? { query } : {}),
					...(severity ? { severity } : {}),
					...(service ? { service } : {}),
					...(traceId ? { traceId } : {}),
				},
			};
		}

		case "ai": {
			let aiCallId: string | undefined;
			if (rawSegments[1] === "calls" && rawSegments.length > 2) {
				const rem = decodePathRemainder(2);
				if (!rem.ok) {
					return {
						ok: false,
						reason: "malformed_encoding",
						rawHash,
						rawTab,
						fallbackRoute,
					};
				}
				aiCallId = rem.value;
			} else {
				const queryId = nonEmptyParam("id") ?? nonEmptyParam("call_id");
				if (queryId) {
					aiCallId = queryId;
					legacyAlias = true;
				}
			}
			return {
				ok: true,
				route: {
					tab: "ai",
					...(aiCallId ? { aiCallId } : {}),
				},
				...(legacyAlias ? { legacyAlias } : {}),
			};
		}

		case "evidence": {
			const evidenceKind = nonEmptyParam("kind");
			const evidenceId = nonEmptyParam("id");
			if ((evidenceKind && !evidenceId) || (!evidenceKind && evidenceId)) {
				return {
					ok: false,
					reason: "invalid_selection",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const route: EvidenceDashboardRoute =
				evidenceKind && evidenceId
					? { tab: "evidence", evidenceKind, evidenceId }
					: { tab: "evidence" };
			return { ok: true, route };
		}

		case "usage": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const usageId = nonEmptyParam("id") ?? rem.value;
			return {
				ok: true,
				route: {
					tab: "usage",
					...(usageId ? { usageId } : {}),
				},
			};
		}

		case "replay": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const sessionId = nonEmptyParam("session") ?? rem.value;
			return {
				ok: true,
				route: {
					tab: "replay",
					...(sessionId ? { sessionId } : {}),
				},
			};
		}

		case "timeline": {
			const sessionId = nonEmptyParam("session");
			return {
				ok: true,
				route: {
					tab: "timeline",
					...(sessionId ? { sessionId } : {}),
				},
			};
		}

		case "alerts": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const legacyAlertParam = nonEmptyParam("alert");
			if (!nonEmptyParam("id") && legacyAlertParam) {
				legacyAlias = true;
			}
			const alertId = nonEmptyParam("id") ?? legacyAlertParam ?? rem.value;
			return {
				ok: true,
				route: {
					tab: "alerts",
					...(alertId ? { alertId } : {}),
				},
				...(legacyAlias ? { legacyAlias } : {}),
			};
		}

		case "users": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "users",
					...(rem.value ? { userId: rem.value } : {}),
				},
			};
		}

		case "agent-runs": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "agent-runs",
					...(rem.value ? { agentRunId: rem.value } : {}),
				},
			};
		}

		case "actions": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "actions",
					...(rem.value ? { actionId: rem.value } : {}),
				},
			};
		}

		case "tool-calls": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "tool-calls",
					...(rem.value ? { toolCallId: rem.value } : {}),
				},
			};
		}

		case "profiles": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const traceId = nonEmptyParam("trace_id") ?? nonEmptyParam("trace");
			return {
				ok: true,
				route: {
					tab: "profiles",
					...(rem.value ? { profileId: rem.value } : {}),
					...(traceId ? { traceId } : {}),
				},
			};
		}

		case "autonomous-review": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const remediationId = rem.value ?? nonEmptyParam("remediation");
			return {
				ok: true,
				route: {
					tab: "autonomous-review",
					...(remediationId ? { remediationId } : {}),
				},
			};
		}

		case "remediations": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const remediationId = rem.value ?? nonEmptyParam("id");
			return {
				ok: true,
				route: {
					tab: "remediations",
					...(remediationId ? { remediationId } : {}),
				},
			};
		}

		case "evaluations": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			const queryCase = nonEmptyParam("case") ?? nonEmptyParam("eval_case_id");
			if (!rem.value && queryCase) {
				legacyAlias = true;
			}
			const evaluationId = rem.value ?? queryCase;
			return {
				ok: true,
				route: {
					tab: "evaluations",
					...(evaluationId ? { evaluationId } : {}),
				},
				...(legacyAlias ? { legacyAlias } : {}),
			};
		}

		case "changes": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "changes",
					...(rem.value ? { changeId: rem.value } : {}),
				},
			};
		}

		case "findings": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "findings",
					...(rem.value ? { findingId: rem.value } : {}),
				},
			};
		}

		case "incidents": {
			const rem = decodePathRemainder(1);
			if (!rem.ok) {
				return {
					ok: false,
					reason: "malformed_encoding",
					rawHash,
					rawTab,
					fallbackRoute,
				};
			}
			return {
				ok: true,
				route: {
					tab: "incidents",
					...(rem.value ? { incidentId: rem.value } : {}),
				},
			};
		}
	}
}

/**
 * Convenience helper returning the validated `DashboardRoute` or its `{ tab: "health" }` fallback.
 */
export function resolveDashboardRoute(rawHash: string): DashboardRoute {
	const res = parseDashboardRouteHash(rawHash);
	return res.ok ? res.route : res.fallbackRoute;
}

/**
 * Serializes a strict `DashboardRoute` to a canonical `/<tab>...` path (without leading `#`).
 */
export function dashboardRouteToHash(route: DashboardRoute): string {
	const enc = encodeURIComponent;
	let path = `/${route.tab}`;
	const params = new URLSearchParams();

	switch (route.tab) {
		case "investigate":
			if (route.investigationId) path += `/${enc(route.investigationId)}`;
			break;
		case "traces":
			if (route.traceId) params.set("trace", route.traceId);
			if (route.spanId) params.set("span", route.spanId);
			if (route.service) params.set("service", route.service);
			if (route.query) params.set("q", route.query);
			break;
		case "service-map":
			if (route.service) params.set("service", route.service);
			break;
		case "issues":
			if (route.issueId) params.set("issue", route.issueId);
			if (route.service) params.set("service", route.service);
			break;
		case "logs":
			if (route.logId) params.set("id", route.logId);
			if (route.query) params.set("q", route.query);
			if (route.severity) params.set("severity", route.severity);
			if (route.service) params.set("service", route.service);
			if (route.traceId) params.set("trace", route.traceId);
			break;
		case "ai":
			if (route.aiCallId) path += `/calls/${enc(route.aiCallId)}`;
			break;
		case "evidence":
			if (route.evidenceKind && route.evidenceId) {
				params.set("kind", route.evidenceKind);
				params.set("id", route.evidenceId);
			}
			break;
		case "usage":
			if (route.usageId) params.set("id", route.usageId);
			break;
		case "replay":
			if (route.sessionId) params.set("session", route.sessionId);
			break;
		case "timeline":
			if (route.sessionId) params.set("session", route.sessionId);
			break;
		case "alerts":
			if (route.alertId) params.set("id", route.alertId);
			break;
		case "users":
			if (route.userId) path += `/${enc(route.userId)}`;
			break;
		case "agent-runs":
			if (route.agentRunId) path += `/${enc(route.agentRunId)}`;
			break;
		case "actions":
			if (route.actionId) path += `/${enc(route.actionId)}`;
			break;
		case "tool-calls":
			if (route.toolCallId) path += `/${enc(route.toolCallId)}`;
			break;
		case "profiles":
			if (route.profileId) path += `/${enc(route.profileId)}`;
			if (route.traceId) params.set("trace_id", route.traceId);
			break;
		case "autonomous-review":
			if (route.remediationId) params.set("remediation", route.remediationId);
			break;
		case "remediations":
			if (route.remediationId) path += `/${enc(route.remediationId)}`;
			break;
		case "evaluations":
			if (route.evaluationId) path += `/${enc(route.evaluationId)}`;
			break;
		case "changes":
			if (route.changeId) path += `/${enc(route.changeId)}`;
			break;
		case "findings":
			if (route.findingId) path += `/${enc(route.findingId)}`;
			break;
		case "incidents":
			if (route.incidentId) path += `/${enc(route.incidentId)}`;
			break;
		case "playground":
		case "health":
		case "onboarding":
		case "resources":
		case "projects":
		case "tool-reliability":
		case "cost-attribution":
		case "agent-version-diff":
			break;
	}

	const qs = params.toString();
	return qs ? `${path}?${qs}` : path;
}

/**
 * Serializes a strict `DashboardRoute` to a `#/<tab>...` href with exactly one `#`.
 */
export function dashboardRouteToHref(route: DashboardRoute): string {
	return `#${dashboardRouteToHash(route)}`;
}

/**
 * Maps an entity `(kind, id)` to its canonical `DashboardRoute`.
 * Unknown entity kinds route to the Evidence Explorer retaining `(kind, id)`.
 */
export function routeForEntity(
	kind: string,
	id: string,
	options?: { traceId?: string; spanId?: string },
): DashboardRoute {
	switch (kind) {
		case "trace":
			return {
				tab: "traces",
				traceId: id,
				...(options?.spanId ? { spanId: options.spanId } : {}),
			};
		case "span": {
			if (options?.traceId) {
				return { tab: "traces", traceId: options.traceId, spanId: id };
			}
			const colonIdx = id.indexOf(":");
			if (colonIdx > 0 && colonIdx < id.length - 1) {
				const traceId = id.slice(0, colonIdx);
				const spanId = id.slice(colonIdx + 1);
				return { tab: "traces", traceId, spanId };
			}
			return { tab: "evidence", evidenceKind: "span", evidenceId: id };
		}
		case "alert":
			return { tab: "alerts", alertId: id };
		case "analysis":
			return { tab: "health" };
		case "service":
			return { tab: "service-map", service: id };
		case "agent_run":
			return { tab: "agent-runs", agentRunId: id };
		case "action":
			return { tab: "actions", actionId: id };
		case "tool_call":
			return { tab: "tool-calls", toolCallId: id };
		case "ai_call":
			return { tab: "ai", aiCallId: id };
		case "profile":
			return {
				tab: "profiles",
				profileId: id,
				...(options?.traceId ? { traceId: options.traceId } : {}),
			};
		case "change":
			return { tab: "changes", changeId: id };
		case "finding":
			return { tab: "findings", findingId: id };
		case "incident":
			return { tab: "incidents", incidentId: id };
		case "remediation":
			return { tab: "remediations", remediationId: id };
		case "eval":
		case "evaluation":
			return { tab: "evaluations", evaluationId: id };
		case "log":
			return {
				tab: "logs",
				logId: id,
				...(options?.traceId ? { traceId: options.traceId } : {}),
			};
		case "usage":
			return { tab: "usage", usageId: id };
		case "replay":
		case "session":
			return { tab: "replay", sessionId: id };
		case "user":
			return { tab: "users", userId: id };
		default:
			return { tab: "evidence", evidenceKind: kind, evidenceId: id };
	}
}

/**
 * Maps an entity `(kind, id)` to its canonical `#/...` dashboard href.
 */
export function hrefForEntity(
	kind: string,
	id: string,
	options?: { traceId?: string; spanId?: string },
): string {
	return dashboardRouteToHref(routeForEntity(kind, id, options));
}

// ── Legacy compatibility interface & adapters ──

export type Route = {
	tab: string;
	traceId?: string;
	spanId?: string;
	issueId?: string;
	sessionId?: string;
	service?: string;
	query?: string;
	severity?: LogRouteSeverity;
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
	alertId?: string;
	logId?: string;
	usageId?: string;
};

export const hashRoutes = {
	change: (id: string): string =>
		dashboardRouteToHref({ tab: "changes", changeId: id }),
	finding: (id: string): string =>
		dashboardRouteToHref({ tab: "findings", findingId: id }),
	incident: (id: string): string =>
		dashboardRouteToHref({ tab: "incidents", incidentId: id }),
	remediation: (id: string): string =>
		dashboardRouteToHref({ tab: "remediations", remediationId: id }),
} as const;

const PATH_ID_TABS: Readonly<Record<string, keyof Route>> = {
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
};

/**
 * Legacy-compatible `parseRouteHash` adapter. Preserves existing return shape
 * while delegating known tabs to `parseDashboardRouteHash` and never throwing
 * on malformed percent-encoding.
 */
export function parseRouteHash(rawHash: string): Route {
	const strict = parseDashboardRouteHash(rawHash);
	if (strict.ok) {
		return { ...strict.route };
	}
	if (strict.reason === "unknown_tab" && strict.rawTab) {
		return { tab: strict.rawTab };
	}
	return { tab: "health" };
}

/**
 * Legacy-compatible `routeToHash` adapter accepting the permissive `Route` shape.
 */
export function routeToHash(next: Route): string {
	if (KNOWN_TABS.has(next.tab)) {
		// Delegate through strict serializer when valid
		return dashboardRouteToHash(next as unknown as DashboardRoute);
	}
	let hash = `/${next.tab}`;
	const idField = PATH_ID_TABS[next.tab];
	const id = idField ? (next[idField] as string | undefined) : undefined;
	if (id) hash += `/${encodeURIComponent(id)}`;
	if (next.tab === "ai" && next.aiCallId) {
		hash += `/calls/${encodeURIComponent(next.aiCallId)}`;
	}
	const params = new URLSearchParams();
	if (next.traceId) {
		params.set(next.tab === "profiles" ? "trace_id" : "trace", next.traceId);
	}
	if (next.spanId) params.set("span", next.spanId);
	if (next.issueId) params.set("issue", next.issueId);
	if (next.sessionId) params.set("session", next.sessionId);
	if (next.service) params.set("service", next.service);
	if (next.query) params.set("q", next.query);
	if (next.alertId) params.set("id", next.alertId);
	if (next.logId) params.set("id", next.logId);
	if (next.usageId) params.set("id", next.usageId);
	if (next.tab === "evidence" && next.evidenceKind) {
		params.set("kind", next.evidenceKind);
	}
	if (next.tab === "evidence" && next.evidenceId) {
		params.set("id", next.evidenceId);
	}
	const qs = params.toString();
	return qs ? `${hash}?${qs}` : hash;
}
