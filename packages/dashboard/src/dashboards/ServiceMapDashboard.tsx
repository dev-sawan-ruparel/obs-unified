import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServiceMapResponse } from "@obs/types";
import {
	Background,
	Controls,
	Handle,
	MarkerType,
	Position,
	ReactFlow,
	type Edge,
	type Node,
	type NodeProps,
} from "@xyflow/react";
import dagre from "dagre";
import "@xyflow/react/dist/style.css";
import { useApi } from "../use-api";
import { useTimeWindowHours } from "../provider";
import { Card, SectionTitle, UpdatedChip } from "../components/primitives";
import { Button } from "../components/Button";
import { StateRow } from "../components/states";

interface ServiceOperationsResponse {
	service: string;
	spanCount: number;
	traceCount: number;
	errorCount: number;
	operations: Array<{
		spanName: string;
		calls: number;
		errors: number;
		errorRate: number;
		p50DurationMs: number;
		p95DurationMs: number;
	}>;
	recentErrors: Array<{
		traceId: string;
		spanId: string;
		spanName: string;
		statusMessage: string | null;
		durationMs: number;
		startTime: string;
	}>;
	windowHours: number;
	timestamp: string;
}

interface Props {
	onNavigate?: (route: { tab?: string; traceId?: string }) => void;
}

type ServiceNodeData = {
	service: string;
	spanCount: number;
	errorCount: number;
	errorRate: number;
	traceCount: number;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 90;

function layout(
	nodes: Node<ServiceNodeData>[],
	edges: Edge[],
): Node<ServiceNodeData>[] {
	if (nodes.length === 0) return nodes;
	const g = new dagre.graphlib.Graph();
	g.setDefaultEdgeLabel(() => ({}));
	g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120 });
	for (const n of nodes) {
		g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
	}
	for (const e of edges) {
		g.setEdge(e.source, e.target);
	}
	dagre.layout(g);
	return nodes.map((n) => {
		const pos = g.node(n.id);
		return {
			...n,
			position: {
				x: pos.x - NODE_WIDTH / 2,
				y: pos.y - NODE_HEIGHT / 2,
			},
		};
	});
}

function ServiceNode({ data, selected }: NodeProps<Node<ServiceNodeData>>) {
	const errorPct = (data.errorRate * 100).toFixed(1);
	const accent =
		data.errorRate >= 0.1
			? "border-sys-error text-sys-error"
			: data.errorRate >= 0.01
				? "border-sys-warning text-sys-warning"
				: "border-sys-outline text-sys-on-surface";
	return (
		<div
			className={`flex flex-col gap-1 border-[2px] bg-sys-surface px-3 py-2 font-mono text-[0.75rem] cursor-pointer transition-none ${accent} ${
				selected ? "outline outline-[2px] outline-sys-primary outline-offset-2" : ""
			}`}
			style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
		>
			<Handle type="target" position={Position.Left} style={{ background: "var(--color-sys-outline)" }} />
			<div className="truncate text-[0.875rem] font-semibold">
				{data.service}
			</div>
			<div className="flex justify-between opacity-70">
				<span>{data.spanCount.toLocaleString()} spans</span>
				<span>{data.traceCount.toLocaleString()} traces</span>
			</div>
			<div className="flex justify-between">
				<span className="opacity-70">err {errorPct}%</span>
				<span className="opacity-70">
					{data.errorCount > 0 ? `${data.errorCount} fail` : "healthy"}
				</span>
			</div>
			<Handle type="source" position={Position.Right} style={{ background: "var(--color-sys-outline)" }} />
		</div>
	);
}

const nodeTypes = { service: ServiceNode };

