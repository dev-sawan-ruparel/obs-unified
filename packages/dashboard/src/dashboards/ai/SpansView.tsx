import type {
	AIEvaluationRecord,
	AIEvaluationsListResponse,
	AISpanRecord,
	AISpansOverviewResponse,
} from "@obs-unified/types";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import { Button } from "../../components/Button";
import { ConnectedRail } from "../../components/ConnectedRail";
import { MessageView } from "../../components/MessageView";
import {
	BarList,
	binByInterval,
	Card,
	Chip,
	JsonBlock,
	percentile,
	SectionTitle,
	Stat,
	TimeSeriesBars,
	Waterfall,
	type WaterfallSpan,
} from "../../components/primitives";
import { SaveEvalCaseModal } from "../../components/SaveEvalCaseModal";
import { ErrorState, StateRow } from "../../components/states";
import { errorMessage, isAbortError, useApi } from "../../use-api";
import {
	attrNumber,
	attrString,
	formatCost,
	formatDuration,
	KIND_BG,
	KindBadge,
	SPAN_KINDS,
} from "./shared";
import { Toolbar, type View } from "./Toolbar";

// ── Spans view (master-detail) ─────────────────────────────────────────────

export interface SpansViewProps {
	hours: string;
	view: View;
	setView: (v: View) => void;
}

