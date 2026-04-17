import { useCallback, useEffect, useMemo, useState } from "react";
import type { LogsOverviewResponse } from "@obs/types";
import { useApi } from "../use-api";
import {
	BarList,
	Card,
	SectionTitle,
	Stat,
	TimeSeriesBars,
	UpdatedChip,
	binByInterval,
} from "../components/primitives";

export function LogsDashboard() {
	const api = useApi();
	const [overview, setOverview] = useState<LogsOverviewResponse | null>(null);
	const [hours, setHours] = useState("24");
	const [loading, setLoading] = useState(false);
	const [severityFilter, setSeverityFilter] = useState<"all" | "ERROR" | "WARN" | "INFO">("all");

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

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<input
					type="text"
					className="h-8 min-w-[200px] flex-1 border-b-[2px] border-sys-outline bg-transparent px-2 font-mono text-[0.875rem] font-bold placeholder:opacity-40 focus:border-sys-primary focus:outline-none transition-none"
					placeholder="SEARCH LOG MESSAGES, ATTRIBUTES..."
					disabled
				/>
				<select
					className="h-8 bg-transparent text-[0.875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface border-b-[2px] border-sys-outline focus:outline-none focus:border-sys-primary transition-none cursor-pointer"
					value={hours}
					onChange={(e) => setHours(e.target.value)}
				>
					<option value="1">LAST 1H</option>
					<option value="6">LAST 6H</option>
					<option value="24">LAST 24H</option>
					<option value="72">LAST 72H</option>
				</select>
				<select
					className="h-8 bg-transparent text-[0.875rem] font-bold uppercase tracking-[0.05em] text-sys-on-surface border-b-[2px] border-sys-outline focus:outline-none focus:border-sys-primary transition-none cursor-pointer"
					value={severityFilter}
					onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
				>
					<option value="all">ALL SEVERITIES</option>
					<option value="ERROR">ERRORS ONLY</option>
					<option value="WARN">WARNS ONLY</option>
					<option value="INFO">INFO ONLY</option>
				</select>
				<button
					type="button"
					className="px-3 py-1.5 text-[0.875rem] font-bold uppercase tracking-[0.05em] bg-sys-primary text-white hover:bg-micro-gradient transition-none cursor-pointer"
					onClick={loadAll}
				>
					REFRESH
				</button>
				<div className="ml-auto">
					<UpdatedChip at={overview?.timestamp ?? null} />
				</div>
			</div>

			{loading && !overview && (
				<p className="p-3 text-[0.875rem] tracking-[0.05em] font-bold opacity-60">INITIALIZING...</p>
			)}

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
					<p className="py-2 text-[0.875rem] opacity-60 uppercase tracking-[0.05em] font-bold">
						No logs{severityFilter !== "all" ? ` at ${severityFilter}` : ""} in window.
					</p>
				)}
			</Card>
		</div>
	);
}
