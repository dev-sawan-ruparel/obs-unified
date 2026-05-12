import { useCallback, useEffect, useMemo, useState } from "react";
import { useApi } from "../use-api";
import { useDashboard, useTimeWindowHours } from "../provider";
import { useLiveTail, type TailEvent } from "../hooks/useLiveTail";
import {
	BarList,
	Card,
	SectionTitle,
	Stat as NewStat,
	TimeSeriesBars,
	UpdatedChip,
	binByInterval,
} from "../components/primitives";
import { Button } from "../components/Button";
import { ConnectedRail } from "../components/ConnectedRail";
import { FlameGraph } from "../components/flame-graph/FlameGraph";
import { Input, Select } from "../components/forms";
import { StateRow } from "../components/states";

interface LiveSpanRow {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
}

const isSpanEvent = (e: TailEvent): e is TailEvent<LiveSpanRow> =>
	e.kind === "span";

// ── Types ──

interface TraceSummary {
	traceId: string;
	serviceName: string;
	spanName: string;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	receivedAt: string;
	spanCount: number;
	errorSpanCount: number;
}
interface Overview {
	summary: {
		totalTraces: number;
		errorTraces: number;
		successTraces: number;
		errorRate: number;
		averageDurationMs: number;
		p95DurationMs: number;
	};
	services: Array<{
		serviceName: string;
		traceCount: number;
		errorTraceCount: number;
	}>;
	traces: TraceSummary[];
	timestamp: string;
}
interface SpanDetail {
	traceId: string;
	spanId: string;
	parentSpanId: string | null;
	serviceName: string;
	scopeName: string | null;
	spanName: string;
	spanKind: number;
	statusCode: number;
	statusMessage: string | null;
	startTime: string;
	endTime: string;
	durationMs: number;
	attributes: Record<string, unknown>;
	resourceAttributes: Record<string, unknown>;
	events: Array<{
		name: string;
		timeUnixNano?: string;
		attributes?: Record<string, unknown>;
	}>;
	links: unknown[];
}
interface TraceDetail {
	trace: TraceSummary;
	spans: SpanDetail[];
}
interface IssueSummary {
	issueId: string;
	category: "error" | "latency" | "dependency";
	severity: "critical" | "high" | "medium" | "low";
	title: string;
	serviceName: string;
	routeLabel: string;
	occurrenceCount: number;
	affectedTraceCount: number;
	lastSeen: string;
	latestStatusMessage: string | null;
	culpritSpanName: string;
	dependencyTarget: string | null;
	sampleTraceId: string;
}
interface IssueOverview {
	summary: {
		totalIssues: number;
		criticalIssues: number;
		highIssues: number;
		affectedTraces: number;
		errorIssues: number;
		latencyIssues: number;
		dependencyIssues: number;
	};
	services: Array<{ serviceName: string; issueCount: number }>;
	issues: IssueSummary[];
	timestamp: string;
}
interface IssueDetail {
	issue: IssueSummary;
	traces: Array<{
		traceId: string;
		routeLabel: string;
		statusCode: number;
		durationMs: number;
		startTime: string;
		culpritSpanName: string;
		dependencyTarget: string | null;
		statusMessage: string | null;
	}>;
	culpritSpans: Array<{
		spanName: string;
		dependencyTarget: string | null;
		occurrenceCount: number;
		averageDurationMs: number;
		maxDurationMs: number;
	}>;
}

// ── Helpers ──

const fmtTs = (iso: string) => {
	try {
		const d = new Date(iso);
		return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
	} catch {
		return iso;
	}
};
const copy = (text: string) => {
	void navigator.clipboard.writeText(text);
};
const sevCls: Record<string, string> = {
	critical: "border-red-500 bg-red-500/10 text-red-700",
	high: "border-orange-500 bg-orange-500/10 text-orange-700",
	medium: "border-yellow-500 bg-yellow-500/10 text-yellow-700",
	low: "border-blue-500 bg-blue-500/10 text-blue-700",
};
const catCls: Record<string, string> = {
	error: "border-red-500 bg-red-500/10 text-red-700",
	latency: "border-yellow-500 bg-yellow-500/10 text-yellow-700",
	dependency: "border-purple-500 bg-purple-500/10 text-purple-700",
};
const SPAN_KIND: Record<number, string> = {
	0: "Unspecified",
	1: "Internal",
	2: "Server",
	3: "Client",
	4: "Producer",
	5: "Consumer",
};