export function SpansView({ hours, view, setView }: SpansViewProps) {
	const api = useApi();
	const [overview, setOverview] = useState<AISpansOverviewResponse | null>(
		null,
	);
	const [kind, setKind] = useState<string>("");
	const [service, setService] = useState<string>("");
	const [model, setModel] = useState<string>("");
	const [provider, setProvider] = useState<string>("");
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<AISpanRecord | null>(null);
	const [traceSpans, setTraceSpans] = useState<AISpanRecord[] | null>(null);
	const [evals, setEvals] = useState<AIEvaluationRecord[] | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);

	const load = useCallback(
		async (signal?: AbortSignal) => {
			const qs = new URLSearchParams({ hours });
			if (kind) qs.set("kind", kind);
			if (service) qs.set("service", service);
			const data = await api<AISpansOverviewResponse>(`/ai/spans?${qs}`, {
				signal,
			});
			setOverview(data);
		},
		[hours, kind, service, api],
	);

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setLoadError(null);
		load(controller.signal)
			.catch((err) => {
				if (isAbortError(err)) return;
				setLoadError(errorMessage(err));
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [load]);

	// Filter client-side by model / provider / search.
	// (Server supports kind/service; client adds the rest without a round-trip.)
	const filteredSpans = useMemo(() => {
		const raw = overview?.spans ?? [];
		const needle = search.trim().toLowerCase();
		return raw.filter((s) => {
			if (model) {
				const m = attrString(s.attributes, "llm.model_name") ?? "";
				if (!m.toLowerCase().includes(model.toLowerCase())) return false;
			}
			if (provider) {
				const p = attrString(s.attributes, "llm.provider") ?? "";
				if (p.toLowerCase() !== provider.toLowerCase()) return false;
			}
			if (needle) {
				const hay = [
					s.spanName,
					s.serviceName ?? "",
					attrString(s.attributes, "llm.model_name") ?? "",
					attrString(s.attributes, "tool.name") ?? "",
					s.inputJson ?? "",
					s.outputJson ?? "",
				]
					.join(" ")
					.toLowerCase();
				if (!hay.includes(needle)) return false;
			}
			return true;
		});
	}, [overview, model, provider, search]);

	// Load detail (trace siblings + evals) when a span is selected.
	useEffect(() => {
		if (!selected) {
			setTraceSpans(null);
			setEvals(null);
			setDetailError(null);
			setDetailLoading(false);
			return;
		}
		const controller = new AbortController();
		setTraceSpans(null);
		setEvals(null);
		setDetailError(null);
		setDetailLoading(true);
		(async () => {
			try {
				const [spansRes, evalsRes] = await Promise.all([
					api<AISpansOverviewResponse>(
						`/ai/spans?traceId=${selected.traceId}&hours=720`,
						{ signal: controller.signal },
					),
					api<AIEvaluationsListResponse>(
						`/ai/evaluations?traceId=${selected.traceId}`,
						{ signal: controller.signal },
					),
				]);
				setTraceSpans(spansRes.spans);
				setEvals(evalsRes.evaluations);
			} catch (err) {
				if (isAbortError(err)) return;
				setDetailError(errorMessage(err));
			} finally {
				if (!controller.signal.aborted) setDetailLoading(false);
			}
		})();
		return () => controller.abort();
	}, [selected, api]);

	// Derived stats
	const spans = filteredSpans;
	const bucketCount = 24;
	const allBuckets = useMemo(
		() =>
			binByInterval(
				spans.map((s) => s.startTime),
				Number(hours) * 60,
				bucketCount,
			),
		[spans, hours],
	);
	const errorBuckets = useMemo(
		() =>
			binByInterval(
				spans.filter((s) => s.statusCode === 2).map((s) => s.startTime),
				Number(hours) * 60,
				bucketCount,
			),
		[spans, hours],
	);
	const llmSpans = useMemo(
		() => spans.filter((s) => s.spanKind === "LLM"),
		[spans],
	);
	const costTotal = useMemo(
		() =>
			llmSpans.reduce(
				(acc, s) => acc + (attrNumber(s.attributes, "llm.cost.total_usd") ?? 0),
				0,
			),
		[llmSpans],
	);
	const tokensPrompt = useMemo(
		() =>
			llmSpans.reduce(
				(acc, s) =>
					acc + (attrNumber(s.attributes, "llm.token_count.prompt") ?? 0),
				0,
			),
		[llmSpans],
	);
	const tokensCompletion = useMemo(
		() =>
			llmSpans.reduce(
				(acc, s) =>
					acc + (attrNumber(s.attributes, "llm.token_count.completion") ?? 0),
				0,
			),
		[llmSpans],
	);
	const p50 = useMemo(
		() =>
			percentile(
				llmSpans.map((s) => s.durationMs),
				0.5,
			),
		[llmSpans],
	);
	const p95 = useMemo(
		() =>
			percentile(
				llmSpans.map((s) => s.durationMs),
				0.95,
			),
		[llmSpans],
	);

	const byKind = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of spans) map.set(s.spanKind, (map.get(s.spanKind) ?? 0) + 1);
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [spans]);
	const _byModel = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of llmSpans) {
			const m = attrString(s.attributes, "llm.model_name") ?? "unknown";
			map.set(m, (map.get(m) ?? 0) + 1);
		}
		return Array.from(map.entries())
			.sort((a, b) => b[1] - a[1])
			.map(([k, v]) => [k, v] as [string, number]);
	}, [llmSpans]);

	const windowStart = Date.now() - Number(hours) * 60 * 60 * 1000;
	const bucketMs = (Number(hours) * 60 * 60 * 1000) / bucketCount;
	const timeSeries = allBuckets.map((v, i) => ({
		t: new Date(windowStart + i * bucketMs).toISOString(),
		v,
	}));

	const errorRate =
		spans.length > 0
			? (spans.filter((span) => span.statusCode === 2).length /
					Math.max(1, spans.length)) *
				100
			: 0;

	return (
		<>
			<Toolbar
				view={view}
				setView={setView}
				updatedAt={overview?.timestamp ?? null}
			>
				<input
					type="text"
					placeholder="Search prompts, models, services…"
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="h-7 min-w-[240px] max-w-[320px] flex-1 border-b border-sys-outline bg-transparent px-2 text-[0.75rem] font-mono placeholder:opacity-40 focus:border-sys-primary focus:outline-none"
				/>
				<select
					className="h-7 bg-transparent text-[0.6875rem] font-semibold border-b border-sys-outline focus:outline-none focus:border-sys-primary cursor-pointer"
					value={kind}
					onChange={(e) => setKind(e.target.value)}
				>
					<option value="">all kinds</option>
					{SPAN_KINDS.map((k) => (
						<option key={k} value={k}>
							{k}
						</option>
					))}
				</select>
				{(kind || service || model || provider) && (
					<div className="flex items-center gap-1">
						{kind && (
							<Chip onClear={() => setKind("")} tone="primary">
								kind:{kind}
							</Chip>
						)}
						{service && (
							<Chip onClear={() => setService("")} tone="accent">
								svc:{service}
							</Chip>
						)}
						{provider && (
							<Chip onClear={() => setProvider("")}>provider:{provider}</Chip>
						)}
						{model && <Chip onClear={() => setModel("")}>model:{model}</Chip>}
					</div>
				)}
			</Toolbar>

			{loadError && (
				<div className="flex-none px-2 pt-2">
					<ErrorState
						message={loadError}
						action={
							<button
								type="button"
								onClick={() => {
									const controller = new AbortController();
									setLoading(true);
									setLoadError(null);
									load(controller.signal)
										.catch((err) => {
											if (!isAbortError(err)) setLoadError(errorMessage(err));
										})
										.finally(() => {
											if (!controller.signal.aborted) setLoading(false);
										});
								}}
								className="flex-none border border-sys-error px-2 py-1 text-[0.6875rem] font-bold text-sys-error"
							>
								Retry
							</button>
						}
					/>
				</div>
			)}

			{/* Stats strip */}
			<div className="flex-none grid grid-cols-6 gap-2 p-2">
				<Stat
					label="Spans"
					value={(overview?.summary.totalSpans ?? 0).toLocaleString()}
					spark={allBuckets}
					note={`${hours}h`}
				/>
				<Stat
					label="LLM cost"
					value={formatCost(costTotal) ?? "$0"}
					accent="accent"
				/>
				<Stat
					label="Tokens (in/out)"
					value={`${tokensPrompt.toLocaleString()} / ${tokensCompletion.toLocaleString()}`}
				/>
				<Stat label="p50 latency" value={formatDuration(p50)} />
				<Stat
					label="p95 latency"
					value={formatDuration(p95)}
					accent={p95 > 3000 ? "warning" : "default"}
				/>
				<Stat
					label="Errors"
					value={(overview?.summary.errorSpans ?? 0).toLocaleString()}
					accent={(overview?.summary.errorSpans ?? 0) > 0 ? "error" : "default"}
					spark={errorBuckets}
					footer={spans.length > 0 ? `${errorRate.toFixed(1)}%` : undefined}
				/>
			</div>

			{/* Timeline + breakdown */}
			<div className="flex-none grid grid-cols-3 gap-2 px-2 pb-2">
				<Card className="col-span-2 p-2">
					<SectionTitle
						title="Spans over time"
						note={`${bucketCount} buckets · ${hours}h`}
					/>
					<TimeSeriesBars data={timeSeries} />
				</Card>
				<Card className="p-2">
					<SectionTitle title="By kind" />
					<BarList title="" items={byKind} />
				</Card>
			</div>

			{/* Master / detail body */}
			<div
				className="flex-1 min-h-0 grid gap-3 px-2 pb-2"
				style={{
					gridTemplateColumns: selected
						? "minmax(420px,0.95fr) minmax(0,1.25fr)"
						: "minmax(0,1fr)",
				}}
			>
				<Card className="min-h-0 overflow-hidden flex flex-col">
					<SectionTitle
						title="AI Spans"
						note={`${spans.length} of ${overview?.summary.totalSpans ?? 0}`}
					/>
					<div className="flex-1 overflow-y-auto">
						{loading && !overview && <StateRow>Loading AI spans…</StateRow>}
						{spans.map((s) => (
							<SpanRow
								key={`${s.traceId}-${s.spanId}`}
								span={s}
								selected={selected?.spanId === s.spanId}
								onClick={() =>
									setSelected(selected?.spanId === s.spanId ? null : s)
								}
								onSelectService={(svc) => setService(svc)}
								onSelectModel={(m) => setModel(m)}
								onSelectProvider={(p) => setProvider(p)}
							/>
						))}
						{!loading && !loadError && spans.length === 0 && (
							<div className="p-6 text-center text-[0.75rem] opacity-60">
								No spans match the current filters.
							</div>
						)}
					</div>
				</Card>

				{selected && (
					<div className="flex gap-3 min-h-0 overflow-hidden">
						<div className="flex-1 min-w-0">
							<SpanDetailPane
								span={selected}
								traceSpans={traceSpans}
								evaluations={evals}
								loading={detailLoading}
								error={detailError}
								onClose={() => setSelected(null)}
								onJumpTo={(span) => setSelected(span)}
							/>
						</div>
						{/* RFC 0006 — connected rail next to the AI span detail */}
						<ConnectedRail
							entityKind="ai_call"
							entityId={selected.spanId}
							traceId={selected.traceId}
						/>
					</div>
				)}
			</div>
		</>
	);
}

