import type {
	CanonicalNodeIdentity,
	CausalTriple,
	JsonValue,
	OntologyEdge,
	OntologyGraphResponse,
	OntologyNode,
	OntologyNodeKind,
	RelationshipCertainty,
	StoredSpan,
} from "@obsunified/types";
import { buildCanonicalNodeId, normalizeErrorSignature } from "@obsunified/types";
import { randomHex } from "./hash";
import { parseJsonArray, parseJsonRecord } from "./json";
import type { SqlDb, SqlStatement } from "./sql-db";

export interface ExtractedSpanLineage {
	environment: string;
	namespace: string;
	serviceName: string | null;
	serviceVersion: string | null;
	commitSha: string | null;
	configDigest: string | null;
	sourceNode: CanonicalNodeIdentity | null;
	targetNode: CanonicalNodeIdentity | null;
	edgePredicate: string | null;
	errorSignature: string | null;
}

const pickStr = (
	record: Record<string, JsonValue>,
	...keys: string[]
): string | null => {
	for (const key of keys) {
		const val = record[key];
		if (typeof val === "string" && val.trim().length > 0) {
			return val.trim();
		}
		if (typeof val === "number") {
			return String(val);
		}
	}
	return null;
};

/**
 * Extracts runtime lineage (`environment`, `serviceVersion`, `commitSha`, `configDigest`),
 * canonical source/target `OntologyNode` identities, and `errorSignature` from a span.
 */