// api helper is now provided via useDashboard context

// Build a tree of spans for indented display
/**
 * RFC 0005 — derived self-time + async-parent flag.
 *
 * `selfMs` = wall - sum(children's wall). Clamped to 0 for "async parents"
 * where children's durations exceed the parent's window (fan-out work
 * that doesn't sum into the parent's wall-clock). The async flag drives
 * a striped visualization that warns the viewer "self-time isn't
 * meaningful for this row."
 *
 * `selfRatio` is selfMs/durationMs in [0, 1] — the bar visualization
 * uses this to overlay a darker self-time portion on the light child
 * portion.
 */
type SpanTreeNode = SpanDetail & {
	depth: number;
	selfMs: number;
	selfRatio: number;
	asyncParent: boolean;
	childCount: number;
};

function buildSpanTree(spans: SpanDetail[]): SpanTreeNode[] {
	const byId = new Map(spans.map((s) => [s.spanId, s]));
	const children = new Map<string | null, SpanDetail[]>();
	for (const s of spans) {
		const parentKey = s.parentSpanId ?? null;
		if (!children.has(parentKey)) children.set(parentKey, []);
		children.get(parentKey)!.push(s);
	}

	const result: SpanTreeNode[] = [];
	const walk = (parentId: string | null, depth: number) => {
		const kids = children.get(parentId) ?? [];
		// Sort by start time
		kids.sort((a, b) => a.startTime.localeCompare(b.startTime));
		for (const s of kids) {
			const myKids = children.get(s.spanId) ?? [];
			const childWall = myKids.reduce((acc, c) => acc + c.durationMs, 0);
			const rawSelf = s.durationMs - childWall;
			const asyncParent = rawSelf < 0;
			const selfMs = Math.max(0, rawSelf);
			const selfRatio = s.durationMs > 0 ? selfMs / s.durationMs : 0;
			result.push({
				...s,
				depth,
				selfMs,
				selfRatio,
				asyncParent,
				childCount: myKids.length,
			});
			walk(s.spanId, depth + 1);
		}
	};
	walk(null, 0);
	// If tree walk missed any (e.g. orphaned spans), add them.
	// Orphans have no parent in the trace, so their self-time = full duration.
	if (result.length < spans.length) {
		const seen = new Set(result.map((s) => s.spanId));
		for (const s of spans) {
			if (!seen.has(s.spanId)) {
				result.push({
					...s,
					depth: 0,
					selfMs: s.durationMs,
					selfRatio: 1,
					asyncParent: false,
					childCount: 0,
				});
			}
		}
	}
	return result;
}

/**
 * RFC 0005 Phase 2.4 — heuristic for "this span hides uninstrumented
 * work, consider profiling or adding child spans." Threshold is the
 * starting calibration in the RFC; tune against real demo data before
 * leaving draft.
 */
