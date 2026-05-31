import { JsonBlock, SectionTitle } from "../primitives";
import { ApprovalBadge, AutonomyBadge } from "./badges";
import type { ActionRef, AgentRunRef, ToolCallRef } from "./types";

interface GovernanceTabProps {
	actions: ActionRef[];
	agentRuns: AgentRunRef[];
	toolCalls: ToolCallRef[];
}

export function GovernanceTab({
	actions,
	agentRuns,
	toolCalls,
}: GovernanceTabProps) {
	return (
		<div className="h-full overflow-y-auto p-4">
			<div className="mb-4">
				<SectionTitle
					title="Autonomy & Governance Audit Log"
					note="State Mutations & Policy Verification"
				/>
			</div>

			{toolCalls.length > 0 ? (
				<div className="flex flex-col gap-3 pb-8">
					{agentRuns.map((run) => (
						<div
							key={run.id}
							className="p-3.5 rounded-xl border border-sys-outline bg-sys-surface-low/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
						>
							<div className="flex flex-col gap-1">
								<h4 className="font-mono font-bold text-[0.8rem] flex items-center gap-2">
									🤖 Active Autonomy Level:{" "}
									<AutonomyBadge level={run.autonomyLevel} />
								</h4>
								<p className="text-[0.6875rem] font-mono opacity-75 mt-0.5 leading-relaxed">
									Scope: {run.agentName} (v{run.agentVersion}) · Target State: "
									{run.outcome || "running..."}"
								</p>
							</div>
							{run.errorMessage && (
								<div className="px-3 py-1.5 bg-sys-error/10 border border-sys-error/20 text-sys-error text-[0.6875rem] font-mono rounded">
									Fail-safe event: {run.errorMessage}
								</div>
							)}
						</div>
					))}

					<div className="border border-sys-outline rounded-xl overflow-hidden bg-sys-surface">
						<div className="grid grid-cols-12 gap-2 bg-sys-surface-low p-3 font-mono font-bold text-[0.625rem] uppercase tracking-wider border-b border-sys-outline">
							<div className="col-span-3">Tool Invocations</div>
							<div className="col-span-3">Causal Action Node</div>
							<div className="col-span-2">Mutation Status</div>
							<div className="col-span-2">Security Approval</div>
							<div className="col-span-2">Arg/Result Integrity</div>
						</div>

						<div className="flex flex-col divide-y divide-sys-outline/30">
							{toolCalls.map((tool) => (
								<ToolAuditRow
									key={tool.id}
									tool={tool}
									parent={actions.find((a) => a.id === tool.actionId)}
								/>
							))}
						</div>
					</div>
				</div>
			) : (
				<div className="p-12 text-center text-[0.75rem] opacity-60 font-mono italic">
					No tool calls were registered under this causal graph manifest.
				</div>
			)}
		</div>
	);
}

function ToolAuditRow({
	tool,
	parent,
}: {
	tool: ToolCallRef;
	parent: ActionRef | undefined;
}) {
	return (
		<div className="grid grid-cols-12 gap-2 p-3 text-[0.7rem] font-mono items-center hover:bg-sys-surface-low/30">
			<div className="col-span-3 font-bold truncate pr-1">
				🛠️ {tool.toolName}
			</div>
			<div className="col-span-3 truncate text-sys-primary font-bold">
				{parent?.name || "unnamed sequence"}
			</div>
			<div className="col-span-2">
				{tool.sideEffect === 1 ? (
					<span className="inline-block px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase bg-sys-accent/20 text-sys-accent border border-sys-accent/30 tracking-wider">
						MUTATES STATE
					</span>
				) : (
					<span className="inline-block px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase bg-sys-surface-low text-sys-on-surface/50 border border-sys-outline/30">
						READ ONLY
					</span>
				)}
			</div>
			<div className="col-span-2">
				<ApprovalBadge state={tool.approvalState} />
			</div>
			<div className="col-span-2 flex flex-col gap-0.5 text-[0.55rem] opacity-75">
				<div className="truncate">Args: {tool.argsHash.slice(0, 8)}…</div>
				<div className="truncate">Out: {tool.resultHash.slice(0, 8)}…</div>
			</div>

			<div className="col-span-12 mt-2 pt-2 border-t border-sys-outline/10 flex flex-col md:flex-row gap-4">
				{tool.argsRedacted && (
					<div className="flex-1 min-w-0">
						<JsonBlock label="arguments verified" value={tool.argsRedacted} />
					</div>
				)}
				{tool.resultRedacted && (
					<div className="flex-1 min-w-0">
						<JsonBlock
							label="mutation outcome verified"
							value={tool.resultRedacted}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
