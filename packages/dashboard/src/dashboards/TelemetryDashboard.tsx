import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../components/Button";
import { Input, Select } from "../components/forms";
import {
	BarList,
	binByInterval,
	Card,
	Stat as NewStat,
	SectionTitle,
	TimeSeriesBars,
} from "../components/primitives";
import { StateRow } from "../components/states";
import { type TailEvent, useLiveTail } from "../hooks/useLiveTail";
import { useDashboard, useTimeWindowHours } from "../provider";
import { Badge, copy, fmtTs } from "./telemetry/shared";
import { TraceDetailView } from "./telemetry/TraceDetailView";
import type {
	IssueDetail,
	IssueOverview,
	IssueSummary,
	LiveSpanRow,
	Overview,
	TraceDetail,
} from "./telemetry/types";

const isSpanEvent = (e: TailEvent): e is TailEvent<LiveSpanRow> =>
	e.kind === "span";

// api helper is now provided via useDashboard context

// ── Main ──

interface Props {
	mode: "traces" | "issues";
	initialTraceId?: string;
	initialIssueId?: string;
	initialService?: string;
	onNavigate: (route: {
		tab?: string;
		traceId?: string;
		issueId?: string;
		sessionId?: string;
		service?: string;
	}) => void;
}

export function TelemetryDashboard({
	mode,
	initialTraceId,
	initialIssueId,
	initialService,
	onNavigate,
}: Props) {
	const { basePath, fetcher } = useDashboard();
	const api = useCallback(
		async <T,>(path: string): Promise<T> => {
			const r = await fetcher(`${basePath}${path}`);
			if (!r.ok) throw new Error(`${r.status}`);
			return r.json();
		},
		[basePath, fetcher],
	);
	const hours = String(useTimeWindowHours());
	const [statusFilter, setStatusFilter] = useState("all");
	const [serviceFilter, setServiceFilter] = useState(initialService ?? "all");
	const [search, setSearch] = useState("");
	const [searchInput, setSearchInput] = useState("");
	const [overview, setOverview] = useState<Overview | null>(null);
	const [expandedTraceId, setExpandedTraceId] = useState<string | null>(
		initialTraceId ?? null,
	);
	const [traceDetail, setTraceDetail] = useState<TraceDetail | null>(null);
	const [issueOverview, setIssueOverview] = useState<IssueOverview | null>(
		null,
	);
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(
		initialIssueId ?? null,
	);
	const [issueDetail, setIssueDetail] = useState<IssueDetail | null>(null);
	const [category, setCategory] = useState("all");
	const [loading, setLoading] = useState(true);
	const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);
	const [liveMode, setLiveMode] = useState(false);

	const liveTail = useLiveTail<LiveSpanRow>(isSpanEvent, {
		kinds: ["span"],
		enabled: liveMode && mode === "traces",
		maxRows: 500,
	});

	const serviceOptions = useMemo(() => {
		const svcs =
			issueOverview?.services.map((s) => s.serviceName) ??
			overview?.services.map((s) => s.serviceName) ??
			[];
		return ["all", ...svcs];
	}, [overview, issueOverview]);

	const loadAll = useCallback(async () => {
		setLoading(true);
		try {
			const svc = serviceFilter !== "all" ? `&service=${serviceFilter}` : "";
			const q = search ? `&q=${encodeURIComponent(search)}` : "";
			const cat = category !== "all" ? `&category=${category}` : "";
			const [ov, iss] = await Promise.all([
				api<Overview>(
					`/telemetry/overview?hours=${hours}&status=${statusFilter}${svc}${q}`,
				),
				api<IssueOverview>(`/telemetry/issues?hours=${hours}${svc}${cat}`),
			]);
			setOverview(ov);
			setIssueOverview(iss);
		} catch {
		} finally {
			setLoading(false);
		}
	}, [hours, statusFilter, serviceFilter, search, category, api]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	// Load initial trace/issue from URL
	useEffect(() => {
		if (initialTraceId && traceDetail?.trace.traceId !== initialTraceId) {
			api<TraceDetail>(
				`/telemetry/traces/${encodeURIComponent(initialTraceId)}`,
			)
				.then(setTraceDetail)
				.catch(() => {});
		}
	}, [initialTraceId, api, traceDetail]);

	// Re-sync the service filter when the URL's ?service= param changes —
	// e.g. when the Health tab opens /#/traces?service=checkout and the user
	// then jumps to a different service from the same tab.
	useEffect(() => {
		if (initialService) setServiceFilter(initialService);
	}, [initialService]);

	useEffect(() => {
		if (initialIssueId && !issueDetail) {
			api<IssueDetail>(
				`/telemetry/issues/detail?issueId=${encodeURIComponent(initialIssueId)}&hours=${hours}`,
			)
				.then(setIssueDetail)
				.catch(() => {});
		}
	}, [initialIssueId, hours, issueDetail, api]);

	const expandTrace = async (id: string) => {
		if (expandedTraceId === id) {
			setExpandedTraceId(null);
			setExpandedSpanId(null);
			onNavigate({ tab: "traces", traceId: undefined });
			return;
		}
		setExpandedTraceId(id);
		setExpandedSpanId(null);
		onNavigate({ tab: "traces", traceId: id });
		try {
			setTraceDetail(
				await api<TraceDetail>(`/telemetry/traces/${encodeURIComponent(id)}`),
			);
		} catch {}
	};

	const selectIssue = async (issue: IssueSummary) => {
		setSelectedIssueId(issue.issueId);
		onNavigate({ tab: "issues", issueId: issue.issueId });
		try {
			setIssueDetail(
				await api<IssueDetail>(
					`/telemetry/issues/detail?issueId=${encodeURIComponent(issue.issueId)}&hours=${hours}`,
				),
			);
		} catch {}
	};

	const handleExport = async () => {
		const params = new URLSearchParams({ hours });
		if (statusFilter !== "all") params.set("status", statusFilter);
		if (search) params.set("q", search);
		if (serviceFilter !== "all") params.set("service", serviceFilter);
		const r = await fetcher(`${basePath}/telemetry/export?${params}`);
		const blob = await r.blob();
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `telemetry-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.jsonl`;
		a.click();
		URL.revokeObjectURL(a.href);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface p-2">
			{/* Toolbar */}
			<div className="mb-2 flex-none flex flex-wrap items-center gap-2 bg-sys-surface px-3 py-2">
				<Input
					type="text"
					className="min-w-[200px] flex-1"
					placeholder="Search spans, attributes…"
					value={searchInput}
					onChange={(e) => setSearchInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") setSearch(searchInput.trim());
					}}
				/>
				<Button onClick={() => setSearch(searchInput.trim())}>Search</Button>
				<Select
					value={statusFilter}
					onChange={(e) => setStatusFilter(e.target.value)}
					options={[
						["all", "All status"],
						["error", "Errors"],
						["ok", "OK"],
					]}
				/>
				<Select
					value={serviceFilter}
					onChange={(e) => setServiceFilter(e.target.value)}
					options={serviceOptions.map((s): [string, string] => [
						s,
						s === "all" ? "All services" : s,
					])}
				/>
				{mode === "issues" && (
					<Select
						value={category}
						onChange={(e) => setCategory(e.target.value)}
						options={[
							["all", "All categories"],
							["error", "Errors"],
							["latency", "Latency"],
							["dependency", "Deps"],
						]}
					/>
				)}
				<Button variant="primary" onClick={loadAll}>
					Refresh
				</Button>
				{mode === "traces" && (
					<Button
						variant="ghost"
						active={liveMode}
						activeClassName="bg-sys-error text-white font-semibold"
						onClick={() => setLiveMode((v) => !v)}
						title={liveMode ? "Stop streaming" : "Stream spans in real time"}
					>
						{liveMode
							? liveTail.connected
								? "● Live"
								: "○ Connecting"
							: "Live"}
					</Button>
				)}
				{liveMode && mode === "traces" && (
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
				<Button onClick={handleExport}>Export</Button>
			</div>

			{loading && !overview ? <StateRow>Initializing…</StateRow> : null}

			{mode === "traces" && liveMode && (
				<LiveSpansView
					rows={liveTail.rows}
					paused={liveTail.paused}
					connected={liveTail.connected}
					error={liveTail.error}
				/>
			)}
			{mode === "traces" && !liveMode && overview && (
				<TracesView
					overview={overview}
					hours={Number(hours) || 6}
					expandedTraceId={expandedTraceId}
					traceDetail={traceDetail}
					expandedSpanId={expandedSpanId}
					onExpandTrace={expandTrace}
					onExpandSpan={setExpandedSpanId}
				/>
			)}
			{mode === "issues" && issueOverview && (
				<IssuesView
					overview={issueOverview}
					selectedIssueId={selectedIssueId}
					issueDetail={issueDetail}
					onSelect={selectIssue}
				/>
			)}
		</div>
	);
}

// ── Live Spans View ──

function LiveSpansView({
	rows,
	paused,
	connected,
	error,
}: {
	rows: LiveSpanRow[];
	paused: boolean;
	connected: boolean;
	error: string | null;
}) {
	return (
		<Card className="min-h-0 flex-1 overflow-y-auto p-3">
			<SectionTitle
				title="Live spans"
				note={`${rows.length.toLocaleString()} streamed${paused ? " · paused" : ""}`}
			/>
			<div className="flex flex-col mt-1">
				{rows.map((span) => {
					const isError = span.statusCode === 2;
					return (
						<div
							key={`${span.traceId}:${span.spanId}`}
							className="border-b-[1px] border-sys-surface-low p-2 font-mono text-[0.75rem] flex items-start gap-2 last:border-b-0"
						>
							<span
								className={`px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] ${
									isError
										? "bg-sys-error text-white"
										: "bg-sys-surface-high text-sys-on-surface"
								}`}
							>
								{isError ? "ERR" : "OK"}
							</span>
							<div className="flex-1 min-w-0">
								<div className="flex justify-between items-center mb-1">
									<span className="font-bold truncate">
										{span.serviceName || "unknown"} · {span.spanName}
									</span>
									<span className="opacity-60 flex-none pl-2">
										{Math.round(span.durationMs)}ms · {fmtTs(span.startTime)}
									</span>
								</div>
								<p className="opacity-60 m-0 break-all">
									trace {span.traceId.slice(0, 16)}… · span{" "}
									{span.spanId.slice(0, 8)}…
									{span.statusMessage ? ` · ${span.statusMessage}` : ""}
								</p>
							</div>
						</div>
					);
				})}
			</div>
			{rows.length === 0 && (
				<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
					{connected ? "Waiting for spans…" : error || "Connecting…"}
				</p>
			)}
		</Card>
	);
}

// ── Traces View ──

function TracesView({
	overview,
	hours,
	expandedTraceId,
	traceDetail,
	expandedSpanId,
	onExpandTrace,
	onExpandSpan,
}: {
	overview: Overview;
	hours: number;
	expandedTraceId: string | null;
	traceDetail: TraceDetail | null;
	expandedSpanId: string | null;
	onExpandTrace: (id: string) => void;
	onExpandSpan: (id: string | null) => void;
}) {
	const s = overview.summary;
	const bucketCount = 24;
	const allTimes = overview.traces.map((t) => t.startTime);
	const errorTimes = overview.traces
		.filter((t) => t.statusCode === 2)
		.map((t) => t.startTime);
	const allBuckets = binByInterval(allTimes, hours * 60, bucketCount);
	const errorBuckets = binByInterval(errorTimes, hours * 60, bucketCount);
	const durBuckets = (() => {
		// p95 per bucket — rough: take max within bucket as proxy for tail
		const buckets = new Array(bucketCount).fill(0);
		const counts = new Array(bucketCount).fill(0);
		const windowMs = hours * 60 * 60 * 1000;
		const start = Date.now() - windowMs;
		for (const t of overview.traces) {
			const ts = new Date(t.startTime).getTime();
			if (Number.isNaN(ts) || ts < start) continue;
			const idx = Math.min(
				bucketCount - 1,
				Math.floor(((ts - start) / windowMs) * bucketCount),
			);
			if (t.durationMs > buckets[idx]) buckets[idx] = t.durationMs;
			counts[idx]++;
		}
		return buckets;
	})();

	// timeseries for the wide chart
	const windowStart = Date.now() - hours * 60 * 60 * 1000;
	const bucketMs = (hours * 60 * 60 * 1000) / bucketCount;
	const timeSeries = allBuckets.map((v, i) => ({
		t: new Date(windowStart + i * bucketMs).toISOString(),
		v,
	}));

	const servicesItems: Array<[string, number]> = overview.services
		.slice()
		.sort((a, b) => b.traceCount - a.traceCount)
		.map((svc) => [svc.serviceName, svc.traceCount]);
	const errorServiceItems: Array<[string, number]> = overview.services
		.filter((svc) => svc.errorTraceCount > 0)
		.sort((a, b) => b.errorTraceCount - a.errorTraceCount)
		.map((svc) => [svc.serviceName, svc.errorTraceCount]);

	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mb-2 grid grid-cols-4 gap-2">
				<NewStat
					label="Traces"
					value={s.totalTraces.toLocaleString()}
					spark={allBuckets}
					note={`${hours}h window`}
				/>
				<NewStat
					label="Errors"
					value={s.errorTraces.toLocaleString()}
					accent={s.errorTraces > 0 ? "error" : "default"}
					spark={errorBuckets}
				/>
				<NewStat
					label="Err rate"
					value={`${(s.errorRate * 100).toFixed(1)}%`}
					accent={
						s.errorRate >= 0.1
							? "error"
							: s.errorRate >= 0.01
								? "warning"
								: "default"
					}
				/>
				<NewStat
					label="P95 ms"
					value={Math.round(s.p95DurationMs).toLocaleString()}
					accent="accent"
					spark={durBuckets}
					footer={`avg ${Math.round(s.averageDurationMs)}ms`}
				/>
			</div>

			<Card className="mb-2 p-3">
				<SectionTitle
					title="Requests over time"
					note={`${bucketCount} buckets · ${hours}h`}
				/>
				<TimeSeriesBars data={timeSeries} />
			</Card>

			<div className="mb-2 grid grid-cols-2 gap-2">
				{servicesItems.length > 0 && (
					<BarList title="Services" items={servicesItems} />
				)}
				{errorServiceItems.length > 0 ? (
					<BarList
						title="Errors by service"
						items={errorServiceItems}
						color="var(--color-sys-error)"
					/>
				) : (
					<Card className="flex items-center justify-center p-6 text-[0.625rem] font-bold uppercase tracking-[0.1em] opacity-40">
						No errors in window
					</Card>
				)}
			</div>

			<div className="bg-sys-surface p-3">
				<div className="mb-2 text-[0.875rem] font-semibold">Traces</div>
				<div className="flex flex-col">
					{overview.traces.map((t) => {
						const isExpanded = expandedTraceId === t.traceId;
						const detail =
							isExpanded && traceDetail?.trace?.traceId === t.traceId
								? traceDetail
								: null;
						return (
							<div
								key={t.traceId}
								className="border-b-[1px] border-sys-surface-low last:border-b-0"
							>
								{/* Log-line row */}
								<button
									type="button"
									className={`flex w-full cursor-pointer items-start gap-2 py-1.5 text-left hover:bg-sys-surface-low transition-none ${isExpanded ? "bg-sys-surface-low" : ""} ${t.statusCode === 2 ? "bg-sys-error/10" : ""}`}
									onClick={() => onExpandTrace(t.traceId)}
								>
									{t.statusCode === 2 && (
										<span className="mt-1 inline-block h-[8px] w-[8px] flex-none bg-sys-error" />
									)}
									<span className="flex-none whitespace-nowrap font-mono text-[0.75rem] opacity-60">
										{fmtTs(t.startTime)}
									</span>
									<span className="min-w-0 flex-1 font-mono text-[0.75rem] leading-relaxed">
										<span
											className={`font-bold ${t.statusCode === 2 ? "text-sys-error" : ""}`}
										>
											{t.spanName}
										</span>{" "}
										<span className="opacity-80">{t.durationMs}ms</span>{" "}
										<span className="opacity-80">{t.serviceName}</span>
										{t.spanCount > 1 && (
											<>
												{" "}
												<span className="opacity-40">
													({t.spanCount} spans)
												</span>
											</>
										)}
										{t.statusMessage && (
											<>
												{" "}
												<span className="text-sys-error">
													{t.statusMessage}
												</span>
											</>
										)}
									</span>
									<button
										type="button"
										className="flex-none cursor-pointer font-mono text-[0.75rem] underline hover:bg-sys-primary hover:text-white px-2 py-0.5"
										onClick={(e) => {
											e.stopPropagation();
											copy(t.traceId);
										}}
										title="Copy trace ID"
									>
										{t.traceId.slice(0, 16)}
									</button>
								</button>

								{/* Expanded: waterfall + spans */}
								{isExpanded && detail && (
									<div className="bg-sys-bg p-2 border-t-[1px] border-sys-surface-low">
										<TraceDetailView
											trace={detail}
											expandedSpanId={expandedSpanId}
											onExpandSpan={onExpandSpan}
										/>
									</div>
								)}
								{isExpanded && !detail && (
									<div className="bg-sys-bg p-2 border-t-[1px] border-sys-surface-low font-mono text-[0.75rem] opacity-60">
										Loading spans...
									</div>
								)}
							</div>
						);
					})}
					{overview.traces.length === 0 && (
						<p className="py-2 text-[0.875rem] opacity-60 font-semibold">
							No traces found.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Issues View ──

function IssuesView({
	overview,
	selectedIssueId,
	issueDetail,
	onSelect,
}: {
	overview: IssueOverview;
	selectedIssueId: string | null;
	issueDetail: IssueDetail | null;
	onSelect: (i: IssueSummary) => void;
}) {
	const selected =
		overview.issues.find((i) => i.issueId === selectedIssueId) ?? null;

	return (
		<div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			{/* Queue */}
			<div className="bg-sys-surface overflow-y-auto">
				<div className="sticky top-0 z-10 flex items-center justify-between bg-sys-surface px-3 py-2">
					<span className="text-[0.75rem] font-semibold">
						ISSUES ({overview.issues.length})
					</span>
				</div>
				<div className="flex flex-col">
					{overview.issues.map((issue) => (
						<button
							type="button"
							key={issue.issueId}
							className={`w-full text-left cursor-pointer border-b-[1px] border-sys-surface-low px-3 py-2 transition-none hover:bg-sys-surface-low ${selectedIssueId === issue.issueId ? "bg-sys-surface-low border-l-[4px] border-l-sys-primary" : "border-l-[4px] border-l-transparent"}`}
							onClick={() => onSelect(issue)}
						>
							<div className="flex items-center gap-3">
								<Badge
									cls={
										issue.severity === "critical"
											? "bg-sys-error text-white"
											: "bg-sys-on-surface text-sys-bg"
									}
								>
									{issue.severity}
								</Badge>
								<Badge cls="bg-sys-surface-low text-sys-on-surface outline outline-[1px] outline-sys-outline">
									{issue.category}
								</Badge>
								<span className="min-w-0 truncate text-[0.875rem] font-bold">
									{issue.routeLabel}
								</span>
								<span className="ml-auto font-mono text-[0.75rem] font-bold bg-sys-surface-high px-2 py-0.5">
									{issue.affectedTraceCount} TRACES
								</span>
							</div>
							<p className="m-0 mt-3 truncate font-mono text-[0.75rem] opacity-60">
								{issue.serviceName} &middot; {fmtTs(issue.lastSeen)}
							</p>
						</button>
					))}
				</div>
				{overview.issues.length === 0 && (
					<p className="p-3 text-[0.875rem] font-semibold opacity-60">
						No issues.
					</p>
				)}
			</div>

			{/* Detail */}
			<div className="bg-sys-surface p-3 overflow-y-auto">
				{!selected ? (
					<p className="text-[0.875rem] font-semibold opacity-60">
						Select an issue to inspect.
					</p>
				) : (
					<div className="space-y-6">
						<div>
							<div className="flex items-center gap-3 mb-2">
								<Badge
									cls={
										selected.severity === "critical"
											? "bg-sys-error text-white"
											: "bg-sys-on-surface text-sys-bg"
									}
								>
									{selected.severity}
								</Badge>
								<Badge cls="bg-sys-surface-low text-sys-on-surface outline outline-[1px] outline-sys-outline">
									{selected.category}
								</Badge>
							</div>
							<p className="m-0 text-[1rem] font-bold font-mono tracking-tight leading-snug">
								{selected.title}
							</p>
							<p className="m-0 mt-2 font-mono text-[0.875rem] opacity-60">
								{selected.routeLabel}
							</p>
						</div>
						<div className="grid grid-cols-2 gap-2 font-mono text-[0.75rem] border-y-[1px] border-sys-surface-low py-2">
							<span className="opacity-60 flex flex-col gap-1">
								Service
								<span className="font-bold opacity-100">
									{selected.serviceName}
								</span>
							</span>
							<span className="opacity-60 flex flex-col gap-1">
								Traces
								<span className="font-bold text-sys-error opacity-100">
									{selected.affectedTraceCount}
								</span>
							</span>
							<span className="opacity-60 flex flex-col gap-1">
								Culprit
								<span className="font-bold opacity-100 truncate">
									{selected.culpritSpanName}
								</span>
							</span>
							<span className="opacity-60 flex flex-col gap-1">
								Last seen
								<span className="font-bold opacity-100">
									{fmtTs(selected.lastSeen)}
								</span>
							</span>
						</div>
						{selected.latestStatusMessage && (
							<div className="bg-sys-error p-2 text-[0.875rem] font-bold font-mono text-white">
								{selected.latestStatusMessage}
							</div>
						)}
						{issueDetail && issueDetail.issue.issueId === selected.issueId && (
							<div className="space-y-6">
								{issueDetail.culpritSpans.length > 0 && (
									<div>
										<p className="m-0 mb-3 text-[0.75rem] font-semibold opacity-70">
											Culprit spans
										</p>
										<table className="w-full text-left">
											<thead>
												<tr>
													<th className="pb-2 pr-4 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
														SPAN
													</th>
													<th className="pb-2 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
														COUNT
													</th>
													<th className="pb-2 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
														AVG
													</th>
													<th className="pb-2 pl-4 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">
														MAX
													</th>
												</tr>
											</thead>
											<tbody className="[&>tr:nth-child(even)]:bg-sys-surface-low font-mono text-[0.75rem]">
												{issueDetail.culpritSpans.map((cs) => (
													<tr
														key={`${cs.spanName}-${cs.dependencyTarget}`}
														className="hover:bg-sys-surface-high transition-none"
													>
														<td className="pr-4 py-2 font-bold truncate max-w-[200px]">
															{cs.spanName}
															{cs.dependencyTarget && (
																<span className="opacity-40 ml-2 font-normal">
																	{cs.dependencyTarget}
																</span>
															)}
														</td>
														<td className="px-2 py-2 text-right">
															{cs.occurrenceCount}
														</td>
														<td className="px-2 py-2 text-right opacity-80">
															{cs.averageDurationMs}ms
														</td>
														<td className="pl-4 py-2 text-right opacity-80 border-l-[1px] border-sys-surface-low">
															{cs.maxDurationMs}ms
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
								{issueDetail.traces.length > 0 && (
									<div>
										<p className="m-0 mb-3 text-[0.75rem] font-semibold opacity-70">
											Affected traces
										</p>
										<div className="flex flex-col bg-sys-bg">
											{issueDetail.traces.map((t) => (
												<div
													key={t.traceId}
													className="flex items-center gap-2 py-2 px-3 border-b-[1px] border-sys-surface-low font-mono text-[0.75rem] hover:bg-sys-surface-low transition-none"
												>
													<span
														className={`block h-[8px] w-[8px] ${t.statusCode === 2 ? "bg-sys-error" : "bg-sys-primary"}`}
													/>
													<span className="font-bold truncate max-w-[200px]">
														{t.routeLabel}
													</span>
													<span className="opacity-60">{t.durationMs}ms</span>
													<span className="opacity-60">
														{fmtTs(t.startTime)}
													</span>
													<button
														type="button"
														className="ml-auto underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 text-sys-on-surface transition-none"
														onClick={() => copy(t.traceId)}
													>
														{t.traceId.slice(0, 12)}
													</button>
												</div>
											))}
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</div>
	);
}

// `Sel` removed — replaced by <Select> primitive in components/forms.tsx.
