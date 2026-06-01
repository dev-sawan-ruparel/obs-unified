import { useCallback, useState } from "react";
import { useApi } from "../use-api";
import { Button } from "./Button";
import { Field, TextField } from "./forms";

export type EvalCaseSourceType =
	| "agent_run"
	| "action"
	| "ai_call"
	| "tool_call"
	| "trace";

interface SaveEvalCaseModalProps {
	sourceEntityType: EvalCaseSourceType;
	sourceEntityId: string;
	sourceAgentRunId?: string;
	sourceActionId?: string;
	sourceToolCallId?: string;
	sourceTraceId?: string;
	sourceSpanId?: string;
	prefillExpectedOutcome?: string;
	onClose: () => void;
}

export function SaveEvalCaseModal({
	sourceEntityType,
	sourceEntityId,
	sourceAgentRunId,
	sourceActionId,
	sourceToolCallId,
	sourceTraceId,
	sourceSpanId,
	prefillExpectedOutcome = "",
	onClose,
}: SaveEvalCaseModalProps) {
	const api = useApi();
	const [name, setName] = useState(
		`Eval Case: ${sourceEntityType.replace(/_/g, " ")} ${sourceEntityId}`,
	);
	const [expectedOutcome, setExpectedOutcome] = useState(
		prefillExpectedOutcome,
	);
	const [rubricText, setRubricText] = useState(
		JSON.stringify(
			{
				criteria: "Verify correctness of response and parameters.",
				grading: "Pass/Fail",
			},
			null,
			2,
		),
	);

	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdId, setCreatedId] = useState<string | null>(null);

	const handleSave = useCallback(async () => {
		setLoading(true);
		setError(null);

		// Validate rubric JSON if provided
		let rubric: unknown = null;
		if (rubricText.trim()) {
			try {
				rubric = JSON.parse(rubricText);
			} catch {
				setError("Rubric must be a valid JSON object or array.");
				setLoading(false);
				return;
			}
		}

		try {
			const body = {
				sourceEntityType,
				sourceEntityId,
				name: name.trim() || `Eval Case: ${sourceEntityType} ${sourceEntityId}`,
				expectedOutcome: expectedOutcome.trim() || null,
				rubric,
				source: {
					agentRunId: sourceAgentRunId || null,
					actionId: sourceActionId || null,
					toolCallId: sourceToolCallId || null,
					traceId: sourceTraceId || null,
					spanId: sourceSpanId || null,
				},
			};

			const data = await api<{ evalCase: { id: string } }>("/eval-cases", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});

			if (data?.evalCase?.id) {
				setCreatedId(data.evalCase.id);
			} else {
				setError("Failed to create evaluation case (invalid response).");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [
		api,
		sourceEntityType,
		sourceEntityId,
		name,
		expectedOutcome,
		rubricText,
		sourceAgentRunId,
		sourceActionId,
		sourceToolCallId,
		sourceTraceId,
		sourceSpanId,
	]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
			<div className="bg-sys-bg border-[1px] border-sys-outline w-full max-w-[560px] max-h-[90vh] overflow-auto flex flex-col">
				<header className="flex items-center justify-between px-4 py-3 border-b-[1px] border-sys-outline bg-sys-surface">
					<div className="text-[0.8125rem] font-semibold text-sys-on-surface">
						Save as evaluation case
					</div>
					<Button size="sm" onClick={onClose} disabled={loading}>
						Close
					</Button>
				</header>

				<div className="p-4 flex flex-col gap-4 overflow-y-auto">
					{createdId ? (
						<div className="p-3 bg-sys-primary/10 border-l-[4px] border-sys-primary flex flex-col gap-2">
							<div className="text-[0.75rem] font-bold uppercase tracking-[0.12em] text-sys-primary">
								Evaluation Case Created Successfully!
							</div>
							<div className="text-[0.8125rem] font-mono opacity-80">
								Created Case ID: <span className="font-bold">{createdId}</span>
							</div>
							<div className="mt-2">
								<Button variant="primary" size="sm" onClick={onClose}>
									Done
								</Button>
							</div>
						</div>
					) : (
						<>
							{error && (
								<div className="p-3 bg-sys-error/10 border-l-[4px] border-sys-error">
									<p className="text-[0.75rem] font-medium text-sys-error m-0">
										{error}
									</p>
								</div>
							)}

							<div className="text-[0.75rem] opacity-70 leading-relaxed font-mono">
								Saving this production entry ({sourceEntityType}:
								{sourceEntityId}) as an evaluation test case will automatically
								link back to its production telemetry.
							</div>

							<Field label="Case Name" htmlFor="case-name">
								<TextField
									id="case-name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Give this test case a descriptive name"
									disabled={loading}
								/>
							</Field>

							<Field label="Suggested Expected Outcome" htmlFor="case-outcome">
								<TextField
									id="case-outcome"
									value={expectedOutcome}
									onChange={(e) => setExpectedOutcome(e.target.value)}
									placeholder="Describe the expected correct result"
									disabled={loading}
								/>
							</Field>

							<Field label="Evaluation Rubric (JSON)" htmlFor="case-rubric">
								<textarea
									id="case-rubric"
									value={rubricText}
									onChange={(e) => setRubricText(e.target.value)}
									placeholder="Enter validation criteria in JSON format"
									disabled={loading}
									className="bg-sys-bg px-2 py-1 text-[0.8125rem] text-sys-on-surface outline outline-1 outline-sys-outline focus:outline-sys-primary focus:outline-1 focus:outline-2 transition-none font-mono h-24"
								/>
							</Field>

							<div className="text-[0.625rem] font-mono opacity-50 flex flex-col gap-0.5 border-t border-sys-outline/30 pt-2">
								<div>
									Source Entity: {sourceEntityType}:{sourceEntityId}
								</div>
								{sourceAgentRunId && (
									<div>Agent Run ID: {sourceAgentRunId}</div>
								)}
								{sourceActionId && <div>Action ID: {sourceActionId}</div>}
								{sourceToolCallId && (
									<div>Tool Call ID: {sourceToolCallId}</div>
								)}
								{sourceTraceId && <div>Trace ID: {sourceTraceId}</div>}
							</div>

							<div className="mt-2 flex justify-end gap-2">
								<Button onClick={onClose} disabled={loading} size="sm">
									Cancel
								</Button>
								<Button
									variant="primary"
									onClick={handleSave}
									disabled={loading}
									size="sm"
								>
									{loading ? "Saving..." : "Save Case"}
								</Button>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