// ── Span row (master list item) ────────────────────────────────────────────

function SpanRow({
	span,
	selected,
	onClick,
	onSelectService,
	onSelectModel,
	onSelectProvider,
}: {
	span: AISpanRecord;
	selected: boolean;
	onClick: () => void;
	onSelectService: (svc: string) => void;
	onSelectModel: (m: string) => void;
	onSelectProvider: (p: string) => void;
}) {
	const model = attrString(span.attributes, "llm.model_name");
	const toolName = attrString(span.attributes, "tool.name");
	const provider = attrString(span.attributes, "llm.provider");
	const pt = attrNumber(span.attributes, "llm.token_count.prompt");
	const ct = attrNumber(span.attributes, "llm.token_count.completion");
	const cost = attrNumber(span.attributes, "llm.cost.total_usd");
	const computed = attrString(span.attributes, "llm.cost.computed");
	const isError = span.statusCode === 2;
	const displayName = model ?? toolName ?? span.spanName;
	const handleInlineKey = (
		event: ReactKeyboardEvent<HTMLElement>,
		action: () => void,
	) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.stopPropagation();
			action();
		}
	};
	return (
		<div
			className={`w-full text-left px-2 py-2 border-b border-sys-outline/30 hover:bg-sys-surface-low transition-none ${
				selected ? "bg-sys-surface-low border-l-[3px] border-l-sys-primary" : ""
			}`}
		>
			<div className="flex items-center gap-2 text-[0.6875rem] font-mono">
				<button
					type="button"
					className="text-left"
					aria-label={`Open span ${span.spanName}`}
					onClick={onClick}
				>
					<KindBadge kind={span.spanKind} />
				</button>
				{/* Click the model/tool name to filter by model. */}
				<button
					type="button"
					disabled={!model}
					className="font-bold truncate max-w-[32ch] hover:text-sys-primary cursor-pointer"
					title={model ? `filter model:${model}` : undefined}
					onClick={(e) => {
						if (!model) return;
						e.stopPropagation();
						onSelectModel(displayName);
					}}
					onKeyDown={(e) => {
						if (!model) return;
						handleInlineKey(e, () => onSelectModel(displayName));
					}}
				>
					{displayName}
				</button>
				{/* Click the provider to filter by provider. */}
				{provider && (
					<button
						type="button"
						className="opacity-50 hover:opacity-100 hover:text-sys-primary cursor-pointer"
						title={`filter provider:${provider}`}
						onClick={(e) => {
							e.stopPropagation();
							onSelectProvider(provider);
						}}
						onKeyDown={(e) =>
							handleInlineKey(e, () => onSelectProvider(provider))
						}
					>
						{provider}
					</button>
				)}
				{span.serviceName && (
					<button
						type="button"
						className="opacity-40 hover:opacity-100 cursor-pointer"
						onClick={(e) => {
							e.stopPropagation();
							if (span.serviceName) onSelectService(span.serviceName);
						}}
						onKeyDown={(e) => {
							const serviceName = span.serviceName;
							if (serviceName) {
								handleInlineKey(e, () => onSelectService(serviceName));
							}
						}}
					>
						· {span.serviceName}
					</button>
				)}
				<div className="flex-1" />
				{pt !== undefined && ct !== undefined && (
					<span className="opacity-60 tabular-nums">
						{pt}↑ {ct}↓
					</span>
				)}
				{cost !== undefined && cost > 0 && (
					<span
						className="opacity-70 tabular-nums"
						title={computed ? "computed from token counts" : "reported"}
					>
						{formatCost(cost)}
						{computed && <span className="opacity-50 ml-0.5">≈</span>}
					</span>
				)}
				<span className="opacity-70 tabular-nums">
					{formatDuration(span.durationMs)}
				</span>
				{isError && <span className="text-sys-error font-bold">ERR</span>}
				<span className="opacity-40 tabular-nums text-[0.625rem]">
					{new Date(span.startTime).toLocaleTimeString()}
				</span>
			</div>
			{/* Inline mini bar — relative duration within the row */}
			<div className="mt-1 h-[3px] w-full bg-sys-surface-low">
				<div
					className={`h-full ${isError ? "bg-sys-error" : (KIND_BG[span.spanKind] ?? "bg-sys-primary")}`}
					style={{
						width: `${Math.min(100, Math.max(2, (span.durationMs / 3000) * 100))}%`,
					}}
				/>
			</div>
		</div>
	);
}

