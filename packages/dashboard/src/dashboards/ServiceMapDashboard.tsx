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

function ServiceNode({ data }: NodeProps<Node<ServiceNodeData>>) {
	const errorPct = (data.errorRate * 100).toFixed(1);
	const accent =
		data.errorRate >= 0.1
			? "border-sys-error text-sys-error"
			: data.errorRate >= 0.01
				? "border-sys-warning text-sys-warning"
				: "border-sys-outline text-sys-on-surface";
	return (
		<div
			className={`flex flex-col gap-1 border-[2px] bg-sys-surface px-3 py-2 font-mono text-[0.75rem] ${accent}`}
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

export function ServiceMapDashboard() {
	const api = useApi();
	const hours = String(useTimeWindowHours());
	const [data, setData] = useState<ServiceMapResponse | null>(null);
	const [loading, setLoading] = useState(false);

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

	useEffect(() => {
		load();
	}, [load]);

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

			<div className="relative min-h-0 flex-1 bg-sys-surface border border-[#E5E7E3]">
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
							nodes={nodes}
							edges={edges}
							nodeTypes={nodeTypes}
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
								Edges are derived from cross-service parent→child spans. Confirm your SDKs propagate trace context across HTTP/queue calls.
							</div>
						)}
					</div>
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
