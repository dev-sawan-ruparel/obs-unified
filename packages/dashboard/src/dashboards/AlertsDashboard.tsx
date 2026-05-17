import type {
	AlertEvaluation,
	AlertRule,
	AlertRuleInput,
	AlertTestResponse,
} from "@obs-unified/types";
import { useCallback, useEffect, useState } from "react";
import { useApi } from "../use-api";
import { AlertRuleForm } from "./AlertRuleForm";
import { Button } from "../components/Button";
import { ConnectedRail } from "../components/ConnectedRail";
import { Tag } from "../components/Tag";
import { DataTable, type Column } from "../components/DataTable";
import { EmptyState } from "../components/states";

export function AlertsDashboard() {
	const api = useApi();
	const [rules, setRules] = useState<AlertRule[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showForm, setShowForm] = useState<"new" | { editId: string } | null>(
		null,
	);
	const [submitting, setSubmitting] = useState(false);
	const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<{ rules: AlertRule[] }>("/alerts/rules");
			setRules(data.rules ?? []);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api]);

	useEffect(() => {
		load();
	}, [load]);

	const createRule = useCallback(
		async (input: AlertRuleInput) => {
			setSubmitting(true);
			try {
				await api("/alerts/rules", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(input),
				});
				setShowForm(null);
				await load();
			} finally {
				setSubmitting(false);
			}
		},
		[api, load],
	);

	const updateRule = useCallback(
		async (id: string, input: AlertRuleInput) => {
			setSubmitting(true);
			try {
				await api(`/alerts/rules/${id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(input),
				});
				setShowForm(null);
				await load();
			} finally {
				setSubmitting(false);
			}
		},
		[api, load],
	);

	const deleteRule = useCallback(
		async (id: string) => {
			if (!confirm("Delete this alert rule? Its evaluation history will be removed too.")) return;
			try {
				await api(`/alerts/rules/${id}`, { method: "DELETE" });
				if (selectedRuleId === id) setSelectedRuleId(null);
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[api, load, selectedRuleId],
	);

	const toggleEnabled = useCallback(
		async (rule: AlertRule) => {
			try {
				await api(`/alerts/rules/${rule.id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ enabled: !rule.enabled }),
				});
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[api, load],
	);

	const editingRule =
		showForm && typeof showForm === "object"
			? rules.find((r) => r.id === showForm.editId) ?? null
			: null;

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Alerts
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					Threshold rules · webhook delivery · 5-min evaluation
				</span>
				<div className="ml-auto flex gap-2">
					<Button variant="primary" size="sm" onClick={() => setShowForm("new")}>
						+ New rule
					</Button>
				</div>
			</div>

			{error && (
				<div className="p-3 bg-sys-error/10 border-l-[4px] border-sys-error mb-2">
					<p className="text-[0.8125rem] font-medium text-sys-error m-0">
						{error}
					</p>
				</div>
			)}

			{showForm === "new" && (
				<div className="mb-2">
					<AlertRuleForm
						onSubmit={createRule}
						onCancel={() => setShowForm(null)}
						submitting={submitting}
					/>
				</div>
			)}
			{editingRule && (
				<div className="mb-2">
					<AlertRuleForm
						initial={editingRule}
						onSubmit={(input) => updateRule(editingRule.id, input)}
						onCancel={() => setShowForm(null)}
						submitting={submitting}
					/>
				</div>
			)}

			<div className="grid grid-cols-[2fr_1fr] gap-2 flex-1 min-h-0">
				<DataTable<AlertRule>
					className="overflow-auto"
					rows={rules}
					rowKey={(r) => r.id}
					loading={loading}
					onRowClick={(r) => setSelectedRuleId(r.id)}
					isRowActive={(r) => selectedRuleId === r.id}
					emptyState={
						<EmptyState
							title="No rules yet"
							description={'Click "+ New rule" to create one.'}
						/>
					}
					columns={alertRuleColumns({
						toggleEnabled,
						edit: (id) => setShowForm({ editId: id }),
						deleteRule,
					})}
				/>

				<div className="flex gap-2">
					<div className="flex-1 min-w-0">
						<AlertDetail ruleId={selectedRuleId} rules={rules} />
					</div>
					{selectedRuleId && (
						<ConnectedRail
							entityKind="alert"
							entityId={selectedRuleId}
						/>
					)}
				</div>
			</div>
		</div>
	);
}

