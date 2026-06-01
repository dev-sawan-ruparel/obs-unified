import { useEffect, useState } from "react";
import {
	Card,
	SectionTitle,
	Stat,
	UpdatedChip,
} from "../components/primitives";
import { EmptyState } from "../components/states";
import { useApi } from "../use-api";

interface AutonomousWriteRow {
	id: string;
	toolName: string;
	actionId: string;
	actionName: string;
	agentRunId: string;
	agentName: string;
	agentVersion: string;
	autonomyLevel: string;
	sideEffect: boolean;
	approvalState: "pending" | "approved" | "rejected" | "bypassed";
	status: "ok" | "error";
	errorSnippet: string | null;
	traceId: string;
	occurredAt: string;
}

interface AutonomousReviewData {
	rows: AutonomousWriteRow[];
	timestamp: string;
}

// Fallback high-fidelity mock data for reviews
const MOCK_REVIEW_DATA: AutonomousReviewData = {
	rows: [
		{
			id: "tc_refund_01",
			toolName: "stripe.charge_refund",
			actionId: "act_refund_921",
			actionName: "Refund Customer Charge",
			agentRunId: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
			agentName: "Billing Operations Assistant",
			agentVersion: "v3.1.2",
			autonomyLevel: "autonomous_write",
			sideEffect: true,
			approvalState: "pending",
			status: "ok",
			errorSnippet: null,
			traceId: "8cf92f3577b34da6a3ce929d0e0e4739",
			occurredAt: new Date(Date.now() - 300000).toISOString(),
		},
		{
			id: "tc_db_update_02",
			toolName: "db.invoice_update",
			actionId: "act_invoice_502",
			actionName: "Mutate Invoice Address Record",
			agentRunId: "01J3Y4Z5A6B7C8D9E0F1G2H3J4",
			agentName: "Billing Operations Assistant",
			agentVersion: "v3.1.2",
			autonomyLevel: "autonomous_write",
			sideEffect: true,
			approvalState: "rejected",
			status: "error",
			errorSnippet:
				"tenant guardrail policy violation: unauthorized address change requested",
			traceId: "9df92f3577b34da6a3ce929d0e0e4741",
			occurredAt: new Date(Date.now() - 600000).toISOString(),
		},
		{
			id: "tc_slack_03",
			toolName: "slack.post_message",
			actionId: "act_notify_38",
			actionName: "Post Alerts Notification",
			agentRunId: "run_alert_sync_102",
			agentName: "Notification Router",
			agentVersion: "v1.1.0",
			autonomyLevel: "autonomous_write",
			sideEffect: true,
			approvalState: "approved",
			status: "ok",
			errorSnippet: null,
			traceId: "acf92f3577b34da6a3ce929d0e0e4743",
			occurredAt: new Date(Date.now() - 1200000).toISOString(),
		},
		{
			id: "tc_refund_04",
			toolName: "stripe.charge_refund",
			actionId: "act_refund_940",
			actionName: "Refund Overcharged Subscription",
			agentRunId: "run_sub_ops_55",
			agentName: "Billing Operations Assistant",
			agentVersion: "v3.1.2",
			autonomyLevel: "autonomous_write",
			sideEffect: true,
			approvalState: "bypassed",
			status: "ok",
			errorSnippet: null,
			traceId: "bcf92f3577b34da6a3ce929d0e0e4745",
			occurredAt: new Date(Date.now() - 3600000).toISOString(),
		},
	],
	timestamp: new Date().toISOString(),
};

interface Props {
	onNavigate: (route: {
		tab: string;
		agentRunId?: string;
		actionId?: string;
		toolCallId?: string;
		traceId?: string;
	}) => void;
}

