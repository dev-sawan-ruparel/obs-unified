import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogRecord, LogsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";
import { useTimeWindowHours } from "../provider";
import { useLiveTail, type TailEvent } from "../hooks/useLiveTail";
import {
	BarList,
	Card,
	SectionTitle,
	Stat,
	TimeSeriesBars,
	UpdatedChip,
	binByInterval,
} from "../components/primitives";
import { Button } from "../components/Button";
import { Input, Select } from "../components/forms";
import { StateRow } from "../components/states";

interface LiveLogRow {
	logId: string;
	traceId: string | null;
	spanId: string | null;
	serviceName: string | null;
	severity: "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";
	loggerName: string | null;
	message: string;
	occurredAt: string;
}

type SelectedLog = (LogRecord | LiveLogRow) & { attributesJson?: string | null };

const isLogEvent = (e: TailEvent): e is TailEvent<LiveLogRow> => e.kind === "log";

const SEVERITY_BADGE_BG: Record<string, string> = {
	ERROR: "bg-sys-error text-white",
	FATAL: "bg-sys-error text-white",
	WARN: "bg-sys-warning text-white",
	INFO: "bg-sys-surface-high text-sys-on-surface",
	DEBUG: "bg-sys-surface-low text-sys-on-surface-muted",
};

function formatClockTime(iso: string): string {
	const d = new Date(iso);
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	const ss = String(d.getSeconds()).padStart(2, "0");
	const ms = String(d.getMilliseconds()).padStart(3, "0");
	return `${hh}:${mm}:${ss}.${ms}`;
}

