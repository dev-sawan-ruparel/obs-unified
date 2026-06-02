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
import type { SqlDb } from "../../lib/sql-db";

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
	| "tool_call";

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
]);

export interface ConnectedLink {
	label: string;
	href: string;
	count?: number;
	sample?: string;
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
	href: `#/traces/${traceId}`,
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
	href: `#/replay?session=${encodeURIComponent(sessionId)}`,
	sample: sessionId,
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
					href: `#/traces?q=${encodeURIComponent(spans[0].traceId)}`,
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
			href: `#/traces/${s.traceId}#span=${s.spanId}`,
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
					href: `#/logs?q=${encodeURIComponent(sample.traceId ?? "")}`,
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
			href: `#/logs?id=${l.logId}`,
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
					href: `#/usage`,
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
			href: `#/usage?id=${e.eventId}`,
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
						? `#/traces/${sample.traceId}`
						: `#/traces?q=${encodeURIComponent(sample.metricName)}`,
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
				? e.spanId
					? `#/traces/${e.traceId}#span=${e.spanId}`
					: `#/traces/${e.traceId}`
				: `#/traces?q=${encodeURIComponent(e.metricName)}`,
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
					"No pprof profile covers this trace's window. Wire @obs-unified/telemetry-sdk's startProfiler() (or run an eBPF agent) on the producing service to populate.",
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
				href: `#/profiles/${r.id}?trace_id=${encodeURIComponent(traceId)}`,
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
					href: `#/ai`,
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
			href: `#/ai?id=${c.callId}`,
		})),
	};
};

export const linkToAction = (
	actionId: string,
	label?: string,
): ConnectedLink => ({
	label: label ?? `action ${actionId.slice(0, 12)}`,
	href: `#/actions/${actionId}`,
});

export const linkToAgentRun = (
	runId: string,
	label?: string,
): ConnectedLink => ({
	label: label ?? `agent run ${runId.slice(0, 12)}`,
	href: `#/agent-runs/${runId}`,
});

export const linksFromActions = (
	actions: ActionRef[],
	prefix: string,
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
					href: `#/actions`,
					count: actions.length,
					sample: truncate(
						`${actions[0].actionKind} · ${actions[0].name ?? "unnamed"}`,
					),
				},
			],
		};
	}
	return {
		label: prefix,
		links: actions.map((a) => ({
			label: `[${a.actionKind}] ${truncate(a.name ?? "unnamed", 40)}`,
			href: `#/actions/${a.id}`,
		})),
	};
};

export const linksFromToolCalls = (
	calls: ToolCallRef[],
	prefix: string,
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
					href: `#/tools`,
					count: calls.length,
					sample: truncate(calls[0].toolName),
				},
			],
		};
	}
	return {
		label: prefix,
		links: calls.map((t) => ({
			label: `tool: ${t.toolName}`,
			href: `#/tool-calls/${t.id}`,
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
			href: `#/retrieval-events/${r.id}`,
		})),
	};
};

export const linksFromEvalResults = (
	results: EvalResultRef[],
	prefix: string,
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
			href: `#/evals/${e.id}`,
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
			href: `#/artifacts/${a.id}`,
		})),
	};
};
