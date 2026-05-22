import type {
	AlertChannel,
	AlertComparison,
	AlertQuery,
	AlertRule,
	AlertRuleInput,
	AlertSignal,
	AlertWebhookChannel,
	LogSeverity,
} from "@obs-unified/types";
import { useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Field, SelectField, TextField } from "../components/forms";

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
];

const COMPARISONS: AlertComparison[] = [">", ">=", "<", "<="];
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
	const [query, setQuery] = useState<AlertQuery>(() => {
		if (initial) return initial.query;
		return { statusCode: "error" };
	});
	const [channels, setChannels] = useState<AlertChannel[]>(
		initial?.channels ?? [{ type: "webhook", url: "" }],
	);
	const [err, setErr] = useState<string | null>(null);

	const canSubmit = useMemo(() => {
		if (!name.trim()) return false;
		if (!Number.isFinite(Number(threshold))) return false;
		if (!Number.isFinite(Number(windowMins)) || Number(windowMins) < 1)
			return false;
		if (channels.length === 0) return false;
		for (const ch of channels) {
			if (!ch.url || !/^https?:\/\//.test(ch.url)) return false;
		}
		return true;
	}, [name, threshold, windowMins, channels]);

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
		}
	};

	const submit = async () => {
		setErr(null);
		const input: AlertRuleInput = {
			name: name.trim(),
			signal,
			query,
			threshold: Number(threshold),
			windowMins: Number(windowMins),
			comparison,
			channels,
			enabled,
		};
		try {
			await onSubmit(input);
		} catch (e) {
			setErr(e instanceof Error ? e.message : String(e));
		}
	};

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

			<div className="grid grid-cols-4 gap-2">
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
								value={(query as any).serviceName ?? ""}
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
								value={(query as any).spanName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, spanName: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Status">
							<SelectField
								value={(query as any).statusCode ?? ""}
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
								value={(query as any).serviceName ?? ""}
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
								value={(query as any).severity ?? ""}
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
								value={(query as any).eventName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, eventName: e.target.value || undefined })
								}
								placeholder="UncaughtError"
								className="w-full"
							/>
						</Field>
						<Field label="Path pattern (SQL LIKE)">
							<TextField
								value={(query as any).pathPattern ?? ""}
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
								value={(query as any).provider ?? ""}
								onChange={(e) =>
									setQuery({ ...query, provider: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Model (optional)">
							<TextField
								value={(query as any).model ?? ""}
								onChange={(e) =>
									setQuery({ ...query, model: e.target.value || undefined })
								}
								className="w-full"
							/>
						</Field>
						<Field label="Errors only">
							<SelectField
								value={(query as any).isError ? "true" : ""}
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
			</div>

			{/* Channels */}
			<div className="border-[1px] border-sys-outline p-3">
				<div className="flex items-center justify-between mb-2">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.12em] text-sys-on-surface-subtle">
						Webhook channels
					</div>
					<Button
						size="xs"
						onClick={() =>
							setChannels([...channels, { type: "webhook", url: "" }])
						}
					>
						+ Add
					</Button>
				</div>
				<div className="flex flex-col gap-2">
					{channels.map((ch, idx) => (
						<div key={idx} className="flex gap-2 items-center">
							<TextField
								value={(ch as AlertWebhookChannel).url}
								onChange={(e) => {
									const next = [...channels];
									next[idx] = {
										...(ch as AlertWebhookChannel),
										url: e.target.value,
									};
									setChannels(next);
								}}
								placeholder="https://hooks.slack.com/…"
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
