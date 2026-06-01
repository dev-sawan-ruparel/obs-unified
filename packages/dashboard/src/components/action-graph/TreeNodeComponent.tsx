import { normalizeActionKind } from "./helpers";
import type {
	ArtifactRef,
	EvalResultRef,
	RetrievalEventRef,
	ToolCallRef,
	TreeNode,
} from "./types";

// ── Recursive TreeNode Component ─────────────────────────────────────────────

interface TreeNodeComponentProps {
	node: TreeNode;
	level: number;
	selectedId: string | null;
	onSelect: (node: TreeNode) => void;
	expandedIds: Set<string>;
	onToggleExpand: (id: string) => void;
	toolCalls: ToolCallRef[];
	retrievalEvents: RetrievalEventRef[];
	evalResults: EvalResultRef[];
	artifacts: ArtifactRef[];
}

export function TreeNodeComponent({
	node,
	level,
	selectedId,
	onSelect,
	expandedIds,
	onToggleExpand,
	toolCalls,
	retrievalEvents,
	evalResults,
	artifacts,
}: TreeNodeComponentProps) {
	const action = node.action;
	const isSelected = selectedId === action.id;
	const hasChildren = node.children.length > 0;
	const isExpanded = expandedIds.has(action.id);

	// Filter relations for this specific node
	const nodeTools = toolCalls.filter((t) => t.actionId === action.id);
	const nodeRetrievals = retrievalEvents.filter(
		(r) => r.actionId === action.id,
	);
	const nodeEvals = evalResults.filter((e) => e.actionId === action.id);
	const nodeArtifacts = artifacts.filter((a) => a.actionId === action.id);

	// Styling based on kind
	let kindColor = "border-sys-outline bg-sys-surface text-sys-on-surface";
	let kindBadge =
		"bg-sys-outline/10 text-sys-on-surface/80 border border-sys-outline/30";
	const normalizedKind = normalizeActionKind(action.actionKind);
	if (normalizedKind === "LLM") {
		kindColor = "border-sys-primary/60 bg-sys-primary/5 text-sys-primary";
		kindBadge =
			"bg-sys-primary/10 text-sys-primary border border-sys-primary/20";
	} else if (normalizedKind === "TOOL") {
		kindColor = "border-sys-accent/60 bg-sys-accent/5 text-sys-accent";
		kindBadge = "bg-sys-accent/10 text-sys-accent border border-sys-accent/20";
	} else if (normalizedKind === "RETRIEVER") {
		kindColor = "border-sys-warning/60 bg-sys-warning/5 text-sys-warning";
		kindBadge =
			"bg-sys-warning/10 text-sys-warning border border-sys-warning/20";
	} else if (normalizedKind === "GUARDRAIL") {
		kindColor = "border-sys-error/60 bg-sys-error/5 text-sys-error";
		kindBadge = "bg-sys-error/10 text-sys-error border border-sys-error/20";
	} else if (normalizedKind === "AGENT" || normalizedKind === "CHAIN") {
		kindColor =
			"border-sys-primary/40 bg-sys-surface text-sys-on-surface border-dashed";
		kindBadge = "bg-sys-surface border border-sys-outline";
	}

	const isError = action.status === "error";

	return (
		<div className="flex flex-col select-none relative">
			{/* Timeline vertical stem line connecting to siblings/parents */}
			{level > 0 && (
				<div
					className="absolute border-l border-sys-outline/40"
					style={{
						left: `${level * 24 - 12}px`,
						top: "-12px",
						bottom: hasChildren && isExpanded ? "100%" : "22px",
					}}
				/>
			)}

			<div
				className="flex items-start gap-2 py-1.5 transition-all duration-150 relative"
				style={{ paddingLeft: `${level * 24}px` }}
			>
				{/* Horizontal connector line */}
				{level > 0 && (
					<div
						className="absolute border-t border-sys-outline/40"
						style={{ left: `${level * 24 - 12}px`, top: "18px", width: "12px" }}
					/>
				)}

				{/* Expand/Collapse arrow */}
				<div className="w-5 h-5 flex items-center justify-center flex-none mt-1.5 z-10">
					{hasChildren ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onToggleExpand(action.id);
							}}
							className="text-[0.625rem] opacity-60 hover:opacity-100 hover:bg-sys-surface-low rounded p-0.5 font-bold focus:outline-none"
						>
							{isExpanded ? "▼" : "▶"}
						</button>
					) : (
						<div className="w-1.5 h-1.5 rounded-full bg-sys-outline/50" />
					)}
				</div>

				{/* Main Action Block Card */}
				<button
					type="button"
					onClick={() => onSelect(node)}
					className={`flex-1 flex flex-col text-left p-2.5 border rounded-lg cursor-pointer transition-all duration-150 hover:shadow-md ${
						isSelected
							? "shadow-md border-sys-primary bg-sys-primary/5 ring-[1px] ring-sys-primary"
							: `${kindColor} hover:border-sys-primary/40`
					}`}
				>
					<div className="flex items-center gap-2 flex-wrap">
						<span
							className={`inline-block px-1.5 py-0.5 text-[0.55rem] font-bold uppercase rounded ${kindBadge}`}
						>
							{action.actionKind}
						</span>
						<span className="font-mono font-bold text-[0.75rem] truncate max-w-[28ch] text-sys-on-surface">
							{action.name || "unnamed step"}
						</span>

						{action.modelName && (
							<span className="text-[0.625rem] font-mono opacity-50">
								({action.modelName})
							</span>
						)}

						<div className="flex-1" />

						{/* Quick stats on card */}
						<div className="flex items-center gap-2 text-[0.625rem] font-mono opacity-70">
							{action.durationMs != null && (
								<span>{action.durationMs.toFixed(0)}ms</span>
							)}
							{action.totalCostUsd != null && action.totalCostUsd > 0 && (
								<span className="text-sys-accent font-bold">
									${action.totalCostUsd.toFixed(4)}
								</span>
							)}
							{isError && (
								<span className="px-1.5 py-0.2 bg-sys-error text-sys-on-error text-[0.5rem] font-bold uppercase rounded">
									error
								</span>
							)}
						</div>
					</div>

					{/* Badges for related items */}
					{(nodeTools.length > 0 ||
						nodeRetrievals.length > 0 ||
						nodeEvals.length > 0 ||
						nodeArtifacts.length > 0) && (
						<div className="flex items-center gap-1.5 mt-2 flex-wrap">
							{nodeTools.map((t) => (
								<span
									key={t.id}
									className={`text-[0.55rem] font-mono px-1 py-0.2 rounded border ${
										t.sideEffect
											? "border-sys-accent/40 bg-sys-accent/10 text-sys-accent font-semibold"
											: "border-sys-outline bg-sys-surface-low text-sys-on-surface/80"
									}`}
									title={`${t.toolName} (side effect: ${t.sideEffect ? "YES" : "NO"})`}
								>
									🛠️ {t.toolName}
								</span>
							))}

							{nodeRetrievals.map((r) => (
								<span
									key={r.id}
									className="text-[0.55rem] font-mono px-1 py-0.2 rounded border border-sys-warning/40 bg-sys-warning/10 text-sys-warning"
									title={`${r.retrieverName}: retrieved ${r.totalResults} documents`}
								>
									🔍 {r.retrieverName} ({r.totalResults})
								</span>
							))}

							{nodeEvals.map((e) => (
								<span
									key={e.id}
									className={`text-[0.55rem] font-mono px-1 py-0.2 rounded border ${
										e.passed
											? "border-sys-primary/40 bg-sys-primary/10 text-sys-primary font-bold"
											: "border-sys-error/40 bg-sys-error/10 text-sys-error font-bold"
									}`}
									title={`evaluator: ${e.evaluatorName} (score: ${e.score != null ? e.score.toFixed(2) : "N/A"})`}
								>
									🛡️ {e.evaluatorName}: {e.passed ? "PASS" : "FAIL"}
								</span>
							))}

							{nodeArtifacts.map((a) => (
								<span
									key={a.id}
									className="text-[0.55rem] font-mono px-1 py-0.2 rounded border border-sys-outline bg-sys-surface text-sys-on-surface/80"
									title={`artifact: ${a.artifactName}`}
								>
									📄 {a.artifactName}
								</span>
							))}
						</div>
					)}
				</button>
			</div>

			{/* Child nodes */}
			{hasChildren && isExpanded && (
				<div className="flex flex-col">
					{node.children.map((child) => (
						<TreeNodeComponent
							key={child.action.id}
							node={child}
							level={level + 1}
							selectedId={selectedId}
							onSelect={onSelect}
							expandedIds={expandedIds}
							onToggleExpand={onToggleExpand}
							toolCalls={toolCalls}
							retrievalEvents={retrievalEvents}
							evalResults={evalResults}
							artifacts={artifacts}
						/>
					))}
				</div>
			)}
		</div>
	);
}
