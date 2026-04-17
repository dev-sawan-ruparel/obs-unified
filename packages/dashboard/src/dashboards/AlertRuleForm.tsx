import type {
	AlertChannel,
	AlertComparison,
	AlertQuery,
	AlertRule,
	AlertRuleInput,
	AlertSignal,
	AlertWebhookChannel,
	LogSeverity,
} from "@obs/types";
import { useMemo, useState } from "react";

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
const LOG_SEVERITIES: LogSeverity[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

export function AlertRuleForm({ initial, onSubmit, onCancel, submitting }: Props) {
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
			<div className="text-[0.875rem] font-bold tracking-widest uppercase">
				{initial ? "EDIT RULE" : "NEW RULE"}
			</div>

			{err && (
				<div className="p-2 bg-sys-error/10 border-l-[4px] border-sys-error text-[0.75rem] font-bold text-sys-error">
					{err}
				</div>
			)}

			<Field label="Name">
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="High error rate on checkout"
					className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
				/>
			</Field>

			<div className="grid grid-cols-4 gap-2">
				<Field label="Signal">
					<select
						value={signal}
						onChange={(e) => changeSignal(e.target.value as AlertSignal)}
						className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
					>
						{SIGNALS.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Comparison">
					<select
						value={comparison}
						onChange={(e) => setComparison(e.target.value as AlertComparison)}
						className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full font-mono"
					>
						{COMPARISONS.map((c) => (
							<option key={c} value={c}>
								{c}
							</option>
						))}
					</select>
				</Field>
				<Field label="Threshold">
					<input
						type="number"
						value={threshold}
						onChange={(e) => setThreshold(e.target.value)}
						className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full font-mono"
					/>
				</Field>
				<Field label="Window (min)">
					<input
						type="number"
						value={windowMins}
						onChange={(e) => setWindowMins(e.target.value)}
						min="1"
						className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full font-mono"
					/>
				</Field>
			</div>

			{/* Signal-specific filters */}
			<div className="border-[1px] border-sys-outline p-3">
				<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60 mb-2">
					Filter
				</div>
				{signal === "spans" && (
					<div className="grid grid-cols-3 gap-2">
						<Field label="Service (optional)">
							<input
								value={(query as any).serviceName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, serviceName: e.target.value || undefined })
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Span name (optional)">
							<input
								value={(query as any).spanName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, spanName: e.target.value || undefined })
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Status">
							<select
								value={(query as any).statusCode ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										statusCode: (e.target.value as "error" | "ok") || undefined,
									})
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							>
								<option value="">any</option>
								<option value="error">error</option>
								<option value="ok">ok</option>
							</select>
						</Field>
					</div>
				)}
				{signal === "logs" && (
					<div className="grid grid-cols-2 gap-2">
						<Field label="Service (optional)">
							<input
								value={(query as any).serviceName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, serviceName: e.target.value || undefined })
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Severity">
							<select
								value={(query as any).severity ?? ""}
								onChange={(e) =>
									setQuery({
										...query,
										severity: (e.target.value as LogSeverity) || undefined,
									})
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							>
								<option value="">any</option>
								{LOG_SEVERITIES.map((s) => (
									<option key={s} value={s}>
										{s}
									</option>
								))}
							</select>
						</Field>
					</div>
				)}
				{signal === "usage" && (
					<div className="grid grid-cols-2 gap-2">
						<Field label="Event name (optional)">
							<input
								value={(query as any).eventName ?? ""}
								onChange={(e) =>
									setQuery({ ...query, eventName: e.target.value || undefined })
								}
								placeholder="UncaughtError"
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Path pattern (SQL LIKE)">
							<input
								value={(query as any).pathPattern ?? ""}
								onChange={(e) =>
									setQuery({ ...query, pathPattern: e.target.value || undefined })
								}
								placeholder="/checkout%"
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full font-mono"
							/>
						</Field>
					</div>
				)}
				{signal === "ai" && (
					<div className="grid grid-cols-3 gap-2">
						<Field label="Provider (optional)">
							<input
								value={(query as any).provider ?? ""}
								onChange={(e) =>
									setQuery({ ...query, provider: e.target.value || undefined })
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Model (optional)">
							<input
								value={(query as any).model ?? ""}
								onChange={(e) =>
									setQuery({ ...query, model: e.target.value || undefined })
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							/>
						</Field>
						<Field label="Errors only">
							<select
								value={(query as any).isError ? "true" : ""}
								onChange={(e) =>
									setQuery({
										...query,
										isError: e.target.value === "true" ? true : undefined,
									})
								}
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline w-full"
							>
								<option value="">all calls</option>
								<option value="true">errors only</option>
							</select>
						</Field>
					</div>
				)}
			</div>

			{/* Channels */}
			<div className="border-[1px] border-sys-outline p-3">
				<div className="flex items-center justify-between mb-2">
					<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
						Webhook channels
					</div>
					<button
						type="button"
						onClick={() =>
							setChannels([...channels, { type: "webhook", url: "" }])
						}
						className="px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-outline outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
					>
						+ ADD
					</button>
				</div>
				<div className="flex flex-col gap-2">
					{channels.map((ch, idx) => (
						<div key={idx} className="flex gap-2 items-center">
							<input
								value={(ch as AlertWebhookChannel).url}
								onChange={(e) => {
									const next = [...channels];
									next[idx] = { ...(ch as AlertWebhookChannel), url: e.target.value };
									setChannels(next);
								}}
								placeholder="https://hooks.slack.com/…"
								className="bg-sys-bg px-2 py-1 text-[0.875rem] outline outline-1 outline-sys-outline flex-1 font-mono"
							/>
							<button
								type="button"
								onClick={() => setChannels(channels.filter((_, i) => i !== idx))}
								className="px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-error outline outline-1 outline-sys-error hover:bg-sys-surface-low cursor-pointer"
							>
								REMOVE
							</button>
						</div>
					))}
				</div>
			</div>

			<label className="flex items-center gap-2 text-[0.75rem] font-bold uppercase tracking-[0.05em]">
				<input
					type="checkbox"
					checked={enabled}
					onChange={(e) => setEnabled(e.target.checked)}
				/>
				Enabled
			</label>

			<div className="flex gap-2 justify-end">
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-transparent text-sys-outline outline outline-1 outline-sys-outline hover:bg-sys-surface-low cursor-pointer"
				>
					CANCEL
				</button>
				<button
					type="button"
					onClick={submit}
					disabled={!canSubmit || submitting}
					className="px-3 py-1.5 text-[0.75rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:opacity-90 cursor-pointer disabled:opacity-40"
				>
					{submitting ? "SAVING…" : initial ? "SAVE" : "CREATE"}
				</button>
			</div>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<label className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-60">
				{label}
			</label>
			{children}
		</div>
	);
}
