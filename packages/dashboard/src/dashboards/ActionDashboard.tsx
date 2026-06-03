import { useEffect, useState } from "react";
import type { EntityManifestExtended } from "../components/ActionGraphRenderer";
import { ActionGraphRenderer } from "../components/ActionGraphRenderer";
import { Button } from "../components/Button";
import { ConnectedRail } from "../components/ConnectedRail";
import { Card, SectionTitle } from "../components/primitives";
import { SaveEvalCaseModal } from "../components/SaveEvalCaseModal";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

export interface ActionDashboardProps {
	actionId: string;
	onNavigate?: (href: string) => void;
}

interface ConnectedManifest {
	entity: { kind: string; id: string; projectId: string };
	rawManifest?: EntityManifestExtended;
}

export function ActionDashboard({
	actionId,
	onNavigate,
}: ActionDashboardProps) {
	const api = useApi();
	const [manifest, setManifest] = useState<ConnectedManifest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showEvalModal, setShowEvalModal] = useState(false);

	useEffect(() => {
		setLoading(true);
		setError(null);
		api<ConnectedManifest>(`/connected/action/${encodeURIComponent(actionId)}`)
			.then((data) => setManifest(data))
			.catch((err) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, [api, actionId]);

	if (loading) {
		return (
			<div className="flex h-full bg-sys-bg">
				<div className="flex-1 p-3">
					<StateRow>Loading action details…</StateRow>
				</div>
			</div>
		);
	}

	if (error || !manifest) {
		return (
			<div className="flex h-full bg-sys-bg">
				<div className="flex-1 p-3">
					<StateRow>
						{error ? `Failed to load action: ${error}` : "Action not found."}
					</StateRow>
				</div>
				<ConnectedRail
					entityKind="action"
					entityId={actionId}
					onNavigate={onNavigate}
				/>
			</div>
		);
	}

	const action = manifest.rawManifest?.actions?.find((a) => a.id === actionId);
	const durationMs = action?.durationMs ?? null;
	const totalCostUsd = action?.totalCostUsd ?? null;
	const hasGraph = Boolean(manifest.rawManifest);

	const parsedAttrs = (() => {
		if (!action?.attrsJson) return {};
		try {
			return JSON.parse(action.attrsJson);
		} catch {
			return {};
		}
	})();

	const confidence =
		(action as unknown as Record<string, unknown>)?.confidence ??
		(action as unknown as Record<string, unknown>)?.causalConfidence ??
		parsedAttrs?.confidence ??
		parsedAttrs?.causalConfidence;

	return (
		<div className="flex h-full bg-sys-bg">
			<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
				<header className="flex items-start justify-between gap-3 flex-none">
					<div className="flex items-start gap-3 min-w-0">
						<div className="flex h-12 w-12 flex-none items-center justify-center bg-sys-surface-high text-[1.25rem] font-bold border border-sys-outline/30">
							AC
						</div>
						<div className="min-w-0">
							<div className="flex items-center gap-2 min-w-0">
								<h1 className="font-mono text-[1rem] font-bold tracking-[-0.01em] truncate">
									{action?.name ?? "Action Step"}
								</h1>
								{action?.actionKind && (
									<span className="flex-none border border-sys-primary bg-sys-primary/10 text-sys-primary px-1.5 py-0.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.08em]">
										{action.actionKind}
									</span>
								)}
								<span
									className={`h-2.5 w-2.5 rounded-full ${
										action?.status === "ok" ? "bg-sys-primary" : "bg-sys-error"
									}`}
									title={`Status: ${action?.status ?? "unknown"}`}
								/>
							</div>
							<div className="mt-0.5 font-mono text-[0.75rem] opacity-70 truncate">
								action_id: {actionId}
							</div>
						</div>
					</div>
					<div className="flex items-center gap-2 flex-none">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setShowEvalModal(true)}
						>
							Save as eval case
						</Button>
					</div>
				</header>

				<Card className="flex-none">
					<SectionTitle title="Action Metadata" />
					<dl className="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
						{action?.agentRunId && (
							<>
								<dt className="opacity-60">Agent Run</dt>
								<dd>
									<button
										type="button"
										onClick={() =>
											onNavigate?.(`#/agent-runs/${action.agentRunId}`)
										}
										className="text-sys-primary hover:underline font-bold text-left cursor-pointer"
									>
										{action.agentRunId}
									</button>
								</dd>
							</>
						)}

						<dt className="opacity-60">Status</dt>
						<dd className="font-medium text-sys-on-surface">
							{action?.status?.toUpperCase() ?? "UNKNOWN"}
						</dd>

						{durationMs != null && (
							<>
								<dt className="opacity-60">Duration</dt>
								<dd className="tabular-nums">
									{durationMs < 1000
										? `${durationMs}ms`
										: `${(durationMs / 1000).toFixed(2)}s`}
								</dd>
							</>
						)}

						{action?.modelName && (
							<>
								<dt className="opacity-60">LLM Model</dt>
								<dd>
									{action.modelName} ({action.provider ?? "unknown"})
								</dd>
							</>
						)}

						{action?.promptVersion && (
							<>
								<dt className="opacity-60">Prompt Version</dt>
								<dd>{action.promptVersion}</dd>
							</>
						)}

						{totalCostUsd != null && totalCostUsd > 0 && (
							<>
								<dt className="opacity-60">Total Cost</dt>
								<dd className="tabular-nums">${totalCostUsd.toFixed(4)}</dd>
							</>
						)}

						{action?.traceId ? (
							<>
								<dt className="opacity-60 font-semibold">Telemetry Trace</dt>
								<dd>
									<button
										type="button"
										onClick={() =>
											onNavigate?.(`#/traces?trace=${action.traceId}`)
										}
										className="text-sys-primary hover:underline text-left cursor-pointer truncate max-w-full block font-bold"
										title={action.traceId}
									>
										🔗 {action.traceId}
									</button>
								</dd>
							</>
						) : (
							<>
								<dt className="opacity-60 font-semibold">Telemetry Trace</dt>
								<dd className="text-sys-warning font-semibold font-mono text-[0.75rem]">
									Backend Trace: None linked
								</dd>
							</>
						)}

						{action?.spanId && (
							<>
								<dt className="opacity-60">OTel Span ID</dt>
								<dd>{action.spanId}</dd>
							</>
						)}

						{action?.interactionId ? (
							<>
								<dt className="opacity-60 font-semibold">Interaction ID</dt>
								<dd className="font-mono text-[0.75rem]">
									{action.interactionId}
								</dd>
							</>
						) : (
							<>
								<dt className="opacity-60 font-semibold">Interaction ID</dt>
								<dd className="text-sys-warning font-semibold font-mono text-[0.75rem]">
									No interaction ID (triggered autonomously by background system
									task/cron)
								</dd>
							</>
						)}

						{action?.userId && (
							<>
								<dt className="opacity-60">User ID</dt>
								<dd>{action.userId}</dd>
							</>
						)}

						{confidence && (
							<>
								<dt className="opacity-60 font-semibold">Causal Confidence</dt>
								<dd>
									<span
										className={`px-1.5 py-0.5 text-[0.625rem] font-bold uppercase border rounded-sm ${
											confidence === "explicit"
												? "bg-sys-primary/10 border-sys-primary/20 text-sys-primary"
												: "bg-sys-outline/10 border-sys-outline/20 text-sys-on-surface-muted"
										}`}
									>
										{confidence}
									</span>
								</dd>
							</>
						)}

						{Object.keys(parsedAttrs).length > 0 && (
							<>
								<dt className="opacity-60 mt-1">Attributes</dt>
								<dd className="bg-sys-surface-low border border-sys-outline/30 p-2 mt-1 rounded max-h-[160px] overflow-y-auto">
									<pre className="text-[0.6875rem] leading-tight break-all whitespace-pre-wrap">
										{JSON.stringify(parsedAttrs, null, 2)}
									</pre>
								</dd>
							</>
						)}
					</dl>
				</Card>

				<div className="flex-1 min-h-[400px] flex flex-col min-w-0">
					<div className="flex-none px-3 py-2 bg-sys-surface border-[1px] border-b-0 border-sys-outline text-[0.8125rem] font-semibold text-sys-on-surface">
						Decision and action graph
					</div>
					<div className="flex-1 min-h-0 border-[1px] border-sys-outline overflow-hidden">
						{hasGraph ? (
							<ActionGraphRenderer
								actionId={actionId}
								rawManifest={manifest.rawManifest as EntityManifestExtended}
							/>
						) : (
							<div className="flex h-full items-center justify-center bg-sys-surface p-6 text-center">
								<div className="max-w-md">
									<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
										Graph unavailable
									</div>
									<p className="mt-2 text-[0.875rem] font-semibold text-sys-on-surface">
										No action graph manifest was returned for this action.
									</p>
									<p className="mt-1 text-[0.75rem] text-sys-on-surface-muted">
										The action metadata can still be inspected here, but the
										collector did not provide decision graph nodes for this
										entity.
									</p>
								</div>
							</div>
						)}
					</div>
				</div>
			</div>
			<ConnectedRail
				entityKind="action"
				entityId={actionId}
				onNavigate={onNavigate}
			/>

			{showEvalModal && (
				<SaveEvalCaseModal
					sourceEntityType="action"
					sourceEntityId={actionId}
					sourceAgentRunId={action?.agentRunId ?? undefined}
					sourceActionId={actionId}
					sourceTraceId={action?.traceId ?? undefined}
					sourceSpanId={action?.spanId ?? undefined}
					prefillExpectedOutcome={
						action?.status === "ok"
							? "Status should be OK"
							: "Status should be ERROR"
					}
					onClose={() => setShowEvalModal(false)}
				/>
			)}
		</div>
	);
}
