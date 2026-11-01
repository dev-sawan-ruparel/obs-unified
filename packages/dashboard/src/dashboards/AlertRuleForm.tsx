import type {
	AlertChannel,
	AlertComparison,
	AlertMetricAggregation,
	AlertMetricField,
	AlertMetricNoData,
	AlertQuery,
	AlertQueryAI,
	AlertQueryLogs,
	AlertQueryMetrics,
	AlertQuerySpans,
	AlertQueryUsage,
	AlertRule,
	AlertRuleInput,
	AlertSignal,
	LogSeverity,
} from "@obsunified/types";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Field, SelectField, TextField } from "../components/forms";
import {
	formatAttributes,
	formatMetricNames,
	METRIC_AGGREGATIONS,
	METRIC_FIELDS,
	parseAttributes,
	parseMetricNames,
	parseRecipients,
} from "./alert-rule-text";

interface Props {
	initial?: AlertRule;
	onSubmit: (input: AlertRuleInput) => Promise<void>;
	onCancel: () => void;
	submitting: boolean;
}

const SIGNALS: Array<{ value: AlertSignal; label: string }> = [
	{ value: "spans", label: "Traces" },
	{ value: "logs", label: "Logs" },
	{ value: "usage", label: "Usage errors" },
	{ value: "ai", label: "AI calls" },
	{ value: "metrics", label: "Metrics" },
];

const COMPARISONS: AlertComparison[] = [">", ">=", "<", "<=", "==", "!="];

/**
 * Form-local channel rows: an email row edits its recipients as text and
 * is turned into `{ type: "email", to: [...] }` on submit.
 */
type ChannelDraft =
	| { type: "webhook"; url: string; headers?: Record<string, string> }
	| { type: "email"; toText: string };

const toDraft = (ch: AlertChannel): ChannelDraft =>
	ch.type === "email"
		? { type: "email", toText: ch.to.join(", ") }
		: { type: "webhook", url: ch.url, headers: ch.headers };

const fromDraft = (d: ChannelDraft): AlertChannel =>
	d.type === "email"
		? { type: "email", to: parseRecipients(d.toText) }
		: {
				type: "webhook",
				url: d.url,
				...(d.headers ? { headers: d.headers } : {}),
			};

/** Metrics query fields as the form edits them (text for lists/maps). */
interface MetricDraft {
	metric: string;
	attributes: string;
	resourceAttributes: string;
	serviceName: string;
	field: AlertMetricField;
	aggregation: AlertMetricAggregation;
	ratio: boolean;
	denMetric: string;
	denAttributes: string;
	minDenominator: string;
	/** Empty: the evaluator default (300 s). */
	staleSecs: string;
	noData: AlertMetricNoData;
}

const metricDraftFrom = (q: AlertQuery | undefined): MetricDraft => {
	const m = (q ?? {}) as Partial<AlertQueryMetrics>;
	return {
		metric: formatMetricNames(m.metric),
		attributes: formatAttributes(m.attributes),
		resourceAttributes: formatAttributes(m.resourceAttributes),
		serviceName: m.serviceName ?? "",
		field: m.field ?? "value",
		aggregation: m.aggregation ?? "last",
		ratio: Boolean(m.denominator),
		denMetric: formatMetricNames(m.denominator?.metric),
		denAttributes: formatAttributes(m.denominator?.attributes),
		minDenominator:
			m.minDenominator !== undefined ? String(m.minDenominator) : "0",
		staleSecs: m.staleSecs !== undefined ? String(m.staleSecs) : "",
		noData: m.noData ?? "zero",
	};
};

