import {
	type CausalProofTier,
	dashboardRouteToHref,
	type EvidenceEntityKind,
	type RelationshipCertainty,
	routeForEntity,
	hrefForEntity as sharedHrefForEntity,
} from "@obsunified/types";
import type {
	ActionRef,
	AICallRef,
	ArtifactRef,
	EntityManifestExtended,
	EvalResultRef,
	LogRef,
	MetricExemplarRef,
	RetrievalEventRef,
	SpanRef,
	ToolCallRef,
	UsageEventRef,
} from "../../lib/identity-index";
import type { CausalConfidence } from "../../lib/identity-index/types";
import type { SqlDb } from "../../lib/sql-db";

export { routeForEntity };

export type ConnectedEntityKind =
	| "span"
	| "profile"
	| "log"
	| "usage"
	| "ai_call"
	| "replay"
	| "alert"
	| "analysis"
	| "user"
	| "action"
	| "agent_run"
	| "tool_call"
	| "change"
	| "finding"
	| "incident";

export const KNOWN_KINDS: ReadonlySet<string> = new Set<ConnectedEntityKind>([
	"span",
	"profile",
	"log",
	"usage",
	"ai_call",
	"replay",
	"alert",
	"analysis",
	"user",
	"action",
	"agent_run",
	"tool_call",
	"change",
	"finding",
	"incident",
]);

export interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
	sample?: string;
	entityKind?: ConnectedEntityKind | EvidenceEntityKind;
	entityId?: string;
	source?: string;
	confidence?: number;
	reason?: string;
	causalConfidence?: CausalConfidence;
	relationshipCertainty?: RelationshipCertainty;
	causalProofTier?: CausalProofTier;
}

export interface ConnectedSection {
	label: string;
	links: ConnectedLink[];
	emptyReason?: string;
}

export interface ConnectedManifest {
	entity: { kind: ConnectedEntityKind; id: string; projectId: string };
	up: ConnectedSection[];
	across: ConnectedSection[];
	down: ConnectedSection[];
	related: ConnectedSection[];
	rawManifest?: EntityManifestExtended;
}

export const MAX_LINKS_INLINE = 5;

const truncate = (s: string, n = 80): string =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

export const linkToTrace = (
	traceId: string,
	label?: string,
): ConnectedLink => ({
	label: label ?? `trace ${traceId.slice(0, 12)}`,
	href: dashboardRouteToHref({ tab: "traces", traceId }),
	entityKind: "trace",
	entityId: traceId,
});

// Show the LAST 12 characters of the session id. ULIDs / UUIDs have most
// of their entropy in the tail; the prefix is timestamp- or cohort-shared
// across sessions in the same window. Slicing the head means every link
// in a busy session looks identical ("session seed-mp27eaj" × 4).
export const linkToSession = (sessionId: string): ConnectedLink => ({
	label:
		sessionId.length > 12
			? `session …${sessionId.slice(-12)}`
			: `session ${sessionId}`,
	href: dashboardRouteToHref({ tab: "replay", sessionId }),
	sample: sessionId,
	entityKind: "replay",
	entityId: sessionId,
});