const isLikelyUninstrumented = (s: SpanTreeNode): boolean =>
	!s.asyncParent &&
	s.durationMs > 100 &&
	s.selfRatio > 0.7 &&
	s.childCount < 2;

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
	const api = useCallback(async <T,>(path: string): Promise<T> => {
		const r = await fetcher(`${basePath}${path}`);
		if (!r.ok) throw new Error(`${r.status}`);
		return r.json();
	}, [basePath, fetcher]);
	const hours = String(useTimeWindowHours());
	const [statusFilter, setStatusFilter] = useState("all");
	const [serviceFilter, setServiceFilter] = useState(
		initialService ?? "all",
	);
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
				api<IssueOverview>(
					`/telemetry/issues?hours=${hours}${svc}${cat}`,
				),
			]);
			setOverview(ov);
			setIssueOverview(iss);
		} catch {
		} finally {
			setLoading(false);
		}
	}, [hours, statusFilter, serviceFilter, search, category]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	// Load initial trace/issue from URL
	useEffect(() => {
		if (initialTraceId && !traceDetail) {
			api<TraceDetail>(
				`/telemetry/traces/${encodeURIComponent(initialTraceId)}`,
			)
				.then(setTraceDetail)
				.catch(() => {});
		}
	}, [initialTraceId]);

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
	}, [initialIssueId]);

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
				await api<TraceDetail>(
					`/telemetry/traces/${encodeURIComponent(id)}`,
				),
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
					options={serviceOptions.map(
						(s): [string, string] => [
							s,
							s === "all" ? "All services" : s,
						],
					)}
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
						{liveMode ? (liveTail.connected ? "● Live" : "○ Connecting") : "Live"}
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
									trace {span.traceId.slice(0, 16)}… · span {span.spanId.slice(0, 8)}…
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
				<div className="mb-2 text-[0.875rem] font-semibold">
					Traces
				</div>
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
								<div
									className={`flex cursor-pointer items-start gap-2 py-1.5 hover:bg-sys-surface-low transition-none ${isExpanded ? "bg-sys-surface-low" : ""} ${t.statusCode === 2 ? "bg-sys-error/10" : ""}`}
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
										className="flex-none cursor-pointer font-mono text-[0.75rem] underline hover:bg-sys-primary hover:text-white px-2 py-0.5"
										onClick={(e) => {
											e.stopPropagation();
											copy(t.traceId);
										}}
										title="Copy trace ID"
									>
										{t.traceId.slice(0, 16)}
									</button>
								</div>

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
						<p className="py-2 text-[0.875rem] opacity-60 font-semibold">No traces found.</p>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Trace Detail + Waterfall ──

