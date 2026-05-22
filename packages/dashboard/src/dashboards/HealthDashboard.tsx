import type {
	AnalysisDefinition,
	AnalysisGroup,
	AnalysisResult,
	AnalysisResultsBulkResponse,
	AnalysisStatus,
} from "@obs-unified/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/Button";
import { SectionTitle, UpdatedChip } from "../components/primitives";
import { EmptyState } from "../components/states";
import { useApi } from "../use-api";
import { PanelTile } from "./health/PanelTile";

const REFRESH_MS = 30_000;

const GROUP_ORDER: AnalysisGroup[] = [
	"Health",
	"Services",
	"Dependencies",
	"Async",
	"AI",
	"Frontend",
	"Custom",
];

const STATUS_RANK: Record<AnalysisStatus, number> = {
	critical: 0,
	warn: 1,
	ok: 2,
	unknown: 3,
};

interface PanelEntry {
	definition: AnalysisDefinition;
	result: AnalysisResult | null;
}

function statusOf(entry: PanelEntry): AnalysisStatus {
	return entry.result?.status ?? "unknown";
}

function sortPanels(a: PanelEntry, b: PanelEntry): number {
	const sa = STATUS_RANK[statusOf(a)];
	const sb = STATUS_RANK[statusOf(b)];
	if (sa !== sb) return sa - sb;
	return a.definition.title.localeCompare(b.definition.title);
}

function groupPanels(
	entries: PanelEntry[],
): Array<{ group: AnalysisGroup; panels: PanelEntry[] }> {
	const buckets = new Map<AnalysisGroup, PanelEntry[]>();
	for (const e of entries) {
		const list = buckets.get(e.definition.group) ?? [];
		list.push(e);
		buckets.set(e.definition.group, list);
	}
	const ordered: Array<{ group: AnalysisGroup; panels: PanelEntry[] }> = [];
	for (const g of GROUP_ORDER) {
		const list = buckets.get(g);
		if (list && list.length > 0) {
			ordered.push({ group: g, panels: list.slice().sort(sortPanels) });
		}
	}
	// Any unrecognised group falls to the end (defensive — types restrict this).
	for (const [g, list] of buckets) {
		if (!GROUP_ORDER.includes(g)) {
			ordered.push({ group: g, panels: list.slice().sort(sortPanels) });
		}
	}
	return ordered;
}

function tallyStatuses(entries: PanelEntry[]): Record<AnalysisStatus, number> {
	const counts: Record<AnalysisStatus, number> = {
		ok: 0,
		warn: 0,
		critical: 0,
		unknown: 0,
	};
	for (const e of entries) counts[statusOf(e)]++;
	return counts;
}

function SkeletonTile() {
	return (
		<div className="flex flex-col bg-sys-surface border border-sys-outline-soft min-h-[120px] animate-pulse">
			<div className="flex items-start justify-between gap-2 px-3 pt-2.5 pb-1.5">
				<span className="h-3 w-32 bg-sys-surface-low" />
				<span className="h-3 w-10 bg-sys-surface-low" />
			</div>
			<div className="px-3 pb-2">
				<div className="h-6 w-24 bg-sys-surface-low" />
				<div className="mt-2 h-3 w-40 bg-sys-surface-low" />
			</div>
			<div className="px-3 pb-3">
				<div className="h-[1px] w-full bg-sys-surface-low" />
			</div>
		</div>
	);
}

