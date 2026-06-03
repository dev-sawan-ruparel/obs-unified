import { useEffect, useState } from "react";
import { ConnectedRail } from "../../components/ConnectedRail";
import { FlameGraph } from "../../components/flame-graph/FlameGraph";
import { buildIdeUrl } from "../../components/ide-link";
import { SaveEvalCaseModal } from "../../components/SaveEvalCaseModal";
import { useApi } from "../../use-api";
import { AttrTable, copy, fmtTs } from "./shared";
import { buildSpanTree, isLikelyUninstrumented } from "./span-tree";
import type { SpanDetail, TraceDetail } from "./types";

const SPAN_KIND: Record<number, string> = {
	0: "Unspecified",
	1: "Internal",
	2: "Server",
	3: "Client",
	4: "Producer",
	5: "Consumer",
};

export function TraceDetailView({
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
	const spanStarts = spans.map((s) => new Date(s.startTime).getTime());
	const spanEnds = spans.map((s) => new Date(s.endTime).getTime());
	const traceStart = spanStarts.length
		? Math.min(...spanStarts)
		: new Date(meta.startTime).getTime();
	const traceEnd = spanEnds.length ? Math.max(...spanEnds) : traceStart;
	const traceDuration = traceEnd - traceStart || 1;
	const tree = buildSpanTree(spans);
	const slowestSpan =
		tree.length > 0
			? tree.reduce((prev, curr) => (prev.selfMs > curr.selfMs ? prev : curr))
			: null;

	const totalSelfMs = tree.reduce((acc, s) => acc + s.selfMs, 0);
	const asyncParents = tree.filter((s) => s.asyncParent).length;
	const uninstrumentedCount = tree.filter(isLikelyUninstrumented).length;
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
	const [showEvalModal, setShowEvalModal] = useState(false);

	const isFailedTrace =
		meta.errorSpanCount > 0 || spans.some((s) => s.statusCode === 2);
	const firstErrorSpan = spans.find((s) => s.statusCode === 2);

	const suggestedOutcome = (() => {
		const errSpans = spans.filter((s) => s.statusCode === 2);
		if (errSpans.length > 0) {
			return `Failed trace containing ${errSpans.length} error span(s): ${errSpans.map((s) => `${s.spanName} (${s.statusMessage || "no message"})`).join("; ")}`;
		}
		return "Trace execution failed.";
	})();

	const metadata = {
		serviceName: meta.serviceName,
		durationMs: meta.durationMs,
		totalSpans: spans.length,
		errorSpanCount: meta.errorSpanCount,
		traceStart: fmtTs(meta.startTime),
	};

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
		<>
			<div className="space-y-4">
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
							title="Spans where most time is unaccounted for - consider adding child spans, or attaching a profile (RFC 0007)."
						>
							UNINSTRUMENTED{" "}
							<span className="font-bold">{uninstrumentedCount}</span>
						</span>
					)}
					{asyncParents > 0 && (
						<span
							className="opacity-60"
							title="Spans whose children's wall-clock exceeds the parent's window - fan-out work where self-time is not meaningful."
						>
							ASYNC <span className="opacity-100">{asyncParents}</span>
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
							Profile {p.serviceName ?? "?"}/{p.profileType}
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
					<div className="ml-auto flex items-center gap-2 flex-none">
						{isFailedTrace && (
							<button
								type="button"
								className="underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 transition-none"
								onClick={() => setShowEvalModal(true)}
							>
								Save as eval case
							</button>
						)}
						<button
							type="button"
							className="underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 transition-none"
							onClick={() => copy(JSON.stringify(trace, null, 2))}
						>
							Copy JSON
						</button>
					</div>
				</div>

				{openProfile && (
					<div className="bg-sys-surface border border-sys-surface-low">
						<div className="flex items-center gap-3 px-3 py-2 border-b border-sys-surface-low">
							<span className="text-[0.75rem] font-bold opacity-70">
								Flame graph - {openProfile.serviceName ?? "?"}/
								{openProfile.profileType}
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
							profileType={
								openProfile.profileType as
									| "cpu"
									| "heap"
									| "wall"
									| "block"
									| "mutex"
									| "goroutine"
									| "offcpu"
							}
							title={`Profile prof-${openProfile.id.slice(0, 8)} - scoped to trace`}
						/>
					</div>
				)}

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
						const selfBarWidth = width * s.selfRatio;

						const isDbQuery = !!(
							s.attributes &&
							Object.keys(s.attributes).some((k) => k.includes("db.system"))
						);
						const isHttpClient = s.spanKind === 3;
						const isSlowest = !!(
							slowestSpan &&
							s.spanId === slowestSpan.spanId &&
							s.selfMs > 0
						);

						const baseColor = isError
							? "bg-sys-error"
							: isDbQuery
								? "bg-sys-accent"
								: isHttpClient
									? "bg-sys-warning"
									: s.parentSpanId
										? "bg-sys-outline"
										: "bg-sys-primary";

						const uninstrumented = isLikelyUninstrumented(s);
						return (
							<div key={s.spanId}>
								<button
									type="button"
									data-testid="trace-waterfall-span"
									data-span-id={s.spanId}
									data-trace-id={s.traceId}
									aria-expanded={isExpanded}
									className={`flex w-full cursor-pointer items-center gap-2 py-1.5 text-left hover:bg-sys-surface-low transition-none border-b border-sys-bg ${isExpanded ? "bg-sys-surface-low" : ""}`}
									onClick={() => onExpandSpan(isExpanded ? null : s.spanId)}
								>
									<span
										className="flex-none truncate font-mono text-[0.75rem] font-bold"
										style={{ width: 180, paddingLeft: s.depth * 12 }}
									>
										{s.depth > 0 && <span className="opacity-40 mr-1">L </span>}
										<span className={isError ? "text-sys-error" : ""}>
											{s.spanName}
										</span>
										{uninstrumented && (
											<span
												className="ml-1 text-sys-warn"
												title={`${Math.round(s.selfMs)}ms of ${s.durationMs}ms is unaccounted for. Consider adding child spans or attaching a profile.`}
											>
												!
											</span>
										)}
										{profileMatches.length > 0 && (
											<span
												className="ml-1 text-sys-primary"
												title={`pprof profile(s) cover this trace: ${profileMatches.map((p) => `${p.serviceName ?? "?"}/${p.profileType}`).join(", ")}. Open Profiles tab to drill in.`}
											>
												prof
											</span>
										)}
									</span>
									<div className="flex items-center gap-1 flex-none mr-2">
										{isDbQuery && (
											<span className="text-[0.625rem] bg-sys-accent/10 text-sys-accent px-1 font-sans font-bold border border-sys-accent/20">
												[DB]
											</span>
										)}
										{isHttpClient && (
											<span className="text-[0.625rem] bg-sys-warning/10 text-sys-warning px-1 font-sans font-bold border border-sys-warning/20">
												[HTTP]
											</span>
										)}
										{isSlowest && (
											<span className="text-[0.625rem] bg-sys-error/10 text-sys-error px-1 font-sans font-bold border border-sys-error/20 animate-pulse">
												🔥 slowest
											</span>
										)}
									</div>
									<div className="relative h-[8px] min-w-0 flex-1 bg-sys-bg">
										{s.asyncParent ? (
											<div
												className="absolute top-0 h-full opacity-60"
												style={{
													left: `${left}%`,
													width: `${width}%`,
													backgroundImage: `repeating-linear-gradient(45deg, var(--color-sys-outline) 0 4px, transparent 4px 8px), linear-gradient(${isError ? "var(--color-sys-error)" : isDbQuery ? "var(--color-sys-accent)" : isHttpClient ? "var(--color-sys-warning)" : "var(--color-sys-primary)"}, ${isError ? "var(--color-sys-error)" : isDbQuery ? "var(--color-sys-accent)" : isHttpClient ? "var(--color-sys-warning)" : "var(--color-sys-primary)"})`,
													backgroundBlendMode: "normal",
												}}
												title={`Async parent - children's wall (${Math.round(s.durationMs - s.selfMs)}ms) exceeds parent's window. Self-time clamped to 0.`}
											/>
										) : (
											<>
												<div
													className={`absolute top-0 h-full ${baseColor} opacity-30`}
													style={{ left: `${left}%`, width: `${width}%` }}
												/>
												<div
													className={`absolute top-0 h-full ${baseColor}`}
													style={{
														left: `${left}%`,
														width: `${selfBarWidth}%`,
													}}
													title={`Self ${Math.round(s.selfMs)}ms / ${s.durationMs}ms wall (${Math.round(s.selfRatio * 100)}%)`}
												/>
											</>
										)}
									</div>
									<span className="w-16 flex-none text-right font-mono text-[0.75rem] opacity-60">
										{s.durationMs}ms
									</span>
								</button>
								{isExpanded && (
									<div className="flex flex-col md:flex-row gap-2 ml-6 mr-2">
										<div className="flex-1 min-w-0">
											<SpanView span={s} isSlowest={isSlowest} />
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
			{showEvalModal && (
				<SaveEvalCaseModal
					sourceEntityType="trace"
					sourceEntityId={meta.traceId}
					sourceTraceId={meta.traceId}
					sourceSpanId={firstErrorSpan?.spanId || spans[0]?.spanId}
					prefillExpectedOutcome={suggestedOutcome}
					metadata={metadata}
					onClose={() => setShowEvalModal(false)}
				/>
			)}
		</>
	);
}

function SpanView({
	span,
	isSlowest = false,
}: {
	span: SpanDetail & { selfMs?: number; selfRatio?: number };
	isSlowest?: boolean;
}) {
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
					{span.durationMs}ms wall
				</span>
				{span.selfMs !== undefined && (
					<span className="font-mono text-[0.75rem] text-sys-primary font-bold">
						{Math.round(span.selfMs)}ms self (
						{Math.round((span.selfRatio ?? 0) * 100)}%)
					</span>
				)}
				<span className="bg-sys-surface-low px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em]">
					{SPAN_KIND[span.spanKind] ?? span.spanKind}
				</span>
				{isSlowest && (
					<span className="bg-sys-error px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-error animate-pulse">
						🔥 SLOWEST SPAN
					</span>
				)}
				{isError && (
					<span className="bg-sys-error px-2 py-1 text-[0.625rem] font-bold uppercase tracking-[0.05em] text-sys-on-error">
						SYSTEM_ERROR
					</span>
				)}
				<button
					type="button"
					className="ml-auto underline cursor-pointer hover:bg-sys-primary hover:text-white px-2 py-0.5 text-[0.75rem] font-mono transition-none"
					onClick={() => copy(JSON.stringify(span, null, 2))}
				>
					Copy JSON
				</button>
			</div>
			<div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[0.75rem]">
				<span className="opacity-60">
					SPAN_ID{" "}
					<span className="opacity-100">{span.spanId.slice(0, 16)}</span>
				</span>
				{span.parentSpanId && (
					<span className="opacity-60">
						PARENT{" "}
						<span className="opacity-100">
							{span.parentSpanId.slice(0, 16)}
						</span>
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
			{span.codeReference &&
				(() => {
					const rel = span.codeReference.relativePath;
					const abs = span.codeReference.absolutePath;
					const orig = span.codeReference.originalPath;
					const isRedacted = (path?: string) =>
						!path || path.includes("redacted") || path === "<redacted>";
					const isRelRedacted = isRedacted(rel);
					const isAbsRedacted = isRedacted(abs);
					const isOrigRedacted = isRedacted(orig);

					const lineCol = [
						span.codeReference.lineNumber,
						span.codeReference.columnNumber,
					]
						.filter((x): x is number => typeof x === "number" && x > 0)
						.join(":");

					const suffix = lineCol ? `:${lineCol}` : "";
					const ideUrl = buildIdeUrl(span.codeReference);

					return (
						<div className="mt-2 bg-sys-surface-low border border-sys-outline-soft p-2 text-[0.75rem] flex flex-col gap-1.5 md:flex-row md:items-center">
							<span className="font-bold uppercase tracking-[0.05em] text-sys-on-surface-subtle flex-none mr-2">
								Code Reference
							</span>
							<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
								{span.codeReference.symbolName && (
									<span
										className="font-mono bg-sys-surface px-1.5 py-0.5 border border-sys-outline-soft font-semibold text-sys-on-surface select-all truncate max-w-[200px]"
										title={span.codeReference.symbolName}
									>
										{span.codeReference.symbolName}
									</span>
								)}
								{rel && (
									<div className="flex items-center gap-1.5 min-w-0 font-mono">
										<span className="opacity-60 text-[0.6875rem] uppercase">
											rel:
										</span>
										<span
											className={`select-all truncate max-w-[250px] ${isRelRedacted ? "italic opacity-50" : ""}`}
											title={rel + suffix}
										>
											{isRelRedacted ? "[redacted]" : rel + suffix}
										</span>
										{!isRelRedacted && (
											<button
												type="button"
												onClick={() => copy(rel)}
												className="text-sys-on-surface-muted hover:text-sys-on-surface text-[0.625rem] px-1 border border-sys-outline-soft cursor-pointer flex-none"
												title="Copy Relative Path"
											>
												Copy
											</button>
										)}
									</div>
								)}
								{abs && (
									<div className="flex items-center gap-1.5 min-w-0 font-mono">
										<span className="opacity-60 text-[0.6875rem] uppercase">
											abs:
										</span>
										<span
											className={`select-all truncate max-w-[250px] ${isAbsRedacted ? "italic opacity-50" : ""}`}
											title={abs + suffix}
										>
											{isAbsRedacted ? "[redacted]" : abs + suffix}
										</span>
										{!isAbsRedacted && (
											<button
												type="button"
												onClick={() => copy(abs)}
												className="text-sys-on-surface-muted hover:text-sys-on-surface text-[0.625rem] px-1 border border-sys-outline-soft cursor-pointer flex-none"
												title="Copy Absolute Path"
											>
												Copy
											</button>
										)}
									</div>
								)}
								{!rel && !abs && orig && (
									<div className="flex items-center gap-1.5 min-w-0 font-mono">
										<span className="opacity-60 text-[0.6875rem] uppercase">
											path:
										</span>
										<span
											className={`select-all truncate max-w-[250px] ${isOrigRedacted ? "italic opacity-50" : ""}`}
											title={orig + suffix}
										>
											{isOrigRedacted ? "[redacted]" : orig + suffix}
										</span>
										{!isOrigRedacted && (
											<button
												type="button"
												onClick={() => copy(orig)}
												className="text-sys-on-surface-muted hover:text-sys-on-surface text-[0.625rem] px-1 border border-sys-outline-soft cursor-pointer flex-none"
												title="Copy Path"
											>
												Copy
											</button>
										)}
									</div>
								)}
								{!rel && !abs && !orig && (
									<span className="italic text-sys-on-surface-muted font-mono">
										[no path reference]
									</span>
								)}
								{ideUrl &&
									(!isRelRedacted || !isAbsRedacted || !isOrigRedacted) && (
										<a
											href={ideUrl}
											target="_blank"
											rel="noreferrer"
											className="underline text-sys-primary hover:text-sys-primary-high font-bold font-mono text-[0.6875rem] px-1 border border-sys-primary/20 bg-sys-primary/5 hover:bg-sys-primary/10 transition-all flex-none"
											title="Open in Local IDE"
										>
											Open IDE
										</a>
									)}
							</div>
						</div>
					);
				})()}
			{span.statusMessage && (
				<div className="mt-2 bg-sys-error p-3 font-mono text-[0.75rem] text-sys-on-error font-bold">
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
						{events.map((evt) => (
							<div
								key={`${evt.name}-${JSON.stringify(evt.attributes ?? {})}`}
								className={`px-3 py-2 text-[0.75rem] ${evt.name.includes("error") || evt.name === "exception" ? "bg-sys-error/10 text-sys-error" : "bg-sys-surface"}`}
							>
								<span className="font-bold">{evt.name}</span>
								{evt.attributes &&
									Object.entries(evt.attributes).map(([k, v]) => (
										<span key={k} className="ml-4 font-mono opacity-80">
											{k}=
											<span className="opacity-100 font-bold">
												{String(v).slice(0, 120)}
											</span>
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
