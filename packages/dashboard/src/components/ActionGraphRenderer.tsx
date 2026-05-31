import { useMemo, useState } from "react";
import { ActionGraphTabHeader } from "./action-graph/ActionGraphTabHeader";
import { DiffTab } from "./action-graph/DiffTab";
import { GovernanceTab } from "./action-graph/GovernanceTab";
import { buildActionTree } from "./action-graph/helpers";
import { TreeTab } from "./action-graph/TreeTab";
import type {
	ActionGraphRendererProps,
	ActiveActionGraphTab,
	TreeNode,
} from "./action-graph/types";

export type {
	ActionGraphRendererProps,
	ActionRef,
	AgentRunRef,
	ArtifactRef,
	EntityManifestExtended,
	EvalResultRef,
	RetrievalEventRef,
	ToolCallRef,
} from "./action-graph/types";

export function ActionGraphRenderer({
	actionId,
	rawManifest,
}: ActionGraphRendererProps) {
	const [activeTab, setActiveTab] = useState<ActiveActionGraphTab>("tree");
	const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
		return new Set(rawManifest?.actions.map((a) => a.id) ?? []);
	});
	const [diffLeftId, setDiffLeftId] = useState<string>("");
	const [diffRightId, setDiffRightId] = useState<string>("");

	const actions = rawManifest?.actions ?? [];
	const toolCalls = rawManifest?.toolCalls ?? [];
	const retrievalEvents = rawManifest?.retrievalEvents ?? [];
	const evalResults = rawManifest?.evalResults ?? [];
	const artifacts = rawManifest?.artifacts ?? [];
	const agentRuns = rawManifest?.agentRuns ?? [];

	const actionTree = useMemo(() => buildActionTree(actions), [actions]);

	useMemo(() => {
		if (actions.length > 0 && !selectedNode) {
			const targetAction = actions.find((a) => a.id === actionId) || actions[0];
			if (targetAction) {
				setSelectedNode({ action: targetAction, children: [] });
			}
		}
	}, [actions, actionId, selectedNode]);

	const llmActions = useMemo(() => {
		return actions.filter((a) => a.actionKind.toUpperCase() === "LLM");
	}, [actions]);

	useMemo(() => {
		if (llmActions.length > 0) {
			if (!diffLeftId) setDiffLeftId(llmActions[0].id);
			if (!diffRightId && llmActions.length > 1) {
				setDiffRightId(llmActions[1].id);
			} else if (!diffRightId) {
				setDiffRightId(llmActions[0].id);
			}
		}
	}, [llmActions, diffLeftId, diffRightId]);

	const currentAction = selectedNode?.action;
	const currentTools = currentAction
		? toolCalls.filter((t) => t.actionId === currentAction.id)
		: [];
	const currentRetrievals = currentAction
		? retrievalEvents.filter((r) => r.actionId === currentAction.id)
		: [];
	const currentEvals = currentAction
		? evalResults.filter((e) => e.actionId === currentAction.id)
		: [];
	const currentArtifacts = currentAction
		? artifacts.filter((a) => a.actionId === currentAction.id)
		: [];
	const currentActionAttrs = useMemo(() => {
		if (!currentAction?.attrsJson) return {};
		try {
			return JSON.parse(currentAction.attrsJson);
		} catch {
			return {};
		}
	}, [currentAction]);

	const toggleExpand = (id: string) => {
		const next = new Set(expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		setExpandedIds(next);
	};

	return (
		<div className="flex flex-col h-full bg-sys-surface font-sans text-sys-on-surface">
			<ActionGraphTabHeader activeTab={activeTab} onTabChange={setActiveTab} />
			<div className="flex-1 min-h-0 overflow-hidden">
				{activeTab === "tree" && (
					<TreeTab
						actionTree={actionTree}
						currentAction={currentAction}
						currentActionAttrs={currentActionAttrs}
						currentTools={currentTools}
						currentRetrievals={currentRetrievals}
						currentEvals={currentEvals}
						currentArtifacts={currentArtifacts}
						agentRuns={agentRuns}
						toolCalls={toolCalls}
						retrievalEvents={retrievalEvents}
						evalResults={evalResults}
						artifacts={artifacts}
						expandedIds={expandedIds}
						onToggleExpand={toggleExpand}
						onSelectNode={setSelectedNode}
					/>
				)}
				{activeTab === "governance" && (
					<GovernanceTab
						actions={actions}
						agentRuns={agentRuns}
						toolCalls={toolCalls}
					/>
				)}
				{activeTab === "diff" && (
					<DiffTab
						actions={actions}
						evalResults={evalResults}
						llmActions={llmActions}
						diffLeftId={diffLeftId}
						diffRightId={diffRightId}
						onDiffLeftChange={setDiffLeftId}
						onDiffRightChange={setDiffRightId}
					/>
				)}
			</div>
		</div>
	);
}
