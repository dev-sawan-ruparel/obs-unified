import { useEffect, useState } from "react";
import {
	Card,
	SectionTitle,
	Stat,
	UpdatedChip,
} from "../components/primitives";
import { EmptyState } from "../components/states";
import { useApi } from "../use-api";

interface ToolAgentBreakdown {
	agentName: string;
	invocations: number;
	errorRate: number;
	avgLatencyMs: number;
	sideEffects: number;
}

interface AggregateExemplar {
	actionId: string;
	agentRunId: string | null;
	traceId: string | null;
	toolCallId: string | null;
	evalId: string | null;
	label: string | null;
	status: string | null;
	occurredAt: string | null;
}

interface ToolReliabilityData {
	summary: {
		totalCalls: number;
		p50LatencyMs: number;
		p95LatencyMs: number;
		errorRate: number;
		sideEffectCount: number;
		timeoutCount: number;
		retryCount: number;
		malformedArgsCount: number;
	};
	tools: ToolReliabilityAggregateResponse["tools"];
	topAgents: ToolAgentBreakdown[];
	timestamp: string;
}

interface ToolReliabilityAggregateResponse {
	tools: Array<{
		toolName: string;
		callCount: number;
		p50LatencyMs: number | null;
		p95LatencyMs: number | null;
		errorRate: number;
		timeoutCount: number;
		retryCount: number;
		malformedArgumentCount: number;
		sideEffectCount: number;
		topCausingAgents: Array<{
			id: string;
			label: string | null;
			count: number;
		}>;
		exemplars?: AggregateExemplar[];
	}>;
	generatedAt: string;
}

const fromAggregateResponse = (
	response: ToolReliabilityAggregateResponse,
): ToolReliabilityData => {
	const totalCalls = response.tools.reduce(
		(sum, tool) => sum + tool.callCount,
		0,
	);
	const weighted = (
		value: (tool: ToolReliabilityAggregateResponse["tools"][number]) => number,
	) =>
		totalCalls === 0
			? 0
			: response.tools.reduce(
					(sum, tool) => sum + value(tool) * tool.callCount,
					0,
				) / totalCalls;
	const agents = new Map<string, ToolAgentBreakdown>();
	for (const tool of response.tools) {
		for (const agent of tool.topCausingAgents) {
			const key = agent.label ?? agent.id;
			const current = agents.get(key) ?? {
				agentName: key,
				invocations: 0,
				errorRate: 0,
				avgLatencyMs: 0,
				sideEffects: 0,
			};
			current.invocations += agent.count;
			current.errorRate = Math.max(current.errorRate, tool.errorRate);
			current.avgLatencyMs = Math.max(
				current.avgLatencyMs,
				tool.p50LatencyMs ?? 0,
			);
			current.sideEffects += tool.sideEffectCount;
			agents.set(key, current);
		}
	}
	return {
		summary: {
			totalCalls,
			p50LatencyMs: Math.round(weighted((tool) => tool.p50LatencyMs ?? 0)),
			p95LatencyMs: Math.round(weighted((tool) => tool.p95LatencyMs ?? 0)),
			errorRate: weighted((tool) => tool.errorRate),
			sideEffectCount: response.tools.reduce(
				(sum, tool) => sum + tool.sideEffectCount,
				0,
			),
			timeoutCount: response.tools.reduce(
				(sum, tool) => sum + tool.timeoutCount,
				0,
			),
			retryCount: response.tools.reduce(
				(sum, tool) => sum + tool.retryCount,
				0,
			),
			malformedArgsCount: response.tools.reduce(
				(sum, tool) => sum + tool.malformedArgumentCount,
				0,
			),
		},
		tools: response.tools,
		topAgents: [...agents.values()]
			.sort((a, b) => b.invocations - a.invocations)
			.slice(0, 10),
		timestamp: response.generatedAt,
	};
};

interface Props {
	onNavigate?: (href: string) => void;
}