// ── Detail pane (tabbed) ───────────────────────────────────────────────────

type DetailTab = "messages" | "attributes" | "waterfall" | "evaluations";

const safeParseJson = (str: string | null | undefined) => {
	if (!str) return null;
	try {
		return JSON.parse(str);
	} catch {
		return str;
	}
};

function SpanDetailPane({
	span,
	traceSpans,
	evaluations,
	loading,
	error,
	onClose,
	onJumpTo,
}: {
	span: AISpanRecord;
	traceSpans: AISpanRecord[] | null;
	evaluations: AIEvaluationRecord[] | null;
	loading: boolean;
	error: string | null;
	onClose: () => void;
	onJumpTo: (span: AISpanRecord) => void;
}) {
	const [tab, setTab] = useState<DetailTab>("messages");
	const [showEvalModal, setShowEvalModal] = useState(false);

	const evalsForSpan = useMemo(
		() => (evaluations ?? []).filter((e) => e.spanId === span.spanId),
		[evaluations, span.spanId],
	);

	const model = attrString(span.attributes, "llm.model_name");
	const provider = attrString(span.attributes, "llm.provider");
	const toolName = attrString(span.attributes, "tool.name");
	const pt = attrNumber(span.attributes, "llm.token_count.prompt");
	const ct = attrNumber(span.attributes, "llm.token_count.completion");
	const tt = attrNumber(span.attributes, "llm.token_count.total");
	const cost = attrNumber(span.attributes, "llm.cost.total_usd");
	const computed = attrString(span.attributes, "llm.cost.computed");
	const isError = span.statusCode === 2;

	const actionId = attrString(span.attributes, "obs.action.id");
	const agentRunId = attrString(span.attributes, "obs.agent_run.id");

	const suggestedOutcome = useMemo(() => {
		if (isError)
			return span.statusMessage || "Error: AI call failed during execution";
		if (evalsForSpan && evalsForSpan.length > 0) {
			const passed = evalsForSpan.filter(
				(e) => e.score === 1 || e.label === "pass",
			);
			const failed = evalsForSpan.filter(
				(e) => e.score === 0 || e.label === "fail",
			);
			if (failed.length > 0) {
				return `Failed evaluations: ${failed
					.map((e) => `${e.name} (${e.explanation || "no explanation"})`)
					.join("; ")}`;
			}
			if (passed.length > 0) {
				return `Passed evaluations: ${passed.map((e) => e.name).join(", ")}`;
			}
		}
		return `Successful GenAI completion using ${model || "model"} (${provider || "provider"}).`;
	}, [isError, span.statusMessage, evalsForSpan, model, provider]);

	const metadata = useMemo(() => {
		return {
			model: model ?? null,
			provider: provider ?? null,
			spanName: span.spanName,
			spanKind: span.spanKind,
			serviceName: span.serviceName ?? null,
			durationMs: span.durationMs,
			statusCode: span.statusCode,
			statusMessage: span.statusMessage ?? null,
			tokenCountPrompt: pt ?? null,
			tokenCountCompletion: ct ?? null,
			tokenCountTotal: tt ?? null,
			costTotalUsd: cost ?? null,
		};
	}, [
		model,
		provider,
		span.spanName,
		span.spanKind,
		span.serviceName,
		span.durationMs,
		span.statusCode,
		span.statusMessage,
		pt,
		ct,
		tt,
		cost,
	]);
	const spanId = span.spanId;

	useEffect(() => {
		if (!spanId) return;
		setTab("messages");
	}, [spanId]);

	return (
		<>
			<Card className="min-h-0 overflow-hidden flex flex-col">
				<div className="flex items-start justify-between gap-2 border-b border-sys-outline/30 p-3">
					<div className="flex flex-col gap-1 min-w-0">
						<div className="flex items-center gap-2">
							<KindBadge kind={span.spanKind} />
							<span className="font-bold font-mono text-[0.875rem] truncate">
								{model ?? toolName ?? span.spanName}
							</span>
							{isError && (
								<span className="px-1.5 py-[2px] text-[0.5rem] font-bold uppercase bg-sys-error text-white">
									error
								</span>
							)}
						</div>
						<div className="flex flex-wrap items-center gap-3 text-[0.625rem] font-mono opacity-70">
							{provider && <span>provider:{provider}</span>}
							{span.serviceName && <span>svc:{span.serviceName}</span>}
							<span>dur:{formatDuration(span.durationMs)}</span>
							{pt !== undefined && ct !== undefined && (
								<span>
									tok:{pt}↑/{ct}↓{tt !== undefined && ` (${tt})`}
								</span>
							)}
							{cost !== undefined && cost > 0 && (
								<span
									title={computed ? "computed from token counts" : "reported"}
								>
									{formatCost(cost)} {computed ? "≈" : ""}
								</span>
							)}
							<span className="opacity-60">
								{new Date(span.startTime).toLocaleString()}
							</span>
						</div>
						<div className="flex items-center gap-1 pt-1">
							<Chip>trace:{span.traceId.slice(0, 8)}…</Chip>
							<Chip>span:{span.spanId.slice(0, 8)}…</Chip>
							{isError && span.statusMessage && (
								<span className="text-[0.625rem] text-sys-error font-mono truncate max-w-[40ch]">
									{span.statusMessage}
								</span>
							)}
						</div>
					</div>
					<div className="flex items-center gap-2 flex-none">
						<Button
							variant="ghost"
							size="sm"
							onClick={() => setShowEvalModal(true)}
						>
							Save as eval case
						</Button>
						<button
							type="button"
							onClick={onClose}
							className="text-[0.75rem] opacity-60 hover:opacity-100 cursor-pointer"
							aria-label="Close detail"
						>
							✕
						</button>
					</div>
				</div>

				<div className="flex-none flex items-center border-b border-sys-outline/30">
					<DetailTabBtn
						active={tab === "messages"}
						onClick={() => setTab("messages")}
					>
						Messages
					</DetailTabBtn>
					<DetailTabBtn
						active={tab === "waterfall"}
						onClick={() => setTab("waterfall")}
					>
						Waterfall{" "}
						{traceSpans && (
							<span className="opacity-50 ml-1">({traceSpans.length})</span>
						)}
					</DetailTabBtn>
					<DetailTabBtn
						active={tab === "evaluations"}
						onClick={() => setTab("evaluations")}
					>
						Evaluations{" "}
						{evalsForSpan.length > 0 && (
							<span className="opacity-50 ml-1">({evalsForSpan.length})</span>
						)}
					</DetailTabBtn>
					{actionId && (
						<DetailTabLink href={`#/actions/${encodeURIComponent(actionId)}`}>
							Action Graph
						</DetailTabLink>
					)}
					<DetailTabBtn
						active={tab === "attributes"}
						onClick={() => setTab("attributes")}
					>
						Attributes
					</DetailTabBtn>
				</div>

				{error && (
					<div className="flex-none p-3">
						<ErrorState title="Failed to load trace context" message={error} />
					</div>
				)}
				<div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
					{tab === "messages" && (
						<div className="flex flex-col gap-3">
							<MessageView
								raw={span.inputJson}
								label="Input"
								defaultRole="user"
							/>
							<MessageView
								raw={span.outputJson}
								label="Output"
								defaultRole="assistant"
								accent={isError ? "error" : undefined}
							/>
						</div>
					)}

					{tab === "waterfall" && (
						<TraceWaterfall
							focusSpanId={span.spanId}
							spans={traceSpans}
							loading={loading}
							onJumpTo={onJumpTo}
						/>
					)}

					{tab === "evaluations" && (
						<EvaluationsList evaluations={evalsForSpan} />
					)}

					{tab === "attributes" && (
						<JsonBlock
							label="attributes"
							value={JSON.stringify(span.attributes, null, 2)}
						/>
					)}
				</div>
			</Card>
			{showEvalModal && (
				<SaveEvalCaseModal
					sourceEntityType="ai_call"
					sourceEntityId={span.spanId}
					sourceTraceId={span.traceId}
					sourceSpanId={span.spanId}
					sourceAgentRunId={agentRunId || undefined}
					sourceActionId={actionId || undefined}
					sourceAiCallId={span.spanId}
					prefillExpectedOutcome={suggestedOutcome}
					redactedPrompt={safeParseJson(span.inputJson)}
					referencePayload={safeParseJson(span.outputJson)}
					metadata={metadata}
					onClose={() => setShowEvalModal(false)}
				/>
			)}
		</>
	);
}