function alertRuleColumns({
	toggleEnabled,
	edit,
	deleteRule,
}: {
	toggleEnabled: (rule: AlertRule) => void;
	edit: (id: string) => void;
	deleteRule: (id: string) => void;
}): Column<AlertRule>[] {
	return [
		{
			key: "state",
			header: "State",
			width: "auto",
			cell: (r) => {
				if (!r.enabled) return <Tag tone="muted">Off</Tag>;
				if (r.currentState === "firing")
					return (
						<Tag tone="error" pulse>
							Firing
						</Tag>
					);
				return <Tag tone="primary">OK</Tag>;
			},
		},
		{
			key: "name",
			header: "Name",
			width: "1fr",
			cell: (r) => <span className="font-semibold truncate">{r.name}</span>,
		},
		{
			key: "signal",
			header: "Signal",
			width: "auto",
			font: "mono",
			cell: (r) => r.signal,
		},
		{
			key: "threshold",
			header: "Threshold",
			width: "auto",
			font: "mono",
			cell: (r) => `${r.comparison} ${r.threshold}`,
		},
		{
			key: "window",
			header: "Window",
			width: "auto",
			font: "mono",
			cell: (r) => `${r.windowMins}m`,
		},
		{
			key: "channels",
			header: "Channels",
			width: "auto",
			font: "mono",
			cell: (r) => r.channels.length,
		},
		{
			key: "actions",
			header: "Actions",
			width: "auto",
			cell: (r) => (
				<div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
					<Button
						variant="ghost"
						size="xs"
						onClick={() => toggleEnabled(r)}
					>
						{r.enabled ? "Disable" : "Enable"}
					</Button>
					<Button
						variant="ghost"
						size="xs"
						className="text-sys-primary outline-sys-primary"
						onClick={() => edit(r.id)}
					>
						Edit
					</Button>
					<Button
						variant="ghost"
						size="xs"
						className="text-sys-error outline-sys-error"
						onClick={() => deleteRule(r.id)}
					>
						Delete
					</Button>
				</div>
			),
		},
	];
}

function AlertDetail({
	ruleId,
	rules,
}: {
	ruleId: string | null;
	rules: AlertRule[];
}) {
	const api = useApi();
	const rule = ruleId ? rules.find((r) => r.id === ruleId) : null;
	const [evaluations, setEvaluations] = useState<AlertEvaluation[]>([]);
	const [loading, setLoading] = useState(false);
	const [testResult, setTestResult] = useState<AlertTestResponse | null>(null);
	const [testing, setTesting] = useState(false);

	const loadEvaluations = useCallback(async () => {
		if (!ruleId) return;
		setLoading(true);
		try {
			const data = await api<{ evaluations: AlertEvaluation[] }>(
				`/alerts/evaluations?ruleId=${encodeURIComponent(ruleId)}&hours=24`,
			);
			setEvaluations(data.evaluations ?? []);
		} catch {
			setEvaluations([]);
		} finally {
			setLoading(false);
		}
	}, [api, ruleId]);

	useEffect(() => {
		if (ruleId) loadEvaluations();
	}, [ruleId, loadEvaluations]);

	const runTest = useCallback(async () => {
		if (!ruleId) return;
		setTesting(true);
		try {
			const data = await api<AlertTestResponse>(
				`/alerts/rules/${ruleId}/test`,
				{ method: "POST" },
			);
			setTestResult(data);
		} finally {
			setTesting(false);
		}
	}, [api, ruleId]);

	if (!rule) {
		return (
			<div className="bg-sys-surface border-[1px] border-sys-outline p-3 flex items-center justify-center text-[0.75rem] opacity-60">
				Select a rule to see details.
			</div>
		);
	}

	return (
		<div className="bg-sys-surface border-[1px] border-sys-outline overflow-auto p-3 flex flex-col gap-3">
			<div>
				<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
					Rule
				</div>
				<div className="text-[0.875rem] font-bold">{rule.name}</div>
				<div className="text-[0.625rem] font-mono opacity-60 mt-1 break-all">
					{JSON.stringify(rule.query)}
				</div>
			</div>

			<div>
				<div className="flex items-center justify-between mb-1">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
						Test run (live count)
					</div>
					<Button
						variant="primary"
						size="xs"
						onClick={runTest}
						disabled={testing}
					>
						{testing ? "Running…" : "Test"}
					</Button>
				</div>
				{testResult && (
					<div className="text-[0.875rem] font-mono">
						value <span className="font-bold">{testResult.value}</span>{" "}
						<span className="opacity-60">
							({testResult.comparison} {testResult.threshold}) →
						</span>{" "}
						<span
							className={
								testResult.wouldFire
									? "text-sys-error font-bold"
									: "text-sys-primary font-bold"
							}
						>
							{testResult.wouldFire ? "Would fire" : "OK"}
						</span>
					</div>
				)}
			</div>

			<div className="border-t-[1px] border-sys-outline pt-3">
				<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60 mb-2">
					Evaluations (24h)
				</div>
				{loading && (
					<div className="text-[0.75rem] opacity-60">Loading…</div>
				)}
				{!loading && evaluations.length === 0 && (
					<div className="text-[0.75rem] opacity-60">No evaluations yet.</div>
				)}
				{!loading && evaluations.length > 0 && (
					<div className="flex flex-col gap-1 max-h-[400px] overflow-auto">
						{evaluations.map((ev) => (
							<div
								key={ev.id}
								className="grid grid-cols-[auto_auto_auto_1fr] gap-2 text-[0.75rem] font-mono"
							>
								<span
									className={
										ev.state === "firing"
											? "text-sys-error font-bold"
											: "opacity-60"
									}
								>
									{ev.state.toUpperCase()}
								</span>
								<span className="font-bold">{ev.value}</span>
								<span>{ev.notified ? "✓" : "·"}</span>
								<span className="opacity-60 truncate">
									{new Date(ev.evaluatedAt).toLocaleString()}
								</span>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
