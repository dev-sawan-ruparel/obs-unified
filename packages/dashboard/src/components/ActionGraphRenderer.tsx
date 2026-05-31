import { useMemo, useState } from "react";
import { ApprovalBadge, AutonomyBadge } from "./action-graph/badges";
import { buildActionTree, computeDiff } from "./action-graph/helpers";
import { TreeNodeComponent } from "./action-graph/TreeNodeComponent";
import type {
	ActionGraphRendererProps,
	ActionRef,
	TreeNode,
} from "./action-graph/types";
import { Card, JsonBlock, SectionTitle } from "./primitives";

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
	const [activeTab, setActiveTab] = useState<"tree" | "governance" | "diff">(
		"tree",
	);
	const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
		// Expand all nodes by default for a clean visual path
		return new Set(rawManifest?.actions.map((a) => a.id) ?? []);
	});

	// A/B Prompt diff selectors
	const [diffLeftId, setDiffLeftId] = useState<string>("");
	const [diffRightId, setDiffRightId] = useState<string>("");

	const actions = rawManifest?.actions ?? [];
	const toolCalls = rawManifest?.toolCalls ?? [];
	const retrievalEvents = rawManifest?.retrievalEvents ?? [];
	const evalResults = rawManifest?.evalResults ?? [];
	const artifacts = rawManifest?.artifacts ?? [];
	const agentRuns = rawManifest?.agentRuns ?? [];

	const actionTree = useMemo(() => buildActionTree(actions), [actions]);

	// Auto-select selected trace's corresponding node if loaded
	useMemo(() => {
		if (actions.length > 0 && !selectedNode) {
			const targetAction = actions.find((a) => a.id === actionId) || actions[0];
			if (targetAction) {
				setSelectedNode({ action: targetAction, children: [] });
			}
		}
	}, [actions, actionId, selectedNode]);

	// Pre-fill diff drop-downs with LLM nodes
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

	const toggleExpand = (id: string) => {
		const next = new Set(expandedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		setExpandedIds(next);
	};

	// Detail attributes of currently selected tree node
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

	// Parse attributes from string safely
	const currentActionAttrs = useMemo(() => {
		if (!currentAction?.attrsJson) return {};
		try {
			return JSON.parse(currentAction.attrsJson);
		} catch {
			return {};
		}
	}, [currentAction]);

	return (
		<div className="flex flex-col h-full bg-sys-surface font-sans text-sys-on-surface">
			{/* Tab Strip Header */}
			<div className="flex-none flex items-center border-b border-sys-outline/30 bg-sys-surface/80 backdrop-blur-md sticky top-0 z-20 px-3">
				<button
					type="button"
					onClick={() => setActiveTab("tree")}
					className={`px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase border-b-2 transition-all cursor-pointer ${
						activeTab === "tree"
							? "border-sys-primary text-sys-primary"
							: "border-transparent text-sys-on-surface/60 hover:text-sys-on-surface hover:bg-sys-surface-low"
					}`}
				>
					🌳 Causal Action Tree
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("governance")}
					className={`px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase border-b-2 transition-all cursor-pointer ${
						activeTab === "governance"
							? "border-sys-primary text-sys-primary"
							: "border-transparent text-sys-on-surface/60 hover:text-sys-on-surface hover:bg-sys-surface-low"
					}`}
				>
					🛡️ Governance & Auditing
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("diff")}
					className={`px-4 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase border-b-2 transition-all cursor-pointer ${
						activeTab === "diff"
							? "border-sys-primary text-sys-primary"
							: "border-transparent text-sys-on-surface/60 hover:text-sys-on-surface hover:bg-sys-surface-low"
					}`}
				>
					📊 Prompt Diff & Evals
				</button>
			</div>

			{/* Content Area */}
			<div className="flex-1 min-h-0 overflow-hidden">
				{activeTab === "tree" && (
					<div className="h-full flex flex-col md:flex-row min-h-0">
						{/* Causal Tree Scroll Area */}
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
										onSelect={setSelectedNode}
										expandedIds={expandedIds}
										onToggleExpand={toggleExpand}
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

						{/* Node Detail Side-panel (Responsive, takes half screen width on desktop) */}
						<div className="w-full md:w-[380px] lg:w-[440px] flex-none overflow-y-auto bg-sys-surface-low/50 border-t md:border-t-0 p-4 flex flex-col gap-4">
							{currentAction ? (
								<>
									<div>
										<div className="flex items-center gap-2 mb-1.5">
											<span className="text-[0.625rem] font-mono tracking-widest uppercase px-1.5 py-0.5 rounded bg-sys-primary/10 border border-sys-primary/20 text-sys-primary font-bold">
												{currentAction.actionKind}
											</span>
											<span className="text-[0.55rem] font-mono opacity-50">
												ID: {currentAction.id.slice(0, 12)}…
											</span>
										</div>
										<h3 className="font-mono font-bold text-[0.9rem] leading-snug break-all text-sys-on-surface">
											{currentAction.name || "Unnamed Sequence"}
										</h3>
									</div>

									{/* Quick Metrics */}
									<div className="grid grid-cols-2 gap-2">
										<Card className="px-3 py-2 flex flex-col">
											<span className="text-[0.55rem] font-bold uppercase opacity-65">
												Duration
											</span>
											<span className="font-mono text-[0.875rem] font-bold mt-0.5">
												{currentAction.durationMs !== null
													? `${currentAction.durationMs.toFixed(1)}ms`
													: "In progress"}
											</span>
										</Card>
										<Card className="px-3 py-2 flex flex-col">
											<span className="text-[0.55rem] font-bold uppercase opacity-65">
												Cost
											</span>
											<span className="font-mono text-[0.875rem] font-bold mt-0.5 text-sys-accent">
												$
												{currentAction.totalCostUsd
													? currentAction.totalCostUsd.toFixed(4)
													: "0.0000"}
											</span>
										</Card>
									</div>

									{/* Autonomy Run Policy Header */}
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

									{/* Evals Grader Results */}
									{currentEvals.length > 0 && (
										<div>
											<SectionTitle
												title={`Evaluator Graders (${currentEvals.length})`}
											/>
											<div className="flex flex-col gap-2 mt-1">
												{currentEvals.map((e) => (
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
																Score:{" "}
																<span className="font-bold">
																	{e.score.toFixed(2)}
																</span>
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
									)}

									{/* Mutating Tool Calls Details */}
									{currentTools.length > 0 && (
										<div>
											<SectionTitle
												title={`Tool Invocations (${currentTools.length})`}
											/>
											<div className="flex flex-col gap-2 mt-1">
												{currentTools.map((t) => (
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
																<JsonBlock
																	label="arguments"
																	value={t.argsRedacted}
																/>
															)}
															{t.resultRedacted && (
																<JsonBlock
																	label="result / outcome"
																	value={t.resultRedacted}
																/>
															)}
														</div>
													</div>
												))}
											</div>
										</div>
									)}

									{/* Vector Search Retrievals */}
									{currentRetrievals.length > 0 && (
										<div>
											<SectionTitle
												title={`Vector Retrievals (${currentRetrievals.length})`}
											/>
											<div className="flex flex-col gap-2 mt-1">
												{currentRetrievals.map((r) => (
													<div
														key={r.id}
														className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5"
													>
														<div className="flex items-center justify-between text-[0.7rem] font-mono">
															<span className="font-bold">
																🔍 {r.retrieverName}
															</span>
															<span>
																{r.durationMs
																	? `${r.durationMs.toFixed(0)}ms`
																	: ""}
															</span>
														</div>
														<div className="grid grid-cols-2 gap-2 text-[0.625rem] font-mono opacity-85">
															<div>
																Docs Found:{" "}
																<span className="font-bold">
																	{r.totalResults}
																</span>
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
															<JsonBlock
																label="retrieved documents"
																value={r.documentsJson}
															/>
														)}
													</div>
												))}
											</div>
										</div>
									)}

									{/* Plan Artifacts */}
									{currentArtifacts.length > 0 && (
										<div>
											<SectionTitle
												title={`Generated Artifacts (${currentArtifacts.length})`}
											/>
											<div className="flex flex-col gap-2 mt-1">
												{currentArtifacts.map((a) => (
													<div
														key={a.id}
														className="p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface flex flex-col gap-1.5"
													>
														<div className="flex items-center justify-between text-[0.7rem] font-mono">
															<span className="font-bold">
																📄 {a.artifactName}
															</span>
															<span className="opacity-60">
																{a.artifactType}
															</span>
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
									)}

									{/* All action attributes */}
									{Object.keys(currentActionAttrs).length > 0 && (
										<div className="mt-2">
											<JsonBlock
												label="raw trace attributes"
												value={JSON.stringify(currentActionAttrs, null, 2)}
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
					</div>
				)}

				{activeTab === "governance" && (
					<div className="h-full overflow-y-auto p-4">
						<div className="mb-4">
							<SectionTitle
								title="Autonomy & Governance Audit Log"
								note="State Mutations & Policy Verification"
							/>
						</div>

						{toolCalls.length > 0 ? (
							<div className="flex flex-col gap-3 pb-8">
								{/* Top Policy Banner */}
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
												Scope: {run.agentName} (v{run.agentVersion}) · Target
												State: "{run.outcome || "running..."}"
											</p>
										</div>
										{run.errorMessage && (
											<div className="px-3 py-1.5 bg-sys-error/10 border border-sys-error/20 text-sys-error text-[0.6875rem] font-mono rounded">
												Fail-safe event: {run.errorMessage}
											</div>
										)}
									</div>
								))}

								{/* Mutating Tool Calls Grid */}
								<div className="border border-sys-outline rounded-xl overflow-hidden bg-sys-surface">
									<div className="grid grid-cols-12 gap-2 bg-sys-surface-low p-3 font-mono font-bold text-[0.625rem] uppercase tracking-wider border-b border-sys-outline">
										<div className="col-span-3">Tool Invocations</div>
										<div className="col-span-3">Causal Action Node</div>
										<div className="col-span-2">Mutation Status</div>
										<div className="col-span-2">Security Approval</div>
										<div className="col-span-2">Arg/Result Integrity</div>
									</div>

									<div className="flex flex-col divide-y divide-sys-outline/30">
										{toolCalls.map((t) => {
											const parent = actions.find((a) => a.id === t.actionId);
											return (
												<div
													key={t.id}
													className="grid grid-cols-12 gap-2 p-3 text-[0.7rem] font-mono items-center hover:bg-sys-surface-low/30"
												>
													<div className="col-span-3 font-bold truncate pr-1">
														🛠️ {t.toolName}
													</div>
													<div className="col-span-3 truncate text-sys-primary font-bold">
														{parent?.name || "unnamed sequence"}
													</div>
													<div className="col-span-2">
														{t.sideEffect === 1 ? (
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
														<ApprovalBadge state={t.approvalState} />
													</div>
													<div className="col-span-2 flex flex-col gap-0.5 text-[0.55rem] opacity-75">
														<div className="truncate">
															Args: {t.argsHash.slice(0, 8)}…
														</div>
														<div className="truncate">
															Out: {t.resultHash.slice(0, 8)}…
														</div>
													</div>

													{/* Inline redacted inspector */}
													<div className="col-span-12 mt-2 pt-2 border-t border-sys-outline/10 flex flex-col md:flex-row gap-4">
														{t.argsRedacted && (
															<div className="flex-1 min-w-0">
																<JsonBlock
																	label="arguments verified"
																	value={t.argsRedacted}
																/>
															</div>
														)}
														{t.resultRedacted && (
															<div className="flex-1 min-w-0">
																<JsonBlock
																	label="mutation outcome verified"
																	value={t.resultRedacted}
																/>
															</div>
														)}
													</div>
												</div>
											);
										})}
									</div>
								</div>
							</div>
						) : (
							<div className="p-12 text-center text-[0.75rem] opacity-60 font-mono italic">
								No tool calls were registered under this causal graph manifest.
							</div>
						)}
					</div>
				)}

				{activeTab === "diff" && (
					<div className="h-full flex flex-col md:flex-row min-h-0">
						{/* A/B Diff Controllers Side Rail */}
						<div className="w-full md:w-[280px] lg:w-[320px] flex-none overflow-y-auto p-4 border-r border-sys-outline/20 bg-sys-surface-low/40 flex flex-col gap-4">
							<SectionTitle title="Compare Prompt Versions" />

							<div className="flex flex-col gap-3">
								<div className="flex flex-col gap-1">
									<label
										htmlFor="action-diff-left"
										className="text-[0.625rem] font-bold uppercase opacity-75"
									>
										Baseline Version A:
									</label>
									<select
										id="action-diff-left"
										value={diffLeftId}
										onChange={(e) => setDiffLeftId(e.target.value)}
										className="w-full p-2 text-[0.7rem] font-mono bg-sys-surface border border-sys-outline focus:outline-none rounded focus:border-sys-primary"
									>
										{llmActions.map((a) => (
											<option key={a.id} value={a.id}>
												{a.name || "LLM call"} (
												{a.promptVersion ? `v${a.promptVersion}` : "v1"})
											</option>
										))}
										{llmActions.length === 0 && (
											<option value="">No LLM actions found</option>
										)}
									</select>
								</div>

								<div className="flex flex-col gap-1">
									<label
										htmlFor="action-diff-right"
										className="text-[0.625rem] font-bold uppercase opacity-75"
									>
										Target Version B:
									</label>
									<select
										id="action-diff-right"
										value={diffRightId}
										onChange={(e) => setDiffRightId(e.target.value)}
										className="w-full p-2 text-[0.7rem] font-mono bg-sys-surface border border-sys-outline focus:outline-none rounded focus:border-sys-primary"
									>
										{llmActions.map((a) => (
											<option key={a.id} value={a.id}>
												{a.name || "LLM call"} (
												{a.promptVersion ? `v${a.promptVersion}` : "v1"})
											</option>
										))}
										{llmActions.length === 0 && (
											<option value="">No LLM actions found</option>
										)}
									</select>
								</div>
							</div>

							<div className="mt-2 flex flex-col gap-2">
								<SectionTitle title="Comparative Cost & Latency" />
								{(() => {
									const leftNode = actions.find((a) => a.id === diffLeftId);
									const rightNode = actions.find((a) => a.id === diffRightId);

									if (!leftNode || !rightNode) return null;

									const costDiff =
										(rightNode.totalCostUsd || 0) -
										(leftNode.totalCostUsd || 0);
									const latDiff =
										(rightNode.durationMs || 0) - (leftNode.durationMs || 0);

									return (
										<div className="flex flex-col gap-2 text-[0.6875rem] font-mono p-2.5 rounded-lg border border-sys-outline/30 bg-sys-surface">
											<div className="flex justify-between border-b border-sys-outline/10 pb-1.5">
												<span className="font-bold">Delta Cost:</span>
												<span
													className={
														costDiff > 0
															? "text-sys-error"
															: costDiff < 0
																? "text-sys-primary"
																: ""
													}
												>
													{costDiff > 0 ? "+" : ""}${costDiff.toFixed(4)}
												</span>
											</div>
											<div className="flex justify-between">
												<span className="font-bold">Delta Latency:</span>
												<span
													className={
														latDiff > 0
															? "text-sys-error"
															: latDiff < 0
																? "text-sys-primary"
																: ""
													}
												>
													{latDiff > 0 ? "+" : ""}
													{latDiff.toFixed(1)}ms
												</span>
											</div>
										</div>
									);
								})()}
							</div>

							{/* Evaluations comparison list */}
							<div className="mt-2 flex flex-col gap-2">
								<SectionTitle title="Safety Grader Delta" />
								{(() => {
									const leftEvals = evalResults.filter(
										(e) => e.actionId === diffLeftId,
									);
									const rightEvals = evalResults.filter(
										(e) => e.actionId === diffRightId,
									);

									if (leftEvals.length === 0 && rightEvals.length === 0) {
										return (
											<span className="text-[0.625rem] font-mono opacity-50 italic">
												No live eval grader scores recorded on selected prompt
												nodes.
											</span>
										);
									}

									return (
										<div className="flex flex-col gap-2">
											{leftEvals.map((le) => {
												const re = rightEvals.find(
													(r) => r.evaluatorName === le.evaluatorName,
												);
												return (
													<div
														key={le.id}
														className="p-2 rounded border border-sys-outline/30 bg-sys-surface flex flex-col gap-1 text-[0.625rem] font-mono"
													>
														<div className="font-bold">{le.evaluatorName}</div>
														<div className="flex items-center justify-between text-[0.55rem] mt-0.5">
															<span>
																A: {le.passed ? "✅ PASS" : "❌ FAIL"}
															</span>
															<span>
																B:{" "}
																{re
																	? re.passed
																		? "✅ PASS"
																		: "❌ FAIL"
																	: "N/A"}
															</span>
														</div>
													</div>
												);
											})}
										</div>
									);
								})()}
							</div>
						</div>

						{/* Comparative A/B Diff Inspector */}
						<div className="flex-1 overflow-y-auto p-4 min-h-0 flex flex-col gap-4">
							<div className="flex-none flex items-center justify-between">
								<SectionTitle title="Side-by-Side Prompt Diff" />
								<span className="text-[0.55rem] font-mono opacity-50 uppercase">
									template changes highlighted in green (added) and red
									(removed)
								</span>
							</div>

							{(() => {
								const left = actions.find((a) => a.id === diffLeftId);
								const right = actions.find((a) => a.id === diffRightId);

								if (!left || !right) {
									return (
										<div className="flex-1 flex items-center justify-center text-[0.75rem] opacity-60 font-mono italic">
											Select LLM nodes to load prompt versions for comparative
											analysis.
										</div>
									);
								}

								// Read JSON template contents if available
								const getPromptText = (a: ActionRef) => {
									if (!a.attrsJson) return "No attributes recorded.";
									try {
										const parsed = JSON.parse(a.attrsJson);
										// Return standard prompt, input text or full system instruction
										return (
											parsed["llm.prompt"] ||
											parsed.input ||
											parsed.prompt ||
											a.attrsJson
										);
									} catch {
										return a.attrsJson;
									}
								};

								const diffSegments = computeDiff(
									getPromptText(left),
									getPromptText(right),
								);

								return (
									<div className="flex-1 border border-sys-outline rounded-xl bg-sys-surface-low overflow-hidden flex flex-col min-h-[300px]">
										{/* Top Info Bar */}
										<div className="grid grid-cols-2 text-[0.625rem] font-mono font-bold uppercase bg-sys-surface border-b border-sys-outline p-2 divide-x divide-sys-outline/35">
											<div className="pl-1 truncate">
												Prompt Version A: {left.name} (v
												{left.promptVersion || "1"})
											</div>
											<div className="pl-3 truncate">
												Prompt Version B: {right.name} (v
												{right.promptVersion || "1"})
											</div>
										</div>

										{/* Diff Content Scroll Area */}
										<div className="flex-1 overflow-y-auto p-3 font-mono text-[0.6875rem] leading-relaxed flex flex-col bg-sys-bg select-text">
											{diffSegments.map((segment, index) => {
												const segmentKey = `${segment.type}-${segment.value}-${index}`;
												if (segment.type === "added") {
													return (
														<div
															key={segmentKey}
															className="bg-sys-primary/15 text-sys-primary border-l-[3px] border-sys-primary/80 pl-2 pr-1 py-0.5"
														>
															+ {segment.value}
														</div>
													);
												}
												if (segment.type === "removed") {
													return (
														<div
															key={segmentKey}
															className="bg-sys-error/15 text-sys-error border-l-[3px] border-sys-error/80 pl-2 pr-1 py-0.5 line-through"
														>
															- {segment.value}
														</div>
													);
												}
												return (
													<div
														key={segmentKey}
														className="pl-3 pr-1 py-0.5 opacity-85"
													>
														&nbsp; {segment.value}
													</div>
												);
											})}
										</div>
									</div>
								);
							})()}
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