export function extractSpanLineageAndTopology(
	span: StoredSpan,
): ExtractedSpanLineage {
	const attrs = parseJsonRecord(span.attributesJson);
	const resource = parseJsonRecord(span.resourceAttributesJson);

	const environment = (
		span.environment ??
		pickStr(
			resource,
			"deployment.environment.name",
			"deployment.environment",
			"obs.environment",
		) ??
		pickStr(
			attrs,
			"deployment.environment.name",
			"deployment.environment",
			"obs.environment",
		) ??
		"default"
	).toLowerCase();

	const namespace =
		pickStr(resource, "service.namespace") ??
		pickStr(attrs, "service.namespace") ??
		"default";

	const serviceName =
		span.serviceName ??
		pickStr(resource, "service.name") ??
		pickStr(attrs, "service.name");

	const serviceVersion =
		span.serviceVersion ??
		pickStr(resource, "service.version", "obs.service.version") ??
		pickStr(attrs, "service.version", "obs.service.version");

	const commitSha =
		span.commitSha ??
		pickStr(
			resource,
			"vcs.commit.id",
			"git.commit.sha",
			"obs.commit.sha",
			"service.commit.sha",
		) ??
		pickStr(attrs, "vcs.commit.id", "git.commit.sha", "obs.commit.sha");

	const configDigest =
		pickStr(resource, "obs.config.digest") ??
		pickStr(attrs, "obs.config.digest");

	const sourceNode = serviceName
		? buildCanonicalNodeId({
				kind: "service",
				environment,
				namespace,
				serviceName,
			})
		: null;

	// Determine downstream target node for DB, cache, queue, external API, or peer service calls
	let targetNode: CanonicalNodeIdentity | null = null;
	let edgePredicate: string | null = null;

	const dbSystem = pickStr(attrs, "db.system");
	const messagingSystem = pickStr(attrs, "messaging.system");
	const peerService = pickStr(attrs, "peer.service", "obs.target.service");
	const serverAddress = pickStr(
		attrs,
		"server.address",
		"net.peer.name",
		"db.connection_string",
	);
	const serverPort = pickStr(attrs, "server.port", "net.peer.port");
	const toolName = pickStr(attrs, "obs.tool.name", "tool.name");

	if (dbSystem) {
		const isCache =
			dbSystem.toLowerCase() === "redis" ||
			dbSystem.toLowerCase() === "memcached";
		targetNode = buildCanonicalNodeId({
			kind: isCache ? "cache" : "database",
			environment,
			dbSystem,
			dbName: pickStr(attrs, "db.namespace", "db.name") ?? dbSystem,
			serverAddress,
			serverPort,
		});
		edgePredicate = isCache ? "queries_cache" : "queries_database";
	} else if (messagingSystem) {
		targetNode = buildCanonicalNodeId({
			kind: "queue_topic",
			environment,
			messagingSystem,
			messagingDestination:
				pickStr(
					attrs,
					"messaging.destination.name",
					"messaging.destination",
				) ?? "default",
			serverAddress,
		});
		edgePredicate =
			span.spanKind === 4 ? "publishes_to_queue" : "consumes_from_queue";
	} else if (peerService) {
		targetNode = buildCanonicalNodeId({
			kind: "service",
			environment,
			namespace: pickStr(attrs, "peer.namespace") ?? namespace,
			serviceName: peerService,
		});
		edgePredicate = "calls_service";
	} else if (span.spanKind === 2 && serverAddress) {
		// Outbound client span to external host or internal service
		targetNode = buildCanonicalNodeId({
			kind: "external_api",
			environment,
			serverAddress,
			serverPort: serverPort ?? "443",
		});
		edgePredicate = "calls_external_api";
	} else if (toolName) {
		targetNode = buildCanonicalNodeId({
			kind: "tool",
			environment,
			serviceName:
				pickStr(attrs, "obs.agent.id", "agent.id") ?? serviceName ?? "default",
			toolName,
		});
		edgePredicate = "invokes_tool";
	}

	// Extract normalized error signature when status_code === 2 (ERROR)
	let errorSignature: string | null = span.errorSignature ?? null;
	if (!errorSignature && span.statusCode === 2) {
		let rawErr =
			pickStr(
				attrs,
				"exception.type",
				"error.type",
				"obs.tool.error_type",
				"http.response.status_code",
				"http.status_code",
				"rpc.grpc.status_code",
			) ?? span.statusMessage;

		if (!rawErr && span.eventsJson) {
			const events = parseJsonArray(span.eventsJson);
			for (const ev of events) {
				if (ev && typeof ev === "object" && !Array.isArray(ev)) {
					const evObj = ev as Record<string, JsonValue>;
					if (evObj.name === "exception" && evObj.attributes) {
						const evAttrs =
							typeof evObj.attributes === "object" &&
							!Array.isArray(evObj.attributes)
								? (evObj.attributes as Record<string, JsonValue>)
								: {};
						rawErr =
							pickStr(evAttrs, "exception.type", "exception.message") ??
							rawErr;
					}
				}
			}
		}

		errorSignature = normalizeErrorSignature(
			rawErr ?? `ERROR:${span.spanName}`,
		);
	}

	return {
		environment,
		namespace,
		serviceName,
		serviceVersion,
		commitSha,
		configDigest,
		sourceNode,
		targetNode,
		edgePredicate,
		errorSignature,
	};
}

// 60-second isolate cache to avoid repeating identical ontology node upserts on every span
const NODE_UPSERT_CACHE = new Map<string, number>();
const CACHE_TTL_MS = 60_000;

export function clearOntologyUpsertCache(): void {
	NODE_UPSERT_CACHE.clear();
}

/**
 * Upserts environment-scoped `ontology_nodes`, `ontology_edges`, and inferred version-transition
 * `change_events` from ingested spans.
 */
