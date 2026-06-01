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

	const actions = manifest.rawManifest?.actions ?? [];
	const toolCalls = manifest.rawManifest?.toolCalls ?? [];
	const retrievalEvents = manifest.rawManifest?.retrievalEvents ?? [];
	const evalResults = manifest.rawManifest?.evalResults ?? [];
	const artifacts = manifest.rawManifest?.artifacts ?? [];

	const llmCallsCount = actions.filter(
		(a) => a.actionKind?.toUpperCase() === "LLM",
	).length;
	const toolCallsCount = toolCalls.length;
	const retrievalsCount = retrievalEvents.length;
	const evalsCount = evalResults.length;
	const artifactsCount = artifacts.length;

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
									{run.agentVersion.startsWith("v")
										? run.agentVersion
										: `v${run.agentVersion}`}
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

				{/* ── Statistics Summary Bar ── */}
				<div className="grid grid-cols-2 md:grid-cols-5 gap-3 flex-none">
					<Card
						className="px-3 py-2 flex flex-col justify-between"
						accent="primary"
					>
						<span className="text-[0.55rem] font-bold uppercase opacity-65">
							LLM Calls
						</span>
						<span className="font-mono text-[1.125rem] font-bold mt-1 text-sys-primary">
							{llmCallsCount}
						</span>
					</Card>
					<Card
						className="px-3 py-2 flex flex-col justify-between"
						accent="accent"
					>
						<span className="text-[0.55rem] font-bold uppercase opacity-65">
							Tool Calls
						</span>
						<span className="font-mono text-[1.125rem] font-bold mt-1 text-sys-accent">
							{toolCallsCount}
						</span>
					</Card>
					<Card
						className="px-3 py-2 flex flex-col justify-between"
						accent="warning"
					>
						<span className="text-[0.55rem] font-bold uppercase opacity-65">
							Retrievals
						</span>
						<span className="font-mono text-[1.125rem] font-bold mt-1 text-sys-warning">
							{retrievalsCount}
						</span>
					</Card>
					<Card
						className="px-3 py-2 flex flex-col justify-between"
						accent={evalStatus === "failed" ? "error" : "default"}
					>
						<span className="text-[0.55rem] font-bold uppercase opacity-65">
							Evaluations
						</span>
						<span
							className={`font-mono text-[1.125rem] font-bold mt-1 ${evalStatus === "failed" ? "text-sys-error" : ""}`}
						>
							{evalsCount}
						</span>
					</Card>
					<Card className="px-3 py-2 flex flex-col justify-between">
						<span className="text-[0.55rem] font-bold uppercase opacity-65">
							Artifacts
						</span>
						<span className="font-mono text-[1.125rem] font-bold mt-1">
							{artifactsCount}
						</span>
					</Card>
				</div>

				{/* ── Two-Column Operational Layout ── */}
				<div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-none">
					{/* Left Column: Context & Metadata */}
					<div className="lg:col-span-5 flex flex-col gap-3">
						{/* Run Summary Card */}
						<Card className="p-3">
							<SectionTitle title="Run Summary" />
							<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
								<dt className="opacity-60 font-semibold">Goal</dt>
								<dd className="break-words font-medium">{run?.goal ?? "—"}</dd>

								<dt className="opacity-60 font-semibold">Outcome</dt>
								<dd className="break-words font-medium">
									{run?.outcome ?? "—"}
								</dd>

								<dt className="opacity-60 font-semibold">Status</dt>
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

								<dt className="opacity-60 font-semibold">Total Cost</dt>
								<dd className="tabular-nums font-bold">
									{totalCostUsd != null ? `$${totalCostUsd.toFixed(4)}` : "—"}
								</dd>

								<dt className="opacity-60 font-semibold">Latency</dt>
								<dd className="tabular-nums font-bold">
									{totalDurationMs != null
										? totalDurationMs < 1000
											? `${totalDurationMs}ms`
											: `${(totalDurationMs / 1000).toFixed(2)}s`
										: "—"}
								</dd>

								{rootAction?.startedAt && (
									<>
										<dt className="opacity-60 font-semibold">Started At</dt>
										<dd>{new Date(rootAction.startedAt).toLocaleString()}</dd>
									</>
								)}
							</dl>
						</Card>

						{/* Trigger / Source Context Card */}
						<Card className="p-3">
							<SectionTitle title="Trigger / Source Context" />
							{(() => {
								const hasInteraction = !!rootAction?.interactionId;
								const triggerAction = rootAction?.causedByActionId
									? actions.find((a) => a.id === rootAction.causedByActionId)
									: null;

								if (!hasInteraction) {
									return (
										<div className="mt-2 p-3 border border-dashed border-sys-outline/30 rounded text-center text-[0.7rem] font-mono italic opacity-70 bg-sys-surface-low/30">
											No user interaction context (triggered autonomously by
											system/background cron)
										</div>
									);
								}

								if (triggerAction) {
									const triggerAttrs = (() => {
										if (!triggerAction.attrsJson) return {};
										try {
											return JSON.parse(triggerAction.attrsJson);
										} catch {
											return {};
										}
									})();

									return (
										<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
											<dt className="opacity-60 font-semibold">Trigger Kind</dt>
											<dd className="font-bold flex items-center gap-1.5">
												<span className="px-1 py-0.2 rounded bg-sys-primary/10 border border-sys-primary/20 text-sys-primary text-[0.625rem] uppercase">
													{triggerAction.actionKind}
												</span>
												{triggerAction.name}
											</dd>

											{triggerAction.actorType && (
												<>
													<dt className="opacity-60 font-semibold">Actor</dt>
													<dd className="capitalize">
														{triggerAction.actorType}{" "}
														{triggerAction.actorId
															? `(${triggerAction.actorId})`
															: ""}
													</dd>
												</>
											)}

											{triggerAttrs.target_element && (
												<>
													<dt className="opacity-60 font-semibold">Element</dt>
													<dd className="bg-sys-surface-low border border-sys-outline/20 px-1 py-0.5 rounded text-[0.6875rem] font-bold text-sys-on-surface break-all">
														{triggerAttrs.target_element}
													</dd>
												</>
											)}

											{triggerAttrs.user_prompt_snippet && (
												<>
													<dt className="opacity-60 font-semibold">
														Prompt Snippet
													</dt>
													<dd className="italic opacity-90 break-words leading-normal">
														"{triggerAttrs.user_prompt_snippet}"
													</dd>
												</>
											)}
										</dl>
									);
								}

								// If we have interactionId but no causal action loaded/present
								return (
									<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
										<dt className="opacity-60 font-semibold">Interaction ID</dt>
										<dd className="font-bold">{rootAction.interactionId}</dd>
										<dt className="opacity-60 font-semibold">Trigger Source</dt>
										<dd className="italic opacity-70">
											Direct Ingress / Context Restored
										</dd>
									</dl>
								);
							})()}
						</Card>

						{/* Telemetry & Connections Card */}
						<Card className="p-3">
							<SectionTitle title="Telemetry & Connections" />
							<dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
								{rootAction?.traceId && (
									<>
										<dt className="opacity-60 font-semibold">
											Telemetry Trace
										</dt>
										<dd>
											<button
												type="button"
												onClick={() =>
													onNavigate?.(`#/traces?trace=${rootAction.traceId}`)
												}
												className="text-sys-primary hover:underline text-left cursor-pointer truncate max-w-full font-bold"
												title={rootAction.traceId}
											>
												🔗 {rootAction.traceId}
											</button>
										</dd>

										<dt className="opacity-60 font-semibold">Search Logs</dt>
										<dd>
											<button
												type="button"
												onClick={() =>
													onNavigate?.(`#/logs?trace=${rootAction.traceId}`)
												}
												className="text-sys-primary hover:underline text-left cursor-pointer font-bold"
											>
												View Trace Logs
											</button>
										</dd>
									</>
								)}

								<dt className="opacity-60 font-semibold">Session Replay</dt>
								<dd>
									{rootAction?.sessionId ? (
										<button
											type="button"
											onClick={() => onNavigate?.(`#/replay`)}
											className="text-sys-primary hover:underline text-left cursor-pointer font-bold"
										>
											🎥 {rootAction.sessionId}
										</button>
									) : (
										<span className="opacity-60 italic text-sys-on-surface-muted">
											No session replay available (replay capture disabled)
										</span>
									)}
								</dd>

								{rootAction?.userId && (
									<>
										<dt className="opacity-60 font-semibold">User Context</dt>
										<dd className="font-bold">{rootAction.userId}</dd>
									</>
								)}
							</dl>
						</Card>
					</div>

					{/* Right Column: Timeline / Chronological steps */}
					<div className="lg:col-span-7">
						<Card className="p-3 h-full flex flex-col min-h-[300px]">
							<SectionTitle
								title="Chronological Execution Steps"
								note="Linear Trace Sequence"
							/>
							<div className="mt-2 flex-1 overflow-y-auto max-h-[380px] pr-1 flex flex-col gap-2">
								{(() => {
									// Filter out trigger action and sort remaining by startedAt
									const steps = actions
										.filter((a) => a.id !== rootAction?.causedByActionId)
										.sort((a, b) => {
											const timeA = new Date(a.startedAt).getTime();
											const timeB = new Date(b.startedAt).getTime();
											if (timeA !== timeB) return timeA - timeB;
											return a.id.localeCompare(b.id);
										});

									if (steps.length === 0) {
										return (
											<div className="flex h-full items-center justify-center text-center p-8 text-[0.75rem] opacity-60 font-mono italic">
												No execution steps recorded.
											</div>
										);
									}

									return steps.map((step) => {
										const isErr = step.status === "error";
										const stepCost = step.totalCostUsd ?? 0;
										const stepDuration = step.durationMs ?? 0;

										// Map colors based on kind
										const stepKind = step.actionKind ?? "";
										let badgeColor =
											"bg-sys-surface border border-sys-outline/30 text-sys-on-surface/80";
										if (stepKind.toUpperCase() === "LLM") {
											badgeColor =
												"bg-sys-primary/10 border border-sys-primary/20 text-sys-primary";
										} else if (stepKind.toUpperCase() === "TOOL") {
											badgeColor =
												"bg-sys-accent/10 border border-sys-accent/20 text-sys-accent";
										} else if (
											stepKind.toUpperCase() === "RETRIEVAL" ||
											stepKind.toUpperCase() === "RETRIEVER"
										) {
											badgeColor =
												"bg-sys-warning/10 border border-sys-warning/20 text-sys-warning";
										} else if (stepKind.toUpperCase() === "GUARDRAIL") {
											badgeColor =
												"bg-sys-error/10 border border-sys-error/20 text-sys-error";
										}

										return (
											<div
												key={step.id}
												className="flex items-start gap-3 p-2 border rounded transition-all duration-150 bg-sys-surface-low/30 hover:bg-sys-surface-low border-sys-outline/20"
											>
												{/* Status dot */}
												<span
													className={`h-2.5 w-2.5 rounded-full flex-none mt-1.5 ${
														isErr
															? "bg-sys-error animate-pulse"
															: "bg-sys-primary"
													}`}
													title={isErr ? "Failed / Error" : "OK"}
												/>

												<div className="flex-1 min-w-0 font-mono text-[0.7rem] flex flex-col gap-0.5">
													<div className="flex items-center gap-2 flex-wrap">
														<span
															className={`px-1.5 py-0.2 rounded text-[0.55rem] font-bold uppercase ${badgeColor}`}
														>
															{step.actionKind}
														</span>
														<span className="font-bold text-sys-on-surface truncate">
															{step.name || "unnamed sequence"}
														</span>
													</div>

													{step.modelName && (
														<div className="text-[0.625rem] opacity-60">
															Model: {step.modelName} (
															{step.provider ?? "unknown"})
														</div>
													)}

													{step.stepId && (
														<div className="text-[0.625rem] opacity-60">
															Step: {step.stepId}
														</div>
													)}
												</div>

												{/* Duration & Cost */}
												<div className="flex-none text-right font-mono text-[0.625rem] opacity-75">
													<div>
														{stepDuration < 1000
															? `${stepDuration.toFixed(0)}ms`
															: `${(stepDuration / 1000).toFixed(2)}s`}
													</div>
													{stepCost > 0 && (
														<div className="text-sys-accent font-bold">
															${stepCost.toFixed(4)}
														</div>
													)}
												</div>
											</div>
										);
									});
								})()}
							</div>
						</Card>
					</div>
				</div>

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