export function ServiceMapDashboard({ onNavigate }: Props = {}) {
	const api = useApi();
	const hours = String(useTimeWindowHours());
	const [data, setData] = useState<ServiceMapResponse | null>(null);
	const [loading, setLoading] = useState(false);
	const [selectedService, setSelectedService] = useState<string | null>(null);
	const [opsData, setOpsData] = useState<ServiceOperationsResponse | null>(null);
	const [opsLoading, setOpsLoading] = useState(false);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api<ServiceMapResponse>(
				`/telemetry/service-map?hours=${hours}`,
			);
			setData(res);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}, [hours, api]);

	const loadOps = useCallback(
		async (service: string) => {
			setOpsLoading(true);
			setOpsData(null);
			try {
				const res = await api<ServiceOperationsResponse>(
					`/telemetry/services/${encodeURIComponent(service)}/operations?hours=${hours}`,
				);
				setOpsData(res);
			} catch (err) {
				console.error(err);
			} finally {
				setOpsLoading(false);
			}
		},
		[api, hours],
	);

	useEffect(() => {
		load();
	}, [load]);

	useEffect(() => {
		if (selectedService) loadOps(selectedService);
	}, [selectedService, loadOps]);

	const { nodes, edges } = useMemo(() => {
		if (!data) return { nodes: [] as Node<ServiceNodeData>[], edges: [] as Edge[] };
		const rawNodes: Node<ServiceNodeData>[] = data.nodes.map((n) => ({
			id: n.service,
			type: "service",
			position: { x: 0, y: 0 },
			data: {
				service: n.service,
				spanCount: n.spanCount,
				errorCount: n.errorCount,
				errorRate: n.errorRate,
				traceCount: n.traceCount,
			},
		}));
		const rawEdges: Edge[] = data.edges.map((e) => {
			const errorPct = (e.errorRate * 100).toFixed(1);
			const p95 = Math.round(e.p95DurationMs);
			const color =
				e.errorRate >= 0.1
					? "var(--color-sys-error)"
					: e.errorRate >= 0.01
						? "var(--color-sys-warning)"
						: "var(--color-sys-outline)";
			return {
				id: `${e.source}->${e.target}`,
				source: e.source,
				target: e.target,
				label: `${e.calls.toLocaleString()} · p95 ${p95}ms · err ${errorPct}%`,
				labelStyle: {
					fontSize: 11,
					fontFamily: "var(--font-mono)",
					fill: "var(--color-sys-on-surface)",
				},
				labelBgStyle: { fill: "var(--color-sys-surface)" },
				style: { stroke: color, strokeWidth: e.errorRate >= 0.01 ? 2 : 1 },
				markerEnd: { type: MarkerType.ArrowClosed, color },
				animated: e.errorRate >= 0.1,
			};
		});
		return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
	}, [data]);

	const totalCalls = data?.edges.reduce((s, e) => s + e.calls, 0) ?? 0;
	const totalErrors = data?.edges.reduce((s, e) => s + e.errors, 0) ?? 0;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<span className="text-[0.875rem] font-semibold">
					Service map
				</span>
				<Button variant="primary" onClick={load}>
					Refresh
				</Button>
				<div className="ml-auto flex items-center gap-4 text-[0.75rem] font-mono opacity-70">
					<span>{data?.nodes.length ?? 0} services</span>
					<span>{data?.edges.length ?? 0} edges</span>
					<span>{totalCalls.toLocaleString()} calls</span>
					<span>
						{totalCalls > 0
							? `${((totalErrors / totalCalls) * 100).toFixed(1)}% err`
							: "—"}
					</span>
					<UpdatedChip at={data?.timestamp ?? null} />
				</div>
			</div>

			<div className="relative flex min-h-0 flex-1 gap-2">
				<div className="relative flex-1 bg-sys-surface border border-[#E5E7E3]">
					{loading && !data ? (
						<p className="p-3 text-[0.875rem] tracking-[0.05em] font-bold opacity-60">
							Initializing...
						</p>
					) : data && data.nodes.length === 0 ? (
						<div className="flex h-full items-center justify-center">
							<p className="text-[0.875rem] opacity-60 font-semibold">
								No services in window.
							</p>
						</div>
					) : (
						<div className="absolute inset-0">
							<ReactFlow
								nodes={nodes.map((n) => ({
									...n,
									selected: n.id === selectedService,
								}))}
								edges={edges}
								nodeTypes={nodeTypes}
								onNodeClick={(_, node) =>
									setSelectedService(node.id)
								}
								onPaneClick={() => setSelectedService(null)}
								fitView
								fitViewOptions={{ padding: 0.2 }}
								proOptions={{ hideAttribution: true }}
								minZoom={0.2}
								maxZoom={2}
							>
								<Background color="var(--color-sys-outline)" gap={24} />
								<Controls />
							</ReactFlow>
							{data && data.nodes.length > 0 && data.edges.length === 0 && (
								<div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 max-w-md bg-sys-surface-low px-3 py-2 text-[0.75rem] text-sys-on-surface-muted shadow-[inset_0_0_0_1px_var(--color-sys-outline-soft)]">
									<span className="font-semibold text-sys-on-surface">No service-to-service edges in this window.</span>{" "}
									Edges are derived from cross-service parent→child spans and span links. Confirm your SDKs propagate trace context across HTTP/queue calls.
								</div>
							)}
						</div>
					)}
				</div>

				{selectedService && (
					<ServiceDetailPanel
						service={selectedService}
						node={data?.nodes.find((n) => n.service === selectedService) ?? null}
						ops={opsData}
						loading={opsLoading}
						onClose={() => setSelectedService(null)}
						onNavigate={onNavigate}
					/>
				)}
			</div>

			{data && data.edges.length > 0 && (
				<Card className="mt-2 max-h-40 overflow-y-auto p-3">
					<SectionTitle
						title="Top edges by traffic"
						note={`${data.edges.length} edges`}
					/>
					<div className="mt-1 flex flex-col font-mono text-[0.75rem]">
						{data.edges
							.slice()
							.sort((a, b) => b.calls - a.calls)
							.slice(0, 8)
							.map((e) => (
								<div
									key={`${e.source}->${e.target}`}
									className="flex items-center gap-2 border-b-[1px] border-sys-surface-low py-1 last:border-b-0"
								>
									<span className="flex-1 truncate">
										<span className="font-bold">{e.source}</span>
										<span className="opacity-60"> → </span>
										<span className="font-bold">{e.target}</span>
									</span>
									<span className="w-20 text-right">
										{e.calls.toLocaleString()}
									</span>
									<span className="w-20 text-right">
										p95 {Math.round(e.p95DurationMs)}ms
									</span>
									<span
										className={`w-16 text-right ${
											e.errorRate >= 0.1
												? "text-sys-error"
												: e.errorRate >= 0.01
													? "text-sys-warning"
													: "opacity-60"
										}`}
									>
										{(e.errorRate * 100).toFixed(1)}% err
									</span>
								</div>
							))}
					</div>
				</Card>
			)}
		</div>
	);
}


