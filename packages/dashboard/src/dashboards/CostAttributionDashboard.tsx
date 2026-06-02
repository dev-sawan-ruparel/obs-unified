import { useEffect, useState } from "react";
import { BarList, Card, Stat, UpdatedChip } from "../components/primitives";
import { EmptyState } from "../components/states";
import { useApi } from "../use-api";

interface CostAttributionData {
	summary: {
		totalCostUsd: number;
		totalRuns: number;
		avgCostPerRunUsd: number;
	};
	breakdowns: {
		agents: Array<[string, number]>;
		runs: Array<[string, number]>;
		models: Array<[string, number]>;
		providers: Array<[string, number]>;
		promptVersions: Array<[string, number]>;
		tools: Array<[string, number]>;
		users: Array<[string, number]>;
	};
	rows: CostAttributionAggregateRow[];
	timestamp: string;
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

interface CostAttributionAggregateRow {
	dimension?: string;
	key: string | null;
	label: string | null;
	totalCostUsd: number;
	agentRunCount: number;
	exemplars?: AggregateExemplar[];
}

interface CostAttributionAggregateResponse {
	byAgent: CostAttributionAggregateRow[];
	byRun: CostAttributionAggregateRow[];
	byModel: CostAttributionAggregateRow[];
	byProvider: CostAttributionAggregateRow[];
	byPromptVersion: CostAttributionAggregateRow[];
	byTool: CostAttributionAggregateRow[];
	byUser: CostAttributionAggregateRow[];
	byTenant: CostAttributionAggregateRow[];
	byWorkflow: CostAttributionAggregateRow[];
	generatedAt: string;
}

const asBarItems = (
	rows: CostAttributionAggregateRow[],
): Array<[string, number]> =>
	rows.map((row) => [row.label ?? row.key ?? "unknown", row.totalCostUsd]);

const fromAggregateResponse = (
	response: CostAttributionAggregateResponse,
): CostAttributionData => {
	const totalCostUsd = response.byRun.reduce(
		(sum, row) => sum + row.totalCostUsd,
		0,
	);
	const totalRuns = response.byRun.reduce(
		(sum, row) => sum + row.agentRunCount,
		0,
	);
	return {
		summary: {
			totalCostUsd,
			totalRuns,
			avgCostPerRunUsd: totalRuns > 0 ? totalCostUsd / totalRuns : 0,
		},
		breakdowns: {
			agents: asBarItems(response.byAgent),
			runs: asBarItems(response.byRun),
			models: asBarItems(response.byModel),
			providers: asBarItems(response.byProvider),
			promptVersions: asBarItems(response.byPromptVersion),
			tools: asBarItems(response.byTool),
			users: [
				...asBarItems(response.byUser),
				...asBarItems(response.byTenant),
				...asBarItems(response.byWorkflow),
			],
		},
		rows: [
			...response.byAgent,
			...response.byRun,
			...response.byTool,
			...response.byPromptVersion,
			...response.byModel,
			...response.byProvider,
			...response.byUser,
			...response.byTenant,
			...response.byWorkflow,
		].filter((row) => (row.exemplars?.length ?? 0) > 0),
		timestamp: response.generatedAt,
	};
};

interface Props {
	onNavigate?: (href: string) => void;
}

const openExemplar = (
	onNavigate: Props["onNavigate"],
	row: CostAttributionAggregateRow,
	ex: AggregateExemplar,
) => {
	if (row.dimension === "tool" && ex.toolCallId) {
		onNavigate?.(`#/tool-calls/${ex.toolCallId}`);
	} else if (ex.agentRunId) onNavigate?.(`#/agent-runs/${ex.agentRunId}`);
	else if (ex.actionId) onNavigate?.(`#/actions/${ex.actionId}`);
	else if (ex.toolCallId) onNavigate?.(`#/tool-calls/${ex.toolCallId}`);
	else if (ex.traceId) onNavigate?.(`#/traces?trace=${ex.traceId}`);
};

export function CostAttributionDashboard({ onNavigate }: Props) {
	const api = useApi();
	const [data, setData] = useState<CostAttributionData | null>(null);
	const [loading, setLoading] = useState(true);
	const [showEmptyState, setShowEmptyState] = useState(false);

	useEffect(() => {
		let active = true;
		async function fetchCosts() {
			try {
				const fetched = fromAggregateResponse(
					await api<CostAttributionAggregateResponse>(
						"/actions/aggregates/cost-attribution",
					),
				);
				if (active) {
					if (!fetched || fetched.summary.totalCostUsd === 0) {
						setShowEmptyState(true);
						setData(null);
					} else {
						setData(fetched);
						setShowEmptyState(false);
					}
				}
			} catch (_err) {
				if (active) {
					setData(null);
					setShowEmptyState(true);
				}
			} finally {
				if (active) setLoading(false);
			}
		}

		fetchCosts();
		return () => {
			active = false;
		};
	}, [api]);

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted font-mono">
				Loading cost attribution metrics…
			</div>
		);
	}

	if (showEmptyState || !data) {
		return (
			<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface">
				<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
					<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
						Cost Attribution
					</span>
				</div>
				<Card className="flex-1 flex items-center justify-center border-[1px] border-sys-outline p-6">
					<EmptyState
						title="No Cost Telemetry Available"
						description="No model usage, tool calls, or token counts with associated costs were recorded in this interval."
					/>
				</Card>
			</div>
		);
	}

	const s = data.summary;
	const b = data.breakdowns;

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			{/* Top bar */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Cost Attribution
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted font-mono">
					Attributing ${s.totalCostUsd.toFixed(2)} USD across runs
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

			{/* Core Metric Cards */}
			<div className="mb-2 grid grid-cols-1 md:grid-cols-3 gap-2 flex-none">
				<Stat
					label="Total AI/Tool Cost"
					value={`$${s.totalCostUsd.toFixed(2)}`}
					accent="primary"
				/>
				<Stat
					label="Total Attributed Runs"
					value={s.totalRuns.toLocaleString()}
					accent="default"
				/>
				<Stat
					label="Avg Cost per Run"
					value={`$${s.avgCostPerRunUsd.toFixed(3)}`}
					accent="accent"
				/>
			</div>

			{/* Multi-Dimensional BarLists Grid */}
			<div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 min-h-0">
				{b.agents.length > 0 && (
					<BarList
						title="Top Agents by Cost (USD)"
						items={b.agents}
						color="var(--color-sys-primary)"
					/>
				)}
				{b.models.length > 0 && (
					<BarList
						title="Top Models by Cost (USD)"
						items={b.models}
						color="var(--color-sys-accent)"
					/>
				)}
				{b.providers.length > 0 && (
					<BarList
						title="Top Providers by Cost (USD)"
						items={b.providers}
						color="var(--color-sys-accent)"
					/>
				)}
				{b.promptVersions.length > 0 && (
					<BarList
						title="Top Prompt/Agent Versions (USD)"
						items={b.promptVersions}
						color="var(--color-sys-primary)"
					/>
				)}
				{b.tools.length > 0 && (
					<BarList
						title="Top Tools by Cost (USD)"
						items={b.tools}
						color="var(--color-sys-primary)"
					/>
				)}
				{b.users.length > 0 && (
					<BarList
						title="Top Users/Workflows by Cost (USD)"
						items={b.users}
						color="var(--color-sys-accent)"
					/>
				)}
				{b.runs.length > 0 && (
					<BarList
						title="Top Runs by Cost (USD)"
						items={b.runs}
						color="var(--color-sys-primary)"
					/>
				)}
				{data.rows.length > 0 && (
					<Card className="flex flex-col p-3 min-w-0">
						<div className="flex items-center justify-between gap-3">
							<span className="text-[0.8125rem] font-semibold">
								Cost Exemplars
							</span>
							<span className="font-mono text-[0.625rem] uppercase tracking-[0.05em] opacity-60">
								{data.rows.length} pivots
							</span>
						</div>
						<div className="mt-2 flex flex-col gap-2">
							{data.rows.slice(0, 8).map((row) => {
								const exemplar = row.exemplars?.[0];
								if (!exemplar) return null;
								return (
									<div
										key={`${row.dimension ?? "cost"}-${row.key ?? row.label}`}
										className="flex items-center justify-between gap-3 border-b border-sys-outline-soft/40 pb-2 last:border-0"
									>
										<div className="min-w-0">
											<div className="truncate text-[0.75rem] font-bold">
												{row.label ?? row.key ?? "unknown"}
											</div>
											<div className="font-mono text-[0.625rem] opacity-60">
												${row.totalCostUsd.toFixed(4)} -{" "}
												{exemplar.label ?? exemplar.actionId}
											</div>
										</div>
										<button
											type="button"
											onClick={() => openExemplar(onNavigate, row, exemplar)}
											className="flex-none underline hover:bg-sys-primary hover:text-white px-1.5 py-0.5 border border-sys-outline-soft font-mono text-[0.75rem]"
										>
											Inspect
										</button>
									</div>
								);
							})}
						</div>
					</Card>
				)}
			</div>
		</div>
	);
}

export default CostAttributionDashboard;
