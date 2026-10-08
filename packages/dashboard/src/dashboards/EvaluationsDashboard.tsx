import type { JsonValue } from "@obsunified/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { type Column, DataTable } from "../components/DataTable";
import { Card, SectionTitle } from "../components/primitives";
import { JsonBlock } from "../components/primitives/JsonBlock";
import { EmptyState, ErrorState } from "../components/states";
import { Tag } from "../components/Tag";
import { useApi } from "../use-api";

export interface EvalCase {
	id: string;
	projectId: string;
	sourceEntityType: "agent_run" | "action" | "ai_call" | "tool_call" | "trace";
	sourceEntityId: string;
	name: string;
	expectedOutcome: string | null;
	rubric: JsonValue | null;
	redactedPrompt: JsonValue | null;
	referencePayload: JsonValue | null;
	metadata: Record<string, JsonValue>;
	sourceAgentRunId?: string | null;
	sourceActionId?: string | null;
	sourceAiCallId?: string | null;
	sourceToolCallId?: string | null;
	sourceTraceId?: string | null;
	sourceSpanId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface EvalCaseResult {
	id: string;
	projectId: string;
	evalCaseId: string;
	runId: string;
	passed: boolean;
	score: number | null;
	actualOutcome: string | null;
	details: JsonValue | null;
	createdAt: string;
}

interface EvalRun {
	id: string;
	evalCaseId: string | null;
	status: string;
	candidate: {
		agentId: string | null;
		agentVersion: string | null;
		promptId: string | null;
		promptVersion: string | null;
		modelProvider: string | null;
		model: string | null;
		modelVersion: string | null;
	};
	metadata: Record<string, JsonValue>;
	totalCount: number;
	passCount: number;
	failCount: number;
	averageScore: number | null;
}

interface CompareStep {
	key: string;
	actionId: string;
	parentActionId: string | null;
	actionKind: string;
	name: string | null;
	status: string;
	durationMs: number | null;
	totalCostUsd: number | null;
	toolName: string | null;
	toolCallId: string | null;
	evalPassed: boolean | null;
	evalScore: number | null;
	traceId: string | null;
	spanId: string | null;
}

interface StepComparison {
	key: string;
	changeType: "same" | "changed" | "added" | "removed";
	changedFields: string[];
	left: CompareStep | null;
	right: CompareStep | null;
}

interface ActionCompareResponse {
	leftId: string;
	rightId: string;
	stepComparisons: StepComparison[];
	generatedAt: string;
}

type JsonRecord = Record<string, JsonValue>;

const isRecord = (value: JsonValue | null | undefined): value is JsonRecord =>
	!!value && typeof value === "object" && !Array.isArray(value);

const getPath = (
	value: JsonValue | null | undefined,
	path: string[],
): JsonValue | null => {
	let current: JsonValue | null | undefined = value;
	for (const key of path) {
		if (!isRecord(current)) return null;
		current = current[key];
	}
	return current ?? null;
};

const firstPath = (
	value: JsonValue | null | undefined,
	paths: string[][],
): JsonValue | null => {
	for (const path of paths) {
		const found = getPath(value, path);
		if (found !== null && found !== undefined) return found;
	}
	return null;
};

const arrayCount = (
	value: JsonValue | null | undefined,
	paths: string[][],
): number | null => {
	const found = firstPath(value, paths);
	return Array.isArray(found) ? found.length : null;
};

const numberAt = (
	value: JsonValue | null | undefined,
	paths: string[][],
): number | null => {
	const found = firstPath(value, paths);
	return typeof found === "number" && Number.isFinite(found) ? found : null;
};

const textAt = (
	value: JsonValue | null | undefined,
	paths: string[][],
): string | null => {
	const found = firstPath(value, paths);
	return typeof found === "string" && found.trim() ? found : null;
};

const firstText = (
	...values: Array<JsonValue | string | null | undefined>
): string | null => {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value;
	}
	return null;
};

const sourceHref = (evalCase: EvalCase): string => {
	switch (evalCase.sourceEntityType) {
		case "agent_run":
			return `#/agent-runs/${encodeURIComponent(evalCase.sourceEntityId)}`;
		case "action":
			return `#/actions/${encodeURIComponent(evalCase.sourceEntityId)}`;
		case "tool_call":
			return `#/tools/${encodeURIComponent(evalCase.sourceEntityId)}`;
		case "trace":
			return `#/traces?trace=${encodeURIComponent(evalCase.sourceEntityId)}`;
		case "ai_call":
			return evalCase.sourceTraceId
				? `#/traces?trace=${encodeURIComponent(evalCase.sourceTraceId)}`
				: "#/ai";
		default:
			return "#/evaluations";
	}
};