export async function upsertOntologyFromSpans(
	db: SqlDb,
	spans: StoredSpan[],
	options: { bypassCache?: boolean } = {},
): Promise<void> {
	if (spans.length === 0) return;

	const nowMs = Date.now();
	const statements: SqlStatement[] = [];
	const edgeAggregates = new Map<
		string,
		{
			projectId: string;
			environment: string;
			id: string;
			sourceNodeId: string;
			predicate: string;
			targetNodeId: string;
			certainty: RelationshipCertainty;
			callCount: number;
			errorCount: number;
			lastDurationMs: number;
			firstSeenAt: string;
			lastSeenAt: string;
		}
	>();

	// Track version transitions per service node
	const serviceNodesToCheck = new Map<
		string,
		{
			projectId: string;
			environment: string;
			node: CanonicalNodeIdentity;
			version: string | null;
			commitSha: string | null;
			configDigest: string | null;
			timestamp: string;
		}
	>();

	for (const span of spans) {
		const lineage = extractSpanLineageAndTopology(span);
		const ts = span.receivedAt || span.startTime || new Date().toISOString();

		if (lineage.sourceNode) {
			const cacheKey = `${span.projectId}::${lineage.environment}::${lineage.sourceNode.id}::${lineage.serviceVersion ?? ""}::${lineage.commitSha ?? ""}::${lineage.configDigest ?? ""}`;
			const cachedAt = NODE_UPSERT_CACHE.get(cacheKey);
			if (options.bypassCache || !cachedAt || nowMs - cachedAt > CACHE_TTL_MS) {
				NODE_UPSERT_CACHE.set(cacheKey, nowMs);
				serviceNodesToCheck.set(
					`${span.projectId}::${lineage.environment}::${lineage.sourceNode.id}`,
					{
						projectId: span.projectId,
						environment: lineage.environment,
						node: lineage.sourceNode,
						version: lineage.serviceVersion,
						commitSha: lineage.commitSha,
						configDigest: lineage.configDigest,
						timestamp: ts,
					},
				);
			}
		}

		if (lineage.targetNode) {
			const targetCacheKey = `${span.projectId}::${lineage.environment}::${lineage.targetNode.id}`;
			const cachedAt = NODE_UPSERT_CACHE.get(targetCacheKey);
			if (options.bypassCache || !cachedAt || nowMs - cachedAt > CACHE_TTL_MS) {
				NODE_UPSERT_CACHE.set(targetCacheKey, nowMs);
				statements.push(
					db
						.prepare(
							`INSERT INTO ontology_nodes (
								project_id, environment, id, kind, name, namespace_or_endpoint,
								is_scoped_identity, attributes_json, first_seen_at, last_seen_at
							) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
							ON CONFLICT (project_id, environment, id) DO UPDATE SET
								last_seen_at = excluded.last_seen_at`,
						)
						.bind(
							span.projectId,
							lineage.environment,
							lineage.targetNode.id,
							lineage.targetNode.kind,
							lineage.targetNode.name,
							lineage.targetNode.namespaceOrEndpoint,
							lineage.targetNode.isScopedIdentity ? 1 : 0,
							ts,
							ts,
						),
				);
			}
		}

		if (lineage.sourceNode && lineage.targetNode && lineage.edgePredicate) {
			const edgeId = `${lineage.sourceNode.id}--${lineage.edgePredicate}-->${lineage.targetNode.id}`;
			const aggKey = `${span.projectId}::${lineage.environment}::${edgeId}`;
			const certainty: RelationshipCertainty =
				lineage.sourceNode.isScopedIdentity &&
				lineage.targetNode.isScopedIdentity
					? "exact"
					: "inferred";
			const existing = edgeAggregates.get(aggKey);
			const isErr = span.statusCode === 2 ? 1 : 0;
			if (existing) {
				existing.callCount += 1;
				existing.errorCount += isErr;
				existing.lastDurationMs = span.durationMs;
				if (ts > existing.lastSeenAt) existing.lastSeenAt = ts;
			} else {
				edgeAggregates.set(aggKey, {
					projectId: span.projectId,
					environment: lineage.environment,
					id: edgeId,
					sourceNodeId: lineage.sourceNode.id,
					predicate: lineage.edgePredicate,
					targetNodeId: lineage.targetNode.id,
					certainty,
					callCount: 1,
					errorCount: isErr,
					lastDurationMs: span.durationMs,
					firstSeenAt: ts,
					lastSeenAt: ts,
				});
			}
		}
	}

	// Check version transitions for service nodes before upserting them
	for (const entry of serviceNodesToCheck.values()) {
		if (entry.version) {
			const existingNode = await db
				.prepare(
					`SELECT current_version, current_commit_sha
					 FROM ontology_nodes
					 WHERE project_id = ? AND environment = ? AND id = ?`,
				)
				.bind(entry.projectId, entry.environment, entry.node.id)
				.first<{
					current_version: string | null;
					current_commit_sha: string | null;
				}>();

			if (
				existingNode?.current_version &&
				existingNode.current_version !== entry.version
			) {
				// Check if an explicit change_event already recorded this transition
				const existingChange = await db
					.prepare(
						`SELECT id FROM change_events
						 WHERE project_id = ? AND environment = ? AND target_node_id = ? AND version = ?
						 LIMIT 1`,
					)
					.bind(
						entry.projectId,
						entry.environment,
						entry.node.id,
						entry.version,
					)
					.first<{ id: string }>();

				if (!existingChange) {
					const changeId = `chg_inf_${randomHex(8)}`;
					const expiresAt = new Date(
						Date.now() + 30 * 24 * 3600_000,
					).toISOString();
					statements.push(
						db
							.prepare(
								`INSERT INTO change_events (
									project_id, environment, id, target_node_id, kind, source,
									relationship_certainty, summary, service_name, version,
									previous_version, commit_sha, previous_commit_sha, config_digest,
									touched_paths_json, attributes_json, occurred_at, received_at, expires_at
								) VALUES (?, ?, ?, ?, 'deploy', 'inferred_telemetry', 'inferred', ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, ?)
								ON CONFLICT (project_id, environment, id) DO NOTHING`,
							)
							.bind(
								entry.projectId,
								entry.environment,
								changeId,
								entry.node.id,
								`Inferred version transition ${existingNode.current_version} -> ${entry.version} on ${entry.node.name}`,
								entry.node.name,
								entry.version,
								existingNode.current_version,
								entry.commitSha,
								existingNode.current_commit_sha,
								entry.configDigest,
								entry.timestamp,
								entry.timestamp,
								expiresAt,
							),
					);
				}
			}
		}

		statements.push(
			db
				.prepare(
					`INSERT INTO ontology_nodes (
						project_id, environment, id, kind, name, namespace_or_endpoint,
						is_scoped_identity, current_version, current_commit_sha,
						current_config_digest, attributes_json, first_seen_at, last_seen_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
					ON CONFLICT (project_id, environment, id) DO UPDATE SET
						current_version = COALESCE(excluded.current_version, ontology_nodes.current_version),
						current_commit_sha = COALESCE(excluded.current_commit_sha, ontology_nodes.current_commit_sha),
						current_config_digest = COALESCE(excluded.current_config_digest, ontology_nodes.current_config_digest),
						last_seen_at = excluded.last_seen_at`,
				)
				.bind(
					entry.projectId,
					entry.environment,
					entry.node.id,
					entry.node.kind,
					entry.node.name,
					entry.node.namespaceOrEndpoint,
					entry.node.isScopedIdentity ? 1 : 0,
					entry.version,
					entry.commitSha,
					entry.configDigest,
					entry.timestamp,
					entry.timestamp,
				),
		);
	}

	for (const edge of edgeAggregates.values()) {
		statements.push(
			db
				.prepare(
					`INSERT INTO ontology_edges (
						project_id, environment, id, source_node_id, predicate, target_node_id,
						relationship_certainty, call_count, error_count, last_duration_ms,
						first_seen_at, last_seen_at
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					ON CONFLICT (project_id, environment, id) DO UPDATE SET
						call_count = ontology_edges.call_count + excluded.call_count,
						error_count = ontology_edges.error_count + excluded.error_count,
						last_duration_ms = excluded.last_duration_ms,
						last_seen_at = excluded.last_seen_at`,
				)
				.bind(
					edge.projectId,
					edge.environment,
					edge.id,
					edge.sourceNodeId,
					edge.predicate,
					edge.targetNodeId,
					edge.certainty,
					edge.callCount,
					edge.errorCount,
					edge.lastDurationMs,
					edge.firstSeenAt,
					edge.lastSeenAt,
				),
		);
	}

	if (statements.length > 0) {
		await db.batch(statements);
	}
}