// ── Service detail panel ───────────────────────────────────────────────

function ServiceDetailPanel({
	service,
	node,
	ops,
	loading,
	onClose,
	onNavigate,
}: {
	service: string;
	node: { spanCount: number; traceCount: number; errorCount: number; errorRate: number } | null;
	ops: ServiceOperationsResponse | null;
	loading: boolean;
	onClose: () => void;
	onNavigate?: (route: { tab?: string; traceId?: string }) => void;
}) {
	const errorPct = node ? (node.errorRate * 100).toFixed(1) : "0.0";
	return (
		<Card className="flex w-[380px] flex-none flex-col overflow-hidden">
			<div className="flex flex-none items-center justify-between border-b border-sys-outline-soft px-3 py-2">
				<span className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
					Service detail
				</span>
				<Button size="xs" onClick={onClose}>
					Close
				</Button>
			</div>

			<div className="flex flex-col gap-3 overflow-y-auto p-3">
				<div>
					<div className="font-mono text-[0.875rem] font-semibold text-sys-on-surface">
						{service}
					</div>
					{node && (
						<div className="mt-1 grid grid-cols-3 gap-2 font-mono text-[0.6875rem] text-sys-on-surface-muted">
							<div>
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
									Spans
								</div>
								<div className="tabular-nums">
									{node.spanCount.toLocaleString()}
								</div>
							</div>
							<div>
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
									Traces
								</div>
								<div className="tabular-nums">
									{node.traceCount.toLocaleString()}
								</div>
							</div>
							<div>
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
									Err rate
								</div>
								<div className={node.errorRate >= 0.01 ? "tabular-nums text-sys-error" : "tabular-nums"}>
									{errorPct}%
								</div>
							</div>
						</div>
					)}
				</div>

				<div className="flex flex-wrap gap-2">
					<Button
						variant="primary"
						size="sm"
						onClick={() => onNavigate?.({ tab: "traces" })}
						title="Open Traces tab"
					>
						View traces
					</Button>
				</div>

				{loading && <StateRow>Loading…</StateRow>}

				{ops && ops.operations.length > 0 && (
					<div>
						<div className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
							Top operations
						</div>
						<div className="flex flex-col">
							{ops.operations.map((op) => (
								<div
									key={op.spanName}
									className="border-b border-sys-outline-soft py-1.5 last:border-b-0"
								>
									<div className="flex items-baseline justify-between gap-2">
										<span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] font-semibold text-sys-on-surface">
											{op.spanName}
										</span>
										<span className="flex-none font-mono text-[0.6875rem] text-sys-on-surface-muted tabular-nums">
											{op.calls.toLocaleString()}
										</span>
									</div>
									<div className="flex items-baseline justify-between gap-2 font-mono text-[0.625rem] text-sys-on-surface-muted">
										<span>
											p50 {Math.round(op.p50DurationMs)}ms · p95 {Math.round(op.p95DurationMs)}ms
										</span>
										<span className={op.errorRate >= 0.01 ? "text-sys-error" : ""}>
											{(op.errorRate * 100).toFixed(1)}% err
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{ops && ops.recentErrors.length > 0 && (
					<div>
						<div className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
							Recent errors
						</div>
						<div className="flex flex-col">
							{ops.recentErrors.map((err) => (
								<button
									key={`${err.traceId}-${err.spanId}`}
									type="button"
									onClick={() => onNavigate?.({ tab: "traces", traceId: err.traceId })}
									className="border-b border-sys-outline-soft py-1.5 last:border-b-0 text-left cursor-pointer hover:bg-sys-surface-low"
									title="View trace"
								>
									<div className="flex items-baseline justify-between gap-2">
										<span className="min-w-0 flex-1 truncate font-mono text-[0.75rem] text-sys-error">
											{err.spanName}
										</span>
										<span className="flex-none font-mono text-[0.625rem] text-sys-on-surface-muted tabular-nums">
											{Math.round(err.durationMs)}ms
										</span>
									</div>
									{err.statusMessage && (
										<div className="truncate font-mono text-[0.625rem] text-sys-on-surface-muted">
											{err.statusMessage}
										</div>
									)}
								</button>
							))}
						</div>
					</div>
				)}

				{ops && ops.operations.length === 0 && !loading && (
					<StateRow>No operations in this window.</StateRow>
				)}
			</div>
		</Card>
	);
}
