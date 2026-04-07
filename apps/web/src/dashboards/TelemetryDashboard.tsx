import { useCallback, useEffect, useMemo, useState } from "react";

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
	0: "UNSPECIFIED",
	1: "INTERNAL",
	2: "SERVER",
	3: "CLIENT",
	4: "PRODUCER",
	5: "CONSUMER",
};

async function api<T>(path: string): Promise<T> {
	const r = await fetch(path);
	if (!r.ok) throw new Error(`${r.status}`);
	return r.json();
}

// Build a tree of spans for indented display
function buildSpanTree(
	spans: SpanDetail[],
): Array<SpanDetail & { depth: number }> {
	const byId = new Map(spans.map((s) => [s.spanId, s]));
	const children = new Map<string | null, SpanDetail[]>();
	for (const s of spans) {
		const parentKey = s.parentSpanId ?? null;
		if (!children.has(parentKey)) children.set(parentKey, []);
		children.get(parentKey)!.push(s);
	}

	const result: Array<SpanDetail & { depth: number }> = [];
	const walk = (parentId: string | null, depth: number) => {
		const kids = children.get(parentId) ?? [];
		// Sort by start time
		kids.sort((a, b) => a.startTime.localeCompare(b.startTime));
		for (const s of kids) {
			result.push({ ...s, depth });
			walk(s.spanId, depth + 1);
		}
	};
	walk(null, 0);
	// If tree walk missed any (e.g. orphaned spans), add them
	if (result.length < spans.length) {
		const seen = new Set(result.map((s) => s.spanId));
		for (const s of spans) {
			if (!seen.has(s.spanId)) result.push({ ...s, depth: 0 });
		}
	}
	return result;
}

// ── Main ──

interface Props {
	mode: "traces" | "issues";
	initialTraceId?: string;
	initialIssueId?: string;
	onNavigate: (route: {
		tab?: string;
		traceId?: string;
		issueId?: string;
		sessionId?: string;
	}) => void;
}

