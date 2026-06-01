import type { JsonValue } from "@obs-unified/types";
import { useCallback, useEffect, useState } from "react";
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

export function EvaluationsDashboard() {
	const api = useApi();
	const [cases, setCases] = useState<EvalCase[]>([]);
	const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
	const [selectedCase, setSelectedCase] = useState<EvalCase | null>(null);
	const [results, setResults] = useState<EvalCaseResult[]>([]);
	const [selectedResult, setSelectedResult] = useState<EvalCaseResult | null>(
		null,
	);

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
			setSelectedResult(null);
			return;
		}

		let active = true;
		async function loadDetails() {
			setLoadingResults(true);
			try {
				const [caseData, resultsData] = await Promise.all([
					api<{ evalCase: EvalCase }>(`/eval-cases/${selectedCaseId}`),
					api<{ evalCaseResults: EvalCaseResult[] }>(
						`/eval-cases/${selectedCaseId}/results`,
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

								<div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto min-h-0 min-w-0 pr-1">
									{/* Production Source context */}
									<div className="flex flex-col gap-2 min-w-0">
										<div className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-80 border-b border-sys-outline-soft pb-1">
											📁 Saved Production Context
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
											🧪 Test Run Evaluation Result
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