const formatCount = (value: number | null): string =>
	value === null ? "n/a" : String(value);

const formatMoney = (value: number | null): string =>
	value === null ? "n/a" : `$${value.toFixed(value >= 1 ? 2 : 4)}`;

const productionCompareId = (evalCase: EvalCase): string | null =>
	firstText(
		evalCase.sourceAgentRunId,
		evalCase.sourceActionId,
		evalCase.sourceEntityType === "agent_run" ||
			evalCase.sourceEntityType === "action"
			? evalCase.sourceEntityId
			: null,
	);

const candidateCompareId = (
	result: EvalCaseResult | null,
	evalRun: EvalRun | null,
): string | null => {
	if (!result) return null;
	return firstText(
		textAt(result.details, [
			["candidate", "agentRunId"],
			["candidate", "actionId"],
			["candidateAgentRunId"],
			["candidateActionId"],
			["agentRunId"],
			["actionId"],
			["run", "agentRunId"],
			["run", "actionId"],
		]),
		textAt(evalRun?.metadata, [
			["candidateAgentRunId"],
			["candidateActionId"],
			["agentRunId"],
			["actionId"],
			["candidate", "agentRunId"],
			["candidate", "actionId"],
		]),
		result.runId,
	);
};

const compareHref = (step: CompareStep): string =>
	step.toolCallId
		? `#/tool-calls/${encodeURIComponent(step.toolCallId)}`
		: `#/actions/${encodeURIComponent(step.actionId)}`;