const metricQueryFrom = (
	d: MetricDraft,
): { ok: true; query: AlertQueryMetrics } | { ok: false; error: string } => {
	const metric = parseMetricNames(d.metric);
	if (!metric || (Array.isArray(metric) && metric.length === 0))
		return { ok: false, error: "Metric name is required" };
	const attributes = parseAttributes(d.attributes);
	if (!attributes.ok) return attributes;
	const resourceAttributes = parseAttributes(d.resourceAttributes);
	if (!resourceAttributes.ok) return resourceAttributes;
	const query: AlertQueryMetrics = {
		metric,
		aggregation: d.aggregation,
		...(attributes.value ? { attributes: attributes.value } : {}),
		...(resourceAttributes.value
			? { resourceAttributes: resourceAttributes.value }
			: {}),
		...(d.serviceName.trim() ? { serviceName: d.serviceName.trim() } : {}),
		...(d.field !== "value" ? { field: d.field } : {}),
		...(d.noData !== "zero" ? { noData: d.noData } : {}),
	};
	if (d.staleSecs.trim()) {
		const staleSecs = Number(d.staleSecs);
		if (!Number.isInteger(staleSecs) || staleSecs < 1)
			return {
				ok: false,
				error: "Stale after (s) must be a whole number >= 1",
			};
		query.staleSecs = staleSecs;
	}
	if (d.ratio) {
		const denMetric = parseMetricNames(d.denMetric);
		if (!denMetric)
			return { ok: false, error: "Denominator metric is required" };
		const denAttributes = parseAttributes(d.denAttributes);
		if (!denAttributes.ok) return denAttributes;
		const minDenominator = Number(d.minDenominator || "0");
		if (!Number.isFinite(minDenominator) || minDenominator < 0)
			return { ok: false, error: "Minimum denominator must be >= 0" };
		query.denominator = {
			metric: denMetric,
			...(denAttributes.value ? { attributes: denAttributes.value } : {}),
			...(d.serviceName.trim() ? { serviceName: d.serviceName.trim() } : {}),
			...(d.field !== "value" ? { field: d.field } : {}),
		};
		query.minDenominator = minDenominator;
	}
	return { ok: true, query };
};
const LOG_SEVERITIES: LogSeverity[] = [
	"DEBUG",
	"INFO",
	"WARN",
	"ERROR",
	"FATAL",
];