function detailTabClassName(active: boolean) {
	return `px-3 py-2 text-[0.8125rem] font-medium cursor-pointer border-b-2 ${
		active
			? "border-sys-primary text-sys-on-surface"
			: "border-transparent text-sys-on-surface/60 hover:text-sys-on-surface hover:bg-sys-surface-low"
	}`;
}

function DetailTabBtn({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: import("react").ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={detailTabClassName(active)}
		>
			{children}
		</button>
	);
}

function DetailTabLink({
	href,
	children,
}: {
	href: string;
	children: import("react").ReactNode;
}) {
	return (
		<a
			href={href}
			onClick={() => {
				if (typeof window !== "undefined") {
					window.location.hash = href.slice(1);
				}
			}}
			className={detailTabClassName(false)}
		>
			{children}
		</a>
	);
}

// ── Trace waterfall tab ────────────────────────────────────────────────────

function TraceWaterfall({
	focusSpanId,
	spans,
	loading,
	onJumpTo,
}: {
	focusSpanId: string;
	spans: AISpanRecord[] | null;
	loading: boolean;
	onJumpTo: (span: AISpanRecord) => void;
}) {
	// Order for gantt: by start time, depth-first within parent groups.
	const ordered = useMemo(
		() => (spans ? orderSpansForGantt(spans) : []),
		[spans],
	);

	if (!spans) {
		return (
			<div className="text-[0.75rem] opacity-60 font-mono">
				{loading ? "Loading trace…" : "Trace context unavailable."}
			</div>
		);
	}
	if (spans.length === 0) {
		return (
			<div className="text-[0.75rem] opacity-60 font-mono">
				No spans in trace.
			</div>
		);
	}

	const items: WaterfallSpan[] = ordered.map((s) => {
		const model = attrString(s.attributes, "llm.model_name");
		const toolName = attrString(s.attributes, "tool.name");
		return {
			spanId: s.spanId,
			parentSpanId: s.parentSpanId,
			startTime: s.startTime,
			endTime: s.endTime,
			durationMs: s.durationMs,
			label: `${s.spanKind}: ${model ?? toolName ?? s.spanName}${s.spanId === focusSpanId ? " ←" : ""}`,
			color: KIND_BG[s.spanKind] ?? "bg-sys-primary",
			isError: s.statusCode === 2,
			onClick: () => onJumpTo(s),
		};
	});

	return (
		<div className="flex flex-col gap-2">
			<div className="text-[0.625rem] font-bold uppercase tracking-[0.05em] opacity-70">
				Trace waterfall
			</div>
			<Waterfall spans={items} />
		</div>
	);
}

