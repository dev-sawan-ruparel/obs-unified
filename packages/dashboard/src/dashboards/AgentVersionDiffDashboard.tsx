import { useEffect, useState } from "react";
import { Card, SectionTitle, UpdatedChip } from "../components/primitives";
import { resolveExemplarLink } from "../components/resolver";
import { EmptyState } from "../components/states";
import { useApi } from "../use-api";

interface VersionDiffMetric {
	label: string;
	baselineValue: string | number;
	targetValue: string | number;
	deltaValue: string | number | null;
	deltaDirection: "positive" | "negative" | "neutral";
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

interface VersionComparison {
	baselineVersion: string;
	targetVersion: string;
	metrics: VersionDiffMetric[];
	baselineExemplars?: AggregateExemplar[];
	targetExemplars?: AggregateExemplar[];
	timestamp: string;
}

interface CompareStep {
	key: string;
	actionId: string;
	parentActionId: string | null;
	actionKind: string;
	name: string | null;
	status: string;
	durationMs: number | null;
	totalCostUsd: number | null;
	toolName: string | null;
	toolCallId: string | null;
	evalPassed: boolean | null;
	evalScore: number | null;
	traceId: string | null;
	spanId: string | null;
	causalConfidence?: string;
}

interface StepComparison {
	key: string;
	changeType: "same" | "changed" | "added" | "removed";
	changedFields: string[];
	left: CompareStep | null;
	right: CompareStep | null;
}

interface ActionCompareResponse {
	leftId: string;
	rightId: string;
	stepComparisons: StepComparison[];
	generatedAt: string;
}

interface Props {
	onNavigate?: (href: string) => void;
}

const openExemplar = (
	onNavigate: Props["onNavigate"],
	ex: AggregateExemplar,
) => {
	const link = resolveExemplarLink(ex);
	if (link) {
		onNavigate?.(link);
	}
};

export function AgentVersionDiffDashboard({ onNavigate }: Props) {
	const api = useApi();
	const [data, setData] = useState<VersionComparison | null>(null);
	const [loading, setLoading] = useState(true);
	const [showEmptyState, setShowEmptyState] = useState(false);
	const [baseline, setBaseline] = useState("v2.0.4");
	const [target, setTarget] = useState("v3.1.2");
	const [compareData, setCompareData] = useState<ActionCompareResponse | null>(
		null,
	);

	useEffect(() => {
		let active = true;
		async function fetchComparison() {
			try {
				const fetched = await api<VersionComparison>(
					`/actions/aggregates/version-diff?baseline=${encodeURIComponent(
						baseline,
					)}&target=${encodeURIComponent(target)}`,
				);
				if (active && fetched) {
					setData(fetched);
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

		fetchComparison();
		return () => {
			active = false;
		};
	}, [api, baseline, target]);

	useEffect(() => {
		let active = true;
		const left =
			data?.baselineExemplars?.[0]?.agentRunId ??
			data?.baselineExemplars?.[0]?.actionId;
		const right =
			data?.targetExemplars?.[0]?.agentRunId ??
			data?.targetExemplars?.[0]?.actionId;
		if (!left || !right) {
			setCompareData(null);
			return () => {
				active = false;
			};
		}

		api<ActionCompareResponse>(
			`/actions/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(
				right,
			)}`,
		)
			.then((comparison) => {
				if (active) setCompareData(comparison);
			})
			.catch(() => {
				if (active) setCompareData(null);
			});

		return () => {
			active = false;
		};
	}, [api, data]);

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted font-mono">
				Loading agent evaluation & diff data…
			</div>
		);
	}

	if (showEmptyState || !data) {
		return (
			<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface">
				<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
					<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
						Prompt & Agent Version Diff
					</span>
				</div>
				<Card className="flex-1 flex items-center justify-center border-[1px] border-sys-outline p-6">
					<EmptyState
						title="No Evaluation Comparison Records Found"
						description="No evaluation-case test suites or side-by-side run comparisons are currently available for the selected prompt/agent versions."
					/>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			{/* Top bar */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Prompt & Agent Version Diff
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted font-mono">
					Comparing {baseline} (Baseline) ➔ {target} (Target)
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

			{/* Version Selectors */}
			<div className="mb-2 flex-none flex flex-wrap items-center gap-4 bg-sys-surface px-4 py-2.5 border border-sys-outline-soft">
				<div className="flex items-center gap-2">
					<span className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-60">
						Baseline Version:
					</span>
					<select
						value={baseline}
						onChange={(e) => setBaseline(e.target.value)}
						className="bg-sys-surface-low border border-sys-outline text-[0.8125rem] font-mono px-2 py-1"
					>
						<option value="v2.0.4">v2.0.4 (Active Prod)</option>
						<option value="v1.0.0">v1.0.0 (Legacy)</option>
					</select>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-60">
						Target Version:
					</span>
					<select
						value={target}
						onChange={(e) => setTarget(e.target.value)}
						className="bg-sys-surface-low border border-sys-outline text-[0.8125rem] font-mono px-2 py-1"
					>
						<option value="v3.1.2">v3.1.2 (Release Candidate)</option>
						<option value="v4.0.0-alpha">v4.0.0-alpha (Dev)</option>
					</select>
				</div>
			</div>

			{/* Grid of Metric Comparisons */}
			<Card className="flex-1 p-3 flex flex-col min-w-0">
				<SectionTitle
					title="Side-by-Side Performance Comparison"
					note="Delta calculated as (Target - Baseline)"
				/>
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5 mt-3 flex-1 overflow-y-auto min-h-0 pr-1">
					{data.metrics.map((metric) => {
						const isPositive = metric.deltaDirection === "positive";
						const isNegative = metric.deltaDirection === "negative";
						const deltaColor = isPositive
							? "text-sys-primary font-bold"
							: isNegative
								? "text-sys-error font-bold"
								: "text-sys-on-surface-muted";

						return (
							<div
								key={metric.label}
								className="p-3 bg-sys-surface-low border border-[#E5E7E3] hover:border-sys-primary/45 transition-none flex flex-col justify-between"
							>
								<div>
									<div className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-muted">
										{metric.label}
									</div>
									<div className="grid grid-cols-2 gap-2 mt-3.5 border-b border-sys-outline-soft/40 pb-2">
										<div>
											<div className="text-[0.5625rem] uppercase font-bold tracking-[0.05em] opacity-50">
												Baseline
											</div>
											<div className="text-[0.9375rem] font-mono font-semibold truncate mt-0.5">
												{metric.baselineValue}
											</div>
										</div>
										<div>
											<div className="text-[0.5625rem] uppercase font-bold tracking-[0.05em] opacity-50">
												Target
											</div>
											<div className="text-[0.9375rem] font-mono font-semibold truncate mt-0.5">
												{metric.targetValue}
											</div>
										</div>
									</div>
								</div>
								<div className="mt-2.5 flex items-center justify-between text-[0.75rem]">
									<span className="opacity-60">Delta</span>
									<span className={deltaColor}>
										{metric.deltaValue ?? "No change"}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</Card>

			<Card className="mt-2 p-3 flex flex-col min-w-0">
				<SectionTitle
					title="Version Exemplars"
					note="Concrete runs behind the aggregate comparison"
				/>
				<div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
					{[
						{
							label: data.baselineVersion,
							rows: data.baselineExemplars ?? [],
						},
						{
							label: data.targetVersion,
							rows: data.targetExemplars ?? [],
						},
					].map((group) => (
						<div
							key={group.label}
							className="border border-sys-outline-soft bg-sys-surface-low p-2"
						>
							<div className="mb-2 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-70">
								{group.label}
							</div>
							{group.rows.length === 0 ? (
								<div className="text-[0.75rem] text-sys-on-surface-muted">
									No exemplar run captured.
								</div>
							) : (
								<div className="flex flex-col gap-1.5">
									{group.rows.map((row) => (
										<div
											key={row.actionId}
											className="flex items-center justify-between gap-2"
										>
											<div className="min-w-0">
												<div className="truncate text-[0.75rem] font-semibold">
													{row.label ?? row.agentRunId ?? row.actionId}
												</div>
												<div className="font-mono text-[0.625rem] opacity-60">
													{row.status ?? "unknown"} -{" "}
													{row.agentRunId?.slice(0, 8) ??
														row.actionId.slice(0, 8)}
												</div>
											</div>
											<button
												type="button"
												onClick={() => openExemplar(onNavigate, row)}
												className="flex-none underline hover:bg-sys-primary hover:text-white px-1.5 py-0.5 border border-sys-outline-soft font-mono text-[0.75rem]"
											>
												Inspect
											</button>
										</div>
									))}
								</div>
							)}
						</div>
					))}
				</div>
			</Card>

			<Card className="mt-2 p-3 flex flex-col min-w-0">
				<SectionTitle
					title="Step Comparison"
					note="First baseline and target exemplars, aligned by step identity"
				/>
				{compareData ? (
					<div className="mt-2 overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead>
								<tr className="border-b border-sys-outline-soft">
									<th className="pb-2 font-bold uppercase tracking-[0.05em] opacity-60">
										Change
									</th>
									<th className="pb-2 font-bold uppercase tracking-[0.05em] opacity-60">
										Baseline Step
									</th>
									<th className="pb-2 font-bold uppercase tracking-[0.05em] opacity-60">
										Target Step
									</th>
									<th className="pb-2 font-bold uppercase tracking-[0.05em] opacity-60">
										Changed Fields
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-sys-outline-soft/40">
								{compareData.stepComparisons
									.filter((row) => row.changeType !== "same")
									.slice(0, 25)
									.map((row) => (
										<tr key={row.key} className="align-top">
											<td className="py-2 pr-3">
												<span
													className={`inline-block border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase ${
														row.changeType === "changed"
															? "border-sys-warning/40 bg-sys-warning/10 text-sys-warning"
															: row.changeType === "added"
																? "border-sys-primary/40 bg-sys-primary/10 text-sys-primary"
																: "border-sys-error/40 bg-sys-error/10 text-sys-error"
													}`}
												>
													{row.changeType}
												</span>
											</td>
											<td className="py-2 pr-3">
												<StepCell step={row.left} onNavigate={onNavigate} />
											</td>
											<td className="py-2 pr-3">
												<StepCell step={row.right} onNavigate={onNavigate} />
											</td>
											<td className="py-2 font-mono text-[0.6875rem] opacity-75">
												{row.changedFields.length > 0
													? row.changedFields.join(", ")
													: "step presence"}
											</td>
										</tr>
									))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="mt-2 border border-sys-outline-soft bg-sys-surface-low p-3 text-[0.75rem] text-sys-on-surface-muted">
						No comparable exemplar pair is available for these versions.
					</div>
				)}
			</Card>
		</div>
	);
}

function StepCell({
	step,
	onNavigate,
}: {
	step: CompareStep | null;
	onNavigate?: Props["onNavigate"];
}) {
	if (!step) {
		return <span className="text-sys-on-surface-muted">absent</span>;
	}
	const target =
		step.toolCallId != null
			? `#/tool-calls/${encodeURIComponent(step.toolCallId)}`
			: `#/actions/${encodeURIComponent(step.actionId)}`;
	return (
		<div className="flex min-w-[12rem] flex-col gap-0.5">
			<button
				type="button"
				onClick={() => onNavigate?.(target)}
				className="text-left font-semibold text-sys-primary hover:underline"
			>
				{step.name ?? step.toolName ?? step.actionKind}
			</button>
			<div className="font-mono text-[0.625rem] opacity-65">
				{step.actionKind} - {step.status}
				{step.durationMs != null ? ` - ${step.durationMs}ms` : ""}
				{step.totalCostUsd != null ? ` - $${step.totalCostUsd.toFixed(4)}` : ""}
			</div>
			<div className="font-mono text-[0.625rem] opacity-55">
				{step.evalPassed == null
					? "eval n/a"
					: step.evalPassed
						? "eval pass"
						: "eval fail"}
				{step.evalScore != null ? ` (${step.evalScore.toFixed(2)})` : ""}
				{step.traceId ? ` - trace ${step.traceId.slice(0, 8)}` : ""}
			</div>
		</div>
	);
}

export default AgentVersionDiffDashboard;