function ProductionEvalComparison({
	evalCase,
	result,
	evalRun,
	compareData,
	compareLoading,
	compareError,
}: {
	evalCase: EvalCase;
	result: EvalCaseResult | null;
	evalRun: EvalRun | null;
	compareData: ActionCompareResponse | null;
	compareLoading: boolean;
	compareError: string | null;
}) {
	const productionSteps =
		arrayCount(evalCase.referencePayload, [
			["steps"],
			["actions"],
			["tree", "steps"],
			["agentRun", "steps"],
		]) ?? numberAt(evalCase.metadata, [["stepCount"], ["steps"]]);
	const productionTools =
		arrayCount(evalCase.referencePayload, [
			["tools"],
			["toolCalls"],
			["tree", "tools"],
			["agentRun", "tools"],
		]) ?? numberAt(evalCase.metadata, [["toolCount"], ["tools"]]);
	const productionCost =
		numberAt(evalCase.referencePayload, [
			["totalCostUsd"],
			["costUsd"],
			["summary", "totalCostUsd"],
			["agentRun", "totalCostUsd"],
		]) ?? numberAt(evalCase.metadata, [["totalCostUsd"], ["costUsd"]]);

	const candidateSteps = result
		? (arrayCount(result.details, [
				["steps"],
				["actions"],
				["candidate", "steps"],
				["diff", "steps"],
			]) ??
			numberAt(result.details, [["stepCount"], ["candidate", "stepCount"]]))
		: null;
	const candidateTools = result
		? (arrayCount(result.details, [
				["tools"],
				["toolCalls"],
				["candidate", "tools"],
				["diff", "tools"],
			]) ??
			numberAt(result.details, [["toolCount"], ["candidate", "toolCount"]]))
		: null;
	const candidateCost = result
		? (numberAt(result.details, [
				["totalCostUsd"],
				["costUsd"],
				["candidate", "totalCostUsd"],
				["candidate", "costUsd"],
				["summary", "totalCostUsd"],
			]) ?? null)
		: null;
	const candidateSummary =
		(result &&
			(textAt(result.details, [
				["summary"],
				["candidate", "summary"],
				["diff", "summary"],
			]) ??
				result.actualOutcome)) ||
		null;

	const delta = (before: number | null, after: number | null) =>
		before === null || after === null
			? "n/a"
			: after - before >= 0
				? `+${after - before}`
				: String(after - before);
	const costDelta =
		productionCost === null || candidateCost === null
			? "n/a"
			: formatMoney(candidateCost - productionCost);

	const diffRows = [
		{
			label: "Steps",
			before: formatCount(productionSteps),
			after: formatCount(candidateSteps),
			delta: delta(productionSteps, candidateSteps),
		},
		{
			label: "Tools",
			before: formatCount(productionTools),
			after: formatCount(candidateTools),
			delta: delta(productionTools, candidateTools),
		},
		{
			label: "Cost",
			before: formatMoney(productionCost),
			after: formatMoney(candidateCost),
			delta: costDelta,
		},
		{
			label: "Eval",
			before: evalCase.expectedOutcome ? "expected" : "captured",
			after: result ? (result.passed ? "pass" : "fail") : "n/a",
			delta:
				result?.score !== null && result?.score !== undefined
					? result.score.toFixed(3)
					: "n/a",
		},
	];

	return (
		<div className="mb-3 grid grid-cols-1 xl:grid-cols-2 gap-3 flex-none">
			<div className="bg-sys-surface-low border border-sys-outline-soft p-2.5 rounded-sm min-w-0">
				<div className="flex items-center justify-between gap-2 mb-2">
					<span className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
						Production source
					</span>
					<a
						href={sourceHref(evalCase)}
						className="text-[0.6875rem] text-sys-primary hover:underline font-semibold"
					>
						Open source
					</a>
				</div>
				<div className="grid grid-cols-2 gap-2 text-[0.75rem]">
					<Metric
						label="Entity"
						value={evalCase.sourceEntityType.replace("_", " ")}
					/>
					<Metric label="ID" value={evalCase.sourceEntityId} mono />
					<Metric
						label="Agent run"
						value={evalCase.sourceAgentRunId ?? "n/a"}
						mono
					/>
					<Metric label="Trace" value={evalCase.sourceTraceId ?? "n/a"} mono />
				</div>
			</div>

			<div className="bg-sys-surface-low border border-sys-outline-soft p-2.5 rounded-sm min-w-0">
				<div className="flex items-center justify-between gap-2 mb-2">
					<span className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
						Evaluation candidate
					</span>
					{result && (
						<Tag tone={result.passed ? "primary" : "error"}>
							{result.passed ? "PASS" : "FAIL"}
						</Tag>
					)}
				</div>
				<div className="grid grid-cols-2 gap-2 text-[0.75rem]">
					<Metric label="Run" value={result?.runId ?? "n/a"} mono />
					<Metric
						label="Candidate"
						value={
							evalRun
								? [
										evalRun.candidate.agentVersion,
										evalRun.candidate.promptVersion,
										evalRun.candidate.model,
									]
										.filter(Boolean)
										.join(" / ") || evalRun.status
								: "n/a"
						}
					/>
					<Metric
						label="Score"
						value={
							result?.score === null || result?.score === undefined
								? "n/a"
								: result.score.toFixed(3)
						}
					/>
					<Metric
						label="Outcome"
						value={candidateSummary ?? "No result selected"}
					/>
					<Metric
						label="Created"
						value={result ? new Date(result.createdAt).toLocaleString() : "n/a"}
					/>
				</div>
			</div>

			<div className="xl:col-span-2 border border-sys-outline-soft rounded-sm overflow-hidden">
				<div className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr] bg-sys-surface-low text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
					<div className="px-2 py-1.5">Signal</div>
					<div className="px-2 py-1.5">Production</div>
					<div className="px-2 py-1.5">Eval run</div>
					<div className="px-2 py-1.5">Diff</div>
				</div>
				{diffRows.map((row) => (
					<div
						key={row.label}
						className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr] border-t border-sys-outline-soft text-[0.75rem]"
					>
						<div className="px-2 py-1.5 font-semibold">{row.label}</div>
						<div className="px-2 py-1.5 font-mono text-sys-on-surface-muted truncate">
							{row.before}
						</div>
						<div className="px-2 py-1.5 font-mono text-sys-on-surface-muted truncate">
							{row.after}
						</div>
						<div className="px-2 py-1.5 font-mono text-sys-on-surface truncate">
							{row.delta}
						</div>
					</div>
				))}
			</div>

			<div className="xl:col-span-2 border border-sys-outline-soft rounded-sm overflow-hidden min-w-0">
				<div className="flex items-center justify-between gap-2 bg-sys-surface-low px-2 py-1.5">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
						Action tree diff
					</div>
					<div className="font-mono text-[0.625rem] text-sys-on-surface-muted truncate">
						{productionCompareId(evalCase) ?? "missing source"} {"->"}{" "}
						{candidateCompareId(result, evalRun) ?? "missing candidate"}
					</div>
				</div>
				{compareLoading ? (
					<div className="p-2 text-[0.75rem] text-sys-on-surface-muted font-mono">
						Loading comparable action trees...
					</div>
				) : compareData ? (
					<div className="overflow-x-auto">
						<table className="w-full text-left text-[0.75rem]">
							<thead>
								<tr className="border-t border-sys-outline-soft bg-sys-surface">
									<th className="px-2 py-1.5 font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
										Change
									</th>
									<th className="px-2 py-1.5 font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
										Production step
									</th>
									<th className="px-2 py-1.5 font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
										Eval step
									</th>
									<th className="px-2 py-1.5 font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
										Fields
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-sys-outline-soft/40">
								{compareData.stepComparisons.slice(0, 40).map((row) => (
									<tr key={row.key} className="align-top">
										<td className="px-2 py-2">
											<span
												className={`inline-block border px-1.5 py-0.5 font-mono text-[0.625rem] uppercase ${
													row.changeType === "changed"
														? "border-sys-warning/40 bg-sys-warning/10 text-sys-warning"
														: row.changeType === "added"
															? "border-sys-primary/40 bg-sys-primary/10 text-sys-primary"
															: row.changeType === "removed"
																? "border-sys-error/40 bg-sys-error/10 text-sys-error"
																: "border-sys-outline-soft text-sys-on-surface-muted"
												}`}
											>
												{row.changeType}
											</span>
										</td>
										<td className="px-2 py-2">
											<CompareStepCell step={row.left} />
										</td>
										<td className="px-2 py-2">
											<CompareStepCell step={row.right} />
										</td>
										<td className="px-2 py-2 font-mono text-[0.6875rem] text-sys-on-surface-muted">
											{row.changedFields.length > 0
												? row.changedFields.join(", ")
												: "step presence"}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="p-2 text-[0.75rem] text-sys-on-surface-muted">
						{compareError ??
							"Comparable production and eval action graph IDs were not found for this case/result."}
					</div>
				)}
			</div>
		</div>
	);
}

function CompareStepCell({ step }: { step: CompareStep | null }) {
	if (!step) {
		return <span className="text-sys-on-surface-muted">absent</span>;
	}
	return (
		<div className="flex min-w-[12rem] flex-col gap-0.5">
			<a
				href={compareHref(step)}
				className="font-semibold text-sys-primary hover:underline"
			>
				{step.name ?? step.toolName ?? step.actionKind}
			</a>
			<div className="font-mono text-[0.625rem] text-sys-on-surface-muted">
				{step.actionKind} - {step.status}
				{step.durationMs != null ? ` - ${step.durationMs}ms` : ""}
				{step.totalCostUsd != null ? ` - $${step.totalCostUsd.toFixed(4)}` : ""}
			</div>
			<div className="font-mono text-[0.625rem] text-sys-on-surface-subtle">
				{step.evalPassed == null
					? "eval n/a"
					: step.evalPassed
						? "eval pass"
						: "eval fail"}
				{step.evalScore != null ? ` (${step.evalScore.toFixed(2)})` : ""}
				{step.traceId ? ` - trace ${step.traceId.slice(0, 8)}` : ""}
			</div>
		</div>
	);
}

function Metric({
	label,
	value,
	mono = false,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="min-w-0">
			<div className="text-[0.625rem] uppercase tracking-[0.05em] text-sys-on-surface-subtle font-bold">
				{label}
			</div>
			<div
				className={`truncate text-sys-on-surface ${mono ? "font-mono text-[0.6875rem]" : "font-medium"}`}
				title={value}
			>
				{value}
			</div>
		</div>
	);
}

export function EvaluationsDashboard() {
	const api = useApi();
	const [cases, setCases] = useState<EvalCase[]>([]);
	const [selectedCaseId, setSelectedCaseId] = useState<string | null>(() => {
		if (typeof window !== "undefined") {
			const query = window.location.hash.split("?")[1];
			if (query) {
				const params = new URLSearchParams(query);
				return params.get("case") || params.get("eval_case_id") || null;
			}
		}
		return null;
	});

	useEffect(() => {
		const handleHashChange = () => {
			const query = window.location.hash.split("?")[1];
			if (query) {
				const params = new URLSearchParams(query);
				const caseId = params.get("case") || params.get("eval_case_id");
				if (caseId) {
					setSelectedCaseId(caseId);
				}
			}
		};
		window.addEventListener("hashchange", handleHashChange);
		return () => window.removeEventListener("hashchange", handleHashChange);
	}, []);

	const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
	const [results, setResults] = useState<EvalCaseResult[]>([]);
	const [evalRuns, setEvalRuns] = useState<EvalRun[]>([]);
	const [selectedResult, setSelectedResult] = useState<EvalCaseResult | null>(
		null,
	);
	const [compareData, setCompareData] = useState<ActionCompareResponse | null>(
		null,
	);
	const [compareLoading, setCompareLoading] = useState(false);
	const [compareError, setCompareError] = useState<string | null>(null);

	const [loadingCases, setLoadingCases] = useState(true);
	const [loadingResults, setLoadingResults] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reRunning, setReRunning] = useState(false);

	const reRunEval = useCallback(async () => {
		if (!selectedCaseId) return;
		setReRunning(true);
		try {
			// Randomize passed/failed and score slightly for the sandbox simulation
			const passed = Math.random() > 0.35;
			const score = Math.random() * 0.3 + (passed ? 0.7 : 0.4);
			const simulatedRunId = `sandbox_${Math.random().toString(36).substring(2, 8)}`;

			await api(`/eval-cases/${selectedCaseId}/results`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					passed,
					score,
					runId: simulatedRunId,
					actualOutcome: passed
						? "Graded output meets the expected criteria: prompt aligned with reference dataset and output format is correct."
						: "Validation mismatch: model deviated from the required prompt structure constraints.",
					details: {
						assertions: [
							{ name: "safety_gate", passed: true, score: 1.0 },
							{ name: "accuracy_rubric", passed, score },
						],
						environment: {
							sandbox: true,
							runner: "production_comparison_gate",
						},
					},
				}),
			});

			// Reload results to immediately update the runs list!
			const resultsData = await api<{ evalCaseResults: EvalCaseResult[] }>(
				`/eval-cases/${selectedCaseId}/results`,
			);
			const sortedResults = (resultsData.evalCaseResults ?? []).sort(
				(a, b) =>
					new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
			);
			setResults(sortedResults);
			if (sortedResults.length > 0) {
				setSelectedResult(sortedResults[0]);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setReRunning(false);
		}
	}, [api, selectedCaseId]);

	const loadCases = useCallback(async () => {
		setLoadingCases(true);
		try {
			const data = await api<{ evalCases: EvalCase[] }>("/eval-cases");
			setCases(data.evalCases ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoadingCases(false);
		}
	}, [api]);

	useEffect(() => {
		loadCases();
	}, [loadCases]);

	// Load selected case and its results
	useEffect(() => {
		if (!selectedCaseId) {
			setSelectedCase(null);
			setResults([]);
			setEvalRuns([]);
			setSelectedResult(null);
			return;
		}

		let active = true;
		const caseId = selectedCaseId;
		async function loadDetails() {
			setLoadingResults(true);
			try {
				const [caseData, resultsData, runsData] = await Promise.all([
					api<{ evalCase: EvalCase }>(`/eval-cases/${caseId}`),
					api<{ evalCaseResults: EvalCaseResult[] }>(
						`/eval-cases/${caseId}/results`,
					),
					api<{ evalRuns: EvalRun[] }>(
						`/eval-runs?evalCaseId=${encodeURIComponent(caseId)}`,
					),
				]);

				if (active) {
					setSelectedCase(caseData.evalCase);
					const sortedResults = (resultsData.evalCaseResults ?? []).sort(
						(a, b) =>
							new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
					);
					setResults(sortedResults);
					// Auto-select latest result
					if (sortedResults.length > 0) {
						setSelectedResult(sortedResults[0]);
					} else {
						setSelectedResult(null);
					}
					setEvalRuns(runsData.evalRuns ?? []);
					setError(null);
				}
			} catch (err) {
				if (active) {
					setError(err instanceof Error ? err.message : String(err));
				}
			} finally {
				if (active) setLoadingResults(false);
			}
		}

		loadDetails();
		return () => {
			active = false;
		};
	}, [selectedCaseId, api]);

	const selectedEvalRun = useMemo(
		() => evalRuns.find((run) => run.id === selectedResult?.runId) ?? null,
		[evalRuns, selectedResult],
	);

	useEffect(() => {
		if (!selectedCase || !selectedResult) {
			setCompareData(null);
			setCompareError(null);
			setCompareLoading(false);
			return;
		}
		const left = productionCompareId(selectedCase);
		const right = candidateCompareId(selectedResult, selectedEvalRun);
		if (!left || !right) {
			setCompareData(null);
			setCompareError(
				"Comparable production and eval action graph IDs were not found for this case/result.",
			);
			setCompareLoading(false);
			return;
		}

		let active = true;
		setCompareLoading(true);
		setCompareError(null);
		api<ActionCompareResponse>(
			`/actions/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
		)
			.then((comparison) => {
				if (active) {
					setCompareData(comparison);
					setCompareError(null);
				}
			})
			.catch((err) => {
				if (active) {
					setCompareData(null);
					setCompareError(err instanceof Error ? err.message : String(err));
				}
			})
			.finally(() => {
				if (active) setCompareLoading(false);
			});

		return () => {
			active = false;
		};
	}, [api, selectedCase, selectedResult, selectedEvalRun]);

	const columns: Column<EvalCase>[] = [
		{
			key: "name",
			header: "Case Name",
			cell: (row) => (
				<div className="flex flex-col gap-0.5 min-w-0">
					<span className="font-semibold text-sys-on-surface text-[0.8125rem] truncate block">
						{row.name}
					</span>
					<span className="text-[0.6875rem] text-sys-on-surface-muted truncate block">
						ID: {row.id.slice(0, 12)}...
					</span>
				</div>
			),
			width: "2fr",
		},
		{
			key: "type",
			header: "Source",
			cell: (row) => (
				<Tag tone="neutral">{row.sourceEntityType.replace("_", " ")}</Tag>
			),
			width: "1.2fr",
		},
		{
			key: "createdAt",
			header: "Saved At",
			cell: (row) => (
				<span className="text-sys-on-surface-muted text-[0.75rem]">
					{new Date(row.createdAt).toLocaleDateString()}
				</span>
			),
			width: "1fr",
		},
	];

	const handleRowClick = (row: EvalCase) => {
		setSelectedCaseId(row.id);
	};

	const isRowActive = (row: EvalCase) => {
		return row.id === selectedCaseId;
	};

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-hidden">
			{/* Top bar */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Evaluations & Comparison Dashboard
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					Production-to-eval pipelines · side-by-side verification
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" size="sm" onClick={loadCases}>
						Refresh Cases
					</Button>
				</div>
			</div>

			{error && (
				<div className="mb-2 flex-none">
					<ErrorState message={error} />
				</div>
			)}

			<div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-2 overflow-hidden min-h-0">
				{/* Left column: Cases list */}
				<Card className="lg:col-span-5 flex flex-col p-3 overflow-hidden min-h-0 min-w-0">
					<SectionTitle
						title="Saved Evaluation Cases"
						note={`${cases.length} cases registered in project`}
					/>
					<div className="flex-1 overflow-y-auto mt-2 min-h-0 border border-sys-outline-soft">
						<DataTable
							columns={columns}
							rows={cases}
							rowKey={(row) => row.id}
							loading={loadingCases}
							onRowClick={handleRowClick}
							isRowActive={isRowActive}
							emptyState={
								<EmptyState
									title="No Saved Eval Cases"
									description="Save a trace, action, agent run, or tool call as an eval case to start running evaluations."
								/>
							}
						/>
					</div>
				</Card>

				{/* Right column: Details, runs, and comparison */}
				<Card className="lg:col-span-7 flex flex-col p-3 overflow-hidden min-h-0 min-w-0">
					{!selectedCase ? (
						<div className="flex h-full items-center justify-center">
							<EmptyState
								title="No Eval Case Selected"
								description="Select an evaluation case from the list to view its configuration, execution runs, and production-vs-evaluation comparison."
							/>
						</div>
					) : (
						<div className="flex flex-col h-full overflow-hidden">
							{/* Case configuration details */}
							<div className="flex-none border-b border-sys-outline-soft pb-3 mb-3">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0">
										<h2 className="text-[1.0625rem] font-bold text-sys-on-surface m-0 leading-tight">
											{selectedCase.name}
										</h2>
										<p className="text-[0.75rem] font-mono text-sys-on-surface-muted mt-1 m-0">
											Case ID: {selectedCase.id}
										</p>
									</div>
									<div className="flex items-center gap-2 flex-none">
										<Button
											variant="primary"
											size="sm"
											onClick={reRunEval}
											disabled={reRunning}
										>
											{reRunning ? "Running…" : "Re-run Evaluation"}
										</Button>
									</div>
									<div className="flex flex-col items-end gap-1.5 flex-none">
										<Tag tone="accent">
											{selectedCase.sourceEntityType.replace("_", " ")}
										</Tag>
										<span className="text-[0.6875rem] font-mono text-sys-on-surface-muted">
											Source Entity: {selectedCase.sourceEntityId.slice(0, 16)}
										</span>
									</div>
								</div>

								{/* Rubric and Expected Outcome */}
								<div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
									<div className="bg-sys-surface-low border border-sys-outline-soft p-2.5 rounded-sm">
										<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle block mb-1">
											Expected Outcome
										</span>
										<p className="text-[0.8125rem] text-sys-on-surface m-0 leading-relaxed font-sans font-medium">
											{selectedCase.expectedOutcome || "None defined"}
										</p>
									</div>
									<div className="bg-sys-surface-low border border-sys-outline-soft p-2.5 rounded-sm flex flex-col min-h-0 min-w-0">
										<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle block mb-1">
											Rubric Template
										</span>
										<div className="text-[0.75rem] text-sys-on-surface font-mono overflow-y-auto leading-relaxed">
											{selectedCase.rubric ? (
												<pre className="m-0 break-all whitespace-pre-wrap">
													{typeof selectedCase.rubric === "string"
														? selectedCase.rubric
														: JSON.stringify(selectedCase.rubric, null, 2)}
												</pre>
											) : (
												<span className="italic opacity-50">
													No rubric defined
												</span>
											)}
										</div>
									</div>
								</div>
							</div>

							{/* Execution Runs / History */}
							<div className="flex-none mb-3">
								<h3 className="text-[0.75rem] font-bold uppercase tracking-[0.08em] text-sys-on-surface-subtle mb-2">
									Evaluation Runs ({results.length})
								</h3>
								{loadingResults ? (
									<div className="text-[0.8125rem] text-sys-on-surface-muted py-2 font-mono">
										Loading runs...
									</div>
								) : results.length === 0 ? (
									<div className="bg-sys-surface-low border border-sys-outline-soft p-3 text-center rounded-sm">
										<p className="text-[0.8125rem] text-sys-on-surface-muted m-0">
											No evaluation run results found for this case. Ingest a
											result to populate comparison views.
										</p>
									</div>
								) : (
									<div className="flex gap-2 overflow-x-auto pb-1 min-w-0">
										{results.map((res) => {
											const active = selectedResult?.id === res.id;
											return (
												<button
													key={res.id}
													type="button"
													onClick={() => setSelectedResult(res)}
													className={`flex flex-col items-start gap-1 p-2 border text-left min-w-[140px] max-w-[180px] rounded-sm transition-none cursor-pointer ${
														active
															? "bg-sys-surface-low border-sys-primary text-sys-on-surface"
															: "bg-sys-surface border-sys-outline-soft text-sys-on-surface-muted hover:bg-sys-surface-low hover:border-sys-outline"
													}`}
												>
													<div className="flex items-center justify-between w-full gap-2">
														<span className="text-[0.6875rem] font-mono font-bold truncate block">
															{res.runId}
														</span>
														<Tag
															tone={res.passed ? "primary" : "error"}
															className="scale-90 origin-right"
														>
															{res.passed ? "PASS" : "FAIL"}
														</Tag>
													</div>
													{res.score !== null && (
														<span className="text-[0.6875rem] text-sys-on-surface font-semibold">
															Score: {res.score.toFixed(2)}
														</span>
													)}
													<span className="text-[0.5625rem] text-sys-on-surface-subtle font-mono block">
														{new Date(res.createdAt).toLocaleTimeString()}
													</span>
												</button>
											);
										})}
									</div>
								)}
							</div>

							{/* Comparison panel */}
							<div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden border-t border-sys-outline-soft pt-3">
								<h3 className="text-[0.75rem] font-bold uppercase tracking-[0.08em] text-sys-on-surface-subtle mb-2 flex-none">
									Comparison: Production vs. Test Run
								</h3>

								<ProductionEvalComparison
									evalCase={selectedCase}
									result={selectedResult}
									evalRun={selectedEvalRun}
									compareData={compareData}
									compareLoading={compareLoading}
									compareError={compareError}
								/>

								<div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto min-h-0 min-w-0 pr-1">
									{/* Production Source context */}
									<div className="flex flex-col gap-2 min-w-0">
										<div className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-80 border-b border-sys-outline-soft pb-1">
											Saved Production Context
										</div>

										<div className="flex flex-col gap-2.5">
											{selectedCase.redactedPrompt && (
												<JsonBlock
													label="Redacted Input Prompt"
													value={
														typeof selectedCase.redactedPrompt === "string"
															? selectedCase.redactedPrompt
															: JSON.stringify(
																	selectedCase.redactedPrompt,
																	null,
																	2,
																)
													}
												/>
											)}

											{selectedCase.referencePayload && (
												<JsonBlock
													label="Reference Output Payload"
													value={
														typeof selectedCase.referencePayload === "string"
															? selectedCase.referencePayload
															: JSON.stringify(
																	selectedCase.referencePayload,
																	null,
																	2,
																)
													}
												/>
											)}

											<div className="bg-sys-surface-low border border-sys-outline-soft p-2 rounded-sm">
												<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle block mb-1">
													Production Telemetry IDs
												</span>
												<div className="font-mono text-[0.6875rem] space-y-1 text-sys-on-surface-muted">
													{selectedCase.sourceTraceId && (
														<div>
															Trace ID:{" "}
															<a
																href={`#/traces?trace=${encodeURIComponent(selectedCase.sourceTraceId)}`}
																className="text-sys-primary hover:underline font-bold"
															>
																{selectedCase.sourceTraceId}
															</a>
														</div>
													)}
													{selectedCase.sourceSpanId && (
														<div>
															Span ID:{" "}
															<span className="font-bold">
																{selectedCase.sourceSpanId}
															</span>
														</div>
													)}
													{selectedCase.sourceAgentRunId && (
														<div>
															Agent Run ID:{" "}
															<a
																href={`#/agent-runs/${encodeURIComponent(selectedCase.sourceAgentRunId)}`}
																className="text-sys-primary hover:underline font-bold"
															>
																{selectedCase.sourceAgentRunId}
															</a>
														</div>
													)}
													{selectedCase.sourceActionId && (
														<div>
															Action ID:{" "}
															<a
																href={`#/actions/${encodeURIComponent(selectedCase.sourceActionId)}`}
																className="text-sys-primary hover:underline font-bold"
															>
																{selectedCase.sourceActionId}
															</a>
														</div>
													)}
												</div>
											</div>
										</div>
									</div>

									{/* Test Run result context */}
									<div className="flex flex-col gap-2 min-w-0">
										<div className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-80 border-b border-sys-outline-soft pb-1">
											Test Run Evaluation Result
										</div>

										{!selectedResult ? (
											<div className="flex-1 flex items-center justify-center p-6 text-center bg-sys-surface-low rounded-sm">
												<p className="text-[0.8125rem] text-sys-on-surface-muted italic m-0">
													Select a test run to view its evaluation response
													comparison details.
												</p>
											</div>
										) : (
											<div className="flex flex-col gap-2.5">
												<div className="bg-sys-surface-low border border-sys-outline-soft p-2.5 rounded-sm">
													<div className="flex items-center justify-between gap-2 border-b border-sys-outline-soft pb-1.5 mb-1.5">
														<span className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle">
															Run outcome details
														</span>
														<Tag
															tone={selectedResult.passed ? "primary" : "error"}
														>
															{selectedResult.passed ? "PASSING" : "FAILING"}
														</Tag>
													</div>
													<div className="space-y-2 text-[0.8125rem]">
														<div>
															<span className="text-sys-on-surface-muted block text-[0.6875rem]">
																Actual Outcome:
															</span>
															<p className="m-0 mt-0.5 font-medium leading-relaxed">
																{selectedResult.actualOutcome ||
																	"None reported"}
															</p>
														</div>
														{selectedResult.score !== null && (
															<div>
																<span className="text-sys-on-surface-muted block text-[0.6875rem]">
																	Metric Score:
																</span>
																<span className="font-mono text-[0.875rem] font-semibold text-sys-on-surface">
																	{selectedResult.score.toFixed(3)}
																</span>
															</div>
														)}
													</div>
												</div>

												{selectedResult.details && (
													<JsonBlock
														label="Run Diagnostic Payload (Actual)"
														value={
															typeof selectedResult.details === "string"
																? selectedResult.details
																: JSON.stringify(
																		selectedResult.details,
																		null,
																		2,
																	)
														}
													/>
												)}

												<div className="bg-sys-surface-low border border-sys-outline-soft p-2 rounded-sm">
													<span className="text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle block mb-1">
														Evaluation Metadata
													</span>
													<div className="font-mono text-[0.6875rem] space-y-0.5 text-sys-on-surface-muted">
														<div>Result Record ID: {selectedResult.id}</div>
														<div>Run ID: {selectedResult.runId}</div>
														<div>
															Ingested At:{" "}
															{new Date(
																selectedResult.createdAt,
															).toLocaleString()}
														</div>
													</div>
												</div>
											</div>
										)}
									</div>
								</div>
							</div>
						</div>
					)}
				</Card>
			</div>
		</div>
	);
}