/**
 * Tarjan's O(V + E) Strongly Connected Components (SCC) condensation algorithm
 * (RFC 0013 § 1.B & P2 #6). Ensures cyclic service/queue topologies never cause
 * infinite loops during dependency traversal.
 */
export function computeTarjanScc(
	nodes: OntologyNode[],
	edges: OntologyEdge[],
): {
	annotatedNodes: OntologyNode[];
	components: Array<{ sccId: string; nodeIds: string[]; isCyclic: boolean }>;
} {
	const adjacency = new Map<string, string[]>();
	const selfLoops = new Set<string>();

	for (const node of nodes) {
		adjacency.set(node.id, []);
	}
	for (const edge of edges) {
		if (!adjacency.has(edge.sourceNodeId)) {
			adjacency.set(edge.sourceNodeId, []);
		}
		if (!adjacency.has(edge.targetNodeId)) {
			adjacency.set(edge.targetNodeId, []);
		}
		adjacency.get(edge.sourceNodeId)?.push(edge.targetNodeId);
		if (edge.sourceNodeId === edge.targetNodeId) {
			selfLoops.add(edge.sourceNodeId);
		}
	}

	let index = 0;
	const indices = new Map<string, number>();
	const lowlink = new Map<string, number>();
	const onStack = new Set<string>();
	const stack: string[] = [];
	const rawComponents: string[][] = [];

	const strongConnect = (nodeId: string) => {
		indices.set(nodeId, index);
		lowlink.set(nodeId, index);
		index += 1;
		stack.push(nodeId);
		onStack.add(nodeId);

		const neighbors = adjacency.get(nodeId) ?? [];
		for (const targetId of neighbors) {
			if (!indices.has(targetId)) {
				strongConnect(targetId);
				lowlink.set(
					nodeId,
					Math.min(lowlink.get(nodeId) ?? 0, lowlink.get(targetId) ?? 0),
				);
			} else if (onStack.has(targetId)) {
				lowlink.set(
					nodeId,
					Math.min(lowlink.get(nodeId) ?? 0, indices.get(targetId) ?? 0),
				);
			}
		}

		if (lowlink.get(nodeId) === indices.get(nodeId)) {
			const component: string[] = [];
			while (stack.length > 0) {
				const w = stack.pop()!;
				onStack.delete(w);
				component.push(w);
				if (w === nodeId) break;
			}
			component.sort();
			rawComponents.push(component);
		}
	};

	for (const nodeId of adjacency.keys()) {
		if (!indices.has(nodeId)) {
			strongConnect(nodeId);
		}
	}

	const nodeSccMap = new Map<string, { sccId: string; isCyclic: boolean }>();
	const components = rawComponents.map((nodeIds, idx) => {
		const sccId = `scc_${idx + 1}`;
		const isCyclic =
			nodeIds.length > 1 || (nodeIds.length === 1 && selfLoops.has(nodeIds[0]));
		for (const id of nodeIds) {
			nodeSccMap.set(id, { sccId, isCyclic });
		}
		return { sccId, nodeIds, isCyclic };
	});

	const annotatedNodes = nodes.map((n) => {
		const scc = nodeSccMap.get(n.id);
		return {
			...n,
			sccId: scc?.sccId ?? "scc_0",
			inCycle: scc?.isCyclic ?? false,
		};
	});

	return { annotatedNodes, components };
}