export function LogsDashboard() {
	const api = useApi();
	const [overview, setOverview] = useState<LogsOverviewResponse | null>(null);
	const hours = String(useTimeWindowHours());
	const [loading, setLoading] = useState(false);
	const [severityFilter, setSeverityFilter] = useState<"all" | "ERROR" | "WARN" | "INFO">("all");
	const [liveMode, setLiveMode] = useState(false);
	const [selectedServices, setSelectedServices] = useState<ReadonlySet<string>>(new Set());
	const [selectedLoggers, setSelectedLoggers] = useState<ReadonlySet<string>>(new Set());
	const [selectedLog, setSelectedLog] = useState<SelectedLog | null>(null);

	const liveTail = useLiveTail<LiveLogRow>(isLogEvent, {
		kinds: ["log"],
		enabled: liveMode,
		maxRows: 500,
	});

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<LogsOverviewResponse>(`/logs/overview?hours=${hours}`);
			setOverview(data);
		} catch (err) {
			console.error(err);
		} finally {
			setLoading(false);
		}
	}, [hours, api]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	const bucketCount = 24;
	const allBuckets = useMemo(
		() => binByInterval(overview?.logs.map((l) => l.receivedAt) ?? [], Number(hours) * 60, bucketCount),
		[overview, hours],
	);
	const errorBuckets = useMemo(
		() =>
			binByInterval(
				overview?.logs
					.filter((l) => l.severity === "ERROR" || l.severity === "FATAL")
					.map((l) => l.receivedAt) ?? [],
				Number(hours) * 60,
				bucketCount,
			),
		[overview, hours],
	);
	const warnBuckets = useMemo(
		() =>
			binByInterval(
				overview?.logs.filter((l) => l.severity === "WARN").map((l) => l.receivedAt) ?? [],
				Number(hours) * 60,
				bucketCount,
			),
		[overview, hours],
	);

	const byService = useMemo(() => {
		const map = new Map<string, number>();
		for (const l of overview?.logs ?? []) {
			const k = l.serviceName || "unknown";
			map.set(k, (map.get(k) ?? 0) + 1);
		}
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [overview]);

	const byLogger = useMemo(() => {
		const map = new Map<string, number>();
		for (const l of overview?.logs ?? []) {
			const k = l.loggerName || "unknown";
			map.set(k, (map.get(k) ?? 0) + 1);
		}
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [overview]);

	const windowStart = Date.now() - Number(hours) * 60 * 60 * 1000;
	const bucketMs = (Number(hours) * 60 * 60 * 1000) / bucketCount;
	const timeSeries = allBuckets.map((v, i) => ({
		t: new Date(windowStart + i * bucketMs).toISOString(),
		v,
	}));

	const matchesFilters = useCallback(
		(l: { severity: string; serviceName: string | null; loggerName: string | null }) => {
			if (severityFilter === "ERROR" && !(l.severity === "ERROR" || l.severity === "FATAL")) return false;
			if (severityFilter === "WARN" && l.severity !== "WARN") return false;
			if (severityFilter === "INFO" && l.severity !== "INFO") return false;
			if (selectedServices.size > 0 && !selectedServices.has(l.serviceName || "unknown")) return false;
			if (selectedLoggers.size > 0 && !selectedLoggers.has(l.loggerName || "unknown")) return false;
			return true;
		},
		[severityFilter, selectedServices, selectedLoggers],
	);

	const filteredLogs = useMemo(
		() => (overview ? overview.logs.filter(matchesFilters) : []),
		[overview, matchesFilters],
	);

	const liveFilteredLogs = useMemo(
		() => liveTail.rows.filter(matchesFilters),
		[liveTail.rows, matchesFilters],
	);

	const toggleService = useCallback((label: string) => {
		setSelectedServices((prev) => {
			const next = new Set(prev);
			if (next.has(label)) next.delete(label);
			else next.add(label);
			return next;
		});
	}, []);

	const toggleLogger = useCallback((label: string) => {
		setSelectedLoggers((prev) => {
			const next = new Set(prev);
			if (next.has(label)) next.delete(label);
			else next.add(label);
			return next;
		});
	}, []);

	const clearAllFilters = useCallback(() => {
		setSelectedServices(new Set());
		setSelectedLoggers(new Set());
		setSeverityFilter("all");
	}, []);

	const activeChips = useMemo(() => {
		const chips: Array<{ key: string; label: string; onClear: () => void }> = [];
		if (severityFilter !== "all") {
			chips.push({
				key: `sev:${severityFilter}`,
				label: `severity:${severityFilter}`,
				onClear: () => setSeverityFilter("all"),
			});
		}
		for (const s of selectedServices) {
			chips.push({
				key: `svc:${s}`,
				label: `service:${s}`,
				onClear: () => toggleService(s),
			});
		}
		for (const l of selectedLoggers) {
			chips.push({
				key: `log:${l}`,
				label: `logger:${l}`,
				onClear: () => toggleLogger(l),
			});
		}
		return chips;
	}, [severityFilter, selectedServices, selectedLoggers, toggleService, toggleLogger]);

	const visibleLogs = liveMode ? liveFilteredLogs : filteredLogs;

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<Input
					type="text"
					className="min-w-[200px] flex-1"
					placeholder="Search log messages, attributes…"
					disabled
				/>
				<Select
					value={severityFilter}
					onChange={(e) =>
						setSeverityFilter(e.target.value as typeof severityFilter)
					}
					options={[
						["all", "All severities"],
						["ERROR", "Errors only"],
						["WARN", "Warns only"],
						["INFO", "Info only"],
					]}
				/>
				<Button variant="primary" onClick={loadAll}>
					Refresh
				</Button>
				<Button
					variant="ghost"
					active={liveMode}
					activeClassName="bg-sys-error text-white font-semibold"
					onClick={() => setLiveMode((v) => !v)}
					title={liveMode ? "Stop streaming" : "Stream logs in real time"}
				>
					{liveMode ? (liveTail.connected ? "● Live" : "○ Connecting") : "Live"}
				</Button>
				{liveMode && (
					<Button
						variant="ghost"
						active={liveTail.paused}
						activeClassName="bg-sys-warning text-white font-semibold"
						onClick={liveTail.togglePause}
					>
						{liveTail.paused
							? `Resume${liveTail.buffered > 0 ? ` (${liveTail.buffered})` : ""}`
							: "Pause"}
					</Button>
				)}
				<div className="ml-auto">
					<UpdatedChip at={overview?.timestamp ?? null} />
				</div>
			</div>

			{activeChips.length > 0 && (
				<div className="mb-2 flex-none flex flex-wrap items-center gap-2 px-1">
					<span className="text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-50">
						Filters
					</span>
					{activeChips.map((c) => (
						<button
							key={c.key}
							type="button"
							onClick={c.onClear}
							className="inline-flex items-center gap-1 bg-sys-surface-high px-2 py-1 text-[0.6875rem] font-mono hover:bg-sys-surface-low"
							title="Clear filter"
						>
							<span>{c.label}</span>
							<span className="opacity-60">×</span>
						</button>
					))}
					{activeChips.length > 1 && (
						<button
							type="button"
							onClick={clearAllFilters}
							className="text-[0.6875rem] font-bold uppercase tracking-[0.05em] opacity-60 hover:opacity-100"
						>
							Clear all
						</button>
					)}
				</div>
			)}

			{loading && !overview && <StateRow>Initializing…</StateRow>}

			{overview && (
				<>
					<div className="mb-2 grid grid-cols-4 gap-2">
						<Stat
							label="Total"
							value={overview.summary.totalLogs.toLocaleString()}
							spark={allBuckets}
							note={`${hours}h`}
						/>
						<Stat
							label="Errors"
							value={overview.summary.errorLogs.toLocaleString()}
							accent={overview.summary.errorLogs > 0 ? "error" : "default"}
							spark={errorBuckets}
						/>
						<Stat
							label="Warns"
							value={overview.summary.warnLogs.toLocaleString()}
							accent={overview.summary.warnLogs > 0 ? "warning" : "default"}
							spark={warnBuckets}
						/>
						<Stat
							label="Err rate"
							value={
								overview.summary.totalLogs === 0
									? "—"
									: `${((overview.summary.errorLogs / overview.summary.totalLogs) * 100).toFixed(1)}%`
							}
							accent={
								overview.summary.totalLogs > 0 && overview.summary.errorLogs / overview.summary.totalLogs >= 0.05
									? "error"
									: "default"
							}
						/>
					</div>

					<Card className="mb-2 p-3">
						<SectionTitle title="Logs over time" note={`${bucketCount} buckets · ${hours}h`} />
						<TimeSeriesBars data={timeSeries} height={56} />
					</Card>
				</>
			)}

			<div className="flex min-h-0 flex-1 gap-2">
				<Card className="min-h-0 flex-1 overflow-y-auto p-3">
					<SectionTitle
						title={liveMode ? `Live logs${severityFilter !== "all" ? ` · ${severityFilter}` : ""}` : `Logs${severityFilter !== "all" ? ` · ${severityFilter}` : ""}`}
						note={liveMode
							? `${visibleLogs.length.toLocaleString()} streamed${liveTail.paused ? " · paused" : ""}`
							: `${visibleLogs.length.toLocaleString()} in window`}
					/>
					<div className="flex flex-col mt-1">
						{visibleLogs.map((log) => {
							const isSelected = selectedLog?.logId === log.logId;
							return (
								<button
									type="button"
									key={log.logId}
									onClick={() => setSelectedLog(log as SelectedLog)}
									className={`flex items-center gap-2 border-b-[1px] border-sys-surface-low px-2 py-1 font-mono text-[0.75rem] text-left last:border-b-0 hover:bg-sys-surface-low ${isSelected ? "bg-sys-surface-high" : ""}`}
								>
									<span
										className={`flex-none w-14 text-center px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${SEVERITY_BADGE_BG[log.severity] ?? "bg-sys-surface-high"}`}
									>
										{log.severity}
									</span>
									<span className="flex-none opacity-60 tabular-nums">
										{formatClockTime(log.occurredAt)}
									</span>
									<span className="flex-none w-32 truncate font-bold">
										{log.serviceName || log.loggerName || "unknown"}
									</span>
									<span className="min-w-0 flex-1 truncate opacity-90">
										{log.message}
									</span>
								</button>
							);
						})}
					</div>
					{visibleLogs.length === 0 && (
						<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
							{liveMode
								? liveTail.connected ? "Waiting for logs…" : liveTail.error || "Connecting…"
								: `No logs${severityFilter !== "all" ? ` at ${severityFilter}` : ""} in window.`}
						</p>
					)}
				</Card>

				<aside className="flex w-[320px] flex-none flex-col gap-2 overflow-y-auto">
					{selectedLog ? (
						<LogDetailDrawer log={selectedLog} onClose={() => setSelectedLog(null)} />
					) : (
						<>
							{byService.length > 0 && (
								<BarList
									title="By service"
									items={byService}
									compact
									selected={selectedServices}
									onToggle={toggleService}
								/>
							)}
							{byLogger.length > 0 && (
								<BarList
									title="By logger"
									items={byLogger}
									color="var(--color-sys-accent)"
									compact
									selected={selectedLoggers}
									onToggle={toggleLogger}
								/>
							)}
						</>
					)}
				</aside>
			</div>
		</div>
	);
}