export function HealthDashboard() {
	const api = useApi();
	const [data, setData] = useState<AnalysisResultsBulkResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [focusMode, setFocusMode] = useState(false);
	const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
	// Once the user toggles focus mode we stop auto-deriving it from criticals,
	// otherwise an incoming critical would override their preference.
	const userTouchedFocusRef = useRef(false);

	const load = useCallback(async () => {
		try {
			// useApi prepends basePath ("/internal" in apps/web), so this resolves
			// to /internal/analyses/results.
			const res = await api<AnalysisResultsBulkResponse>("/analyses/results");
			setData(res);
			setLastFetchedAt(res.timestamp ?? new Date().toISOString());
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [api]);

	useEffect(() => {
		load();
		const id = window.setInterval(load, REFRESH_MS);
		return () => window.clearInterval(id);
	}, [load]);

	const entries: PanelEntry[] = useMemo(() => data?.results ?? [], [data]);
	const counts = useMemo(() => tallyStatuses(entries), [entries]);

	// Default focus-mode on if any critical is present, until the user touches it.
	useEffect(() => {
		if (userTouchedFocusRef.current) return;
		setFocusMode(counts.critical > 0);
	}, [counts.critical]);

	const visibleEntries = useMemo(() => {
		if (!focusMode) return entries;
		return entries.filter((e) => statusOf(e) !== "ok");
	}, [entries, focusMode]);

	// Stage 6 — auto-pinned panels render in their own section at the top
	// of the dashboard, deduped from their native group. The `pinned` flag
	// is computed server-side from Ask-box citations over the past week, so
	// the user gets a "what people are actually asking about" surface
	// without manual config.
	const pinnedEntries = useMemo(
		() =>
			visibleEntries
				.filter((e) => e.definition.pinned === true)
				.slice()
				.sort(sortPanels),
		[visibleEntries],
	);
	const groupedEntries = useMemo(
		() => visibleEntries.filter((e) => !e.definition.pinned),
		[visibleEntries],
	);
	const grouped = useMemo(() => groupPanels(groupedEntries), [groupedEntries]);
	const totalPanels = entries.length;
	const hiddenByFocus = focusMode ? counts.ok : 0;

	const breakdown = formatBreakdown(counts);

	const onToggleFocus = () => {
		userTouchedFocusRef.current = true;
		setFocusMode((v) => !v);
	};

	return (
		<div className="flex h-full flex-col bg-sys-bg p-2 font-sans text-sys-on-surface overflow-y-auto">
			{/* ── Top bar ───────────────────────────────────────────────────── */}
			<div className="mb-2 flex flex-none items-center gap-4 bg-sys-surface px-4 py-2 border-[1px] border-sys-outline">
				<span className="text-[0.8125rem] font-semibold text-sys-on-surface">
					Health
				</span>
				<div className="h-4 w-[1px] bg-sys-outline" />
				<span className="text-[0.8125rem] text-sys-on-surface-muted">
					{totalPanels === 0
						? "No analyses yet"
						: `${totalPanels} ${totalPanels === 1 ? "panel" : "panels"} · ${breakdown}`}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<UpdatedChip at={lastFetchedAt} />
					<Button
						variant="ghost"
						size="sm"
						active={focusMode}
						activeClassName="bg-sys-primary text-white font-semibold"
						onClick={onToggleFocus}
						title={
							focusMode
								? "Show all panels including healthy ones"
								: "Hide healthy panels and focus on warnings + criticals"
						}
					>
						{focusMode ? "Focus mode on" : "Focus mode"}
					</Button>
				</div>
			</div>

			{error && (
				<div className="p-3 bg-sys-error/10 border-l-[4px] border-sys-error mb-2">
					<p className="text-[0.8125rem] font-medium text-sys-error m-0">
						{error}
					</p>
				</div>
			)}

			{/* ── Body ──────────────────────────────────────────────────────── */}
			{loading && totalPanels === 0 ? (
				<div className="flex flex-col gap-3">
					<div>
						<SectionTitle title="Health" />
						<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
							<SkeletonTile />
							<SkeletonTile />
							<SkeletonTile />
							<SkeletonTile />
						</div>
					</div>
				</div>
			) : totalPanels === 0 ? (
				<div className="bg-sys-surface border-[1px] border-sys-outline">
					<EmptyState
						title="No analyses yet"
						description={
							<>
								Send some telemetry and the Health tab will populate. The
								quickest path is{" "}
								<span className="font-mono text-sys-on-surface">
									pnpm demo:up
								</span>{" "}
								to point the OpenTelemetry Astronomy Shop at the collector, or{" "}
								<span className="font-mono text-sys-on-surface">pnpm seed</span>{" "}
								for synthetic data without Docker. Tier 0 panels appear within
								about a minute of the first traffic.
							</>
						}
					/>
				</div>
			) : grouped.length === 0 && pinnedEntries.length === 0 ? (
				<div className="bg-sys-surface border-[1px] border-sys-outline">
					<EmptyState
						title="Everything looks healthy"
						description={
							<>
								Focus mode is hiding {hiddenByFocus}{" "}
								{hiddenByFocus === 1 ? "panel" : "panels"} in the ok state.
								Toggle it off to see them.
							</>
						}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{pinnedEntries.length > 0 ? (
						<section className="flex flex-col" data-test-pinned-section>
							<SectionTitle
								title="Pinned"
								note={`${pinnedEntries.length} ${pinnedEntries.length === 1 ? "panel" : "panels"} · auto-derived from Ask citations`}
							/>
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
								{pinnedEntries.map((p) => (
									<PanelTile
										key={p.definition.id}
										definition={p.definition}
										result={p.result}
									/>
								))}
							</div>
						</section>
					) : null}
					{grouped.map(({ group, panels }) => (
						<section key={group} className="flex flex-col">
							<SectionTitle
								title={group}
								note={`${panels.length} ${panels.length === 1 ? "panel" : "panels"}`}
							/>
							<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
								{panels.map((p) => (
									<PanelTile
										key={p.definition.id}
										definition={p.definition}
										result={p.result}
									/>
								))}
							</div>
						</section>
					))}
					{focusMode && hiddenByFocus > 0 && (
						<div className="text-[0.75rem] text-sys-on-surface-subtle px-1">
							{hiddenByFocus} healthy {hiddenByFocus === 1 ? "panel" : "panels"}{" "}
							hidden by focus mode.
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function formatBreakdown(counts: Record<AnalysisStatus, number>): string {
	const parts: string[] = [];
	if (counts.critical > 0) parts.push(`${counts.critical} critical`);
	if (counts.warn > 0) parts.push(`${counts.warn} warn`);
	if (counts.ok > 0) parts.push(`${counts.ok} ok`);
	if (counts.unknown > 0) parts.push(`${counts.unknown} unknown`);
	return parts.join(" · ");
}

export default HealthDashboard;