export interface TraceSpanLocusInput {
	span_id: string;
	parent_span_id: string | null;
	service_name: string | null;
	span_name: string;
	span_kind: number;
	status_code: number;
	status_message: string | null;
	start_time: string;
	end_time: string;
	duration_ms: number;
	environment?: string | null;
	target_node_id?: string | null;
	error_signature?: string | null;
}

export interface TraceFaultLocusResult {
	faultLocusSpan: TraceSpanLocusInput | null;
	faultLocusNodeId: string | null;
	relationshipCertainty: RelationshipCertainty;
	causalProofTier: "unverified_locus";
	causalTriples: CausalTriple[];
}

/**
 * Per-trace cycle-guarded DFS fault locus detector (RFC 0013 § 1.B & P1 #1).
 * Identifies where an error surfaced (`originated_fault_in_span`) while keeping
 * `causalProofTier: "unverified_locus"` separate from `relationshipCertainty: "exact"`.
 */
export function localizeTraceFaultLocus(
	traceId: string,
	spans: TraceSpanLocusInput[],
): TraceFaultLocusResult {
	if (spans.length === 0) {
		return {
			faultLocusSpan: null,
			faultLocusNodeId: null,
			relationshipCertainty: "exact",
			causalProofTier: "unverified_locus",
			causalTriples: [],
		};
	}

	const spanById = new Map<string, TraceSpanLocusInput>();
	const childrenByParent = new Map<string, TraceSpanLocusInput[]>();
	for (const s of spans) {
		spanById.set(s.span_id, s);
		if (s.parent_span_id) {
			const list = childrenByParent.get(s.parent_span_id) ?? [];
			list.push(s);
			childrenByParent.set(s.parent_span_id, list);
		}
	}

	for (const list of childrenByParent.values()) {
		list.sort((a, b) => a.start_time.localeCompare(b.start_time));
	}

	const roots = spans
		.filter((s) => !s.parent_span_id || !spanById.has(s.parent_span_id))
		.sort((a, b) => a.start_time.localeCompare(b.start_time));

	const visited = new Set<string>();
	const causalTriples: CausalTriple[] = [];
	const leafErrorSpans: TraceSpanLocusInput[] = [];
	const MAX_DEPTH = 256;

	const walk = (span: TraceSpanLocusInput, depth: number) => {
		if (visited.has(span.span_id) || depth > MAX_DEPTH) return;
		visited.add(span.span_id);

		const children = (childrenByParent.get(span.span_id) ?? []).filter(
			(c) => !visited.has(c.span_id),
		);
		const errorChildren = children.filter((c) => c.status_code === 2);

		if (span.status_code === 2) {
			if (errorChildren.length === 0) {
				leafErrorSpans.push(span);
			} else {
				for (const errChild of errorChildren) {
					causalTriples.push({
						subjectKind: "span",
						subjectId: span.span_id,
						predicate: "failed_due_to_child_span",
						objectKind: "span",
						objectId: errChild.span_id,
						relationshipCertainty: "exact",
						causalProofTier: "unverified_locus",
						confidence: 0.85,
						reason: `Parent span ${span.span_name} failed while child span ${errChild.span_name} returned ERROR`,
					});
				}
			}
		}

		for (const child of children) {
			walk(child, depth + 1);
		}
	};

	for (const root of roots) {
		walk(root, 0);
	}
	// Catch any disconnected cycle islands
	for (const s of spans) {
		if (!visited.has(s.span_id)) {
			walk(s, 0);
		}
	}

	leafErrorSpans.sort((a, b) => a.start_time.localeCompare(b.start_time));
	const faultLocusSpan =
		leafErrorSpans[0] ?? spans.find((s) => s.status_code === 2) ?? null;

	let faultLocusNodeId: string | null = null;
	if (faultLocusSpan) {
		const env = (faultLocusSpan.environment ?? "default").toLowerCase();
		faultLocusNodeId =
			faultLocusSpan.target_node_id ??
			(faultLocusSpan.service_name
				? buildCanonicalNodeId({
						kind: "service",
						environment: env,
						serviceName: faultLocusSpan.service_name,
					}).id
				: null);

		causalTriples.unshift({
			subjectKind: "trace",
			subjectId: traceId,
			predicate: "originated_fault_in_span",
			objectKind: "span",
			objectId: faultLocusSpan.span_id,
			relationshipCertainty: "exact",
			causalProofTier: "unverified_locus",
			confidence: 0.9,
			reason: `Deepest/earliest failing span ${faultLocusSpan.span_name} (${faultLocusSpan.service_name ?? "unknown"}) is the trace fault locus`,
		});
	}

	return {
		faultLocusSpan,
		faultLocusNodeId,
		relationshipCertainty: "exact",
		causalProofTier: "unverified_locus",
		causalTriples,
	};
}

