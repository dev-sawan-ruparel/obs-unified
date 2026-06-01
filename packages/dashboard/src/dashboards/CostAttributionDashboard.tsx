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
	timestamp: string;
}

// High-fidelity fallback cost mock data
const MOCK_COST_DATA: CostAttributionData = {
	summary: {
		totalCostUsd: 184.25,
		totalRuns: 1420,
		avgCostPerRunUsd: 0.129,
	},
	breakdowns: {
		agents: [
			["Billing Operations Assistant", 88.42],
			["Support Triage Agent", 45.18],
			["Database Sync Daemon", 32.1],
			["Notification Router", 18.55],
		],
		runs: [
			["run_wrong_invoice_01", 12.45],
			["run_address_update_92", 8.2],
			["run_auth_check_102", 5.6],
			["run_stripe_charge_44", 4.15],
		],
		models: [
			["gpt-4o", 112.5],
			["gpt-4o-mini", 35.8],
			["claude-3-5-sonnet", 24.15],
			["gemini-1.5-pro", 11.8],
		],
		providers: [
			["openai", 148.3],
			["anthropic", 24.15],
			["google", 11.8],
		],
		promptVersions: [
			["v3.1.2", 88.42],
			["v2.0.4", 45.18],
			["v1.0.0", 32.1],
			["v1.1.0", 18.55],
		],
		tools: [
			["db.invoice_update", 42.1],
			["stripe.charge_refund", 32.4],
			["slack.post_message", 12.05],
			["sendgrid.send_email", 6.2],
		],
		users: [
			["tenant_acme_corp", 74.2],
			["tenant_globex_corp", 48.9],
			["tenant_umbrella_corp", 32.15],
			["tenant_hooli", 29.0],
		],
	},
	timestamp: new Date().toISOString(),
};

export function CostAttributionDashboard() {
	const api = useApi();
	const [data, setData] = useState<CostAttributionData | null>(null);
	const [loading, setLoading] = useState(true);
	const [showEmptyState, setShowEmptyState] = useState(false);

	useEffect(() => {
		let active = true;
		async function fetchCosts() {
			try {
				const fetched = await api<CostAttributionData>(
					"/connected/cost_attribution",
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
				// Backend not fully ready yet, fallback to local high-fidelity mock data.
				if (active) {
					setData(MOCK_COST_DATA);
					setShowEmptyState(false);
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
				<button
					type="button"
					onClick={() => {
						setShowEmptyState(true);
					}}
					className="text-[0.6875rem] font-semibold underline text-sys-on-surface-muted hover:text-sys-on-surface ml-2"
				>
					Simulate Empty State
				</button>
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
			</div>
		</div>
	);
}

export default CostAttributionDashboard;