function TraceDetailView({
	trace,
	expandedSpanId,
	onExpandSpan,
}: {
	trace: TraceDetail;
	expandedSpanId: string | null;
	onExpandSpan: (id: string | null) => void;
}) {
	const spans = trace.spans;
	const meta = trace.trace;
	const traceStart = Math.min(
		...spans.map((s) => new Date(s.startTime).getTime()),
	);
	const traceEnd = Math.max(...spans.map((s) => new Date(s.endTime).getTime()));
	const traceDuration = traceEnd - traceStart || 1;
	const tree = buildSpanTree(spans);

	// RFC 0005 — per-trace summary aggregates. self-time across all spans
	// is the wall-clock that hides in span bodies (not yet broken out into
	// children). The asyncParent count is informational so the user knows
	// some self-time numbers are clamped.
	const totalSelfMs = tree.reduce((acc, s) => acc + s.selfMs, 0);
	const asyncParents = tree.filter((s) => s.asyncParent).length;
	const uninstrumentedCount = tree.filter(isLikelyUninstrumented).length;

	// RFC 0007 Phase 4.6 — does any pprof profile cover this trace?
	// One query per trace; populates a state on first render.
	const api = useApi();
	const [profileMatches, setProfileMatches] = useState<
		Array<{
			id: string;
			serviceName: string | null;
			profileType: string;
			durationMs: number;
		}>
	>([]);
	const [openProfileId, setOpenProfileId] = useState<string | null>(null);
	useEffect(() => {
		api<{
			profiles: Array<{
				id: string;
				serviceName: string | null;
				profileType: string;
				durationMs: number;
			}>;
		}>(`/profiles?trace_id=${encodeURIComponent(meta.traceId)}`)
			.then((r) => setProfileMatches(r.profiles ?? []))
			.catch(() => {});
	}, [api, meta.traceId]);
	const openProfile = profileMatches.find((p) => p.id === openProfileId);

	return (
		<div className="space-y-4">
			{/* Summary bar */}
			<div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[0.75rem] font-bold">
				<span className="opacity-60">
					TRACE{" "}
					<span className="opacity-100">{meta.traceId.slice(0, 16)}</span>
				</span>
				<span className="opacity-60">
					SERVICE <span className="opacity-100">{meta.serviceName}</span>
				</span>
				<span className="opacity-60">
					DURATION <span className="opacity-100">{meta.durationMs}MS</span>
				</span>
				<span className="opacity-60">
					SPANS <span className="opacity-100">{spans.length}</span>
				</span>
				{/* RFC 0005 — self-time + uninstrumented hints in the trace summary */}
				<span
					className="opacity-60"
					title="Wall-clock time spent in span bodies that isn't broken out into child spans. High self-time often means an unprofiled hot path."
				>
					SELF{" "}
					<span className="opacity-100">{Math.round(totalSelfMs)}MS</span>
				</span>
				{uninstrumentedCount > 0 && (
					<span
						className="text-sys-warn"
						title="Spans where most time is unaccounted for — consider adding child spans, or attaching a profile (RFC 0007)."
					>
						⚠ UNINSTRUMENTED{" "}
						<span className="font-bold">{uninstrumentedCount}</span>
					</span>
				)}
				{asyncParents > 0 && (
					<span
						className="opacity-60"
						title="Spans whose children's wall-clock exceeds the parent's window — fan-out work where self-time is not meaningful."
					>
						ASYNC{" "}
						<span className="opacity-100">{asyncParents}</span>
					</span>
				)}
				{profileMatches.map((p) => (
					<button
						key={p.id}
						type="button"
						className={`text-sys-primary cursor-pointer underline hover:bg-sys-primary hover:text-white px-1 py-0.5 transition-none ${openProfileId === p.id ? "bg-sys-primary text-white" : ""}`}
						onClick={() =>
							setOpenProfileId(openProfileId === p.id ? null : p.id)
						}
						title={`Open ${p.profileType} flame graph for ${p.serviceName ?? "?"} (${p.durationMs}ms window). Scoped to this trace.`}
					>
						🔥 {p.serviceName ?? "?"}/{p.profileType}
					</button>
				))}
				{meta.errorSpanCount > 0 && (
					<span className="text-sys-error">
						ERRORS{" "}
						<span className="font-bold text-sys-error">
							{meta.errorSpanCount}
						</span>
					</span>
				)}
				<span className="opacity-60">
					START <span className="opacity-100">{fmtTs(meta.startTime)}</span>
				</span>
				<button
					className="ml-auto underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 transition-none"
					onClick={() => copy(JSON.stringify(trace, null, 2))}
				>
					Copy JSON
				</button>
			</div>

			{/* RFC 0007 Phase 4.7 — flame graph viewer.
			    Renders inline when the user clicks a 🔥 badge in the
			    summary header. Scoped to this trace's samples via
			    traceIdFilter so the rendered tree shows only what
			    contributed to the open trace, not the full profile. */}
			{openProfile && (
				<div className="bg-sys-surface border border-sys-surface-low">
					<div className="flex items-center gap-3 px-3 py-2 border-b border-sys-surface-low">
						<span className="text-[0.75rem] font-bold opacity-70">
							Flame graph · {openProfile.serviceName ?? "?"}/{openProfile.profileType}
						</span>
						<button
							type="button"
							onClick={() => setOpenProfileId(null)}
							className="ml-auto text-[0.75rem] underline hover:text-sys-primary cursor-pointer"
						>
							Close
						</button>
					</div>
					<FlameGraph
						profileId={openProfile.id}
						traceIdFilter={meta.traceId}
						profileType={openProfile.profileType as "cpu" | "heap" | "wall" | "block" | "mutex" | "goroutine" | "offcpu"}
						title={`Profile prof-${openProfile.id.slice(0, 8)} · scoped to trace`}
					/>
				</div>
			)}

			{/* Waterfall — always show, click row to expand span */}
			<div className="bg-sys-surface p-2 border border-sys-surface-low">
				<p className="m-0 mb-2 text-[0.75rem] font-semibold opacity-70">
					Waterfall
				</p>
				{tree.map((s) => {
					const sStart = new Date(s.startTime).getTime();
					const sEnd = new Date(s.endTime).getTime();
					const left = ((sStart - traceStart) / traceDuration) * 100;
					const width = Math.max(((sEnd - sStart) / traceDuration) * 100, 1);
					const isExpanded = expandedSpanId === s.spanId;
					const isError = s.statusCode === 2;
					// RFC 0005 \u2014 self-time portion of the bar. The full bar
					// renders at lighter opacity (children's wall); the inner
					// dark sub-bar shows self_ms as a fraction of the span's
					// own width. For async parents (children exceed parent
					// wall) we render diagonal stripes since self-time is not
					// meaningful for that row.
					const selfBarWidth = width * s.selfRatio;
					const baseColor = isError
						? "bg-sys-error"
						: s.parentSpanId
							? "bg-sys-outline"
							: "bg-sys-primary";
					const uninstrumented = isLikelyUninstrumented(s);
					return (
						<div key={s.spanId}>
							{/* Waterfall row is a real <button> so keyboard users can
							    Tab/Space into it and screen readers announce it. The
							    data-testid is the selector the Playwright matrix uses
							    to drive Span → X navigations (see
							    apps/web/tests/connected-rail.spec.ts). */}
							<button
								type="button"
								data-testid="trace-waterfall-span"
								data-span-id={s.spanId}
								data-trace-id={s.traceId}
								aria-expanded={isExpanded}
								className={`flex w-full cursor-pointer items-center gap-2 py-1.5 text-left hover:bg-sys-surface-low transition-none border-b border-sys-bg ${isExpanded ? "bg-sys-surface-low" : ""}`}
								onClick={() => onExpandSpan(isExpanded ? null : s.spanId)}
							>
								{/* Indented label */}
								<span
									className="flex-none truncate font-mono text-[0.75rem] font-bold"
									style={{ width: 180, paddingLeft: s.depth * 12 }}
								>
									{s.depth > 0 && (
										<span className="opacity-40 mr-1">{"\u2514"} </span>
									)}
									<span className={isError ? "text-sys-error" : ""}>
										{s.spanName}
									</span>
									{uninstrumented && (
										<span
											className="ml-1 text-sys-warn"
											title={`${Math.round(s.selfMs)}ms of ${s.durationMs}ms is unaccounted for. Consider adding child spans or attaching a profile.`}
										>
											\u26a0
										</span>
									)}
									{profileMatches.length > 0 && (
										<span
											className="ml-1 text-sys-primary"
											title={`pprof profile(s) cover this trace: ${profileMatches.map((p) => `${p.serviceName ?? "?"}/${p.profileType}`).join(", ")}. Open Profiles tab to drill in.`}
										>
											{"\ud83d\udd25"}
										</span>
									)}
								</span>
								{/* Bar */}
								<div className="relative h-[8px] min-w-0 flex-1 bg-sys-bg">
									{s.asyncParent ? (
										// Striped pattern signals "self-time not meaningful"
										<div
											className={`absolute top-0 h-full opacity-60`}
											style={{
												left: `${left}%`,
												width: `${width}%`,
												backgroundImage: `repeating-linear-gradient(45deg, var(--color-sys-outline) 0 4px, transparent 4px 8px), linear-gradient(${isError ? "var(--color-sys-error)" : "var(--color-sys-primary)"}, ${isError ? "var(--color-sys-error)" : "var(--color-sys-primary)"})`,
												backgroundBlendMode: "normal",
											}}
											title={`Async parent \u2014 children's wall (${Math.round(s.durationMs - s.selfMs)}ms) exceeds parent's window. Self-time clamped to 0.`}
										/>
									) : (
										<>
											{/* Lighter "outer" bar = full wall-clock */}
											<div
												className={`absolute top-0 h-full ${baseColor} opacity-30`}
												style={{ left: `${left}%`, width: `${width}%` }}
											/>
											{/* Darker "inner" bar = self-time only */}
											<div
												className={`absolute top-0 h-full ${baseColor}`}
												style={{ left: `${left}%`, width: `${selfBarWidth}%` }}
												title={`Self ${Math.round(s.selfMs)}ms / ${s.durationMs}ms wall (${Math.round(s.selfRatio * 100)}%)`}
											/>
										</>
									)}
								</div>
								<span className="w-16 flex-none text-right font-mono text-[0.75rem] opacity-60">
									{s.durationMs}ms
								</span>
							</button>
							{/* Expanded span detail + RFC 0006 connected rail */}
							{isExpanded && (
								<div className="flex gap-2 ml-6 mr-2">
									<div className="flex-1 min-w-0">
										<SpanView span={s} />
									</div>
									<ConnectedRail
										entityKind="span"
										entityId={`${s.traceId}:${s.spanId}`}
										traceId={s.traceId}
									/>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function SpanView({ span }: { span: SpanDetail }) {
	const attrs = Object.entries(span.attributes).filter(
		([k]) => !k.startsWith("collector."),
	);
	const collectorAttrs = Object.entries(span.attributes).filter(([k]) =>
		k.startsWith("collector."),
	);
	const resAttrs = Object.entries(span.resourceAttributes).filter(
		([k]) => !k.startsWith("collector.") && !k.startsWith("telemetry."),
	);
	const events = span.events ?? [];
	const isError = span.statusCode === 2;

	return (
		<div
			className={`ml-6 mr-2 my-2 border-l-[4px] border-sys-outline p-2 ${isError ? "border-l-sys-error bg-sys-error/5" : "bg-sys-surface"}`}
		>
			<div className="flex flex-wrap items-center gap-3">
				<span className="bg-sys-surface-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-80">
					SPAN
				</span>
				<span
					className={`font-mono text-[0.875rem] font-bold ${isError ? "text-sys-error" : "text-sys-on-surface"}`}
				>
					{span.spanName}
				</span>
				<span className="font-mono text-[0.75rem] opacity-60">
					{span.durationMs}ms
				</span>
				<span className="bg-sys-surface-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em]">
					{SPAN_KIND[span.spanKind] ?? span.spanKind}
				</span>
				{isError && (
					<span className="bg-sys-error px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] text-white">
						SYSTEM_ERROR
					</span>
				)}
				<button
					className="ml-auto underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 text-[0.75rem] font-mono transition-none"
					onClick={() => copy(JSON.stringify(span, null, 2))}
				>
					Copy JSON
				</button>
			</div>
			<div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.75rem]">
				<span className="opacity-60">
					SPAN_ID <span className="opacity-100">{span.spanId.slice(0, 16)}</span>
				</span>
				{span.parentSpanId && (
					<span className="opacity-60">
						PARENT <span className="opacity-100">{span.parentSpanId.slice(0, 16)}</span>
					</span>
				)}
				<span className="opacity-60">
					SERVICE <span className="opacity-100">{span.serviceName}</span>
				</span>
				<span className="opacity-60">
					START <span className="opacity-100">{fmtTs(span.startTime)}</span>
				</span>
				<span className="opacity-60">
					END <span className="opacity-100">{fmtTs(span.endTime)}</span>
				</span>
			</div>
			{span.statusMessage && (
				<div className="mt-2 bg-sys-error p-3 font-mono text-[0.75rem] text-white font-bold">
					{span.statusMessage}
				</div>
			)}
			{attrs.length > 0 && (
				<div className="mt-2">
					<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
						ATTRIBUTES
					</p>
					<AttrTable attrs={attrs} />
				</div>
			)}
			{resAttrs.length > 0 && (
				<div className="mt-2">
					<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
						RESOURCE
					</p>
					<AttrTable attrs={resAttrs} />
				</div>
			)}
			{collectorAttrs.length > 0 && (
				<div className="mt-2">
					<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
						COLLECTOR
					</p>
					<AttrTable attrs={collectorAttrs} />
				</div>
			)}
			{events.length > 0 && (
				<div className="mt-2">
					<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
						EVENTS ({events.length})
					</p>
					<div className="flex flex-col gap-[1px] bg-sys-surface-low">
						{events.map((evt, i) => (
							<div
								key={i}
								className={`px-3 py-2 text-[0.75rem] ${evt.name.includes("error") || evt.name === "exception" ? "bg-sys-error/10 text-sys-error" : "bg-sys-surface"}`}
							>
								<span className="font-bold">
									{evt.name}
								</span>
								{evt.attributes &&
									Object.entries(evt.attributes).map(([k, v]) => (
										<span key={k} className="ml-4 font-mono opacity-80">
											{k}=<span className="opacity-100 font-bold">{String(v).slice(0, 120)}</span>
										</span>
									))}
							</div>
						))}
					</div>
				</div>
			)}
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
						<div
							key={issue.issueId}
							className={`cursor-pointer border-b-[1px] border-sys-surface-low px-3 py-2 transition-none hover:bg-sys-surface-low ${selectedIssueId === issue.issueId ? "bg-sys-surface-low border-l-[4px] border-l-sys-primary" : "border-l-[4px] border-l-transparent"}`}
							onClick={() => onSelect(issue)}
						>
							<div className="flex items-center gap-3">
								<Badge cls={issue.severity === "critical" ? "bg-sys-error text-white" : "bg-sys-on-surface text-sys-bg"}>
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
						</div>
					))}
				</div>
				{overview.issues.length === 0 && (
					<p className="p-3 text-[0.875rem] font-semibold opacity-60">No issues.</p>
				)}
			</div>

			{/* Detail */}
			<div className="bg-sys-surface p-3 overflow-y-auto">
				{!selected ? (
					<p className="text-[0.875rem] font-semibold opacity-60">Select an issue to inspect.</p>
				) : (
					<div className="space-y-6">
						<div>
							<div className="flex items-center gap-3 mb-2">
								<Badge cls={selected.severity === "critical" ? "bg-sys-error text-white" : "bg-sys-on-surface text-sys-bg"}>
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
								<span className="font-bold opacity-100">{selected.serviceName}</span>
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
													<th className="pb-2 pr-4 font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">SPAN</th>
													<th className="pb-2 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">COUNT</th>
													<th className="pb-2 px-2 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">AVG</th>
													<th className="pb-2 pl-4 text-right font-bold uppercase tracking-[0.05em] text-[0.625rem] opacity-70">MAX</th>
												</tr>
											</thead>
											<tbody className="[&>tr:nth-child(even)]:bg-sys-surface-low font-mono text-[0.75rem]">
												{issueDetail.culpritSpans.map((cs) => (
													<tr key={`${cs.spanName}-${cs.dependencyTarget}`} className="hover:bg-sys-surface-high transition-none">
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
													<span className="font-bold truncate max-w-[200px]">{t.routeLabel}</span>
													<span className="opacity-60">{t.durationMs}ms</span>
													<span className="opacity-60">
														{fmtTs(t.startTime)}
													</span>
													<button
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

// ── Shared ──

function Stat({
	label,
	value,
	cls,
}: {
	label: string;
	value: string | number;
	cls?: string;
}) {
	return (
		<div className="flex flex-col justify-center bg-sys-surface px-3 py-2">
			<p className="m-0 mb-2 text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
				{label}
			</p>
			<p className={`m-0 font-mono text-3xl font-light tracking-tight ${cls ?? ""}`}>
				{value}
			</p>
		</div>
	);
}

function Badge({ children, cls }: { children: React.ReactNode; cls?: string }) {
	return (
		<span
			className={`inline-block px-1 py-0 text-[0.625rem] font-bold tracking-[0.05em] uppercase ${cls ?? ""}`}
		>
			{children}
		</span>
	);
}

function AttrTable({ attrs }: { attrs: [string, unknown][] }) {
	return (
		<div className="bg-sys-bg">
			<table className="w-full text-left">
				<tbody>
					{attrs.map(([k, v]) => (
						<tr key={k} className="border-b-[1px] border-sys-surface-low last:border-b-0 hover:bg-sys-surface-low transition-none">
							<td className="whitespace-nowrap px-2 py-1.5 align-top font-mono text-[0.75rem] font-bold opacity-70">
								{k}
							</td>
							<td className="break-all px-2 py-1.5 font-mono text-[0.75rem]">
								{String(v).length > 200
									? `${String(v).slice(0, 200)}...`
									: String(v)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

// `Sel` removed — replaced by <Select> primitive in components/forms.tsx.