/**
 * Queries `telemetry_spans` for a trace and computes its fault locus.
 */
export async function loadTraceFaultLocusFromDb(
	db: SqlDb,
	projectId: string,
	traceId: string,
): Promise<TraceFaultLocusResult> {
	const rows = await db
		.prepare(
			`SELECT
				span_id, parent_span_id, service_name, span_name, span_kind,
				status_code, status_message, start_time, end_time, duration_ms,
				environment, target_node_id, error_signature
			 FROM telemetry_spans
			 WHERE project_id = ? AND trace_id = ?
			 ORDER BY start_time ASC
			 LIMIT 500`,
		)
		.bind(projectId, traceId)
		.all<TraceSpanLocusInput>();
	return localizeTraceFaultLocus(traceId, rows.results);
}

interface OntologyNodeRow {
	project_id: string;
	environment: string;
	id: string;
	kind: string;
	name: string;
	namespace_or_endpoint: string;
	is_scoped_identity: number;
	current_version: string | null;
	current_commit_sha: string | null;
	current_config_digest: string | null;
	attributes_json: string | null;
	first_seen_at: string;
	last_seen_at: string;
}

interface OntologyEdgeRow {
	project_id: string;
	environment: string;
	id: string;
	source_node_id: string;
	predicate: string;
	target_node_id: string;
	relationship_certainty: string;
	call_count: number;
	error_count: number;
	last_duration_ms: number | null;
	first_seen_at: string;
	last_seen_at: string;
}