const openExemplar = (
	onNavigate: Props["onNavigate"],
	ex: AggregateExemplar,
) => {
	if (ex.toolCallId) onNavigate?.(`#/tool-calls/${ex.toolCallId}`);
	else if (ex.actionId) onNavigate?.(`#/actions/${ex.actionId}`);
	else if (ex.agentRunId) onNavigate?.(`#/agent-runs/${ex.agentRunId}`);
	else if (ex.traceId) onNavigate?.(`#/traces?trace=${ex.traceId}`);
};

export function ToolReliabilityDashboard({ onNavigate }: Props) {
	const api = useApi();
	const [data, setData] = useState<ToolReliabilityData | null>(null);
	const [loading, setLoading] = useState(true);
	const [_error, setError] = useState<string | null>(null);
	const [showEmptyState, setShowEmptyState] = useState(false);

	useEffect(() => {
		let active = true;
		async function fetchReliability() {
			try {
				const fetched = fromAggregateResponse(
					await api<ToolReliabilityAggregateResponse>(
						"/actions/aggregates/tool-reliability",
					),
				);
				if (active) {
					if (!fetched || fetched.summary.totalCalls === 0) {
						setShowEmptyState(true);
						setData(null);
					} else {
						setData(fetched);
						setShowEmptyState(false);
					}
					setError(null);
				}
			} catch (_err) {
				if (active) {
					setData(null);
					setShowEmptyState(true);
					setError("Failed to load tool reliability aggregates.");
				}
			} finally {
				if (active) setLoading(false);
			}
		}

		fetchReliability();
		return () => {
			active = false;
		};
	}, [api]);

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted font-mono">
				Loading tool reliability telemetry…
			</div>
		);
	}

	if (showEmptyState || !data) {
		return (
			<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface">
				<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
					<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
						Tool Reliability Dashboard
					</span>
				</div>
				<Card className="flex-1 flex items-center justify-center border-[1px] border-sys-outline p-6">
					<EmptyState
						title="No Tool Telemetry Logged"
						description="No tool executions or agent action spans were detected within the active telemetry window."
					/>
				</Card>
			</div>
		);
	}

	const s = data.summary;

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			{/* Top bar */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Tool Reliability Dashboard
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted font-mono">
					{s.totalCalls.toLocaleString()} tool calls monitored
				</span>
				{import.meta.env.DEV && (
					<button
						type="button"
						onClick={() => {
							setShowEmptyState(true);
						}}
						className="text-[0.6875rem] font-semibold underline text-sys-on-surface-muted hover:text-sys-on-surface ml-2"
					>
						Simulate Empty State
					</button>
				)}
				<div className="ml-auto flex items-center gap-2">
					<UpdatedChip at={data.timestamp} />
				</div>
			</div>

			{/* Core Metric Grid */}
			<div className="mb-2 grid grid-cols-2 md:grid-cols-5 gap-2 flex-none">
				<Stat
					label="Call Count"
					value={s.totalCalls.toLocaleString()}
					accent="primary"
				/>
				<Stat
					label="p50 Latency"
					value={`${s.p50LatencyMs}ms`}
					accent="default"
				/>
				<Stat
					label="p95 Latency"
					value={`${s.p95LatencyMs}ms`}
					accent="default"
				/>
				<Stat
					label="Error Rate"
					value={`${(s.errorRate * 100).toFixed(1)}%`}
					accent={
						s.errorRate > 0.05
							? "error"
							: s.errorRate > 0
								? "warning"
								: "default"
					}
				/>
				<Stat
					label="Side-Effect Invocations"
					value={s.sideEffectCount.toLocaleString()}
					accent="accent"
				/>
			</div>

			{/* Error and Cause Panels */}
			<div className="flex-1 flex flex-col md:flex-row gap-2 min-h-0">
				{/* Left: Error breakdown */}
				<div className="flex-1 flex flex-col gap-2 min-w-0">
					<Card className="p-3 flex flex-col">
						<SectionTitle title="Telemetry Error Breakdown" />
						<div className="grid grid-cols-3 gap-2 mt-2">
							<div className="p-3 bg-sys-surface-low border border-[#E5E7E3] text-center">
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
									Timeouts
								</div>
								<div className="text-xl font-mono font-bold mt-1 tabular-nums">
									{s.timeoutCount}
								</div>
							</div>
							<div className="p-3 bg-sys-surface-low border border-[#E5E7E3] text-center">
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
									Retries
								</div>
								<div className="text-xl font-mono font-bold mt-1 tabular-nums">
									{s.retryCount}
								</div>
							</div>
							<div className="p-3 bg-sys-surface-low border border-[#E5E7E3] text-center">
								<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
									Malformed Args
								</div>
								<div className="text-xl font-mono font-bold mt-1 tabular-nums">
									{s.malformedArgsCount}
								</div>
							</div>
						</div>
					</Card>

					<Card className="p-3 flex flex-col">
						<SectionTitle title="Tool Exemplars" />
						<div className="mt-2 overflow-x-auto">
							<table className="w-full text-left text-[0.8125rem]">
								<thead>
									<tr className="border-b border-[#E5E7E3]">
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Tool
										</th>
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Exemplar
										</th>
										<th className="pb-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Inspect
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-sys-outline-soft/40">
									{data.tools.map((tool) => {
										const exemplar = tool.exemplars?.[0];
										return (
											<tr
												key={tool.toolName}
												className="hover:bg-sys-surface-low/50"
											>
												<td className="py-2.5 font-bold font-mono text-[0.75rem]">
													{tool.toolName}
												</td>
												<td className="py-2.5 min-w-0">
													<div className="flex flex-col gap-0.5">
														<span className="font-semibold truncate max-w-[260px]">
															{exemplar?.label ?? "No exemplar captured"}
														</span>
														<span className="font-mono text-[0.625rem] opacity-60">
															{exemplar?.agentRunId
																? `run ${exemplar.agentRunId.slice(0, 8)}...`
																: "aggregate only"}
														</span>
													</div>
												</td>
												<td className="py-2.5 text-right font-mono text-[0.75rem]">
													<button
														type="button"
														disabled={!exemplar}
														onClick={() =>
															exemplar && openExemplar(onNavigate, exemplar)
														}
														className="underline hover:bg-sys-primary hover:text-white px-1.5 py-0.5 border border-sys-outline-soft disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-current"
													>
														Open Exemplar
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</Card>

					{/* Top Causing Agents / Workflows Table */}
					<Card className="p-3 flex-1 flex flex-col min-w-0 overflow-y-auto">
						<SectionTitle title="Top Causing Agents / Workflows" />
						<div className="mt-2 overflow-x-auto">
							<table className="w-full text-left text-[0.8125rem]">
								<thead>
									<tr className="border-b border-[#E5E7E3]">
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Agent / Workflow
										</th>
										<th className="pb-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Invocations
										</th>
										<th className="pb-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Error Rate
										</th>
										<th className="pb-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Avg Latency
										</th>
										<th className="pb-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Side Effects
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-sys-outline-soft/40">
									{data.topAgents.map((agent) => (
										<tr
											key={`${agent.agentName}-${agent.invocations}-${agent.avgLatencyMs}-${agent.sideEffects}`}
											className="hover:bg-sys-surface-low/50"
										>
											<td className="py-2.5 font-semibold truncate max-w-[200px]">
												{agent.agentName}
											</td>
											<td className="py-2.5 text-right font-mono tabular-nums">
												{agent.invocations.toLocaleString()}
											</td>
											<td
												className={`py-2.5 text-right font-mono font-bold tabular-nums ${agent.errorRate > 0.04 ? "text-sys-error" : "opacity-80"}`}
											>
												{(agent.errorRate * 100).toFixed(1)}%
											</td>
											<td className="py-2.5 text-right font-mono opacity-80 tabular-nums">
												{agent.avgLatencyMs}ms
											</td>
											<td className="py-2.5 text-right font-mono opacity-80 tabular-nums">
												{agent.sideEffects}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</Card>
				</div>
			</div>
		</div>
	);
}

export default ToolReliabilityDashboard;
