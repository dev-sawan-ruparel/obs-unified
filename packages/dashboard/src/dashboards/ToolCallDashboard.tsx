import { useEffect, useState } from "react";
import type { EntityManifestExtended } from "../components/ActionGraphRenderer";
import { ActionGraphRenderer } from "../components/ActionGraphRenderer";
import { ConnectedRail } from "../components/ConnectedRail";
import { Card, SectionTitle } from "../components/primitives";
import { StateRow } from "../components/states";
import { useApi } from "../use-api";

export interface ToolCallDashboardProps {
	toolCallId: string;
	onNavigate?: (href: string) => void;
}

interface ConnectedManifest {
	entity: { kind: string; id: string; projectId: string };
	rawManifest?: EntityManifestExtended;
}

export function ToolCallDashboard({
	toolCallId,
	onNavigate,
}: ToolCallDashboardProps) {
	const api = useApi();
	const [manifest, setManifest] = useState<ConnectedManifest | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setLoading(true);
		setError(null);
		api<ConnectedManifest>(
			`/connected/tool_call/${encodeURIComponent(toolCallId)}`,
		)
			.then((data) => setManifest(data))
			.catch((err) =>
				setError(err instanceof Error ? err.message : String(err)),
			)
			.finally(() => setLoading(false));
	}, [api, toolCallId]);

	if (loading) {
		return (
			<div className="flex h-full bg-sys-bg">
				<div className="flex-1 p-3">
					<StateRow>Loading tool call details…</StateRow>
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
							? `Failed to load tool call: ${error}`
							: "Tool call not found."}
					</StateRow>
				</div>
				<ConnectedRail
					entityKind="tool_call"
					entityId={toolCallId}
					onNavigate={onNavigate}
				/>
			</div>
		);
	}

	const toolCall = manifest.rawManifest?.toolCalls?.find(
		(t) => t.id === toolCallId,
	);
	const actionId = toolCall?.actionId;
	const causalAction = manifest.rawManifest?.actions?.find(
		(a) => a.id === actionId,
	);

	const approvalBadgeColor: Record<string, string> = {
		suggested: "border-sys-outline bg-sys-outline/10 text-sys-on-surface-muted",
		human_approved:
			"border-sys-primary bg-sys-primary/10 text-sys-primary font-semibold",
		bypassed: "border-sys-accent bg-sys-accent/10 text-sys-accent",
		blocked: "border-sys-error bg-sys-error/10 text-sys-error font-bold",
	};

	return (
		<div className="flex h-full bg-sys-bg">
			<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3 min-h-0">
				<header className="flex items-start gap-3 flex-none">
					<div className="flex h-12 w-12 flex-none items-center justify-center bg-sys-surface-high text-[1.25rem] font-bold border border-sys-outline/30">
						TC
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2 min-w-0">
							<h1 className="font-mono text-[1rem] font-bold tracking-[-0.01em] truncate">
								{toolCall?.toolName ?? "Tool Call"}
							</h1>
							{toolCall?.sideEffect ? (
								<span className="flex-none border border-sys-warning bg-sys-warning/10 text-sys-warning px-1.5 py-0.5 font-mono text-[0.625rem] font-bold uppercase tracking-[0.08em]">
									Side Effect
								</span>
							) : (
								<span className="flex-none border border-sys-outline bg-sys-surface-low text-sys-on-surface-muted px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em]">
									Read-Only
								</span>
							)}
							{toolCall?.approvalState && (
								<span
									className={`flex-none border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.08em] ${
										approvalBadgeColor[toolCall.approvalState] ??
										"border-sys-outline"
									}`}
								>
									{toolCall.approvalState}
								</span>
							)}
						</div>
						<div className="mt-0.5 font-mono text-[0.75rem] opacity-70 truncate">
							tool_call_id: {toolCallId}
						</div>
					</div>
				</header>

				<Card className="flex-none">
					<SectionTitle title="Tool Call Metadata" />
					<dl className="mt-2 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1.5 font-mono text-[0.75rem]">
						<dt className="opacity-60">Tool Name</dt>
						<dd className="font-semibold">{toolCall?.toolName ?? "—"}</dd>

						{actionId && (
							<>
								<dt className="opacity-60">Causal Action</dt>
								<dd>
									<button
										type="button"
										onClick={() => onNavigate?.(`#/actions/${actionId}`)}
										className="text-sys-primary hover:underline font-bold text-left cursor-pointer"
									>
										{causalAction?.name ?? actionId}
									</button>
								</dd>
							</>
						)}

						<dt className="opacity-60">Side Effect</dt>
						<dd>
							{toolCall?.sideEffect
								? "Yes (Mutates External State)"
								: "No (Read-Only)"}
						</dd>

						<dt className="opacity-60">Approval State</dt>
						<dd className="capitalize">{toolCall?.approvalState ?? "—"}</dd>

						{toolCall?.errorType && (
							<>
								<dt className="opacity-60 text-sys-error">Error Type</dt>
								<dd className="text-sys-error font-bold">
									{toolCall.errorType}
								</dd>
							</>
						)}

						<dt className="opacity-60">Arguments Hash</dt>
						<dd
							className="break-all font-mono opacity-80"
							title={toolCall?.argsHash}
						>
							{toolCall?.argsHash ?? "—"}
						</dd>

						<dt className="opacity-60">Result Hash</dt>
						<dd
							className="break-all font-mono opacity-80"
							title={toolCall?.resultHash}
						>
							{toolCall?.resultHash ?? "—"}
						</dd>
					</dl>
				</Card>

				<div className="flex-1 min-h-[400px] flex flex-col min-w-0">
					<div className="flex-none px-3 py-1 bg-sys-surface border-[1px] border-b-0 border-sys-outline font-mono text-[0.75rem] font-bold uppercase tracking-[0.05em] opacity-80">
						Decision & Action Graph Context
					</div>
					<div className="flex-1 min-h-0 border-[1px] border-sys-outline overflow-hidden">
						{manifest.rawManifest && actionId && (
							<ActionGraphRenderer
								actionId={actionId}
								rawManifest={manifest.rawManifest}
							/>
						)}
					</div>
				</div>
			</div>
			<ConnectedRail
				entityKind="tool_call"
				entityId={toolCallId}
				onNavigate={onNavigate}
			/>
		</div>
	);
}
