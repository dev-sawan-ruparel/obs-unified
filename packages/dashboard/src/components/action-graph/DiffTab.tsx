import { SectionTitle } from "../primitives";
import { computeDiff } from "./helpers";
import type { ActionRef, EvalResultRef } from "./types";

interface DiffTabProps {
	actions: ActionRef[];
	evalResults: EvalResultRef[];
	llmActions: ActionRef[];
	diffLeftId: string;
	diffRightId: string;
	onDiffLeftChange: (id: string) => void;
	onDiffRightChange: (id: string) => void;
}

export function DiffTab({
	actions,
	evalResults,
	llmActions,
	diffLeftId,
	diffRightId,
	onDiffLeftChange,
	onDiffRightChange,
}: DiffTabProps) {
	return (
		<div className="h-full flex flex-col md:flex-row min-h-0">
			<div className="w-full md:w-[280px] lg:w-[320px] flex-none overflow-y-auto p-4 border-r border-sys-outline/20 bg-sys-surface-low/40 flex flex-col gap-4">
				<SectionTitle title="Compare Prompt Versions" />

				<PromptSelectors
					llmActions={llmActions}
					diffLeftId={diffLeftId}
					diffRightId={diffRightId}
					onDiffLeftChange={onDiffLeftChange}
					onDiffRightChange={onDiffRightChange}
				/>

				<CostLatencyDelta
					left={actions.find((a) => a.id === diffLeftId)}
					right={actions.find((a) => a.id === diffRightId)}
				/>

				<EvalDelta
					leftEvals={evalResults.filter((e) => e.actionId === diffLeftId)}
					rightEvals={evalResults.filter((e) => e.actionId === diffRightId)}
				/>
			</div>

			<PromptDiffInspector
				left={actions.find((a) => a.id === diffLeftId)}
				right={actions.find((a) => a.id === diffRightId)}
			/>
		</div>
	);
}

function PromptSelectors({
	llmActions,
	diffLeftId,
	diffRightId,
	onDiffLeftChange,
	onDiffRightChange,
}: {
	llmActions: ActionRef[];
	diffLeftId: string;
	diffRightId: string;
	onDiffLeftChange: (id: string) => void;
	onDiffRightChange: (id: string) => void;
}) {
	return (
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
					onChange={(e) => onDiffLeftChange(e.target.value)}
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
					onChange={(e) => onDiffRightChange(e.target.value)}
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
	);
}

function CostLatencyDelta({
	left,
	right,
}: {
	left: ActionRef | undefined;
	right: ActionRef | undefined;
}) {
	if (!left || !right) return null;

	const costDiff = (right.totalCostUsd || 0) - (left.totalCostUsd || 0);
	const latDiff = (right.durationMs || 0) - (left.durationMs || 0);

	return (
		<div className="mt-2 flex flex-col gap-2">
			<SectionTitle title="Comparative Cost & Latency" />
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
		</div>
	);
}

function EvalDelta({
	leftEvals,
	rightEvals,
}: {
	leftEvals: EvalResultRef[];
	rightEvals: EvalResultRef[];
}) {
	return (
		<div className="mt-2 flex flex-col gap-2">
			<SectionTitle title="Safety Grader Delta" />
			{leftEvals.length === 0 && rightEvals.length === 0 ? (
				<span className="text-[0.625rem] font-mono opacity-50 italic">
					No live eval grader scores recorded on selected prompt nodes.
				</span>
			) : (
				<div className="flex flex-col gap-2">
					{leftEvals.map((leftEval) => {
						const rightEval = rightEvals.find(
							(r) => r.evaluatorName === leftEval.evaluatorName,
						);
						return (
							<div
								key={leftEval.id}
								className="p-2 rounded border border-sys-outline/30 bg-sys-surface flex flex-col gap-1 text-[0.625rem] font-mono"
							>
								<div className="font-bold">{leftEval.evaluatorName}</div>
								<div className="flex items-center justify-between text-[0.55rem] mt-0.5">
									<span>A: {leftEval.passed ? "✅ PASS" : "❌ FAIL"}</span>
									<span>
										B:{" "}
										{rightEval
											? rightEval.passed
												? "✅ PASS"
												: "❌ FAIL"
											: "N/A"}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

function PromptDiffInspector({
	left,
	right,
}: {
	left: ActionRef | undefined;
	right: ActionRef | undefined;
}) {
	return (
		<div className="flex-1 overflow-y-auto p-4 min-h-0 flex flex-col gap-4">
			<div className="flex-none flex items-center justify-between">
				<SectionTitle title="Side-by-Side Prompt Diff" />
				<span className="text-[0.55rem] font-mono opacity-50 uppercase">
					template changes highlighted in green (added) and red (removed)
				</span>
			</div>

			{!left || !right ? (
				<div className="flex-1 flex items-center justify-center text-[0.75rem] opacity-60 font-mono italic">
					Select LLM nodes to load prompt versions for comparative analysis.
				</div>
			) : (
				<PromptDiff left={left} right={right} />
			)}
		</div>
	);
}

function PromptDiff({ left, right }: { left: ActionRef; right: ActionRef }) {
	const diffSegments = computeDiff(getPromptText(left), getPromptText(right));

	return (
		<div className="flex-1 border border-sys-outline rounded-xl bg-sys-surface-low overflow-hidden flex flex-col min-h-[300px]">
			<div className="grid grid-cols-2 text-[0.625rem] font-mono font-bold uppercase bg-sys-surface border-b border-sys-outline p-2 divide-x divide-sys-outline/35">
				<div className="pl-1 truncate">
					Prompt Version A: {left.name} (v{left.promptVersion || "1"})
				</div>
				<div className="pl-3 truncate">
					Prompt Version B: {right.name} (v{right.promptVersion || "1"})
				</div>
			</div>

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
						<div key={segmentKey} className="pl-3 pr-1 py-0.5 opacity-85">
							&nbsp; {segment.value}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function getPromptText(action: ActionRef) {
	if (!action.attrsJson) return "No attributes recorded.";
	try {
		const parsed = JSON.parse(action.attrsJson);
		return (
			parsed["llm.prompt"] || parsed.input || parsed.prompt || action.attrsJson
		);
	} catch {
		return action.attrsJson;
	}
}