export const linksFromSpans = (
	spans: SpanRef[],
	prefix: string,
): ConnectedSection => {
	if (spans.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No spans matched.",
		};
	}
	if (spans.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${spans.length} spans`,
					href: dashboardRouteToHref({
						tab: "traces",
						query: spans[0].traceId,
					}),
					count: spans.length,
					sample: truncate(
						`${spans[0].serviceName ?? "?"} · ${spans[0].spanName}`,
					),
				},
			],
		};
	}
	return {
		label: prefix,
		links: spans.map((s) => ({
			label: `${s.serviceName ?? "?"} · ${truncate(s.spanName, 40)}`,
			href: dashboardRouteToHref({
				tab: "traces",
				traceId: s.traceId,
				spanId: s.spanId,
			}),
		})),
	};
};

export const linksFromLogs = (
	logs: LogRef[],
	prefix: string,
): ConnectedSection => {
	if (logs.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No logs share this identity key.",
		};
	}
	if (logs.length > MAX_LINKS_INLINE) {
		const sample = logs[0];
		return {
			label: prefix,
			links: [
				{
					label: `${logs.length} logs`,
					href: dashboardRouteToHref({
						tab: "logs",
						...(sample.traceId ? { query: sample.traceId } : {}),
					}),
					count: logs.length,
					sample: truncate(sample.message),
				},
			],
		};
	}
	return {
		label: prefix,
		links: logs.map((l) => ({
			label: `[${l.severity}] ${truncate(l.message, 60)}`,
			href: dashboardRouteToHref({ tab: "logs", logId: l.logId }),
		})),
	};
};

export const linksFromUsage = (
	events: UsageEventRef[],
	prefix: string,
): ConnectedSection => {
	if (events.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No usage events share this identity key.",
		};
	}
	if (events.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${events.length} usage events`,
					href: dashboardRouteToHref({ tab: "usage" }),
					count: events.length,
					sample: truncate(`${events[0].eventType} · ${events[0].eventName}`),
				},
			],
		};
	}
	return {
		label: prefix,
		links: events.map((e) => ({
			label: `${e.eventType} · ${truncate(e.eventName, 50)}`,
			href: dashboardRouteToHref({ tab: "usage", usageId: e.eventId }),
		})),
	};
};

export const linksFromMetricExemplars = (
	exemplars: MetricExemplarRef[],
	prefix: string,
): ConnectedSection => {
	if (exemplars.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No metric exemplars share this trace.",
		};
	}
	if (exemplars.length > MAX_LINKS_INLINE) {
		const sample = exemplars[0];
		return {
			label: prefix,
			links: [
				{
					label: `${exemplars.length} metric exemplars`,
					href: sample.traceId
						? dashboardRouteToHref({ tab: "traces", traceId: sample.traceId })
						: dashboardRouteToHref({ tab: "traces", query: sample.metricName }),
					count: exemplars.length,
					sample: truncate(
						`${sample.serviceName ?? "?"} · ${sample.metricName}=${sample.value}`,
					),
				},
			],
		};
	}
	return {
		label: prefix,
		links: exemplars.map((e) => ({
			label: `${e.serviceName ?? "?"} · ${truncate(e.metricName, 40)}=${e.value}`,
			href: e.traceId
				? dashboardRouteToHref({
						tab: "traces",
						traceId: e.traceId,
						...(e.spanId ? { spanId: e.spanId } : {}),
					})
				: dashboardRouteToHref({ tab: "traces", query: e.metricName }),
			sample: e.tsNs,
		})),
	};
};

/**
 * RFC 0009 acceptance #5 — query profile_blobs joined with
 * profile_trace_index to find profiles covering a trace, group by
 * profile_type so CPU and off-CPU render as distinct sections.
 * Returns a list of ConnectedSections (one per profile_type) for the
 * Down field of a span manifest.
 */
export const profileLinksForTrace = async (
	db: SqlDb,
	projectId: string,
	traceId: string,
): Promise<ConnectedSection[]> => {
	const rows = await db
		.prepare(
			`SELECT b.id, b.service_name, b.profile_type, b.duration_ms
			 FROM profile_trace_index i
			 JOIN profile_blobs b ON b.id = i.profile_id
			 WHERE i.project_id = ? AND i.trace_id = ?
			 ORDER BY b.end_ts DESC LIMIT 50`,
		)
		.bind(projectId, traceId)
		.all<{
			id: string;
			service_name: string | null;
			profile_type: string;
			duration_ms: number;
		}>();

	if (rows.results.length === 0) {
		return [
			{
				label: "Profiles",
				links: [],
				emptyReason:
					"No pprof profile covers this trace's window. Wire @obsunified/telemetry-sdk's startProfiler() (or run an eBPF agent) on the producing service to populate.",
			},
		];
	}

	// Group by profile_type so CPU and off-CPU surface as distinct rows.
	const byType = new Map<string, typeof rows.results>();
	for (const row of rows.results) {
		const list = byType.get(row.profile_type) ?? [];
		list.push(row);
		byType.set(row.profile_type, list);
	}

	const sections: ConnectedSection[] = [];
	for (const [type, list] of byType) {
		const icon = type === "offcpu" ? "🌊" : "🔥";
		sections.push({
			label: `${icon} ${type === "offcpu" ? "Off-CPU profiles" : `${type[0].toUpperCase()}${type.slice(1)} profiles`}`,
			links: list.map((r) => ({
				label: `${r.service_name ?? "?"} · ${r.duration_ms}ms`,
				href: dashboardRouteToHref({
					tab: "profiles",
					profileId: r.id,
					traceId,
				}),
			})),
		});
	}
	return sections;
};

