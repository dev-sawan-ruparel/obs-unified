import { useEffect, useState } from "react";
import type { EntityManifestExtended } from "../components/ActionGraphRenderer";
import { ActionGraphRenderer } from "../components/ActionGraphRenderer";
import { ConnectedRail } from "../components/ConnectedRail";
import { Card, SectionTitle } from "../components/primitives";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

export interface AgentRunDashboardProps {
	agentRunId: string;
	onNavigate?: (href: string) => void;
}

interface ConnectedManifest {
	entity: { kind: string; id: string; projectId: string };
	rawManifest?: EntityManifestExtended;
}

export function AgentRunDashboard({
	agentRunId,
	onNavigate,
}: AgentRunDashboardProps) {
	const api = useApi();
	const [manifest, setManifest] = useState<ConnectedManifest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		api<ConnectedManifest>(
			`/connected/agent_run/${encodeURIComponent(agentRunId)}`,
		)
			.then((data) => setManifest(data))
			.catch((err) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, [api, agentRunId]);

	if (loading) {
		return (
			<div className="flex h-full bg-sys-bg">
				<div className="flex-1 p-3">
					<StateRow>Loading agent run details…</StateRow>
				</div>
			</div>
		);
	}

	if (error || !manifest) {
		return (
			<div className="flex h-full bg-sys-bg">
				<div className="flex-1 p-3">
					<StateRow>
						{error
							? `Failed to load agent run: ${error}`
							: "Agent run not found."}
					</StateRow>
				</div>
				<ConnectedRail
					entityKind="agent_run"
					entityId={agentRunId}
					onNavigate={onNavigate}
				/>
			</div>
		);
	}

	const run = manifest.rawManifest?.agentRuns?.find((r) => r.id === agentRunId);
	const rootAction = manifest.rawManifest?.actions?.find(
		(a) => a.id === agentRunId,
	);
	const totalCostUsd = run?.totalCostUsd ?? null;
	const totalDurationMs = run?.totalDurationMs ?? null;
	const evalsForRun =
		manifest.rawManifest?.evalResults?.filter(
			(e) => e.actionId === agentRunId,
		) ?? [];
	const failedEval = evalsForRun.find((e) => !e.passed);
	const evalStatus =
		evalsForRun.length === 0 ? null : failedEval ? "failed" : "passed";

	const autonomyBadgeColor: Record<string, string> = {
		read_only: "border-sys-outline bg-sys-outline/10 text-sys-on-surface-muted",
		suggested_action: "border-sys-accent bg-sys-accent/10 text-sys-accent",
		human_approved_write:
			"border-sys-primary bg-sys-primary/10 text-sys-primary",
		autonomous_write:
			"border-sys-warning bg-sys-warning/10 text-sys-warning font-bold animate-pulse",
		blocked_by_policy:
			"border-sys-error bg-sys-error/10 text-sys-error font-bold",
	};

	const evalBadgeColor: Record<string, string> = {
		passed: "border-sys-primary bg-sys-primary/10 text-sys-primary",
		failed: "border-sys-error bg-sys-error/10 text-sys-error font-bold",
	};

	return (
		<div className="flex h-full bg-sys-bg">
			<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
				<header className="flex items-start gap-3 flex-none">
					<div className="flex h-12 w-12 flex-none items-center justify-center bg-sys-surface-high text-[1.25rem] font-bold border border-sys-outline/30">
						AG
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 min-w-0">
							<h1 className="font-mono text-[1rem] font-bold tracking-[-0.01em] truncate">
								{run?.agentName ?? "Agent Run"}
							</h1>
							{run?.agentVersion && (
								<span className="flex-none border border-sys-outline bg-sys-surface-low px-1.5 py-0.5 font-mono text-[0.625rem] tracking-[0.08em] opacity-70">
									v{run.agentVersion}
								</span>
							)}
							{run?.autonomyLevel && (
								<span
									className={`flex-none border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em] ${
										autonomyBadgeColor[run.autonomyLevel] ??
										"border-sys-outline"
									}`}
								>
									{run.autonomyLevel.replace(/_/g, " ")}
								</span>
							)}
						</div>
						<div className="mt-0.5 font-mono text-[0.75rem] opacity-70 truncate">
							run_id: {agentRunId}
						</div>
					</div>
				</header>

				<Card className="flex-none">
					<SectionTitle title="Run Summary" />
					<dl className="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
						<dt className="opacity-60">Goal</dt>
						<dd className="break-words font-medium">{run?.goal ?? "—"}</dd>

						<dt className="opacity-60">Outcome</dt>
						<dd className="break-words font-medium">{run?.outcome ?? "—"}</dd>

						<dt className="opacity-60">Status</dt>
						<dd className="flex items-center gap-1.5 font-medium">
							<span
								className={`h-2 w-2 rounded-full ${
									rootAction?.status === "ok"
										? "bg-sys-primary"
										: "bg-sys-error"
								}`}
							/>
							{rootAction?.status?.toUpperCase() ?? "UNKNOWN"}
						</dd>

						<dt className="opacity-60">Evaluation</dt>
						<dd>
							{evalStatus ? (
								<span
									className={`inline-block border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-[0.08em] ${
										evalBadgeColor[evalStatus] ?? "border-sys-outline"
									}`}
								>
									{evalStatus}
								</span>
							) : (
								"—"
							)}
						</dd>

						<dt className="opacity-60">Total Cost</dt>
						<dd className="tabular-nums">
							{totalCostUsd != null ? `$${totalCostUsd.toFixed(4)}` : "—"}
						</dd>

						<dt className="opacity-60">Latency</dt>
						<dd className="tabular-nums">
							{totalDurationMs != null
								? totalDurationMs < 1000
									? `${totalDurationMs}ms`
									: `${(totalDurationMs / 1000).toFixed(2)}s`
								: "—"}
						</dd>

						{rootAction?.startedAt && (
							<>
								<dt className="opacity-60">Started At</dt>
								<dd>{new Date(rootAction.startedAt).toLocaleString()}</dd>
							</>
						)}
					</dl>
				</Card>

				<div className="flex-1 min-h-[400px] flex flex-col min-w-0">
					<div className="flex-none px-3 py-1 bg-sys-surface border-[1px] border-b-0 border-sys-outline font-mono text-[0.75rem] font-bold uppercase tracking-[0.05em] opacity-80">
						Decision & Action Graph
					</div>
					<div className="flex-1 min-h-0 border-[1px] border-sys-outline overflow-hidden">
						{manifest.rawManifest && (
							<ActionGraphRenderer
								actionId={agentRunId}
								rawManifest={manifest.rawManifest}
							/>
						)}
					</div>
				</div>
			</div>
			<ConnectedRail
				entityKind="agent_run"
				entityId={agentRunId}
				onNavigate={onNavigate}
			/>
		</div>
	);
}