export function TelemetryDashboard({
	mode,
	initialTraceId,
	initialIssueId,
	onNavigate,
}: Props) {
	const [hours, setHours] = useState("6");
	const [statusFilter, setStatusFilter] = useState("all");
	const [serviceFilter, setServiceFilter] = useState("all");
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
					`/api/admin/telemetry?hours=${hours}&status=${statusFilter}${svc}${q}`,
				),
				api<IssueOverview>(
					`/api/admin/telemetry/issues?hours=${hours}${svc}${cat}`,
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
				`/api/admin/telemetry/traces/${encodeURIComponent(initialTraceId)}`,
			)
				.then(setTraceDetail)
				.catch(() => {});
		}
	}, [initialTraceId]);

	useEffect(() => {
		if (initialIssueId && !issueDetail) {
			api<IssueDetail>(
				`/api/admin/telemetry/issues/detail?issueId=${encodeURIComponent(initialIssueId)}&hours=${hours}`,
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
					`/api/admin/telemetry/traces/${encodeURIComponent(id)}`,
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
					`/api/admin/telemetry/issues/detail?issueId=${encodeURIComponent(issue.issueId)}&hours=${hours}`,
				),
			);
		} catch {}
	};

	const handleExport = async () => {
		const params = new URLSearchParams({ hours });
		if (statusFilter !== "all") params.set("status", statusFilter);
		if (search) params.set("q", search);
		if (serviceFilter !== "all") params.set("service", serviceFilter);
		const r = await fetch(`/api/admin/telemetry/export?${params}`);
		const blob = await r.blob();
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `telemetry-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.jsonl`;
		a.click();
		URL.revokeObjectURL(a.href);
	};

	return (
		<div className="flex h-full flex-col overflow-hidden p-3">
			{/* Toolbar */}
			<div className="mb-2 flex-none rounded-md border border-stone-200 bg-white p-2">
				<div className="flex items-center gap-2">
					<input
						type="text"
						className="h-7 min-w-0 flex-1 rounded border border-stone-300 bg-white px-2 font-mono text-xs placeholder:text-stone-400 focus:border-stone-500 focus:outline-none"
						placeholder="Search spans, attributes..."
						value={searchInput}
						onChange={(e) => setSearchInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") setSearch(searchInput.trim());
						}}
					/>
					<button
						className="h-7 rounded border border-stone-300 bg-stone-50 px-2 text-xs text-stone-700 hover:bg-stone-100"
						onClick={() => setSearch(searchInput.trim())}
					>
						Search
					</button>
					<Sel
						value={hours}
						onChange={setHours}
						options={[
							["1", "1h"],
							["6", "6h"],
							["24", "24h"],
							["72", "72h"],
						]}
					/>
					<Sel
						value={statusFilter}
						onChange={setStatusFilter}
						options={[
							["all", "All"],
							["error", "Errors"],
							["ok", "OK"],
						]}
					/>
					<Sel
						value={serviceFilter}
						onChange={setServiceFilter}
						options={serviceOptions.map((s) => [
							s,
							s === "all" ? "All services" : s,
						])}
					/>
					{mode === "issues" && (
						<Sel
							value={category}
							onChange={setCategory}
							options={[
								["all", "All"],
								["error", "Errors"],
								["latency", "Latency"],
								["dependency", "Deps"],
							]}
						/>
					)}
					<button
						className="h-7 rounded border border-stone-900 bg-stone-900 px-2 text-xs font-medium text-white hover:opacity-90"
						onClick={loadAll}
					>
						Refresh
					</button>
					<button
						className="h-7 rounded border border-stone-300 bg-white px-2 text-xs text-stone-600 hover:bg-stone-50"
						onClick={handleExport}
					>
						Export
					</button>
				</div>
			</div>

			{loading && !overview ? (
				<p className="p-3 text-xs text-stone-500">Loading...</p>
			) : null}

			{mode === "traces" && overview && (
				<TracesView
					overview={overview}
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

// ── Traces View ──

function TracesView({
	overview,
	expandedTraceId,
	traceDetail,
	expandedSpanId,
	onExpandTrace,
	onExpandSpan,
}: {
	overview: Overview;
	expandedTraceId: string | null;
	traceDetail: TraceDetail | null;
	expandedSpanId: string | null;
	onExpandTrace: (id: string) => void;
	onExpandSpan: (id: string | null) => void;
}) {
	const s = overview.summary;
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<div className="mb-2 grid grid-cols-4 gap-2">
				<Stat label="Traces" value={s.totalTraces} />
				<Stat label="Errors" value={s.errorTraces} cls="text-red-600" />
				<Stat label="Err %" value={`${(s.errorRate * 100).toFixed(1)}%`} />
				<Stat label="P95 ms" value={Math.round(s.p95DurationMs)} />
			</div>

			<div className="rounded-md border border-stone-200 bg-white">
				{overview.traces.map((t) => {
					const isExpanded = expandedTraceId === t.traceId;
					const detail =
						isExpanded && traceDetail?.trace?.traceId === t.traceId
							? traceDetail
							: null;
					return (
						<div
							key={t.traceId}
							className="border-b border-stone-100 last:border-b-0"
						>
							{/* Log-line row */}
							<div
								className={`flex cursor-pointer items-start gap-2 px-2 py-1 hover:bg-stone-50 ${isExpanded ? "bg-stone-50" : ""} ${t.statusCode === 2 ? "bg-red-50/40" : ""}`}
								onClick={() => onExpandTrace(t.traceId)}
							>
								{t.statusCode === 2 && (
									<span className="mt-1 inline-block h-2 w-2 flex-none rounded-full bg-red-500" />
								)}
								<span className="flex-none whitespace-nowrap font-mono text-[10px] text-stone-400">
									{fmtTs(t.startTime)}
								</span>
								<span className="min-w-0 flex-1 font-mono text-xs leading-relaxed">
									<span
										className={`font-medium ${t.statusCode === 2 ? "text-red-700" : "text-stone-900"}`}
									>
										{t.spanName}
									</span>{" "}
									<span className="text-stone-400">{t.durationMs}ms</span>{" "}
									<span className="text-stone-400">{t.serviceName}</span>
									{t.spanCount > 1 && (
										<>
											{" "}
											<span className="text-stone-300">
												({t.spanCount} spans)
											</span>
										</>
									)}
									{t.statusMessage && (
										<>
											{" "}
											<span className="text-red-600">{t.statusMessage}</span>
										</>
									)}
								</span>
								<button
									className="flex-none cursor-copy font-mono text-[9px] text-stone-300 hover:text-stone-600"
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
								<div className="border-t border-stone-100 bg-stone-50/60 px-3 py-2">
									<TraceDetailView
										trace={detail}
										expandedSpanId={expandedSpanId}
										onExpandSpan={onExpandSpan}
									/>
								</div>
							)}
							{isExpanded && !detail && (
								<div className="border-t border-stone-100 bg-stone-50/60 px-3 py-2 text-xs text-stone-500">
									Loading...
								</div>
							)}
						</div>
					);
				})}
				{overview.traces.length === 0 && (
					<p className="px-2 py-4 text-xs text-stone-500">No traces found.</p>
				)}
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

	return (
		<div className="space-y-2">
			{/* Summary bar */}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px]">
				<span className="text-stone-400">
					trace{" "}
					<span className="text-stone-700">{meta.traceId.slice(0, 16)}...</span>
				</span>
				<span className="text-stone-400">
					service <span className="text-stone-700">{meta.serviceName}</span>
				</span>
				<span className="text-stone-400">
					duration <span className="text-stone-700">{meta.durationMs}ms</span>
				</span>
				<span className="text-stone-400">
					spans <span className="text-stone-700">{spans.length}</span>
				</span>
				{meta.errorSpanCount > 0 && (
					<span className="text-red-500">
						errors{" "}
						<span className="font-medium text-red-600">
							{meta.errorSpanCount}
						</span>
					</span>
				)}
				<span className="text-stone-400">
					start <span className="text-stone-700">{fmtTs(meta.startTime)}</span>
				</span>
				<button
					className="ml-auto text-[10px] text-stone-400 hover:text-stone-700"
					onClick={() => copy(JSON.stringify(trace, null, 2))}
				>
					Copy JSON
				</button>
			</div>

			{/* Waterfall — always show, click row to expand span */}
			<div className="rounded border border-stone-100 bg-white p-1.5">
				<p className="m-0 mb-1 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
					Waterfall
				</p>
				{tree.map((s) => {
					const sStart = new Date(s.startTime).getTime();
					const sEnd = new Date(s.endTime).getTime();
					const left = ((sStart - traceStart) / traceDuration) * 100;
					const width = Math.max(((sEnd - sStart) / traceDuration) * 100, 1);
					const isExpanded = expandedSpanId === s.spanId;
					const isError = s.statusCode === 2;
					return (
						<div key={s.spanId}>
							<div
								className={`flex cursor-pointer items-center gap-1 py-0.5 hover:bg-stone-50 ${isExpanded ? "bg-stone-50" : ""}`}
								onClick={() => onExpandSpan(isExpanded ? null : s.spanId)}
							>
								{/* Indented label */}
								<span
									className="flex-none truncate font-mono text-[10px]"
									style={{ width: 180, paddingLeft: s.depth * 12 }}
								>
									{s.depth > 0 && (
										<span className="text-stone-300 mr-0.5">{"\u2514"} </span>
									)}
									<span className={isError ? "text-red-600" : "text-stone-600"}>
										{s.spanName}
									</span>
								</span>
								{/* Bar */}
								<div className="relative h-3 min-w-0 flex-1 rounded bg-stone-100">
									<div
										className={`absolute top-0 h-full rounded ${isError ? "bg-red-400" : s.parentSpanId ? "bg-indigo-400" : "bg-blue-400"}`}
										style={{ left: `${left}%`, width: `${width}%` }}
									/>
								</div>
								<span className="w-14 flex-none text-right font-mono text-[10px] text-stone-400">
									{s.durationMs}ms
								</span>
							</div>
							{/* Expanded span detail */}
							{isExpanded && <SpanView span={s} />}
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
			className={`ml-4 mr-1 my-1 rounded border px-2 py-1.5 ${isError ? "border-red-200 bg-red-50/50" : "border-stone-200 bg-white"}`}
		>
			<div className="flex items-center gap-2">
				<span className="rounded bg-stone-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-stone-500">
					Span
				</span>
				<span
					className={`font-mono text-xs font-medium ${isError ? "text-red-700" : "text-stone-900"}`}
				>
					{span.spanName}
				</span>
				<span className="font-mono text-[10px] text-stone-500">
					{span.durationMs}ms
				</span>
				<span className="rounded bg-stone-100 px-1 py-0.5 text-[9px] text-stone-500">
					{SPAN_KIND[span.spanKind] ?? span.spanKind}
				</span>
				{isError && (
					<span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-semibold text-red-700">
						ERROR
					</span>
				)}
				<button
					className="ml-auto text-[10px] text-stone-400 hover:text-stone-700"
					onClick={() => copy(JSON.stringify(span, null, 2))}
				>
					Copy
				</button>
			</div>
			<div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]">
				<span className="text-stone-400">
					span_id{" "}
					<span className="text-stone-600">{span.spanId.slice(0, 16)}</span>
				</span>
				{span.parentSpanId && (
					<span className="text-stone-400">
						parent{" "}
						<span className="text-stone-600">
							{span.parentSpanId.slice(0, 16)}
						</span>
					</span>
				)}
				<span className="text-stone-400">
					service <span className="text-stone-600">{span.serviceName}</span>
				</span>
				<span className="text-stone-400">
					start <span className="text-stone-600">{fmtTs(span.startTime)}</span>
				</span>
				<span className="text-stone-400">
					end <span className="text-stone-600">{fmtTs(span.endTime)}</span>
				</span>
			</div>
			{span.statusMessage && (
				<div className="mt-1 rounded bg-red-100 px-2 py-1 font-mono text-[11px] text-red-700">
					{span.statusMessage}
				</div>
			)}
			{attrs.length > 0 && (
				<div className="mt-1.5">
					<p className="m-0 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
						Attributes
					</p>
					<AttrTable attrs={attrs} />
				</div>
			)}
			{resAttrs.length > 0 && (
				<div className="mt-1.5">
					<p className="m-0 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
						Resource
					</p>
					<AttrTable attrs={resAttrs} />
				</div>
			)}
			{collectorAttrs.length > 0 && (
				<div className="mt-1.5">
					<p className="m-0 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
						Collector
					</p>
					<AttrTable attrs={collectorAttrs} />
				</div>
			)}
			{events.length > 0 && (
				<div className="mt-1.5">
					<p className="m-0 mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
						Events ({events.length})
					</p>
					{events.map((evt, i) => (
						<div
							key={i}
							className={`rounded px-1.5 py-1 text-[10px] mb-0.5 ${evt.name.includes("error") || evt.name === "exception" ? "bg-red-50" : "bg-stone-100"}`}
						>
							<span
								className={`font-semibold ${evt.name.includes("error") ? "text-red-600" : "text-yellow-700"}`}
							>
								{evt.name}
							</span>
							{evt.attributes &&
								Object.entries(evt.attributes).map(([k, v]) => (
									<span key={k} className="ml-2 text-stone-500">
										{k}=
										<span className="text-stone-700">
											{String(v).slice(0, 120)}
										</span>
									</span>
								))}
						</div>
					))}
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
			<div className="rounded-md border border-stone-200 bg-white overflow-y-auto">
				<div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-200 bg-white px-2 py-1.5">
					<span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
						Issues ({overview.issues.length})
					</span>
				</div>
				{overview.issues.map((issue) => (
					<div
						key={issue.issueId}
						className={`cursor-pointer border-b border-stone-100 px-2 py-1.5 hover:bg-stone-50 ${selectedIssueId === issue.issueId ? "bg-stone-50" : ""}`}
						onClick={() => onSelect(issue)}
					>
						<div className="flex items-center gap-1.5">
							<Badge cls={sevCls[issue.severity]}>{issue.severity}</Badge>
							<Badge cls={catCls[issue.category]}>{issue.category}</Badge>
							<span className="min-w-0 truncate text-xs text-stone-900">
								{issue.routeLabel}
							</span>
							<span className="ml-auto font-mono text-[10px] text-stone-500">
								{issue.affectedTraceCount}
							</span>
						</div>
						<p className="m-0 mt-0.5 truncate text-[10px] text-stone-500">
							{issue.serviceName} &middot; {fmtTs(issue.lastSeen)}
						</p>
					</div>
				))}
				{overview.issues.length === 0 && (
					<p className="p-2 text-xs text-stone-500">No issues.</p>
				)}
			</div>

			{/* Detail */}
			<div className="rounded-md border border-stone-200 bg-white p-3 overflow-y-auto">
				{!selected ? (
					<p className="text-xs text-stone-500">Select an issue to inspect.</p>
				) : (
					<div className="space-y-3">
						<div>
							<div className="flex items-center gap-2">
								<Badge cls={sevCls[selected.severity]}>
									{selected.severity}
								</Badge>
								<Badge cls={catCls[selected.category]}>
									{selected.category}
								</Badge>
							</div>
							<p className="m-0 mt-1 text-sm font-medium text-stone-900">
								{selected.title}
							</p>
							<p className="m-0 mt-0.5 font-mono text-[10px] text-stone-500">
								{selected.routeLabel}
							</p>
						</div>
						<div className="grid grid-cols-2 gap-2 font-mono text-[10px]">
							<span className="text-stone-400">
								service{" "}
								<span className="text-stone-800">{selected.serviceName}</span>
							</span>
							<span className="text-stone-400">
								traces{" "}
								<span className="text-stone-800">
									{selected.affectedTraceCount}
								</span>
							</span>
							<span className="text-stone-400">
								culprit{" "}
								<span className="text-stone-800">
									{selected.culpritSpanName}
								</span>
							</span>
							<span className="text-stone-400">
								last{" "}
								<span className="text-stone-800">
									{fmtTs(selected.lastSeen)}
								</span>
							</span>
						</div>
						{selected.latestStatusMessage && (
							<div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">
								{selected.latestStatusMessage}
							</div>
						)}
						{issueDetail && issueDetail.issue.issueId === selected.issueId && (
							<>
								{issueDetail.culpritSpans.length > 0 && (
									<div>
										<p className="m-0 mb-1 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
											Culprit Spans
										</p>
										<table className="w-full text-[10px]">
											<thead>
												<tr className="border-b border-stone-100">
													<th className="text-left px-1 py-0.5 font-medium text-stone-400">
														Span
													</th>
													<th className="text-right px-1 py-0.5 font-medium text-stone-400">
														#
													</th>
													<th className="text-right px-1 py-0.5 font-medium text-stone-400">
														Avg
													</th>
													<th className="text-right px-1 py-0.5 font-medium text-stone-400">
														Max
													</th>
												</tr>
											</thead>
											<tbody>
												{issueDetail.culpritSpans.map((cs) => (
													<tr
														key={`${cs.spanName}-${cs.dependencyTarget}`}
														className="border-b border-stone-50"
													>
														<td className="px-1 py-0.5 text-stone-800">
															{cs.spanName}
															{cs.dependencyTarget && (
																<span className="text-stone-400 ml-1">
																	{cs.dependencyTarget}
																</span>
															)}
														</td>
														<td className="px-1 py-0.5 text-right text-stone-700">
															{cs.occurrenceCount}
														</td>
														<td className="px-1 py-0.5 text-right text-stone-700">
															{cs.averageDurationMs}ms
														</td>
														<td className="px-1 py-0.5 text-right text-stone-700">
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
										<p className="m-0 mb-1 text-[9px] font-semibold uppercase tracking-wider text-stone-400">
											Traces
										</p>
										{issueDetail.traces.map((t) => (
											<div
												key={t.traceId}
												className="flex items-center gap-2 border-b border-stone-50 py-0.5 font-mono text-[10px]"
											>
												<span
													className={`inline-block h-2 w-2 rounded-full ${t.statusCode === 2 ? "bg-red-500" : "bg-green-500"}`}
												/>
												<span className="text-stone-800">{t.routeLabel}</span>
												<span className="text-stone-400">{t.durationMs}ms</span>
												<span className="text-stone-400">
													{fmtTs(t.startTime)}
												</span>
												<button
													className="ml-auto text-stone-300 hover:text-stone-600"
													onClick={() => copy(t.traceId)}
												>
													{t.traceId.slice(0, 12)}
												</button>
											</div>
										))}
									</div>
								)}
							</>
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
		<div className="rounded border border-stone-200 bg-white px-2 py-1">
			<p className="m-0 text-[10px] uppercase tracking-wider text-stone-400">
				{label}
			</p>
			<p className={`m-0 text-sm font-semibold ${cls ?? "text-stone-900"}`}>
				{value}
			</p>
		</div>
	);
}

function Badge({ children, cls }: { children: React.ReactNode; cls?: string }) {
	return (
		<span
			className={`inline-block rounded border px-1 py-0 text-[9px] font-medium ${cls ?? ""}`}
		>
			{children}
		</span>
	);
}

function AttrTable({ attrs }: { attrs: [string, unknown][] }) {
	return (
		<div className="overflow-hidden rounded border border-stone-100">
			<table className="w-full">
				<tbody>
					{attrs.map(([k, v]) => (
						<tr key={k} className="border-b border-stone-100 last:border-b-0">
							<td className="whitespace-nowrap px-1.5 py-0.5 align-top font-mono text-[10px] text-stone-400">
								{k}
							</td>
							<td className="break-all px-1.5 py-0.5 font-mono text-[10px] text-stone-800">
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

function Sel({
	value,
	onChange,
	options,
}: {
	value: string;
	onChange: (v: string) => void;
	options: string[][];
}) {
	return (
		<select
			value={value}
			onChange={(e) => onChange(e.target.value)}
			className="h-7 rounded border border-stone-300 bg-white px-1.5 text-xs text-stone-700 focus:outline-none"
		>
			{options.map(([v, l]) => (
				<option key={v} value={v}>
					{l}
				</option>
			))}
		</select>
	);
}