export const linksFromAi = (
	calls: AICallRef[],
	prefix: string,
): ConnectedSection => {
	if (calls.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No AI calls under this identity key.",
		};
	}
	if (calls.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${calls.length} AI calls`,
					href: dashboardRouteToHref({ tab: "ai" }),
					count: calls.length,
					sample: truncate(`${calls[0].provider} · ${calls[0].modelName}`),
				},
			],
		};
	}
	return {
		label: prefix,
		links: calls.map((c) => ({
			label: `${c.provider} · ${c.modelName}`,
			href: dashboardRouteToHref({ tab: "ai", aiCallId: c.callId }),
			entityKind: "ai_call",
			entityId: c.callId,
		})),
	};
};

export const linkToAction = (
	actionId: string,
	label?: string,
): ConnectedLink => ({
	label: label ?? `action ${actionId.slice(0, 12)}`,
	href: dashboardRouteToHref({ tab: "actions", actionId }),
	entityKind: "action",
	entityId: actionId,
});

export const linkToAgentRun = (
	runId: string,
	label?: string,
): ConnectedLink => ({
	label: label ?? `agent run ${runId.slice(0, 12)}`,
	href: dashboardRouteToHref({ tab: "agent-runs", agentRunId: runId }),
	entityKind: "agent_run",
	entityId: runId,
});

export interface ActionContextLinkMetadata {
	source: string;
	causalConfidence?: CausalConfidence;
	confidence?: number;
	reason: string;
}

const actionContextMetadata = (
	action: Pick<ActionRef, "causalConfidence">,
	metadata?: ActionContextLinkMetadata,
): Pick<
	ConnectedLink,
	"source" | "confidence" | "reason" | "causalConfidence"
> => ({
	source: metadata?.source,
	confidence: metadata?.confidence,
	reason: metadata?.reason,
	causalConfidence: metadata?.causalConfidence ?? action.causalConfidence,
});

export const linksFromActions = (
	actions: ActionRef[],
	prefix: string,
	metadata?: ActionContextLinkMetadata,
): ConnectedSection => {
	if (actions.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No actions matched.",
		};
	}
	if (actions.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${actions.length} actions`,
					href: dashboardRouteToHref({ tab: "actions" }),
					count: actions.length,
					sample: truncate(
						`${actions[0].actionKind} · ${actions[0].name ?? "unnamed"}`,
					),
					entityKind: "action",
					entityId: actions[0].id,
					...actionContextMetadata(actions[0], metadata),
				},
			],
		};
	}
	return {
		label: prefix,
		links: actions.map((a) => ({
			label: `[${a.actionKind}] ${truncate(a.name ?? "unnamed", 40)}`,
			href: dashboardRouteToHref({ tab: "actions", actionId: a.id }),
			entityKind: "action",
			entityId: a.id,
			...actionContextMetadata(a, metadata),
		})),
	};
};

export const linksFromToolCalls = (
	calls: ToolCallRef[],
	prefix: string,
	metadataForAction?: (
		actionId: string,
	) => ActionContextLinkMetadata | undefined,
): ConnectedSection => {
	if (calls.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No tool calls matched.",
		};
	}
	if (calls.length > MAX_LINKS_INLINE) {
		return {
			label: prefix,
			links: [
				{
					label: `${calls.length} tool calls`,
					href: dashboardRouteToHref({ tab: "tool-calls" }),
					count: calls.length,
					sample: truncate(calls[0].toolName),
					entityKind: "tool_call",
					entityId: calls[0].id,
					...metadataForAction?.(calls[0].actionId),
				},
			],
		};
	}
	return {
		label: prefix,
		links: calls.map((t) => ({
			label: `tool: ${t.toolName}`,
			href: dashboardRouteToHref({ tab: "tool-calls", toolCallId: t.id }),
			entityKind: "tool_call",
			entityId: t.id,
			...metadataForAction?.(t.actionId),
		})),
	};
};

