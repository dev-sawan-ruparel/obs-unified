import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";
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

const isLogEvent = (e: TailEvent): e is TailEvent<LiveLogRow> => e.kind === "log";

export function LogsDashboard() {
	const api = useApi();
	const [overview, setOverview] = useState<LogsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);
	const [severityFilter, setSeverityFilter] = useState<"all" | "ERROR" | "WARN" | "INFO">("all");
	const [liveMode, setLiveMode] = useState(false);

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

	// Service and logger breakdowns derived client-side from the log list.
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

	const filteredLogs = useMemo(() => {
		if (!overview) return [];
		if (severityFilter === "all") return overview.logs;
		if (severityFilter === "ERROR")
			return overview.logs.filter((l) => l.severity === "ERROR" || l.severity === "FATAL");
		return overview.logs.filter((l) => l.severity === severityFilter);
	}, [overview, severityFilter]);

	const liveFilteredLogs = useMemo(() => {
		if (severityFilter === "all") return liveTail.rows;
		if (severityFilter === "ERROR")
			return liveTail.rows.filter((l) => l.severity === "ERROR" || l.severity === "FATAL");
		return liveTail.rows.filter((l) => l.severity === severityFilter);
	}, [liveTail.rows, severityFilter]);

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
					value={hours}
					onChange={(e) => setHours(e.target.value)}
					options={[
						["1", "Last 1h"],
						["6", "Last 6h"],
						["24", "Last 24h"],
						["72", "Last 72h"],
					]}
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
						<TimeSeriesBars data={timeSeries} />
					</Card>

					<div className="mb-2 grid grid-cols-2 gap-2">
						{byService.length > 0 && <BarList title="By service" items={byService} />}
						{byLogger.length > 0 && (
							<BarList
								title="By logger"
								items={byLogger}
								color="var(--color-sys-accent)"
							/>
						)}
					</div>
				</>
			)}

			<Card className="min-h-0 flex-1 overflow-y-auto p-3">
				{liveMode ? (
					<>
						<SectionTitle
							title={`Live logs${severityFilter !== "all" ? ` · ${severityFilter}` : ""}`}
							note={`${liveFilteredLogs.length.toLocaleString()} streamed${liveTail.paused ? " · paused" : ""}`}
						/>
						<div className="flex flex-col mt-1">
							{liveFilteredLogs.map((log) => (
								<div
									key={log.logId}
									className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2 last:border-b-0"
								>
									<span
										className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
											log.severity === "ERROR" || log.severity === "FATAL"
												? "bg-sys-error text-white"
												: log.severity === "WARN"
													? "bg-sys-warning text-white"
													: "bg-sys-surface-high text-sys-on-surface"
										}`}
									>
										{log.severity}
									</span>
									<div className="flex-1 min-w-0">
										<div className="flex justify-between items-center mb-1">
											<span className="font-bold">{log.loggerName || log.serviceName || "unknown"}</span>
											<span className="opacity-60">{new Date(log.occurredAt).toLocaleString()}</span>
										</div>
										<p className="opacity-80 whitespace-pre-wrap leading-relaxed m-0 break-all">
											{log.message}
										</p>
									</div>
								</div>
							))}
						</div>
						{liveFilteredLogs.length === 0 && (
							<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
								{liveTail.connected ? "Waiting for logs…" : liveTail.error || "Connecting…"}
							</p>
						)}
					</>
				) : (
					<>
						<SectionTitle
							title={`Logs${severityFilter !== "all" ? ` · ${severityFilter}` : ""}`}
							note={`${filteredLogs.length.toLocaleString()} in window`}
						/>
						<div className="flex flex-col mt-1">
							{filteredLogs.map((log) => (
								<div
									key={log.logId}
									className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2 last:border-b-0"
								>
									<span
										className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
											log.severity === "ERROR" || log.severity === "FATAL"
												? "bg-sys-error text-white"
												: log.severity === "WARN"
													? "bg-sys-warning text-white"
													: "bg-sys-surface-high text-sys-on-surface"
										}`}
									>
										{log.severity}
									</span>
									<div className="flex-1 min-w-0">
										<div className="flex justify-between items-center mb-1">
											<span className="font-bold">{log.loggerName || "unknown"}</span>
											<span className="opacity-60">{new Date(log.occurredAt).toLocaleString()}</span>
										</div>
										<p className="opacity-80 whitespace-pre-wrap leading-relaxed m-0 break-all">
											{log.message}
										</p>
										{log.attributesJson && log.attributesJson !== "{}" && (
											<pre className="mt-2 text-[0.75rem] opacity-70 bg-sys-surface-low p-2 overflow-x-auto">
												{JSON.stringify(JSON.parse(log.attributesJson), null, 2)}
											</pre>
										)}
									</div>
								</div>
							))}
						</div>
						{filteredLogs.length === 0 && (
							<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
								No logs{severityFilter !== "all" ? ` at ${severityFilter}` : ""} in window.
							</p>
						)}
					</>
				)}
			</Card>
		</div>
	);
}