/**
 * Loads the environment-scoped operational ontology graph with Tarjan SCC
 * cycle metadata and dependency blackout indicators.
 */
export async function getOntologyGraph(
	db: SqlDb,
	options: { projectId: string; environment?: string },
): Promise<OntologyGraphResponse> {
	const env = (options.environment ?? "default").toLowerCase();

	const [nodeRows, edgeRows] = await Promise.all([
		db
			.prepare(
				`SELECT * FROM ontology_nodes
				 WHERE project_id = ? AND environment = ?
				 ORDER BY id ASC
				 LIMIT 500`,
			)
			.bind(options.projectId, env)
			.all<OntologyNodeRow>(),
		db
			.prepare(
				`SELECT * FROM ontology_edges
				 WHERE project_id = ? AND environment = ?
				 ORDER BY call_count DESC
				 LIMIT 1000`,
			)
			.bind(options.projectId, env)
			.all<OntologyEdgeRow>(),
	]);

	const rawNodes: OntologyNode[] = nodeRows.results.map((r) => ({
		projectId: r.project_id,
		environment: r.environment,
		id: r.id,
		kind: r.kind as OntologyNodeKind,
		name: r.name,
		namespaceOrEndpoint: r.namespace_or_endpoint,
		isScopedIdentity: r.is_scoped_identity === 1,
		currentVersion: r.current_version,
		currentCommitSha: r.current_commit_sha,
		currentConfigDigest: r.current_config_digest,
		attributes: parseJsonRecord(r.attributes_json ?? "{}"),
		firstSeenAt: r.first_seen_at,
		lastSeenAt: r.last_seen_at,
	}));

	const edges: OntologyEdge[] = edgeRows.results.map((r) => ({
		projectId: r.project_id,
		environment: r.environment,
		id: r.id,
		sourceNodeId: r.source_node_id,
		predicate: r.predicate,
		targetNodeId: r.target_node_id,
		relationshipCertainty: (r.relationship_certainty ||
			"exact") as RelationshipCertainty,
		callCount: Number(r.call_count ?? 0),
		errorCount: Number(r.error_count ?? 0),
		lastDurationMs:
			r.last_duration_ms === null ? null : Number(r.last_duration_ms),
		firstSeenAt: r.first_seen_at,
		lastSeenAt: r.last_seen_at,
	}));

	const { annotatedNodes, components } = computeTarjanScc(rawNodes, edges);

	// Detect suspected dependency blackouts: targets with high inbound error edges
	const inboundErrorsByTarget = new Map<string, number>();
	for (const e of edges) {
		if (e.errorCount > 0) {
			inboundErrorsByTarget.set(
				e.targetNodeId,
				(inboundErrorsByTarget.get(e.targetNodeId) ?? 0) + e.errorCount,
			);
		}
	}

	const nodes = annotatedNodes.map((n) => ({
		...n,
		isBlackoutSuspected:
			(inboundErrorsByTarget.get(n.id) ?? 0) >= 3 &&
			edges.filter((e) => e.sourceNodeId === n.id).length === 0,
	}));

	return {
		environment: env,
		nodes,
		edges,
		stronglyConnectedComponents: components,
	};
}