export const linksFromRetrievalEvents = (
	events: RetrievalEventRef[],
	prefix: string,
): ConnectedSection => {
	if (events.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No retrievals matched.",
		};
	}
	return {
		label: prefix,
		links: events.map((r) => ({
			label: `retrieve: ${r.retrieverName} (${r.totalResults} docs)`,
			// No dedicated retrieval tab: the owning action's detail page lists it.
			href: dashboardRouteToHref({ tab: "actions", actionId: r.actionId }),
		})),
	};
};

export const linksFromEvalResults = (
	results: EvalResultRef[],
	prefix: string,
	metadataForAction?: (
		actionId: string,
	) => ActionContextLinkMetadata | undefined,
): ConnectedSection => {
	if (results.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No evaluations matched.",
		};
	}
	return {
		label: prefix,
		links: results.map((e) => ({
			label: `eval: ${e.evaluatorName} (${e.passed ? "passed" : "failed"})`,
			// The Evaluations tab resolves this id to an eval case, falling back
			// to the case saved from the same action.
			href: dashboardRouteToHref({ tab: "evaluations", evaluationId: e.id }),
			entityKind: "eval",
			entityId: e.id,
			...metadataForAction?.(e.actionId),
		})),
	};
};

export const linksFromArtifacts = (
	arts: ArtifactRef[],
	prefix: string,
): ConnectedSection => {
	if (arts.length === 0) {
		return {
			label: prefix,
			links: [],
			emptyReason: "No artifacts matched.",
		};
	}
	return {
		label: prefix,
		links: arts.map((a) => ({
			label: `artifact: ${a.artifactName} (${a.artifactType})`,
			// No dedicated artifact tab: the owning action's detail page lists it.
			href: dashboardRouteToHref({ tab: "actions", actionId: a.actionId }),
		})),
	};
};

/**
 * Dashboard destination for an evidence entity, delegating to the shared
 * `@obsunified/types` route contract. Unknown kinds fall back to the
 * evidence explorer so a link never lands on the Health tab.
 */
export const hrefForEntity = (
	kind: string,
	id: string,
	options?: { traceId?: string; spanId?: string },
): string => sharedHrefForEntity(kind, id, options);

export interface FaultLocusTarget {
	entityKind: "service" | "span";
	entityId: string;
	href: string;
}

const HEX_SPAN_PAIR = /^[0-9a-f]{32}:[0-9a-f]{16}$/i;
const HEX_SPAN_ID = /^[0-9a-f]{16}$/i;
const NODE_KINDS = new Set([
	"service",
	"endpoint",
	"database",
	"queue",
	"messaging_topic",
	"topic",
	"cache",
	"external",
]);

/**
 * A finding's `faultLocusEntityId` is a canonical ontology node id
 * (`service:<env>:<ns>:<name>`, `endpoint:<env>:<ns>:<svc>:...`), a
 * `traceId:spanId` pair, a bare span id, or a bare service name. Resolve it to
 * the entity kind it really is and the surface that shows that kind.
 */
export const resolveFaultLocusTarget = (
	faultLocusEntityId: string,
): FaultLocusTarget => {
	const id = faultLocusEntityId;
	if (HEX_SPAN_PAIR.test(id)) {
		return {
			entityKind: "span",
			entityId: id,
			href: hrefForEntity("span", id),
		};
	}
	if (HEX_SPAN_ID.test(id)) {
		return {
			entityKind: "span",
			entityId: id,
			href: hrefForEntity("span", id),
		};
	}
	const segments = id.split(":");
	if (segments.length > 1 && NODE_KINDS.has(segments[0] ?? "")) {
		// service:<env>:<ns>:<name> and endpoint:<env>:<ns>:<svc>:... both carry
		// the owning service name at index 3.
		const name = segments[3] || segments[segments.length - 1] || id;
		return {
			entityKind: "service",
			entityId: id,
			href: hrefForEntity("service", name),
		};
	}
	return {
		entityKind: "service",
		entityId: id,
		href: hrefForEntity("service", id),
	};
};