function LogDetailDrawer({
	log,
	onClose,
}: {
	log: SelectedLog;
	onClose: () => void;
}) {
	const attributes = useMemo(() => {
		if (!log.attributesJson || log.attributesJson === "{}") return null;
		try {
			return JSON.parse(log.attributesJson) as Record<string, unknown>;
		} catch {
			return null;
		}
	}, [log.attributesJson]);

	return (
		<Card className="flex min-h-0 flex-1 flex-col p-3 overflow-y-auto">
			<div className="mb-2 flex items-start justify-between gap-2">
				<div className="flex items-center gap-2">
					<span
						className={`flex-none w-14 text-center px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${SEVERITY_BADGE_BG[log.severity] ?? "bg-sys-surface-high"}`}
					>
						{log.severity}
					</span>
					<span className="text-[0.6875rem] font-bold uppercase tracking-[0.1em] opacity-70">
						Log detail
					</span>
				</div>
				<button
					type="button"
					onClick={onClose}
					className="flex-none px-2 text-[1rem] leading-none opacity-60 hover:opacity-100"
					title="Close"
					aria-label="Close detail"
				>
					×
				</button>
			</div>

			<dl className="mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.6875rem] font-mono">
				<dt className="opacity-50 uppercase tracking-[0.05em]">Time</dt>
				<dd className="break-all">{new Date(log.occurredAt).toLocaleString()}</dd>
				{log.serviceName && (
					<>
						<dt className="opacity-50 uppercase tracking-[0.05em]">Service</dt>
						<dd className="break-all">{log.serviceName}</dd>
					</>
				)}
				{log.loggerName && (
					<>
						<dt className="opacity-50 uppercase tracking-[0.05em]">Logger</dt>
						<dd className="break-all">{log.loggerName}</dd>
					</>
				)}
				{log.traceId && (
					<>
						<dt className="opacity-50 uppercase tracking-[0.05em]">Trace</dt>
						<dd className="break-all">
							<a
								href={`#/traces?traceId=${encodeURIComponent(log.traceId)}`}
								className="text-sys-primary underline"
							>
								{log.traceId}
							</a>
						</dd>
					</>
				)}
				{log.spanId && (
					<>
						<dt className="opacity-50 uppercase tracking-[0.05em]">Span</dt>
						<dd className="break-all">{log.spanId}</dd>
					</>
				)}
			</dl>

			<div className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-50">
				Message
			</div>
			<pre className="mb-2 whitespace-pre-wrap break-all bg-sys-surface-low p-2 text-[0.75rem] font-mono leading-relaxed">
				{log.message}
			</pre>

			{attributes && (
				<>
					<div className="mb-1 text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-50">
						Attributes
					</div>
					<pre className="bg-sys-surface-low p-2 text-[0.6875rem] font-mono overflow-x-auto">
						{JSON.stringify(attributes, null, 2)}
					</pre>
				</>
			)}
		</Card>
	);
}
