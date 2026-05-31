import { Card, JsonBlock, SectionTitle } from "../primitives";
import { ApprovalBadge, AutonomyBadge } from "./badges";
import { TreeNodeComponent } from "./TreeNodeComponent";
import type {
	ActionRef,
	AgentRunRef,
	ArtifactRef,
	EvalResultRef,
	RetrievalEventRef,
	ToolCallRef,
	TreeNode,
} from "./types";

interface TreeTabProps {
	actionTree: TreeNode[];
	currentAction: ActionRef | undefined;
	currentActionAttrs: Record<string, unknown>;
	currentTools: ToolCallRef[];
	currentRetrievals: RetrievalEventRef[];
	currentEvals: EvalResultRef[];
	currentArtifacts: ArtifactRef[];
	agentRuns: AgentRunRef[];
	toolCalls: ToolCallRef[];
	retrievalEvents: RetrievalEventRef[];
	evalResults: EvalResultRef[];
	artifacts: ArtifactRef[];
	expandedIds: Set<string>;
	onToggleExpand: (id: string) => void;
	onSelectNode: (node: TreeNode) => void;
}

export function TreeTab({
	actionTree,
	currentAction,
	currentActionAttrs,
	currentTools,
	currentRetrievals,
	currentEvals,
	currentArtifacts,
	agentRuns,
	toolCalls,
	retrievalEvents,
	evalResults,
	artifacts,
	expandedIds,
	onToggleExpand,
	onSelectNode,
}: TreeTabProps) {
	return (
		<div className="h-full flex flex-col md:flex-row min-h-0">
			<div className="flex-1 overflow-y-auto p-4 min-w-0 border-r border-sys-outline/20">
				<div className="mb-4">
					<SectionTitle
						title="Causal Plan Sequence"
						note="Adjacent Decision Chains"
					/>
				</div>

				<div className="flex flex-col gap-1 pb-8">
					{actionTree.map((root) => (
						<TreeNodeComponent
							key={root.action.id}
							node={root}
							level={0}
							selectedId={currentAction?.id || null}
							onSelect={onSelectNode}
							expandedIds={expandedIds}
							onToggleExpand={onToggleExpand}
							toolCalls={toolCalls}
							retrievalEvents={retrievalEvents}
							evalResults={evalResults}
							artifacts={artifacts}
						/>
					))}
					{actionTree.length === 0 && (
						<div className="p-8 text-center text-[0.75rem] opacity-60 font-mono italic">
							No action events recorded under this span ID.
						</div>
					)}
				</div>
			</div>

			<ActionDetailPanel
				action={currentAction}
				actionAttrs={currentActionAttrs}
				agentRuns={agentRuns}
				tools={currentTools}
				retrievals={currentRetrievals}
				evals={currentEvals}
				artifacts={currentArtifacts}
			/>
		</div>
	);
}

interface ActionDetailPanelProps {
	action: ActionRef | undefined;
	actionAttrs: Record<string, unknown>;
	agentRuns: AgentRunRef[];
	tools: ToolCallRef[];
	retrievals: RetrievalEventRef[];
	evals: EvalResultRef[];
	artifacts: ArtifactRef[];
}

function ActionDetailPanel({
	action,
	actionAttrs,
	agentRuns,
	tools,
	retrievals,
	evals,
	artifacts,
}: ActionDetailPanelProps) {
	return (
		<div className="w-full md:w-[380px] lg:w-[440px] flex-none overflow-y-auto bg-sys-surface-low/50 border-t md:border-t-0 p-4 flex flex-col gap-4">
			{action ? (
				<>
					<div>
						<div className="flex items-center gap-2 mb-1.5">
							<span className="text-[0.625rem] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded bg-sys-primary/10 border border-sys-primary/20 text-sys-primary font-bold">
								{action.actionKind}
							</span>
							<span className="text-[0.55rem] font-mono opacity-50">
								ID: {action.id.slice(0, 12)}…
							</span>
						</div>
						<h3 className="font-mono font-bold text-[0.9rem] leading-snug break-all text-sys-on-surface">
							{action.name || "Unnamed Sequence"}
						</h3>
					</div>

					<div className="grid grid-cols-2 gap-2">
						<Card className="px-3 py-2 flex flex-col">
							<span className="text-[0.55rem] font-bold uppercase opacity-65">
								Duration
							</span>
							<span className="font-mono text-[0.875rem] font-bold mt-0.5">
								{action.durationMs !== null
									? `${action.durationMs.toFixed(1)}ms`
									: "In progress"}
							</span>
						</Card>
						<Card className="px-3 py-2 flex flex-col">
							<span className="text-[0.55rem] font-bold uppercase opacity-65">
								Cost
							</span>
							<span className="font-mono text-[0.875rem] font-bold mt-0.5 text-sys-accent">
								$
								{action.totalCostUsd
									? action.totalCostUsd.toFixed(4)
									: "0.0000"}
							</span>
						</Card>
					</div>

					{agentRuns.length > 0 && (
						<div>
							<SectionTitle title="Execution Autonomy Policy" />
							{agentRuns.map((run) => (
								<div
									key={run.id}
									className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5 mt-1"
								>
									<div className="flex items-center justify-between">
										<span className="font-mono font-bold text-[0.7rem] truncate">
											{run.agentName} (v{run.agentVersion})
										</span>
										<AutonomyBadge level={run.autonomyLevel} />
									</div>
									{run.goal && (
										<p className="text-[0.6875rem] font-mono opacity-75 line-clamp-2 italic leading-relaxed">
											Goal: "{run.goal}"
										</p>
									)}
								</div>
							))}
						</div>
					)}

					<EvalList evals={evals} />
					<ToolList tools={tools} />
					<RetrievalList retrievals={retrievals} />
					<ArtifactList artifacts={artifacts} />

					{Object.keys(actionAttrs).length > 0 && (
						<div className="mt-2">
							<JsonBlock
								label="raw trace attributes"
								value={JSON.stringify(actionAttrs, null, 2)}
							/>
						</div>
					)}
				</>
			) : (
				<div className="h-full flex items-center justify-center p-8 text-center text-[0.75rem] opacity-60 font-mono italic">
					Select a causal action node in the tree to audit its step
					dependencies.
				</div>
			)}
		</div>
	);
}