function orderSpansForGantt(spans: AISpanRecord[]): AISpanRecord[] {
	const children = new Map<string | null, AISpanRecord[]>();
	for (const s of spans) {
		const key = s.parentSpanId ?? null;
		if (!children.has(key)) children.set(key, []);
		children.get(key)?.push(s);
	}
	for (const list of children.values()) {
		list.sort((a, b) => a.startTime.localeCompare(b.startTime));
	}
	const known = new Set(spans.map((s) => s.spanId));
	const out: AISpanRecord[] = [];
	const walk = (parentId: string | null) => {
		const kids = children.get(parentId) ?? [];
		for (const s of kids) {
			out.push(s);
			walk(s.spanId);
		}
	};
	// Roots = parent not in set, or parent null
	for (const s of spans) {
		if (s.parentSpanId === null || !known.has(s.parentSpanId)) {
			// Walk from each root
		}
	}
	walk(null);
	// Walk any orphan roots (parent unknown)
	const seen = new Set(out.map((s) => s.spanId));
	for (const s of spans) {
		if (!seen.has(s.spanId)) {
			out.push(s);
			walk(s.spanId);
		}
	}
	return out;
}

// ── Evaluations list ───────────────────────────────────────────────────────

function EvaluationsList({
	evaluations,
}: {
	evaluations: AIEvaluationRecord[];
}) {
	if (evaluations.length === 0) {
		return (
			<div className="text-[0.75rem] opacity-60 font-mono">
				No evaluations for this span yet. Post one to{" "}
				<code className="bg-sys-surface-low px-1">/v1/ai/evaluations</code>.
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{evaluations.map((e) => (
				<div
					key={e.evaluationId}
					className="p-2 bg-sys-surface-low border-l-[3px] border-sys-primary"
				>
					<div className="flex items-center justify-between gap-2 mb-1">
						<div className="flex items-center gap-2">
							<span className="font-bold text-[0.75rem] font-mono">
								{e.name}
							</span>
							<Chip>{e.source}</Chip>
						</div>
						<div className="flex items-center gap-3 text-[0.6875rem] font-mono">
							{e.score !== null && (
								<span className="font-bold">{e.score.toFixed(2)}</span>
							)}
							{e.label && <span className="opacity-80">{e.label}</span>}
						</div>
					</div>
					{e.explanation && (
						<div className="text-[0.6875rem] font-mono opacity-70 whitespace-pre-wrap">
							{e.explanation}
						</div>
					)}
					<div className="mt-1 text-[0.5625rem] font-mono opacity-40">
						{new Date(e.createdAt).toLocaleString()}
					</div>
				</div>
			))}
		</div>
	);
}