export function AlertRuleForm({
	initial,
	onSubmit,
	onCancel,
	submitting,
}: Props) {
	const [name, setName] = useState(initial?.name ?? "");
	const [signal, setSignal] = useState<AlertSignal>(initial?.signal ?? "spans");
	const [threshold, setThreshold] = useState<string>(
		initial?.threshold !== undefined ? String(initial.threshold) : "1",
	);
	const [windowMins, setWindowMins] = useState<string>(
		initial?.windowMins ? String(initial.windowMins) : "5",
	);
	const [comparison, setComparison] = useState<AlertComparison>(
		initial?.comparison ?? ">=",
	);
	const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
	const [pendingSecs, setPendingSecs] = useState<string>(
		String(initial?.pendingSecs ?? 0),
	);
	const [metricDraft, setMetricDraft] = useState<MetricDraft>(() =>
		metricDraftFrom(initial?.signal === "metrics" ? initial.query : undefined),
	);
	const editMetric = (patch: Partial<MetricDraft>) =>
		setMetricDraft((d) => ({ ...d, ...patch }));
	const [query, setQuery] = useState<AlertQuery>(() => {
		if (initial) return initial.query;
		return { statusCode: "error" };
	});
	const [channels, setChannels] = useState<ChannelDraft[]>(
		initial?.channels.map(toDraft) ?? [{ type: "webhook", url: "" }],
	);
	const [err, setErr] = useState<string | null>(null);

	const canSubmit = useMemo(() => {
		if (!name.trim()) return false;
		if (!Number.isFinite(Number(threshold))) return false;
		if (!Number.isFinite(Number(windowMins)) || Number(windowMins) < 1)
			return false;
		const pending = Number(pendingSecs);
		if (!Number.isInteger(pending) || pending < 0) return false;
		if (signal === "metrics" && !metricDraft.metric.trim()) return false;
		if (channels.length === 0) return false;
		for (const ch of channels) {
			if (ch.type === "email") {
				if (parseRecipients(ch.toText).length === 0) return false;
			} else if (!ch.url || !/^https?:\/\//.test(ch.url)) return false;
		}
		return true;
	}, [name, threshold, windowMins, pendingSecs, signal, metricDraft, channels]);

	const changeSignal = (next: AlertSignal) => {
		setSignal(next);
		// Reset query to a sensible default for the new signal.
		switch (next) {
			case "spans":
				setQuery({ statusCode: "error" });
				break;
			case "logs":
				setQuery({ severity: "ERROR" });
				break;
			case "usage":
				setQuery({});
				break;
			case "ai":
				setQuery({ isError: true });
				break;
			case "metrics":
				// Edited through metricDraft; built on submit.
				break;
		}
	};

	const submit = async () => {
		setErr(null);
		let ruleQuery: AlertQuery = query;
		if (signal === "metrics") {
			const built = metricQueryFrom(metricDraft);
			if (!built.ok) {
				setErr(built.error);
				return;
			}
			ruleQuery = built.query;
		}
		const input: AlertRuleInput = {
			name: name.trim(),
			signal,
			query: ruleQuery,
			threshold: Number(threshold),
			windowMins: Number(windowMins),
			comparison,
			channels: channels.map(fromDraft),
			enabled,
			pendingSecs: Number(pendingSecs),
		};
		try {
			await onSubmit(input);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		}
	};
	const spansQuery = query as AlertQuerySpans;
	const logsQuery = query as AlertQueryLogs;
	const usageQuery = query as AlertQueryUsage;
	const aiQuery = query as AlertQueryAI;

	return (
		<div className="bg-sys-surface p-4 border-[1px] border-sys-outline flex flex-col gap-3">
			<div className="text-[0.875rem] font-semibold">
				{initial ? "Edit rule" : "New rule"}
			</div>

			{err && (
				<div className="p-2 bg-sys-error/10 border-l-[4px] border-sys-error text-[0.75rem] font-bold text-sys-error">
					{err}
				</div>
			)}

			<Field label="Name">
				<TextField
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="High error rate on checkout"
					className="w-full"
				/>
			</Field>

			<div className="grid grid-cols-5 gap-2">
				<Field label="Signal">
					<SelectField
						value={signal}
						onChange={(e) => changeSignal(e.target.value as AlertSignal)}
						className="w-full"
						options={SIGNALS.map((s): [string, string] => [s.value, s.label])}
					/>
				</Field>
				<Field label="Comparison">
					<SelectField
						value={comparison}
						onChange={(e) => setComparison(e.target.value as AlertComparison)}
						mono
						className="w-full"
						options={COMPARISONS.map((c): [string, string] => [c, c])}
					/>
				</Field>
				<Field label="Threshold">
					<TextField
						type="number"
						value={threshold}
						onChange={(e) => setThreshold(e.target.value)}
						mono
						className="w-full"
					/>
				</Field>
				<Field label="Window (min)">
					<TextField
						type="number"
						value={windowMins}
						onChange={(e) => setWindowMins(e.target.value)}
						min={1}
						mono
						className="w-full"
					/>
				</Field>
				<Field label="For (s)">
					<TextField
						type="number"
						value={pendingSecs}
						onChange={(e) => setPendingSecs(e.target.value)}
						min={0}
						step={1}
						mono
						className="w-full"
						title="Seconds the condition must hold on consecutive evaluations before the rule fires"
					/>
				</Field>
			</div>

			{/* Signal-specific filters */}
			<div className="border-[1px] border-sys-outline p-3">
				<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle mb-2">
					Filter
				</div>
				{signal === "spans" && (
					<div className="grid grid-cols-3 gap-2">
						<Field label="Service (optional)">
							<TextField
								value={spansQuery.serviceName ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										serviceName: e.target.value || undefined,
									})
								}
								className="w-full"
							/>
						</Field>
						<Field label="Span name (optional)">
							<TextField
								value={spansQuery.spanName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, spanName: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Status">
							<SelectField
								value={spansQuery.statusCode ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										statusCode: (e.target.value as "error" | "ok") || undefined,
									})
								}
								className="w-full"
								options={[
									["", "Any"],
									["error", "Error"],
									["ok", "OK"],
								]}
							/>
						</Field>
					</div>
				)}
				{signal === "logs" && (
					<div className="grid grid-cols-2 gap-2">
						<Field label="Service (optional)">
							<TextField
								value={logsQuery.serviceName ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										serviceName: e.target.value || undefined,
									})
								}
								className="w-full"
							/>
						</Field>
						<Field label="Severity">
							<SelectField
								value={logsQuery.severity ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										severity: (e.target.value as LogSeverity) || undefined,
									})
								}
								className="w-full"
								options={[
									["", "Any"],
									...LOG_SEVERITIES.map((s): [string, string] => [s, s]),
								]}
							/>
						</Field>
					</div>
				)}
				{signal === "usage" && (
					<div className="grid grid-cols-2 gap-2">
						<Field label="Event name (optional)">
							<TextField
								value={usageQuery.eventName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, eventName: e.target.value || undefined })
								}
								placeholder="UncaughtError"
								className="w-full"
							/>
						</Field>
						<Field label="Path pattern (SQL LIKE)">
							<TextField
								value={usageQuery.pathPattern ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										pathPattern: e.target.value || undefined,
									})
								}
								placeholder="/checkout%"
								mono
								className="w-full"
							/>
						</Field>
					</div>
				)}
				{signal === "ai" && (
					<div className="grid grid-cols-3 gap-2">
						<Field label="Provider (optional)">
							<TextField
								value={aiQuery.provider ?? ""}
								onChange={(e) =>
									setQuery({ ...query, provider: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Model (optional)">
							<TextField
								value={aiQuery.model ?? ""}
								onChange={(e) =>
									setQuery({ ...query, model: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Errors only">
							<SelectField
								value={aiQuery.isError ? "true" : ""}
								onChange={(e) =>
									setQuery({
										...query,
										isError: e.target.value === "true" ? true : undefined,
									})
								}
								className="w-full"
								options={[
									["", "All calls"],
									["true", "Errors only"],
								]}
							/>
						</Field>
					</div>
				)}
				{signal === "metrics" && (
					<div className="flex flex-col gap-2">
						<div className="grid grid-cols-3 gap-2">
							<Field label="Metric (comma-separated names are summed)">
								<TextField
									value={metricDraft.metric}
									onChange={(e) => editMetric({ metric: e.target.value })}
									placeholder="calls_failed_total"
									mono
									className="w-full"
								/>
							</Field>
							<Field label="Aggregation">
								<SelectField
									value={metricDraft.aggregation}
									onChange={(e) =>
										editMetric({
											aggregation: e.target.value as AlertMetricAggregation,
											ratio:
												e.target.value === "age_seconds"
													? false
													: metricDraft.ratio,
										})
									}
									className="w-full"
									options={METRIC_AGGREGATIONS.map((a): [string, string] => [
										a.value,
										a.label,
									])}
								/>
							</Field>
							<Field label="Field">
								<SelectField
									value={metricDraft.field}
									onChange={(e) =>
										editMetric({ field: e.target.value as AlertMetricField })
									}
									mono
									className="w-full"
									options={METRIC_FIELDS.map((f): [string, string] => [f, f])}
								/>
							</Field>
						</div>
						<div className="grid grid-cols-3 gap-2">
							<Field label="Attributes (key=value, …)">
								<TextField
									value={metricDraft.attributes}
									onChange={(e) => editMetric({ attributes: e.target.value })}
									placeholder="code=500"
									mono
									className="w-full"
								/>
							</Field>
							<Field label="Resource attributes (key=value, …)">
								<TextField
									value={metricDraft.resourceAttributes}
									onChange={(e) =>
										editMetric({ resourceAttributes: e.target.value })
									}
									placeholder="deployment.environment=prod"
									mono
									className="w-full"
								/>
							</Field>
							<Field label="Service (optional)">
								<TextField
									value={metricDraft.serviceName}
									onChange={(e) => editMetric({ serviceName: e.target.value })}
									className="w-full"
								/>
							</Field>
						</div>
						<div className="grid grid-cols-3 gap-2">
							<Field label="Stale after (s)">
								<TextField
									type="number"
									value={metricDraft.staleSecs}
									onChange={(e) => editMetric({ staleSecs: e.target.value })}
									placeholder="300"
									min={1}
									mono
									className="w-full"
									title="last/min/max/avg/sum ignore series whose newest point is older than this"
								/>
							</Field>
							<Field label="No data">
								<SelectField
									value={metricDraft.noData}
									onChange={(e) =>
										editMetric({ noData: e.target.value as AlertMetricNoData })
									}
									className="w-full"
									options={[
										["zero", "Evaluate as 0"],
										["keep", "Keep current state"],
									]}
								/>
							</Field>
						</div>
						<label className="flex items-center gap-2 text-[0.8125rem] font-medium">
							<input
								type="checkbox"
								checked={metricDraft.ratio}
								disabled={metricDraft.aggregation === "age_seconds"}
								onChange={(e) => editMetric({ ratio: e.target.checked })}
								className="accent-sys-primary"
							/>
							Ratio: divide by a denominator
						</label>
						{metricDraft.ratio && (
							<div className="grid grid-cols-3 gap-2">
								<Field label="Denominator metric">
									<TextField
										value={metricDraft.denMetric}
										onChange={(e) => editMetric({ denMetric: e.target.value })}
										placeholder="calls_total"
										mono
										className="w-full"
									/>
								</Field>
								<Field label="Denominator attributes">
									<TextField
										value={metricDraft.denAttributes}
										onChange={(e) =>
											editMetric({ denAttributes: e.target.value })
										}
										mono
										className="w-full"
									/>
								</Field>
								<Field label="Minimum denominator">
									<TextField
										type="number"
										value={metricDraft.minDenominator}
										onChange={(e) =>
											editMetric({ minDenominator: e.target.value })
										}
										min={0}
										mono
										className="w-full"
									/>
								</Field>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Channels */}
			<div className="border-[1px] border-sys-outline p-3">
				<div className="flex items-center justify-between mb-2">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
						Channels
					</div>
					<div className="flex gap-2">
						<Button
							size="xs"
							onClick={() =>
								setChannels([...channels, { type: "webhook", url: "" }])
							}
						>
							+ Webhook
						</Button>
						<Button
							size="xs"
							onClick={() =>
								setChannels([...channels, { type: "email", toText: "" }])
							}
						>
							+ Email
						</Button>
					</div>
				</div>
				<div className="flex flex-col gap-2">
					{channels.map((ch, idx) => (
						<div
							// Rows have no stable id; position is the identity while editing.
							// biome-ignore lint/suspicious/noArrayIndexKey: see above
							key={idx}
							className="flex gap-2 items-center"
						>
							<span className="text-[0.625rem] font-bold uppercase w-14 opacity-70">
								{ch.type}
							</span>
							<TextField
								value={ch.type === "email" ? ch.toText : ch.url}
								onChange={(e) => {
									const next = [...channels];
									next[idx] =
										ch.type === "email"
											? { ...ch, toText: e.target.value }
											: { ...ch, url: e.target.value };
									setChannels(next);
								}}
								placeholder={
									ch.type === "email"
										? "oncall@example.com, ops@example.com"
										: "https://hooks.slack.com/…"
								}
								mono
								className="flex-1"
							/>
							<Button
								size="xs"
								className="text-sys-error outline-sys-error"
								onClick={() =>
									setChannels(channels.filter((_, i) => i !== idx))
								}
							>
								Remove
							</Button>
						</div>
					))}
				</div>
				{channels.some((c) => c.type === "email") && (
					<div className="mt-2 text-[0.6875rem] opacity-70">
						Email uses the collector&apos;s SMTP settings (ALERT_SMTP_*); a
						collector without them refuses the rule.
					</div>
				)}
			</div>

			<label className="flex items-center gap-2 text-[0.8125rem] font-medium">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
					className="accent-sys-primary"
				/>
				Enabled
			</label>

			<div className="flex gap-2 justify-end">
				<Button size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={submit}
					disabled={!canSubmit || submitting}
				>
					{submitting ? "Saving…" : initial ? "Save" : "Create"}
				</Button>
			</div>
		</div>
	);
}

// Field is imported from components/forms.tsx