function EvalList({ evals }: { evals: EvalResultRef[] }) {
	if (evals.length === 0) return null;

	return (
		<div>
			<SectionTitle title={`Evaluator Graders (${evals.length})`} />
			<div className="flex flex-col gap-2 mt-1">
				{evals.map((e) => (
					<div
						key={e.id}
						className={`p-2.5 rounded-lg border flex flex-col gap-1.5 ${
							e.passed
								? "border-sys-primary/40 bg-sys-primary/5"
								: "border-sys-error/40 bg-sys-error/5"
						}`}
					>
						<div className="flex items-center justify-between">
							<span className="font-mono font-bold text-[0.7rem]">
								{e.evaluatorName}
							</span>
							<span
								className={`text-[0.55rem] font-bold font-mono px-1.5 py-0.5 rounded border ${
									e.passed
										? "border-sys-primary bg-sys-primary/10 text-sys-primary"
										: "border-sys-error bg-sys-error/10 text-sys-error"
								}`}
							>
								{e.passed ? "PASSED" : "FAILED"}
							</span>
						</div>
						{e.score !== null && (
							<div className="text-[0.625rem] font-mono">
								Score: <span className="font-bold">{e.score.toFixed(2)}</span>
							</div>
						)}
						{e.reasoning && (
							<p className="text-[0.6875rem] font-mono opacity-80 whitespace-pre-wrap leading-relaxed border-t border-sys-outline/20 pt-1">
								{e.reasoning}
							</p>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function ToolList({ tools }: { tools: ToolCallRef[] }) {
	if (tools.length === 0) return null;

	return (
		<div>
			<SectionTitle title={`Tool Invocations (${tools.length})`} />
			<div className="flex flex-col gap-2 mt-1">
				{tools.map((t) => (
					<div
						key={t.id}
						className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5"
					>
						<div className="flex items-center justify-between">
							<span className="font-mono font-bold text-[0.7rem] truncate">
								🛠️ {t.toolName}
							</span>
							<div className="flex items-center gap-1">
								{t.sideEffect === 1 && (
									<span className="text-[0.5rem] font-bold px-1 rounded bg-sys-accent/20 text-sys-accent border border-sys-accent/30 uppercase tracking-[0.05em]">
										mutation
									</span>
								)}
								<ApprovalBadge state={t.approvalState} />
							</div>
						</div>

						<div className="flex flex-col gap-2 pt-1 border-t border-sys-outline/20">
							{t.argsRedacted && (
								<JsonBlock label="arguments" value={t.argsRedacted} />
							)}
							{t.resultRedacted && (
								<JsonBlock label="result / outcome" value={t.resultRedacted} />
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function RetrievalList({ retrievals }: { retrievals: RetrievalEventRef[] }) {
	if (retrievals.length === 0) return null;

	return (
		<div>
			<SectionTitle title={`Vector Retrievals (${retrievals.length})`} />
			<div className="flex flex-col gap-2 mt-1">
				{retrievals.map((r) => (
					<div
						key={r.id}
						className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5"
					>
						<div className="flex items-center justify-between text-[0.7rem] font-mono">
							<span className="font-bold">🔍 {r.retrieverName}</span>
							<span>{r.durationMs ? `${r.durationMs.toFixed(0)}ms` : ""}</span>
						</div>
						<div className="grid grid-cols-2 gap-2 text-[0.625rem] font-mono opacity-85">
							<div>
								Docs Found: <span className="font-bold">{r.totalResults}</span>
							</div>
							{r.maxRelevanceScore !== null && (
								<div>
									Max Score:{" "}
									<span className="font-bold">
										{r.maxRelevanceScore.toFixed(3)}
									</span>
								</div>
							)}
						</div>
						{r.documentsJson && (
							<JsonBlock label="retrieved documents" value={r.documentsJson} />
						)}
					</div>
				))}
			</div>
		</div>
	);
}

function ArtifactList({ artifacts }: { artifacts: ArtifactRef[] }) {
	if (artifacts.length === 0) return null;

	return (
		<div>
			<SectionTitle title={`Generated Artifacts (${artifacts.length})`} />
			<div className="flex flex-col gap-2 mt-1">
				{artifacts.map((a) => (
					<div
						key={a.id}
						className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5"
					>
						<div className="flex items-center justify-between text-[0.7rem] font-mono">
							<span className="font-bold">📄 {a.artifactName}</span>
							<span className="opacity-60">{a.artifactType}</span>
						</div>
						<div className="text-[0.625rem] font-mono opacity-70">
							Size:{" "}
							<span className="font-bold">
								{a.sizeBytes
									? `${(a.sizeBytes / 1024).toFixed(1)} KB`
									: "unknown"}
							</span>
						</div>
						{a.contentPreview && (
							<pre className="text-[0.625rem] font-mono p-1.5 rounded bg-sys-surface-low overflow-x-auto whitespace-pre-wrap max-h-36 opacity-90 border border-sys-outline/10 leading-normal">
								{a.contentPreview}
							</pre>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