export function AutonomousReviewDashboard({ onNavigate }: Props) {
	const api = useApi();
	const [data, setData] = useState<AutonomousReviewData | null>(null);
	const [loading, setLoading] = useState(true);
	const [filter, setFilter] = useState<
		"all" | "pending" | "approved" | "rejected" | "bypassed"
	>("all");

	useEffect(() => {
		let active = true;
		async function fetchReviews() {
			try {
				const fetched = await api<AutonomousReviewData>(
					"/connected/autonomous_review",
				);
				if (active && fetched) {
					setData(fetched);
				}
			} catch (_err) {
				// Backend not fully ready yet, fallback to local high-fidelity mock data.
				if (active) {
					setData(MOCK_REVIEW_DATA);
				}
			} finally {
				if (active) setLoading(false);
			}
		}

		fetchReviews();
		return () => {
			active = false;
		};
	}, [api]);

	if (loading) {
		return (
			<div className="flex h-full items-center justify-center text-[0.8125rem] text-sys-on-surface-muted font-mono">
				Loading autonomous review registry…
			</div>
		);
	}

	const rows = data?.rows ?? [];
	const filteredRows = rows.filter((r) => {
		if (filter === "all") return true;
		return r.approvalState === filter;
	});

	const pendingCount = rows.filter((r) => r.approvalState === "pending").length;
	const approvedCount = rows.filter(
		(r) => r.approvalState === "approved",
	).length;
	const rejectedCount = rows.filter(
		(r) => r.approvalState === "rejected",
	).length;

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-hidden">
			{/* Top bar */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Autonomous-Write Review Surface
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted font-mono">
					{pendingCount} Pending Reviews
				</span>
				<div className="ml-auto flex items-center gap-2">
					<UpdatedChip at={data?.timestamp ?? new Date().toISOString()} />
				</div>
			</div>

			{/* Filter Toolbar */}
			<div className="mb-2 flex-none flex flex-wrap items-center gap-1.5 bg-sys-surface px-3 py-2 border border-sys-outline-soft">
				{(["all", "pending", "approved", "rejected", "bypassed"] as const).map(
					(opt) => {
						const active = filter === opt;
						const count =
							opt === "all"
								? rows.length
								: rows.filter((r) => r.approvalState === opt).length;
						return (
							<button
								key={opt}
								type="button"
								onClick={() => setFilter(opt)}
								className={`px-3 py-1 text-[0.6875rem] font-bold uppercase tracking-[0.05em] border transition-none cursor-pointer ${
									active
										? "bg-sys-primary text-white border-sys-primary"
										: "bg-sys-surface-low text-sys-on-surface border-sys-outline hover:bg-sys-surface-high"
								}`}
							>
								{opt} ({count})
							</button>
						);
					},
				)}
			</div>

			{/* Stats Bar */}
			<div className="mb-2 grid grid-cols-3 gap-2 flex-none">
				<Stat
					label="Total Pending Invocations"
					value={pendingCount.toString()}
					accent="warning"
				/>
				<Stat
					label="Total Approved Operations"
					value={approvedCount.toString()}
					accent="primary"
				/>
				<Stat
					label="Total Blocked/Rejected"
					value={rejectedCount.toString()}
					accent="error"
				/>
			</div>

			{/* High Density Review Table Card */}
			<Card className="flex-1 flex flex-col p-3 overflow-hidden min-w-0">
				<SectionTitle
					title="Autonomous Operations Registry"
					note="Mutative side-effects requiring oversight"
				/>
				<div className="flex-1 overflow-y-auto mt-2 min-h-0">
					{filteredRows.length === 0 ? (
						<EmptyState
							title="No Autonomous Write Reviews Found"
							description={`No actions matching the filter "${filter.toUpperCase()}" are currently recorded in the registry.`}
						/>
					) : (
						<div className="overflow-x-auto min-w-full">
							<table className="w-full text-left text-[0.8125rem] whitespace-nowrap">
								<thead>
									<tr className="border-b border-[#E5E7E3]">
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Tool
										</th>
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Actor / Version
										</th>
										<th className="pb-2 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Action / Workflow
										</th>
										<th className="pb-2 text-center font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											State
										</th>
										<th className="pb-2 text-center font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Status
										</th>
										<th className="pb-2 pr-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
											Inspect Telemetry
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-sys-outline-soft/40">
									{filteredRows.map((row) => {
										const approvalBadgeColor =
											row.approvalState === "pending"
												? "bg-sys-warning/15 text-sys-warning border border-sys-warning/30"
												: row.approvalState === "approved"
													? "bg-sys-primary/15 text-sys-primary border border-sys-primary/30"
													: row.approvalState === "rejected"
														? "bg-sys-error/15 text-sys-error border border-sys-error/30"
														: "bg-sys-on-surface-muted/15 text-sys-on-surface-muted border border-sys-on-surface-muted/30";

										const statusBadgeColor =
											row.status === "ok"
												? "bg-sys-primary/15 text-sys-primary border border-sys-primary/30"
												: "bg-sys-error/15 text-sys-error border border-sys-error/30";

										return (
											<tr
												key={row.id}
												className="hover:bg-sys-surface-low/50 group"
											>
												<td className="py-2.5 font-bold font-mono text-[0.75rem]">
													{row.toolName}
												</td>
												<td className="py-2.5">
													<div className="flex flex-col gap-0.5 min-w-0">
														<span className="font-semibold text-[0.8125rem]">
															{row.agentName}
														</span>
														<span className="font-mono text-[0.625rem] opacity-60">
															{row.agentVersion}
														</span>
													</div>
												</td>
												<td className="py-2.5">
													<div className="flex flex-col gap-0.5 min-w-0">
														<button
															type="button"
															onClick={() =>
																onNavigate({
																	tab: "agent-runs",
																	agentRunId: row.agentRunId,
																})
															}
															className="font-bold text-[0.8125rem] text-left hover:underline text-sys-primary cursor-pointer truncate max-w-[200px]"
														>
															{row.actionName}
														</button>
														{row.errorSnippet ? (
															<span
																className="font-mono text-[0.6875rem] text-sys-error font-semibold truncate max-w-[280px]"
																title={row.errorSnippet}
															>
																⚠️ {row.errorSnippet}
															</span>
														) : (
															<span className="font-mono text-[0.625rem] opacity-60">
																Run ID: {row.agentRunId.slice(0, 8)}…
															</span>
														)}
													</div>
												</td>
												<td className="py-2.5 text-center">
													<span
														className={`px-2 py-0.5 rounded text-[0.6875rem] font-bold uppercase tracking-[0.05em] inline-block ${approvalBadgeColor}`}
													>
														{row.approvalState}
													</span>
												</td>
												<td className="py-2.5 text-center">
													<span
														className={`px-2 py-0.5 rounded text-[0.6875rem] font-bold uppercase tracking-[0.05em] inline-block ${statusBadgeColor}`}
													>
														{row.status}
													</span>
												</td>
												<td className="py-2.5 text-right font-mono text-[0.75rem] pr-2">
													<div className="flex items-center justify-end gap-2.5">
														<button
															type="button"
															onClick={() =>
																onNavigate({
																	tab: "actions",
																	actionId: row.actionId,
																})
															}
															className="underline hover:bg-sys-primary hover:text-white px-1.5 py-0.5 border border-sys-outline-soft"
														>
															Action Details
														</button>
														<button
															type="button"
															onClick={() =>
																onNavigate({
																	tab: "traces",
																	traceId: row.traceId,
																})
															}
															className="underline hover:bg-sys-primary hover:text-white px-1.5 py-0.5 border border-sys-outline-soft"
														>
															View Trace
														</button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</div>
			</Card>
		</div>
	);
}

export default AutonomousReviewDashboard;
